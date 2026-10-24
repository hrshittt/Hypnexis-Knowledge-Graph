"""
PlacementService — workspace-scoped placement data: settings, staged imports, metrics.

Import lifecycle (nothing is written until the user confirms)
  stage()    parse the upload, keep the parsed rows in a staging file, suggest a mapping,
             return a preview (valid / invalid / duplicate rows, unrecognised values)
  preview()  re-validate with an edited mapping
  commit()   one transaction: insert new records; records that already exist are skipped
             (default) or updated only when the user explicitly chose "update"
  discard()  drop the staged file

Every stored record keeps its import id and spreadsheet row number (provenance).
"""

import hashlib
import json
import re
import time
import uuid
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.config import PlatformSettings
from backend.placement import metrics as M
from backend.placement import schema as S
from backend.placement.importer import (
    ParsedTable, PlacementImportError, clean_mapping, parse_table, sensitive_columns, suggest_mapping, validate,
)
from backend.storage.database import PlatformDB
from backend.utils.logger import get_logger

log = get_logger(__name__)

_STUDENT_COLS = ("academic_year", "student_id", "department", "program", "graduation_year", "eligible", "registered")
_APP_COLS = ("academic_year", "student_id", "department", "company", "company_norm", "industry", "role",
             "opportunity_type", "is_ppo", "stage", "stage_index", "result", "internship_status", "ppo_status",
             "ctc", "stipend", "applied_on", "result_on", "offer_on")


class PlacementError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class PlacementService:
    def __init__(self, db: PlatformDB, settings: PlatformSettings):
        self.db = db
        self.settings = settings

    # ═════════════════════════════════════════════════════════════════════════
    # Settings
    # ═════════════════════════════════════════════════════════════════════════
    def config(self, ws_id: str) -> Dict[str, Any]:
        row = self.db.one("SELECT config FROM pl_settings WHERE workspace_id=?", (ws_id,))
        conf = json.loads(json.dumps(S.DEFAULT_CONFIG))
        if row:
            conf.update(json.loads(row["config"]))
        return conf

    def set_config(self, ws_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
        conf = self.config(ws_id)
        if "stages" in patch:
            conf["stages"] = self._clean_stages(patch["stages"])
        if "placement_denominator" in patch:
            if patch["placement_denominator"] not in ("eligible", "registered"):
                raise PlacementError(422, "invalid_config", "Denominator must be 'eligible' or 'registered'.")
            conf["placement_denominator"] = patch["placement_denominator"]
        if "placed_definition" in patch:
            if patch["placed_definition"] not in ("offer_received", "offer_accepted"):
                raise PlacementError(422, "invalid_config", "Placed definition must be 'offer_received' or 'offer_accepted'.")
            conf["placed_definition"] = patch["placed_definition"]
        if "count_ppo_as_placement" in patch:
            conf["count_ppo_as_placement"] = bool(patch["count_ppo_as_placement"])
        if "ctc_unit" in patch:
            unit = str(patch["ctc_unit"] or "").strip()
            if len(unit) > 20:
                raise PlacementError(422, "invalid_config", "CTC unit label is at most 20 characters.")
            conf["ctc_unit"] = unit
        if "cycles" in patch:
            cycles = {}
            for ay, c in (patch["cycles"] or {}).items():
                norm = S.normalize_academic_year(ay)
                if not norm:
                    raise PlacementError(422, "invalid_config", f"'{ay}' is not an academic year like 2025-26.")
                c = c or {}
                status = c.get("status") or None
                if status not in (None, "ongoing", "completed"):
                    raise PlacementError(422, "invalid_config", "Cycle status must be 'ongoing' or 'completed'.")
                start = c.get("start_date") or None
                if start:
                    try:
                        date.fromisoformat(start)
                    except ValueError:
                        raise PlacementError(422, "invalid_config", f"Start date '{start}' must be YYYY-MM-DD.")
                cycles[norm] = {"status": status, "start_date": start}
            conf["cycles"] = cycles
        with self.db.tx() as c:
            c.execute("INSERT INTO pl_settings VALUES (?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET config=excluded.config, "
                      "updated_at=excluded.updated_at", (ws_id, json.dumps(conf), time.time()))
        return conf

    @staticmethod
    def _clean_stages(stages: Any) -> List[Dict[str, Any]]:
        if not isinstance(stages, list) or not 2 <= len(stages) <= 20:
            raise PlacementError(422, "invalid_config", "Define between 2 and 20 pipeline stages.")
        out, keys = [], set()
        for s in stages:
            label = str((s or {}).get("label", "")).strip()
            key = str(s.get("key") or re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_"))[:32]
            if not label or len(label) > 60 or not re.fullmatch(r"[a-z0-9_]{1,32}", key):
                raise PlacementError(422, "invalid_config", "Each stage needs a label (≤ 60 characters).")
            if key in keys:
                raise PlacementError(422, "invalid_config", f"Stage '{label}' is listed twice.")
            keys.add(key)
            syn = [str(x).strip()[:40] for x in (s.get("synonyms") or []) if str(x).strip()][:30]
            out.append({"key": key, "label": label, "synonyms": syn})
        if "offer" not in keys:
            raise PlacementError(422, "invalid_config", "Keep a stage with key 'offer' — offer metrics depend on it.")
        return out

    # ═════════════════════════════════════════════════════════════════════════
    # Imports
    # ═════════════════════════════════════════════════════════════════════════
    def _staging_path(self, ws_id: str, import_id: str) -> Path:
        return self.settings.workspace_dir(ws_id) / "imports" / f"{import_id}.json"

    def _import_row(self, ws_id: str, import_id: str) -> Dict[str, Any]:
        row = self.db.one("SELECT * FROM pl_imports WHERE import_id=? AND workspace_id=?", (import_id, ws_id))
        if row is None:
            raise PlacementError(404, "import_not_found", "Import not found.")
        return row

    def _load_table(self, ws_id: str, import_id: str) -> ParsedTable:
        p = self._staging_path(ws_id, import_id)
        if not p.exists():
            raise PlacementError(410, "staging_expired", "The staged file is gone; upload it again.")
        return ParsedTable.from_json(json.loads(p.read_text(encoding="utf-8")))

    def stage(self, ws_id: str, kind: str, filename: str, data: bytes, user_id: str,
              is_sample: bool = False) -> Dict[str, Any]:
        if kind not in S.FIELDS:
            raise PlacementError(422, "invalid_kind", "Import kind must be 'students' or 'applications'.")
        if len(data) > self.settings.placement_max_upload_bytes:
            raise PlacementError(413, "too_large",
                                 f"File is {len(data) / 1048576:.1f} MB; the limit is {self.settings.placement_max_upload_mb} MB.")
        safe = re.sub(r"[^A-Za-z0-9._\- ]+", "_", Path(filename or "upload.csv").name)[:160] or "upload.csv"
        try:
            table = parse_table(safe, data, self.settings.placement_max_rows)
        except PlacementImportError as e:
            raise PlacementError(400, e.code, e.message)
        import_id = "i_" + uuid.uuid4().hex[:12]
        path = self._staging_path(ws_id, import_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(table.to_json()), encoding="utf-8")
        mapping = suggest_mapping(table.headers, kind)
        with self.db.tx() as c:
            c.execute("INSERT INTO pl_imports(import_id, workspace_id, kind, filename, sha256, status, uploaded_by, "
                      "is_sample, mapping, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                      (import_id, ws_id, kind, safe, hashlib.sha256(data).hexdigest(), "staged", user_id,
                       int(is_sample), json.dumps(mapping), time.time()))
        return self.preview(ws_id, import_id, mapping, {})

    def _existing_keys(self, ws_id: str, kind: str) -> set:
        if kind == "students":
            return {f"{r['academic_year']}|{r['student_id']}" for r in
                    self.db.q("SELECT academic_year, student_id FROM pl_students WHERE workspace_id=?", (ws_id,))}
        return {r["record_key"] for r in self.db.q("SELECT record_key FROM pl_applications WHERE workspace_id=?", (ws_id,))}

    def preview(self, ws_id: str, import_id: str, mapping: Optional[Dict[str, Any]],
                defaults: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        imp = self._import_row(ws_id, import_id)
        if imp["status"] != "staged":
            raise PlacementError(409, "not_staged", f"This import is already {imp['status']}.")
        table = self._load_table(ws_id, import_id)
        kind = imp["kind"]
        try:
            m = clean_mapping(mapping if mapping is not None else json.loads(imp["mapping"]), table.headers, kind)
        except PlacementImportError as e:
            raise PlacementError(422, e.code, e.message)
        val = validate(table, kind, m, defaults or {}, self.config(ws_id))
        existing = self._existing_keys(ws_id, kind)
        matches = sum(1 for r in val.records if r["_key"] in existing)
        self.db.execute("UPDATE pl_imports SET mapping=? WHERE import_id=?", (json.dumps(m), import_id))
        specs = S.FIELDS[kind]
        mapped = {v for v in m.values() if v}
        return {
            "import": self._public_import(self._import_row(ws_id, import_id)),
            "kind": kind, "filename": table.filename, "sheet": table.sheet, "headers": table.headers,
            "fields": [{"key": f.key, "label": f.label, "required": f.required, "kind": f.kind, "help": f.help}
                       for f in specs],
            "mapping": m, "defaults": defaults or {},
            "sensitive_columns": sensitive_columns(table.headers),
            "unmapped_columns": [h for h in table.headers if h not in mapped and not S.is_sensitive_header(h)],
            "summary": {**val.summary(), "existing_matches": matches, "new_records": len(val.records) - matches},
            "errors": val.errors, "duplicates": val.duplicates_in_file[:200],
            "sample_rows": [{k: v for k, v in r.items() if not k.startswith("_")} | {"row": r["_row"]}
                            for r in val.records[:15]],
            "stages": [s["label"] for s in self.config(ws_id)["stages"]],
        }

    def commit(self, ws_id: str, import_id: str, mapping: Dict[str, Any], defaults: Dict[str, Any],
               duplicate_policy: str, user_id: str) -> Dict[str, Any]:
        if duplicate_policy not in ("skip", "update"):
            raise PlacementError(422, "invalid_policy", "Choose 'skip' or 'update' for records that already exist.")
        imp = self._import_row(ws_id, import_id)
        if imp["status"] != "staged":
            raise PlacementError(409, "not_staged", f"This import is already {imp['status']}.")
        table = self._load_table(ws_id, import_id)
        kind = imp["kind"]
        try:
            m = clean_mapping(mapping, table.headers, kind)
        except PlacementImportError as e:
            raise PlacementError(422, e.code, e.message)
        val = validate(table, kind, m, defaults or {}, self.config(ws_id))
        if not val.records:
            raise PlacementError(422, "nothing_to_import", "No valid rows to import — fix the errors in the preview first.")
        existing = self._existing_keys(ws_id, kind)
        inserted = updated = skipped = 0
        now = time.time()
        try:
            with self.db.tx() as c:
                for r in val.records:
                    if kind == "students":
                        vals = [r.get(k) for k in _STUDENT_COLS]
                        if r["_key"] in existing:
                            if duplicate_policy == "skip":
                                skipped += 1
                                continue
                            c.execute("UPDATE pl_students SET department=?, program=?, graduation_year=?, eligible=?, "
                                      "registered=?, import_id=?, source_row=?, updated_at=? WHERE workspace_id=? AND "
                                      "academic_year=? AND student_id=?",
                                      (*vals[2:], import_id, r["_row"], now, ws_id, r["academic_year"], r["student_id"]))
                            updated += 1
                        else:
                            c.execute(f"INSERT INTO pl_students(workspace_id, {', '.join(_STUDENT_COLS)}, import_id, "
                                      f"source_row, updated_at) VALUES (?{',?' * len(_STUDENT_COLS)},?,?,?)",
                                      (ws_id, *vals, import_id, r["_row"], now))
                            inserted += 1
                    else:
                        vals = [r.get(k) for k in _APP_COLS]
                        if r["_key"] in existing:
                            if duplicate_policy == "skip":
                                skipped += 1
                                continue
                            sets = ", ".join(f"{k}=?" for k in _APP_COLS)
                            c.execute(f"UPDATE pl_applications SET {sets}, import_id=?, source_row=?, updated_at=? "
                                      "WHERE workspace_id=? AND record_key=?",
                                      (*vals, import_id, r["_row"], now, ws_id, r["_key"]))
                            updated += 1
                        else:
                            c.execute(f"INSERT INTO pl_applications(workspace_id, record_key, {', '.join(_APP_COLS)}, "
                                      f"import_id, source_row, updated_at) VALUES (?,?{',?' * len(_APP_COLS)},?,?,?)",
                                      (ws_id, r["_key"], *vals, import_id, r["_row"], now))
                            inserted += 1
                summary = {**val.summary(), "inserted": inserted, "updated": updated, "skipped_existing": skipped,
                           "errors": val.errors[:100]}
                c.execute("UPDATE pl_imports SET status='committed', mapping=?, duplicate_policy=?, summary=?, "
                          "committed_at=? WHERE import_id=?",
                          (json.dumps(m), duplicate_policy, json.dumps(summary), now, import_id))
        except PlacementError:
            raise
        except Exception as e:
            log.exception("Placement import failed")
            self.db.execute("UPDATE pl_imports SET status='failed', summary=? WHERE import_id=?",
                            (json.dumps({"error": f"{type(e).__name__}: {e}"}), import_id))
            raise PlacementError(500, "import_failed", "The import failed and nothing was written. Try again.")
        self._staging_path(ws_id, import_id).unlink(missing_ok=True)
        log.info(f"Placement import {import_id} ({kind}): +{inserted} ~{updated} skipped {skipped}")
        return {"import": self._public_import(self._import_row(ws_id, import_id)), "summary": summary}

    def discard(self, ws_id: str, import_id: str) -> None:
        imp = self._import_row(ws_id, import_id)
        if imp["status"] == "staged":
            self.db.execute("UPDATE pl_imports SET status='discarded' WHERE import_id=?", (import_id,))
        self._staging_path(ws_id, import_id).unlink(missing_ok=True)

    @staticmethod
    def _public_import(r: Dict[str, Any]) -> Dict[str, Any]:
        return {"id": r["import_id"], "kind": r["kind"], "filename": r["filename"], "status": r["status"],
                "is_sample": bool(r["is_sample"]), "duplicate_policy": r.get("duplicate_policy"),
                "summary": json.loads(r.get("summary") or "{}"), "created_at": r["created_at"],
                "committed_at": r.get("committed_at"), "uploaded_by": r.get("uploaded_by")}

    def imports(self, ws_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        rows = self.db.q("SELECT i.*, u.name AS uploader FROM pl_imports i LEFT JOIN users u ON u.user_id=i.uploaded_by "
                         "WHERE i.workspace_id=? ORDER BY i.created_at DESC LIMIT ?", (ws_id, limit))
        return [{**self._public_import(r), "uploader": r.get("uploader")} for r in rows]

    def has_sample_data(self, ws_id: str) -> bool:
        return self.db.one("SELECT 1 FROM pl_imports WHERE workspace_id=? AND is_sample=1 AND status='committed'",
                           (ws_id,)) is not None

    def load_samples(self, ws_id: str, user_id: str) -> Dict[str, Any]:
        d = self.settings.samples_dir / "placement"
        results = {}
        for kind, name in (("students", "sample_students.csv"), ("applications", "sample_applications.csv")):
            p = d / name
            if not p.exists():
                raise PlacementError(404, "no_samples", f"Sample file {name} is missing.")
            staged = self.stage(ws_id, kind, name, p.read_bytes(), user_id, is_sample=True)
            results[kind] = self.commit(ws_id, staged["import"]["id"], staged["mapping"], {}, "skip", user_id)["summary"]
        return results

    def delete_all(self, ws_id: str) -> Dict[str, int]:
        with self.db.tx() as c:
            a = c.execute("DELETE FROM pl_applications WHERE workspace_id=?", (ws_id,)).rowcount
            s = c.execute("DELETE FROM pl_students WHERE workspace_id=?", (ws_id,)).rowcount
            c.execute("UPDATE pl_imports SET status='discarded' WHERE workspace_id=? AND status='staged'", (ws_id,))
        return {"applications_removed": a, "students_removed": s}

    # ═════════════════════════════════════════════════════════════════════════
    # Metrics
    # ═════════════════════════════════════════════════════════════════════════
    def dataset(self, ws_id: str, today: Optional[date] = None) -> M.Dataset:
        conf = self.config(ws_id)
        index = {s["key"]: i for i, s in enumerate(conf["stages"])}
        students = self.db.q(f"SELECT {', '.join(_STUDENT_COLS)} FROM pl_students WHERE workspace_id=?", (ws_id,))
        apps = self.db.q(f"SELECT record_key, import_id, source_row, {', '.join(_APP_COLS)} FROM pl_applications "
                         "WHERE workspace_id=?", (ws_id,))
        for a in apps:  # stage order follows the current pipeline settings, not the order at import time
            a["stage_index"] = index.get(a["stage"]) if a.get("stage") else None
        return M.Dataset(students, apps, conf, today=today or date.today())
