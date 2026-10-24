"""
Minimal, read-only XLSX reader (standard library only: zipfile + ElementTree).

Reads cell values of one worksheet — shared/inline strings, numbers, booleans and
date-formatted numbers (returned as ISO dates). Formulas contribute their cached value;
nothing in the workbook is ever executed. Limits on part sizes guard against zip bombs.
Legacy binary .xls files are not supported (save them as .xlsx or .csv).
"""

import io
import re
import zipfile
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

MAX_PART_BYTES = 80 * 1024 * 1024
_BUILTIN_DATE_FORMATS = set(range(14, 23)) | {45, 46, 47}


class XlsxError(ValueError):
    pass


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _read(zf: zipfile.ZipFile, name: str) -> Optional[bytes]:
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > MAX_PART_BYTES:
        raise XlsxError(f"Workbook part {name} is too large to read safely.")
    return zf.read(name)


def _col_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref.upper())
    n = 0
    for ch in letters.group(0) if letters else "A":
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _text(el: ET.Element) -> str:
    """Concatenate <t> runs, skipping phonetic hints (<rPh>)."""
    out = []
    for child in el.iter():
        name = _local(child.tag)
        if name == "rPh":
            continue
        if name == "t" and child.text:
            out.append(child.text)
    return "".join(out)


def _date_styles(zf: zipfile.ZipFile) -> List[bool]:
    raw = _read(zf, "xl/styles.xml")
    if raw is None:
        return []
    root = ET.fromstring(raw)
    custom: Dict[int, bool] = {}
    for el in root.iter():
        if _local(el.tag) == "numFmt":
            code = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', "", el.get("formatCode", "")).lower()
            custom[int(el.get("numFmtId", "0"))] = bool(re.search(r"[dmy]", code)) and "0.0" not in code
    flags: List[bool] = []
    for el in root.iter():
        if _local(el.tag) == "cellXfs":
            for xf in el:
                fid = int(xf.get("numFmtId", "0"))
                flags.append(fid in _BUILTIN_DATE_FORMATS or custom.get(fid, False))
            break
    return flags


def _first_sheet_path(zf: zipfile.ZipFile) -> Tuple[str, str, bool]:
    wb_raw = _read(zf, "xl/workbook.xml")
    if wb_raw is None:
        raise XlsxError("Not an .xlsx workbook (xl/workbook.xml is missing).")
    wb = ET.fromstring(wb_raw)
    date1904 = any(_local(e.tag) == "workbookPr" and e.get("date1904") in ("1", "true") for e in wb.iter())
    sheets = [e for e in wb.iter() if _local(e.tag) == "sheet"]
    if not sheets:
        raise XlsxError("The workbook has no worksheets.")
    rels: Dict[str, str] = {}
    rels_raw = _read(zf, "xl/_rels/workbook.xml.rels")
    if rels_raw is not None:
        for e in ET.fromstring(rels_raw).iter():
            if _local(e.tag) == "Relationship":
                rels[e.get("Id", "")] = e.get("Target", "")
    first = sheets[0]
    rid = next((v for k, v in first.attrib.items() if _local(k) == "id"), "")
    target = rels.get(rid, "worksheets/sheet1.xml").lstrip("/")
    path = target if target.startswith("xl/") else f"xl/{target}"
    return first.get("name", "Sheet1"), path, date1904


def _number(v: str) -> str:
    try:
        f = float(v)
    except ValueError:
        return v
    if f.is_integer() and abs(f) < 1e15:
        return str(int(f))
    return repr(f)


def read_xlsx(data: bytes, max_rows: int = 100000) -> Tuple[str, List[List[str]]]:
    """(sheet name, rows of cell strings) for the first worksheet."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise XlsxError("The file is not a valid .xlsx workbook.") from e
    with zf:
        shared: List[str] = []
        ss_raw = _read(zf, "xl/sharedStrings.xml")
        if ss_raw is not None:
            for si in ET.fromstring(ss_raw):
                if _local(si.tag) == "si":
                    shared.append(_text(si))
        date_flags = _date_styles(zf)
        name, path, date1904 = _first_sheet_path(zf)
        raw = _read(zf, path)
        if raw is None:
            raise XlsxError("The first worksheet could not be found in the workbook.")
        epoch = datetime(1904, 1, 1) if date1904 else datetime(1899, 12, 30)

        rows: List[List[str]] = []
        for _, el in ET.iterparse(io.BytesIO(raw), events=("end",)):
            if _local(el.tag) != "row":
                continue
            try:  # keep spreadsheet row numbers aligned: blank rows are omitted from the XML
                rnum = int(el.get("r", "0"))
            except ValueError:
                rnum = 0
            while rnum and len(rows) < rnum - 1:
                rows.append([])
            cells: Dict[int, str] = {}
            for c in el:
                if _local(c.tag) != "c":
                    continue
                ctype = c.get("t", "n")
                ref = c.get("r", "")
                idx = _col_index(ref) if ref else len(cells)
                v_el = next((x for x in c if _local(x.tag) == "v"), None)
                v = v_el.text if v_el is not None and v_el.text is not None else ""
                if ctype == "s":
                    try:
                        val = shared[int(v)]
                    except (ValueError, IndexError):
                        val = ""
                elif ctype == "inlineStr":
                    is_el = next((x for x in c if _local(x.tag) == "is"), None)
                    val = _text(is_el) if is_el is not None else ""
                elif ctype == "b":
                    val = "TRUE" if v == "1" else "FALSE" if v == "0" else ""
                elif ctype == "e":
                    val = ""
                elif ctype == "str":
                    val = v
                else:
                    style = int(c.get("s", "0") or 0)
                    if v and style < len(date_flags) and date_flags[style]:
                        try:
                            val = (epoch + timedelta(days=float(v))).date().isoformat()
                        except (ValueError, OverflowError):
                            val = _number(v)
                    else:
                        val = _number(v) if v else ""
                cells[idx] = val
            el.clear()
            if cells:
                width = max(cells) + 1
                rows.append([cells.get(i, "") for i in range(width)])
            else:
                rows.append([])
            if len(rows) > max_rows + 1:
                raise XlsxError(f"The worksheet has more than {max_rows} rows.")
        return name, rows
