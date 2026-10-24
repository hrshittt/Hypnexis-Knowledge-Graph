"""
WorkspaceService — workspaces, membership roles, per-workspace knowledge bases,
document metadata, activity log and saved analyses.

Isolation
  Every workspace gets its own KnowledgeBaseService (own documents, Chroma index and
  uploads under data/workspaces/<id>/kb, and its own graph: the Neo4j namespace
  "<NEO4J_NAMESPACE>.ws-<id>", or the SQLite fallback graph in that directory). The
  embedder, reranker and LLM client are shared with the global KB so models load
  once per process. The shared demo corpus
  (data/kb, /api/kb) is untouched by anything here.

Roles (per workspace)
  owner    everything, incl. members, settings, deleting documents / records
  analyst  upload and import data, run analyses, see student-level placement records
  viewer   read documents, graphs, answers and aggregate metrics only
"""

import json
import threading
import time
import uuid
from collections import OrderedDict
from typing import Any, Callable, Dict, List, Optional, Tuple

from backend.config import WORKSPACE_TYPES, PlatformSettings
from backend.storage.database import PlatformDB
from backend.utils.logger import get_logger

log = get_logger(__name__)

ROLES = ("owner", "analyst", "viewer")
ROLE_RANK = {"viewer": 0, "analyst": 1, "owner": 2}
TYPE_LABELS = {"corporate": "Corporate Intelligence", "research": "Research Intelligence",
               "legal": "Legal & Policy Intelligence", "placement": "Placement Intelligence"}
META_FIELDS = ("company", "fiscal_year", "doc_kind", "jurisdiction", "authority", "effective_date", "source_url")


class WorkspaceError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def role_at_least(role: Optional[str], minimum: str) -> bool:
    return role is not None and ROLE_RANK.get(role, -1) >= ROLE_RANK[minimum]


def _shared_models() -> Tuple[Any, Any, Any]:
    """(embedder, reranker, llm) — reuse the global KB's if it initialised, else load once."""
    try:
        from backend.kb.service import get_kb
        kb = get_kb()
        return kb.embedder, kb.reranker, kb.llm
    except Exception as e:  # global KB unavailable: load our own copies
        log.warning(f"Global KB unavailable ({e}); loading models for workspace knowledge bases")
        from backend.kb.config import load_settings
        from backend.kb.embeddings import load_embedder, load_reranker
        from backend.kb.llm import build_llm
        s = load_settings()
        return load_embedder(s.embedding_model)[0], load_reranker(s.reranker_model)[0], build_llm(s)


class WorkspaceService:
    def __init__(self, db: PlatformDB, settings: PlatformSettings,
                 models_provider: Optional[Callable[[], Tuple[Any, Any, Any]]] = None):
        self.db = db
        self.settings = settings
        self._models_provider = models_provider or _shared_models
        self._models: Optional[Tuple[Any, Any, Any]] = None
        self._kbs: "OrderedDict[str, Any]" = OrderedDict()
        self._lock = threading.RLock()

    # ═════════════════════════════════════════════════════════════════════════
    # Workspaces & membership
    # ═════════════════════════════════════════════════════════════════════════
    def create(self, user_id: str, wtype: str, name: str = "", description: str = "") -> Dict[str, Any]:
        if wtype not in WORKSPACE_TYPES:
            raise WorkspaceError(422, "invalid_type", "Unknown workspace type.")
        name = (name or "").strip() or TYPE_LABELS[wtype]
        if len(name) > 80:
            raise WorkspaceError(422, "invalid_name", "Workspace names are at most 80 characters.")
        if len(description or "") > 500:
            raise WorkspaceError(422, "invalid_description", "Descriptions are at most 500 characters.")
        ws_id = "w_" + uuid.uuid4().hex[:12]
        now = time.time()
        with self.db.tx() as c:
            c.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)",
                      (ws_id, wtype, name, (description or "").strip(), user_id, now, now))
            c.execute("INSERT INTO workspace_members VALUES (?,?,?,?)", (ws_id, user_id, "owner", now))
        self.log(user_id, ws_id, "workspace", f"Created workspace “{name}”")
        return self.get(ws_id)

    def get(self, ws_id: str) -> Optional[Dict[str, Any]]:
        return self.db.one("SELECT * FROM workspaces WHERE workspace_id=?", (ws_id,))

    def role_of(self, ws_id: str, user_id: str) -> Optional[str]:
        row = self.db.one("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?", (ws_id, user_id))
        return row["role"] if row else None

    def access(self, ws_id: str, user_id: str, minimum: str = "viewer") -> Tuple[Dict[str, Any], str]:
        """(workspace, role) or WorkspaceError. Non-members get 404 so ids don't leak."""
        ws = self.get(ws_id)
        role = self.role_of(ws_id, user_id) if ws else None
        if ws is None or role is None:
            raise WorkspaceError(404, "workspace_not_found", "Workspace not found.")
        if not role_at_least(role, minimum):
            raise WorkspaceError(403, "insufficient_role",
                                 f"This action needs the {minimum} role in this workspace (you are a {role}).")
        return ws, role

    def list_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        rows = self.db.q(
            "SELECT w.*, m.role AS my_role, (SELECT COUNT(*) FROM workspace_members x WHERE x.workspace_id=w.workspace_id) "
            "AS member_count FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.workspace_id "
            "WHERE m.user_id=? ORDER BY w.created_at", (user_id,))
        return [self.public(r) for r in rows]

    def public(self, row: Dict[str, Any]) -> Dict[str, Any]:
        return {"id": row["workspace_id"], "type": row["type"], "type_label": TYPE_LABELS[row["type"]],
                "name": row["name"], "description": row["description"], "created_at": row["created_at"],
                "role": row.get("my_role"), "member_count": row.get("member_count")}

    def update(self, ws_id: str, name: Optional[str] = None, description: Optional[str] = None) -> Dict[str, Any]:
        fields: Dict[str, Any] = {}
        if name is not None:
            n = name.strip()
            if not n or len(n) > 80:
                raise WorkspaceError(422, "invalid_name", "Workspace names are 1–80 characters.")
            fields["name"] = n
        if description is not None:
            if len(description) > 500:
                raise WorkspaceError(422, "invalid_description", "Descriptions are at most 500 characters.")
            fields["description"] = description.strip()
        if fields:
            fields["updated_at"] = time.time()
            cols = ", ".join(f"{k}=?" for k in fields)
            self.db.execute(f"UPDATE workspaces SET {cols} WHERE workspace_id=?", (*fields.values(), ws_id))
        return self.get(ws_id)

    def members(self, ws_id: str) -> List[Dict[str, Any]]:
        return self.db.q(
            "SELECT u.user_id AS id, u.name, u.email, m.role, m.added_at FROM workspace_members m "
            "JOIN users u ON u.user_id=m.user_id WHERE m.workspace_id=? ORDER BY m.added_at", (ws_id,))

    def add_member(self, ws_id: str, email: str, role: str) -> Dict[str, Any]:
        if role not in ROLES:
            raise WorkspaceError(422, "invalid_role", "Role must be owner, analyst or viewer.")
        user = self.db.one("SELECT user_id FROM users WHERE email=?", ((email or "").strip().lower(),))
        if user is None:
            raise WorkspaceError(404, "user_not_found",
                                 "No Paheli account uses that email. Ask them to register first.")
        if self.role_of(ws_id, user["user_id"]):
            raise WorkspaceError(409, "already_member", "That person is already a member of this workspace.")
        self.db.execute("INSERT INTO workspace_members VALUES (?,?,?,?)", (ws_id, user["user_id"], role, time.time()))
        return next(m for m in self.members(ws_id) if m["id"] == user["user_id"])

    def _owner_count(self, ws_id: str) -> int:
        row = self.db.one("SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id=? AND role='owner'", (ws_id,))
        return int(row["n"])

    def set_member_role(self, ws_id: str, user_id: str, role: str) -> None:
        if role not in ROLES:
            raise WorkspaceError(422, "invalid_role", "Role must be owner, analyst or viewer.")
        current = self.role_of(ws_id, user_id)
        if current is None:
            raise WorkspaceError(404, "member_not_found", "Member not found.")
        if current == "owner" and role != "owner" and self._owner_count(ws_id) <= 1:
            raise WorkspaceError(409, "last_owner", "A workspace needs at least one owner.")
        self.db.execute("UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?", (role, ws_id, user_id))

    def remove_member(self, ws_id: str, user_id: str) -> None:
        current = self.role_of(ws_id, user_id)
        if current is None:
            raise WorkspaceError(404, "member_not_found", "Member not found.")
        if current == "owner" and self._owner_count(ws_id) <= 1:
            raise WorkspaceError(409, "last_owner", "A workspace needs at least one owner.")
        self.db.execute("DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?", (ws_id, user_id))

    # ═════════════════════════════════════════════════════════════════════════
    # Per-workspace knowledge bases
    # ═════════════════════════════════════════════════════════════════════════
    def models(self) -> Tuple[Any, Any, Any]:
        with self._lock:
            if self._models is None:
                self._models = self._models_provider()
            return self._models

    def kb(self, ws_id: str):
        """The workspace's KnowledgeBaseService (opened on first use, LRU-cached)."""
        with self._lock:
            svc = self._kbs.get(ws_id)
            if svc is not None:
                self._kbs.move_to_end(ws_id)
                return svc
            ws = self.get(ws_id)
            if ws is None:
                raise WorkspaceError(404, "workspace_not_found", "Workspace not found.")
            from backend.kb.config import load_settings
            from backend.kb.service import KnowledgeBaseService
            embedder, reranker, llm = self.models()
            kb_settings = load_settings(data_dir=self.settings.workspace_dir(ws_id) / "kb",
                                        samples_dir=self.settings.samples_dir / ws["type"])
            # isolation in Neo4j too: each workspace graph lives in its own namespace
            kb_settings.neo4j_namespace = f"{kb_settings.neo4j_namespace}.ws-{ws_id}"
            if llm is None:
                kb_settings.llm_mode = "off"
            svc = KnowledgeBaseService(kb_settings, embedder=embedder, reranker=reranker, llm=llm)
            self._kbs[ws_id] = svc
            self._evict()
            return svc

    def _evict(self) -> None:
        while len(self._kbs) > max(1, self.settings.max_open_workspace_kbs):
            victim = next((k for k, s in self._kbs.items() if not s._tasks and not any(
                j["status"] in ("queued", "running") for j in s.jobs.values())), None)
            if victim is None:
                return  # every open KB is ingesting; keep them all
            svc = self._kbs.pop(victim)
            try:
                svc.store.close()
            except Exception:
                pass

    def opened_kb(self, ws_id: str):
        """The KB only if it's already open (cheap status checks without opening every workspace)."""
        with self._lock:
            return self._kbs.get(ws_id)

    def close(self) -> None:
        with self._lock:
            for svc in self._kbs.values():
                try:
                    svc.store.close()
                except Exception:
                    pass
            self._kbs.clear()

    # ═════════════════════════════════════════════════════════════════════════
    # Document metadata (company, fiscal year, jurisdiction, …) — user-supplied
    # ═════════════════════════════════════════════════════════════════════════
    def doc_meta(self, ws_id: str) -> Dict[str, Dict[str, Any]]:
        rows = self.db.q("SELECT * FROM document_meta WHERE workspace_id=?", (ws_id,))
        return {r["doc_id"]: r for r in rows}

    def set_doc_meta(self, ws_id: str, doc_id: str, fields: Dict[str, Any], user_id: Optional[str] = None,
                     is_sample: Optional[bool] = None, verified: Optional[bool] = None) -> Dict[str, Any]:
        clean: Dict[str, Any] = {}
        for k in META_FIELDS:
            if k in fields:
                v = fields[k]
                v = None if v is None else str(v).strip()[:300] or None
                if k == "source_url" and v and not v.lower().startswith(("http://", "https://")):
                    raise WorkspaceError(422, "invalid_url", "Source links must start with http:// or https://.")
                clean[k] = v
        now = time.time()
        existing = self.db.one("SELECT * FROM document_meta WHERE workspace_id=? AND doc_id=?", (ws_id, doc_id))
        with self.db.tx() as c:
            if existing is None:
                c.execute("INSERT INTO document_meta(workspace_id, doc_id, uploaded_by, updated_at) VALUES (?,?,?,?)",
                          (ws_id, doc_id, user_id, now))
            sets = dict(clean)
            if is_sample is not None:
                sets["is_sample"] = int(is_sample)
            if verified is not None:
                sets["verified_at"] = now if verified else None
            sets["updated_at"] = now
            cols = ", ".join(f"{k}=?" for k in sets)
            c.execute(f"UPDATE document_meta SET {cols} WHERE workspace_id=? AND doc_id=?", (*sets.values(), ws_id, doc_id))
        return self.db.one("SELECT * FROM document_meta WHERE workspace_id=? AND doc_id=?", (ws_id, doc_id))

    def drop_doc_meta(self, ws_id: str, doc_id: Optional[str] = None) -> None:
        if doc_id is None:
            self.db.execute("DELETE FROM document_meta WHERE workspace_id=?", (ws_id,))
        else:
            self.db.execute("DELETE FROM document_meta WHERE workspace_id=? AND doc_id=?", (ws_id, doc_id))

    def documents(self, ws_id: str) -> List[Dict[str, Any]]:
        """KB documents joined with their metadata."""
        meta = self.doc_meta(ws_id)
        out = []
        for d in self.kb(ws_id).documents():
            m = meta.get(d["doc_id"], {})
            out.append({**d, "meta": {k: m.get(k) for k in META_FIELDS},
                        "is_sample": bool(m.get("is_sample")), "verified_at": m.get("verified_at"),
                        "uploaded_by": m.get("uploaded_by")})
        return out

    # ═════════════════════════════════════════════════════════════════════════
    # Activity & saved analyses (per user)
    # ═════════════════════════════════════════════════════════════════════════
    def log(self, user_id: Optional[str], ws_id: Optional[str], kind: str, summary: str,
            detail: Optional[Dict[str, Any]] = None) -> None:
        if not user_id:
            return
        try:
            self.db.execute("INSERT INTO activity(user_id, workspace_id, kind, summary, detail, created_at) "
                            "VALUES (?,?,?,?,?,?)",
                            (user_id, ws_id, kind, summary[:300], json.dumps(detail or {})[:4000], time.time()))
        except Exception as e:  # activity is best-effort; never fail the request over it
            log.warning(f"Activity log write failed: {e}")

    def activity(self, user_id: str, limit: int = 50, kind: Optional[str] = None,
                 ws_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        sql = ("SELECT a.*, w.name AS workspace_name, w.type AS workspace_type FROM activity a "
               "LEFT JOIN workspaces w ON w.workspace_id=a.workspace_id WHERE a.user_id=?")
        args: List[Any] = [user_id]
        if kind:
            sql += " AND a.kind=?"
            args.append(kind)
        sql += " ORDER BY a.created_at DESC LIMIT ?"
        args.append(max(1, min(limit, 500)))
        rows = self.db.q(sql, args)
        allowed = None if ws_ids is None else set(ws_ids)
        out = []
        for r in rows:
            if r["workspace_id"] and allowed is not None and r["workspace_id"] not in allowed:
                continue  # membership was revoked since
            r["detail"] = json.loads(r["detail"] or "{}")
            out.append(r)
        return out

    def save_analysis(self, user_id: str, ws_id: Optional[str], kind: str, title: str,
                      payload: Dict[str, Any]) -> Dict[str, Any]:
        title = (title or "").strip()[:160] or "Untitled analysis"
        raw = json.dumps(payload, default=str)
        if len(raw) > 2_000_000:
            raise WorkspaceError(413, "too_large", "This analysis is too large to save.")
        aid = "a_" + uuid.uuid4().hex[:12]
        self.db.execute("INSERT INTO saved_analyses VALUES (?,?,?,?,?,?,?)",
                        (aid, user_id, ws_id, kind, title, raw, time.time()))
        self.log(user_id, ws_id, "analysis", f"Saved “{title}”", {"analysis_id": aid, "kind": kind})
        return self.get_saved(user_id, aid)

    def list_saved(self, user_id: str, ws_ids: Optional[List[str]] = None, limit: int = 100) -> List[Dict[str, Any]]:
        rows = self.db.q(
            "SELECT s.analysis_id, s.workspace_id, s.kind, s.title, s.created_at, w.name AS workspace_name, "
            "w.type AS workspace_type FROM saved_analyses s LEFT JOIN workspaces w ON w.workspace_id=s.workspace_id "
            "WHERE s.user_id=? ORDER BY s.created_at DESC LIMIT ?", (user_id, max(1, min(limit, 500))))
        allowed = None if ws_ids is None else set(ws_ids)
        return [r for r in rows if not r["workspace_id"] or allowed is None or r["workspace_id"] in allowed]

    def get_saved(self, user_id: str, aid: str) -> Dict[str, Any]:
        row = self.db.one("SELECT * FROM saved_analyses WHERE analysis_id=? AND user_id=?", (aid, user_id))
        if row is None:
            raise WorkspaceError(404, "not_found", "Saved analysis not found.")
        row["payload"] = json.loads(row["payload"])
        return row

    def delete_saved(self, user_id: str, aid: str) -> None:
        if not self.db.execute("DELETE FROM saved_analyses WHERE analysis_id=? AND user_id=?", (aid, user_id)):
            raise WorkspaceError(404, "not_found", "Saved analysis not found.")
