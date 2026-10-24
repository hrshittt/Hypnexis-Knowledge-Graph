"""
Shared plumbing for the document analysers: exact page text, sentences with offsets,
section headings, and citations that point back to a KB chunk.

Page text is re-extracted from the stored upload with the same normaliser the KB used,
so offsets match the chunks exactly; when the upload is gone the text is rebuilt from
the chunks themselves.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.kb.documents import extract_pages
from backend.kb.text_utils import split_sentences

# Years / fiscal years, not amounts: "2024.5", "$2,015" and "1,950" are excluded.
YEAR_RE = re.compile(
    r"(?<![\w$€£₹.,])(?P<pfx>fy\s?|fiscal(?: year)?\s|financial year\s)?"
    r"(?P<y1>(?:19|20)\d{2})(?:\s?[-/–]\s?(?P<y2>(?:19|20)?\d{2}))?(?![.,]\d|\d)"
    r"|(?<![\w$€£₹.,])fy\s?(?P<y3>\d{2})(?!\d)", re.I)


@dataclass
class Sentence:
    doc_id: str
    filename: str
    page: int
    start: int
    end: int
    text: str
    heading: str          # nearest heading above the sentence on its page ("" if none)
    index: int            # position in the document


@dataclass
class DocText:
    doc_id: str
    filename: str
    title: str
    pages: List[Tuple[int, str]]
    sentences: List[Sentence]
    chunks: List[Dict[str, Any]]

    def citation(self, s: Sentence) -> Dict[str, Any]:
        chunk = next((c for c in self.chunks if c["page"] == s.page and c["start_char"] <= s.start < c["end_char"]), None)
        return {"doc_id": s.doc_id, "filename": s.filename, "page": s.page, "sentence": s.text,
                "chunk_id": chunk["chunk_id"] if chunk else None,
                "highlight": [s.start - chunk["start_char"], s.end - chunk["start_char"]] if chunk else None,
                "section": s.heading or None}


def _looks_like_heading(line: str) -> bool:
    t = line.strip()
    return 2 <= len(t) <= 90 and not t.endswith((".", ",", ";", ":")) and (t[0].isupper() or t[0].isdigit()) \
        and len(t.split()) <= 12


def _rebuild_from_chunks(chunks: List[Dict[str, Any]]) -> List[Tuple[int, str]]:
    pages: Dict[int, List[Dict[str, Any]]] = {}
    for c in chunks:
        pages.setdefault(c["page"], []).append(c)
    out = []
    for p in sorted(pages):
        text, pos = "", 0
        for c in sorted(pages[p], key=lambda c: c["start_char"]):
            if c["start_char"] > pos:
                text += (" " if c["start_char"] - pos == 1 else "\n\n" + " " * (c["start_char"] - pos - 2))
                pos = c["start_char"]
            text += c["text"][pos - c["start_char"]:]
            pos = max(pos, c["end_char"])
        out.append((p, text))
    return out


def load_document(kb, doc_id: str) -> Optional[DocText]:
    doc = kb.store.get_document(doc_id)
    if doc is None or doc["status"] != "ready":
        return None
    rows = kb.store.get_chunks(kb.store.chunk_ids_for_docs([doc_id]))
    chunks = sorted(rows.values(), key=lambda c: (c["page"], c["start_char"]))
    pages: List[Tuple[int, str]] = []
    path = Path(doc.get("stored_path") or "")
    if path.is_file():
        try:
            pages = [(p.page, p.text) for p in extract_pages(path.read_bytes(), doc["file_type"])]
        except Exception:
            pages = []
    if not pages:
        pages = _rebuild_from_chunks(chunks)
    sentences: List[Sentence] = []
    for pnum, text in pages:
        # headings: a line that looks like a title; sentences inherit the latest one above them
        heads: List[Tuple[int, str]] = []
        pos = 0
        for line in text.split("\n"):
            if _looks_like_heading(line):
                heads.append((pos, line.strip()))
            pos += len(line) + 1
        for s, e, t in split_sentences(text):
            h = ""
            for hp, ht in heads:
                if hp <= s:
                    h = ht
                else:
                    break
            if t.strip() == h:
                continue  # the heading line itself
            sentences.append(Sentence(doc_id, doc["filename"], pnum, s, e, t, h, len(sentences)))
    return DocText(doc_id, doc["filename"], doc.get("title") or doc["filename"], pages, sentences, chunks)


def years_in(text: str) -> List[Tuple[int, int, int, str]]:
    """(start, end, end-year, label) for year/fiscal-year mentions, e.g. 'FY2024', '2023-24'."""
    out = []
    for m in YEAR_RE.finditer(text):
        if m.group("y3"):
            y = 2000 + int(m.group("y3"))
            out.append((m.start(), m.end(), y, f"FY{y}"))
            continue
        y1 = int(m.group("y1"))
        y2 = m.group("y2")
        if y2:
            y2i = int(y2) if len(y2) == 4 else (y1 // 100) * 100 + int(y2)
            if y2i != y1 + 1:
                continue
            out.append((m.start(), m.end(), y2i, f"FY{y1}-{str(y2i)[-2:]}"))
        else:
            out.append((m.start(), m.end(), y1, f"FY{y1}" if m.group("pfx") else str(y1)))
    return out


def doc_year(doc: DocText, meta_year: Optional[str]) -> Optional[Tuple[int, str, str]]:
    """(end-year, label, source) from user metadata, else from the document title."""
    for text, source in ((meta_year or "", "document metadata"), (doc.title, "document title")):
        ys = years_in(text)
        if ys:
            return ys[-1][2], ys[-1][3], source
    return None
