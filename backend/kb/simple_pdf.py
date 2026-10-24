"""
Minimal dependency-free PDF writer (Helvetica text, word-wrapped, multi-page).
Used to generate the bundled sample PDF and PDF fixtures in tests.
"""

import textwrap
from typing import List


def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(pages: List[str], width_chars: int = 88) -> bytes:
    """Each item in `pages` is the text of one page; blank lines separate paragraphs."""
    objects: List[bytes] = []

    def add(obj: str) -> int:
        objects.append(obj.encode("latin-1", "replace"))
        return len(objects)

    font_id = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids: List[int] = []
    pages_obj_index = len(objects) + 1 + 2 * len(pages)  # reserved after content+page objects

    for text in pages:
        lines: List[str] = []
        for para in text.strip().split("\n"):
            para = para.rstrip()
            lines.extend(textwrap.wrap(para, width_chars) if para else [""])
        ops = ["BT", "/F1 11 Tf", "14 TL", "72 760 Td"]
        for ln in lines[:52]:
            ops.append(f"({_esc(ln)}) Tj T*" if ln else "T*")
        ops.append("ET")
        stream = "\n".join(ops)
        content_id = add(f"<< /Length {len(stream.encode('latin-1', 'replace'))} >>\nstream\n{stream}\nendstream")
        page_ids.append(add(
            f"<< /Type /Page /Parent {pages_obj_index} 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>"
        ))

    kids = " ".join(f"{p} 0 R" for p in page_ids)
    pages_id = add(f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>")
    assert pages_id == pages_obj_index
    catalog_id = add(f"<< /Type /Catalog /Pages {pages_id} 0 R >>")

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)
