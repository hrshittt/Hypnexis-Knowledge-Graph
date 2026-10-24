"""
Document ingestion primitives: validation, text extraction, normalisation, chunking.

Chunks are sentence-aligned and carry exact offsets into their page text, so every
citation can point back to (filename, page, start_char, end_char).
"""

import hashlib
import io
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple

from backend.kb.text_utils import split_sentences

ALLOWED_TYPES = {".pdf": "pdf", ".txt": "text", ".md": "text"}


class DocumentError(ValueError):
    """Raised for files we refuse to ingest. `code` is machine-readable for the UI."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class PageText:
    page: int   # 1-based; text files are a single page
    text: str


@dataclass
class Chunk:
    chunk_id: str
    doc_id: str
    page: int
    chunk_index: int
    start_char: int
    end_char: int
    text: str


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def doc_id_for(sha: str) -> str:
    return f"d_{sha[:16]}"


def safe_filename(name: str) -> str:
    base = Path(name or "upload").name
    base = re.sub(r"[^A-Za-z0-9._\- ]+", "_", base).strip(" .") or "upload"
    return base[:180]


def validate_upload(filename: str, data: bytes, max_bytes: int) -> str:
    """Return the file type ('pdf' | 'text') or raise DocumentError."""
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_TYPES:
        raise DocumentError(
            "unsupported_type",
            f"Unsupported file type '{ext or 'none'}'. Upload PDF or TXT files.",
        )
    if not data:
        raise DocumentError("empty_file", "The file is empty.")
    if len(data) > max_bytes:
        raise DocumentError(
            "too_large", f"File is {len(data) / 1048576:.1f} MB; the limit is {max_bytes // 1048576} MB."
        )
    ftype = ALLOWED_TYPES[ext]
    if ftype == "pdf" and not data.lstrip()[:5].startswith(b"%PDF-"):
        raise DocumentError("invalid_pdf", "File has a .pdf extension but is not a valid PDF.")
    if ftype == "text" and b"\x00" in data[:8192] and not data.startswith((b"\xff\xfe", b"\xfe\xff")):
        raise DocumentError("binary_text", "File looks binary, not plain text.")
    return ftype


def _decode_text(data: bytes) -> str:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


_TERMINAL = (".", "!", "?", ":", ";", '"', "”", ")")


def _is_heading(line: str, prev: str, nxt: str, prev_heading: bool = False) -> bool:
    s = line.strip()
    if not s or len(s) > 70 or s.endswith(_TERMINAL) or s.endswith(","):
        return False
    if not (s[0].isupper() or s[0].isdigit() or s.startswith("#")):
        return False
    prev_s = prev.strip()
    prev_ok = prev_heading or (not prev_s) or prev_s.endswith(_TERMINAL) or prev_s.startswith("#")
    nxt_s = nxt.strip()
    next_ok = (not nxt_s) or nxt_s[0].isupper() or nxt_s[0].isdigit()
    return prev_ok and next_ok


def normalize_text(raw: str) -> str:
    """
    Repair layout artefacts while keeping paragraph and heading boundaries:
      - de-hyphenate words broken across lines
      - join soft-wrapped lines inside a paragraph
      - keep headings and blank-line paragraph breaks as newlines
    """
    text = raw.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ").replace(" ", " ")
    text = re.sub(r"(?<=[a-z])-\n(?=[a-z])", "", text)
    lines = [re.sub(r"[ \f\v]+", " ", ln).strip() for ln in text.split("\n")]
    out: List[str] = []
    prev_heading = False
    for i, line in enumerate(lines):
        prev = lines[i - 1] if i > 0 else ""
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if not line:
            if out and out[-1] != "\n\n":
                out.append("\n\n")
            prev_heading = False
            continue
        heading = _is_heading(line, prev, nxt, prev_heading) or line.startswith("#")
        prev_heading = heading
        if heading:
            if out and out[-1] not in ("\n", "\n\n"):
                out.append("\n")
            out.append(line.lstrip("# ").strip())
            out.append("\n")
            continue
        if out and out[-1] not in ("\n", "\n\n"):
            out.append(" ")
        out.append(line)
    joined = "".join(out)
    joined = re.sub(r"\n{3,}", "\n\n", joined)
    return joined.strip()


def extract_pages(data: bytes, file_type: str) -> List[PageText]:
    if file_type == "pdf":
        try:
            from pypdf import PdfReader
            from pypdf.errors import PdfReadError
        except ImportError as e:  # pragma: no cover - dependency is in requirements
            raise DocumentError("pdf_support_missing", "pypdf is not installed on the server.") from e
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                try:
                    reader.decrypt("")
                except Exception as e:
                    raise DocumentError("encrypted_pdf", "PDF is password-protected.") from e
            pages = []
            for i, page in enumerate(reader.pages, start=1):
                try:
                    raw = page.extract_text() or ""
                except Exception:
                    raw = ""
                pages.append(PageText(page=i, text=normalize_text(raw)))
        except DocumentError:
            raise
        except (PdfReadError, Exception) as e:
            raise DocumentError("invalid_pdf", f"Could not read PDF: {e}") from e
    else:
        pages = [PageText(page=1, text=normalize_text(_decode_text(data)))]

    if sum(len(p.text) for p in pages) < 20:
        raise DocumentError(
            "no_text",
            "No extractable text found (scanned PDFs need OCR before upload).",
        )
    return pages


def document_title(pages: List[PageText], fallback: str) -> str:
    for p in pages:
        for line in p.text.split("\n"):
            line = line.strip()
            if 3 <= len(line) <= 120:
                return line
    return fallback


def _hard_split(start: int, end: int, text: str, size: int) -> List[Tuple[int, int]]:
    """Split an over-long sentence at whitespace."""
    spans = []
    s = start
    while end - s > size:
        cut = text.rfind(" ", s, s + size)
        if cut <= s:
            cut = s + size
        spans.append((s, cut))
        s = cut
        while s < end and text[s].isspace():
            s += 1
    if s < end:
        spans.append((s, end))
    return spans


def chunk_pages(doc_id: str, pages: List[PageText], chunk_size: int = 900, overlap: int = 150) -> List[Chunk]:
    """Greedy sentence packing with sentence-level overlap; text == page_text[start:end]."""
    chunks: List[Chunk] = []
    idx = 0
    for page in pages:
        text = page.text
        units: List[Tuple[int, int]] = []
        for s, e, _ in split_sentences(text):
            units.extend(_hard_split(s, e, text, chunk_size) if e - s > chunk_size else [(s, e)])
        i = 0
        while i < len(units):
            j = i
            start = units[i][0]
            while j + 1 < len(units) and units[j + 1][1] - start <= chunk_size:
                j += 1
            end = units[j][1]
            chunks.append(Chunk(
                chunk_id=f"c_{doc_id[2:14]}_{idx:04d}",
                doc_id=doc_id, page=page.page, chunk_index=idx,
                start_char=start, end_char=end, text=text[start:end],
            ))
            idx += 1
            if j + 1 >= len(units):
                break
            # Next chunk re-includes trailing sentences that fit in `overlap` chars,
            # but always starts after unit i so the loop makes progress.
            k = j + 1
            while k - 1 > i and end - units[k - 1][0] <= overlap:
                k -= 1
            i = k
    return chunks
