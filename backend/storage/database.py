"""
PlatformDB — accounts, sessions, workspaces, document metadata, activity, saved analyses
and placement records (SQLite, WAL mode).

Schema changes are versioned migrations (MIGRATIONS below). Each one runs exactly once,
in order, inside a transaction, and its version is recorded in schema_migrations.
Released migrations are never edited — append a new one instead.

Knowledge graphs are NOT stored here: the shared corpus lives in data/kb (backend.kb)
and every workspace owns a separate knowledge base under data/workspaces/<id>/kb.
"""

import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.utils.logger import get_logger

log = get_logger(__name__)

MIGRATIONS: List[Tuple[int, str, str]] = [
    (1, "accounts, sessions, workspaces, activity", """
    CREATE TABLE users (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
        primary_workspace_type TEXT,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL,
        last_login_at REAL
    );
    CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        remember INTEGER NOT NULL DEFAULT 0,
        user_agent TEXT,
        created_at REAL NOT NULL,
        expires_at REAL NOT NULL,
        last_seen_at REAL NOT NULL
    );
    CREATE INDEX idx_sessions_user ON sessions(user_id);
    CREATE TABLE workspaces (
        workspace_id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('corporate', 'research', 'legal', 'placement')),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL REFERENCES users(user_id),
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
    );
    CREATE TABLE workspace_members (
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'analyst', 'viewer')),
        added_at REAL NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
    );
    CREATE INDEX idx_members_user ON workspace_members(user_id);
    CREATE TABLE document_meta (
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        doc_id TEXT NOT NULL,
        company TEXT,
        fiscal_year TEXT,
        doc_kind TEXT,
        jurisdiction TEXT,
        authority TEXT,
        effective_date TEXT,
        source_url TEXT,
        verified_at REAL,
        is_sample INTEGER NOT NULL DEFAULT 0,
        uploaded_by TEXT,
        updated_at REAL NOT NULL,
        PRIMARY KEY (workspace_id, doc_id)
    );
    CREATE TABLE activity (
        activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        workspace_id TEXT,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        created_at REAL NOT NULL
    );
    CREATE INDEX idx_activity_user ON activity(user_id, created_at);
    CREATE TABLE saved_analyses (
        analysis_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        workspace_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at REAL NOT NULL
    );
    CREATE INDEX idx_saved_user ON saved_analyses(user_id, created_at);
    """),
    (2, "placement records and import history", """
    CREATE TABLE pl_settings (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        config TEXT NOT NULL,
        updated_at REAL NOT NULL
    );
    CREATE TABLE pl_imports (
        import_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('students', 'applications')),
        filename TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('staged', 'committed', 'discarded', 'failed')),
        uploaded_by TEXT NOT NULL,
        is_sample INTEGER NOT NULL DEFAULT 0,
        mapping TEXT NOT NULL DEFAULT '{}',
        duplicate_policy TEXT,
        summary TEXT NOT NULL DEFAULT '{}',
        created_at REAL NOT NULL,
        committed_at REAL
    );
    CREATE INDEX idx_pl_imports_ws ON pl_imports(workspace_id, created_at);
    CREATE TABLE pl_students (
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        academic_year TEXT NOT NULL,
        student_id TEXT NOT NULL,
        department TEXT,
        program TEXT,
        graduation_year INTEGER,
        eligible INTEGER,
        registered INTEGER,
        import_id TEXT NOT NULL,
        source_row INTEGER NOT NULL,
        updated_at REAL NOT NULL,
        PRIMARY KEY (workspace_id, academic_year, student_id)
    );
    CREATE TABLE pl_applications (
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        record_key TEXT NOT NULL,
        academic_year TEXT NOT NULL,
        student_id TEXT NOT NULL,
        department TEXT,
        company TEXT NOT NULL,
        company_norm TEXT NOT NULL,
        industry TEXT,
        role TEXT NOT NULL DEFAULT '',
        opportunity_type TEXT NOT NULL CHECK (opportunity_type IN ('internship', 'full_time')),
        is_ppo INTEGER NOT NULL DEFAULT 0,
        stage TEXT,
        stage_index INTEGER,
        result TEXT NOT NULL,
        internship_status TEXT,
        ppo_status TEXT,
        ctc REAL,
        stipend REAL,
        applied_on TEXT,
        result_on TEXT,
        offer_on TEXT,
        import_id TEXT NOT NULL,
        source_row INTEGER NOT NULL,
        updated_at REAL NOT NULL,
        PRIMARY KEY (workspace_id, record_key)
    );
    CREATE INDEX idx_pl_app_year ON pl_applications(workspace_id, academic_year);
    CREATE INDEX idx_pl_app_company ON pl_applications(workspace_id, company_norm);
    CREATE INDEX idx_pl_app_student ON pl_applications(workspace_id, student_id);
    """),
]


class PlatformDB:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False, timeout=30)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self.migrate()

    # ── migrations ────────────────────────────────────────────────────────────
    def migrate(self) -> List[int]:
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, "
                "description TEXT NOT NULL, applied_at REAL NOT NULL)")
            self._conn.commit()
            done = {r[0] for r in self._conn.execute("SELECT version FROM schema_migrations")}
            applied = []
            for version, desc, sql in MIGRATIONS:
                if version in done:
                    continue
                try:
                    self._conn.execute("BEGIN")
                    for stmt in (s.strip() for s in sql.split(";")):
                        if stmt:
                            self._conn.execute(stmt)
                    self._conn.execute("INSERT INTO schema_migrations VALUES (?,?,?)", (version, desc, time.time()))
                    self._conn.commit()
                except Exception:
                    self._conn.rollback()
                    raise
                applied.append(version)
                log.info(f"Platform DB migration {version} applied: {desc}")
            return applied

    def schema_version(self) -> int:
        row = self.one("SELECT MAX(version) AS v FROM schema_migrations")
        return int(row["v"] or 0) if row else 0

    # ── plumbing ──────────────────────────────────────────────────────────────
    @contextmanager
    def tx(self):
        with self._lock:
            try:
                yield self._conn
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

    def q(self, sql: str, args: Sequence = ()) -> List[Dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, args).fetchall()]

    def one(self, sql: str, args: Sequence = ()) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(sql, args).fetchone()
            return dict(row) if row else None

    def execute(self, sql: str, args: Sequence = ()) -> int:
        with self.tx() as c:
            return c.execute(sql, args).rowcount

    def close(self) -> None:
        with self._lock:
            self._conn.close()
