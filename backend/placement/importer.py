"""
Placement spreadsheet import: parse → map columns → validate → (preview) → commit.

  parse_table()      CSV (delimiter sniffed) or XLSX → header + rows with source row numbers
  suggest_mapping()  header names → canonical fields (synonym match); sensitive columns excluded
  validate()         per-row normalisation and checks → clean records, row errors, in-file
                     duplicates, unrecognised values (e.g. a status nobody mapped yet)

Nothing here writes to the database; PlacementService.commit() does that in one transaction
after the user has seen the preview and chosen how to treat records that already exist.
"""

import csv
import hashlib
import io
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.placement import schema as S
from backend.placement.xlsx import XlsxError, read_xlsx

ALLOWED = {".csv": "csv", ".tsv": "csv", ".txt": "csv", ".xlsx": "xlsx"}
MAX_ERRORS_RETURNED = 500


class PlacementImportError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ParsedTable:
    filename: str
    headers: List[str]
    rows: List[Tuple[int, List[str]]]       # (spreadsheet row number, cells)
    sheet: Optional[str] = None

    def to_json(self) -> Dict[str, Any]:
        return {"filename": self.filename, "headers": self.headers, "rows": self.rows, "sheet": self.sheet}

    @classmethod
    def from_json(cls, d: Dict[str, Any]) -> "ParsedTable":
        return cls(d["filename"], d["headers"], [(int(n), list(r)) for n, r in d["rows"]], d.get("sheet"))


def _decode(data: bytes) -> str:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def parse_table(filename: str, data: bytes, max_rows: int = 50000) -> ParsedTable:
    ext = Path(filename or "").suffix.lower()
    if ext == ".xls":
        raise PlacementImportError("legacy_xls", "Legacy .xls workbooks aren't supported. Save the sheet as .xlsx or .csv.")
    if ext not in ALLOWED:
        raise PlacementImportError("unsupported_type", f"Unsupported file type '{ext or 'none'}'. Upload a .csv or .xlsx file.")
    if not data:
        raise PlacementImportError("empty_file", "The file is empty.")
    sheet = None
    if ALLOWED[ext] == "xlsx":
        if not data.startswith(b"PK"):
            raise PlacementImportError("invalid_xlsx", "The file has an .xlsx extension but is not an Excel workbook.")
        try:
            sheet, raw_rows = read_xlsx(data, max_rows=max_rows)
        except XlsxError as e:
            raise PlacementImportError("invalid_xlsx", str(e))
        numbered = [(i + 1, r) for i, r in enumerate(raw_rows)]
    else:
        if b"\x00" in data[:4096] and not data.startswith((b"\xff\xfe", b"\xfe\xff")):
            raise PlacementImportError("binary_file", "The file looks binary, not CSV text.")
        text = _decode(data)
        sample = text[:20000]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(io.StringIO(text), dialect)
        numbered = []
        for i, r in enumerate(reader, start=1):
            numbered.append((i, r))
            if len(numbered) > max_rows + 1:
                raise PlacementImportError("too_many_rows", f"The file has more than {max_rows} rows.")
    numbered = [(n, [str(c).strip() for c in r]) for n, r in numbered]
    first = next((k for k, (_, r) in enumerate(numbered) if any(c for c in r)), None)
    if first is None:
        raise PlacementImportError("no_rows", "No data found in the file.")
    _, header_cells = numbered[first]
    headers: List[str] = []
    seen: Counter = Counter()
    for i, h in enumerate(header_cells):
        h = " ".join(h.split()) or f"Column {i + 1}"
        seen[h] += 1
        headers.append(h if seen[h] == 1 else f"{h} ({seen[h]})")
    rows = [(n, (r + [""] * len(headers))[:len(headers)]) for n, r in numbered[first + 1:] if any(c for c in r)]
    if not rows:
        raise PlacementImportError("no_rows", "The file has a header row but no data rows.")
    if len(rows) > max_rows:
        raise PlacementImportError("too_many_rows", f"The file has more than {max_rows} data rows.")
    return ParsedTable(filename, headers, rows, sheet)


# ── mapping ──────────────────────────────────────────────────────────────────

def sensitive_columns(headers: List[str]) -> List[str]:
    return [h for h in headers if S.is_sensitive_header(h)]


def suggest_mapping(headers: List[str], kind: str) -> Dict[str, Optional[str]]:
    specs = S.FIELDS[kind]
    normed = {h: S.norm_header(h) for h in headers if not S.is_sensitive_header(h)}
    taken: set = set()
    out: Dict[str, Optional[str]] = {f.key: None for f in specs}
    # pass 1: exact synonym matches (in field order, so 'academic year' beats a bare 'year')
    for f in specs:
        for syn in (f.key.replace("_", " "), f.label.lower(), *f.synonyms):
            hit = next((h for h, n in normed.items() if n == S.norm_header(syn) and h not in taken), None)
            if hit:
                out[f.key] = hit
                taken.add(hit)
                break
    # pass 2: a header that contains a multi-word synonym ("Company Name (as on offer)")
    for f in specs:
        if out[f.key]:
            continue
        for syn in sorted(f.synonyms, key=len, reverse=True):
            if len(syn) < 5:
                continue
            hit = next((h for h, n in normed.items() if syn in n and h not in taken), None)
            if hit:
                out[f.key] = hit
                taken.add(hit)
                break
    return out


def clean_mapping(mapping: Dict[str, Any], headers: List[str], kind: str) -> Dict[str, Optional[str]]:
    keys = {f.key for f in S.FIELDS[kind]}
    out: Dict[str, Optional[str]] = {}
    for k, v in (mapping or {}).items():
        if k not in keys:
            continue
        if v in (None, ""):
            out[k] = None
        elif v not in headers:
            raise PlacementImportError("bad_mapping", f"Column '{v}' is not in the file.")
        elif S.is_sensitive_header(v):
            raise PlacementImportError("sensitive_column", f"Column '{v}' holds personal or sensitive data and is never imported.")
        else:
            out[k] = v
    return out


# ── validation ───────────────────────────────────────────────────────────────

@dataclass
class Validation:
    records: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    invalid_rows: int = 0
    duplicates_in_file: List[Dict[str, Any]] = field(default_factory=list)
    unknown_values: Dict[str, Counter] = field(default_factory=lambda: defaultdict(Counter))
    adjustments: Counter = field(default_factory=Counter)
    total_rows: int = 0

    def summary(self) -> Dict[str, Any]:
        return {"total_rows": self.total_rows, "valid": len(self.records), "invalid": self.invalid_rows,
                "duplicates_in_file": len(self.duplicates_in_file), "adjustments": dict(self.adjustments),
                "unknown_values": {k: [{"value": v, "rows": n} for v, n in c.most_common(25)]
                                   for k, c in self.unknown_values.items() if c}}


def norm_student_id(v: str) -> str:
    return "".join(str(v).split()).upper()


def record_key(kind: str, r: Dict[str, Any]) -> str:
    if kind == "students":
        return f"{r['academic_year']}|{r['student_id']}"
    raw = "|".join([r["academic_year"], r["student_id"], r["company_norm"], S.norm_token(r.get("role") or ""),
                    r["opportunity_type"], str(r.get("is_ppo", 0))])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]


def _convert(spec: S.FieldSpec, raw: str) -> Tuple[bool, Any, str]:
    """(ok, value, error message)."""
    if spec.kind == "year":
        v = S.normalize_academic_year(raw)
        return (v is not None, v, f"Use the academic-year format 2025-26 (got '{raw}').")
    if spec.kind == "str":
        v = " ".join(raw.split())
        return (len(v) <= 200, v or None, "Text is longer than 200 characters.")
    if spec.kind == "int":
        if not raw.strip():
            return True, None, ""
        ok, num = S.number_value(raw)
        if not ok or num is None or not num.is_integer() or not 1950 <= num <= 2100:
            return False, None, f"Expected a year like 2026 (got '{raw}')."
        return True, int(num), ""
    if spec.kind == "float":
        ok, num = S.number_value(raw)
        if not ok:
            return False, None, f"Expected a number (got '{raw}')."
        if num is not None and num < 0:
            return False, None, f"Negative values aren't valid here (got '{raw}')."
        return True, num, ""
    if spec.kind == "bool":
        ok, b = S.bool_value(raw)
        return ok, b, f"Expected yes/no (got '{raw}')."
    if spec.kind == "date":
        ok, d = S.date_value(raw)
        return ok, d, f"Expected a date such as 2025-08-14 or 14/08/2025 (got '{raw}')."
    if spec.kind == "enum":
        v = S.enum_value(spec.enum, raw)
        return (v is not None, v, f"Unrecognised {spec.label.lower()} '{raw}'.")
    return True, raw, ""


def validate(table: ParsedTable, kind: str, mapping: Dict[str, Optional[str]], defaults: Dict[str, Any],
             config: Dict[str, Any]) -> Validation:
    specs = S.FIELDS[kind]
    col = {h: i for i, h in enumerate(table.headers)}
    stages = config.get("stages") or S.DEFAULT_STAGES
    lookup = S.stage_lookup(stages)
    offer_idx = next((i for i, s in enumerate(stages) if s["key"] == "offer"), None)
    res = Validation(total_rows=len(table.rows))
    seen: Dict[str, int] = {}

    for rownum, cells in table.rows:
        rec: Dict[str, Any] = {"_row": rownum}
        row_errors: List[Dict[str, Any]] = []
        for spec in specs:
            header = mapping.get(spec.key)
            raw = cells[col[header]] if header else ""
            if not header and spec.key in defaults and defaults[spec.key] not in (None, ""):
                raw = str(defaults[spec.key])
            if spec.required and not raw.strip():
                row_errors.append({"row": rownum, "field": spec.key, "value": raw,
                                   "message": f"{spec.label} is required."})
                continue
            ok, val, msg = _convert(spec, raw)
            if not ok:
                if spec.kind == "enum":
                    res.unknown_values[spec.key][raw] += 1
                row_errors.append({"row": rownum, "field": spec.key, "value": raw, "message": msg})
                continue
            rec[spec.key] = val

        if not row_errors:
            rec["student_id"] = norm_student_id(rec["student_id"])
            if not rec["student_id"] or len(rec["student_id"]) > 64:
                row_errors.append({"row": rownum, "field": "student_id", "value": rec["student_id"],
                                   "message": "Student ID must be 1–64 characters."})
        if not row_errors and kind == "applications":
            if rec["opportunity_type"] == "ppo":
                rec["opportunity_type"], rec["is_ppo"] = "full_time", 1
            else:
                rec["is_ppo"] = 0
            rec["company_norm"] = S.norm_company(rec["company"])
            rec["role"] = rec.get("role") or ""  # optional column; stored as '' (the column default), as in record_key
            rec["result"] = rec.get("result") or S.UNKNOWN
            stage_raw = rec.pop("stage", None)
            rec["stage"], rec["stage_index"] = None, None
            if stage_raw:
                hit = lookup.get(S.norm_token(stage_raw))
                if hit is None:
                    res.unknown_values["stage"][stage_raw] += 1
                    row_errors.append({"row": rownum, "field": "stage", "value": stage_raw,
                                       "message": f"Unknown stage '{stage_raw}'. Add it to the pipeline in Placement "
                                                  "settings, or correct the value."})
                else:
                    rec["stage"], rec["stage_index"] = hit
            if not row_errors and rec["result"] in S.OFFER_RESULTS and offer_idx is not None \
                    and (rec["stage_index"] is None or rec["stage_index"] < offer_idx):
                rec["stage"], rec["stage_index"] = "offer", offer_idx
                res.adjustments["offer rows moved to the offer stage"] += 1
            if rec["opportunity_type"] == "full_time":
                for k in ("internship_status", "ppo_status"):
                    if rec.get(k) not in (None, S.UNKNOWN):
                        res.adjustments[f"{k.replace('_', ' ')} ignored on full-time rows"] += 1
                    rec[k] = None
        if row_errors:
            res.invalid_rows += 1
            if len(res.errors) < MAX_ERRORS_RETURNED:
                res.errors.extend(row_errors[: MAX_ERRORS_RETURNED - len(res.errors)])
            continue
        key = record_key(kind, rec)
        if key in seen:
            res.duplicates_in_file.append({"row": rownum, "duplicate_of": seen[key],
                                           "message": f"Same record as row {seen[key]}; only the first is imported."})
            continue
        seen[key] = rownum
        rec["_key"] = key
        res.records.append(rec)
    return res
