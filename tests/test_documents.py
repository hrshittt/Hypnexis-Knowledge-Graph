"""Ingestion primitives: validation, decoding, layout normalisation, offset-exact chunking, PDF parsing."""

import pytest

from backend.kb.documents import (
    DocumentError, PageText, chunk_pages, document_title, extract_pages, normalize_text, validate_upload,
)
from backend.kb.simple_pdf import make_pdf
from backend.kb.text_utils import split_sentences

MB = 1024 * 1024


@pytest.mark.parametrize("name,data,code", [
    ("notes.docx", b"PK\x03\x04", "unsupported_type"),
    ("noext", b"hello", "unsupported_type"),
    ("empty.txt", b"", "empty_file"),
    ("fake.pdf", b"<html>not a pdf</html>", "invalid_pdf"),
    ("bin.txt", b"\x00\x01\x02" * 100, "binary_text"),
])
def test_validate_rejects(name, data, code):
    with pytest.raises(DocumentError) as e:
        validate_upload(name, data, 5 * MB)
    assert e.value.code == code


def test_validate_size_limit():
    with pytest.raises(DocumentError) as e:
        validate_upload("big.txt", b"a" * (2 * MB), 1 * MB)
    assert e.value.code == "too_large"


def test_text_encodings():
    assert "Zürich" in extract_pages("Zürich is in Switzerland.".encode("utf-8"), "text")[0].text
    assert "café" in extract_pages("The café opened in 2020.".encode("cp1252"), "text")[0].text
    assert "Kraków" in extract_pages("Kraków hosted the summit.".encode("utf-16"), "text")[0].text


def test_normalize_keeps_headings_and_joins_wrapped_lines():
    raw = "Annual Report\nOverview\nMeridian Grid serves Port Calder and the\nsurrounding coast. It oper-\nates storage.\n\nOutlook\nGrowth continues."
    out = normalize_text(raw)
    lines = out.split("\n")
    assert lines[0] == "Annual Report" and lines[1] == "Overview"
    assert "Port Calder and the surrounding coast. It operates storage." in out
    assert "Outlook" in lines


def test_sentence_splitter_offsets_and_abbreviations():
    text = "Dr. Lena Park leads the institute. It was founded in 2009 by Tomas Reyes Inc. staff? No. U.S. teams joined."
    sents = split_sentences(text)
    assert sents[0][2] == "Dr. Lena Park leads the institute."
    for s, e, sent in sents:
        assert text[s:e] == sent


def test_chunks_are_exact_slices_with_overlap():
    body = " ".join(f"Sentence number {i} talks about Voltaic Systems and storage." for i in range(60))
    pages = [PageText(1, body), PageText(2, "Second page. " * 30)]
    chunks = chunk_pages("d_0123456789abcdef", pages, chunk_size=300, overlap=80)
    assert len(chunks) > 5
    for c in chunks:
        assert pages[c.page - 1].text[c.start_char:c.end_char] == c.text
        assert len(c.text) <= 300
    same_page = [c for c in chunks if c.page == 1]
    assert any(a.end_char > b.start_char for a, b in zip(same_page, same_page[1:])), "expected overlap"
    assert len({c.chunk_id for c in chunks}) == len(chunks)


def test_pdf_roundtrip_two_pages():
    data = make_pdf(["Report Title\n\nVoltaic Systems develops sodium-ion batteries.", "Page two text about Meridian Grid."])
    pages = extract_pages(data, validate_upload("r.pdf", data, 5 * MB))
    assert [p.page for p in pages] == [1, 2]
    assert "sodium-ion batteries" in pages[0].text and "Meridian Grid" in pages[1].text
    assert document_title(pages, "r.pdf") == "Report Title"


def test_pdf_without_text_is_rejected():
    data = make_pdf([""])
    with pytest.raises(DocumentError) as e:
        extract_pages(data, "pdf")
    assert e.value.code == "no_text"


def test_corrupt_pdf_is_rejected():
    with pytest.raises(DocumentError) as e:
        extract_pages(b"%PDF-1.4\n garbage garbage", "pdf")
    assert e.value.code == "invalid_pdf"
