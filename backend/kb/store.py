"""
KnowledgeStore — persistent graph + document store (SQLite, WAL mode).

Tables
  documents        uploaded files (sha256-unique → duplicate detection), status lifecycle
  chunks           sentence-aligned passages with page + char offsets
  entities         graph nodes (canonical name, type, description, community)
  aliases          normalised surface form → entity (dedup + question linking)
  mentions         entity ↔ chunk occurrences (extraction or alias scan)
  relations        graph edges (subject, predicate, object) — unique per triple
  evidence         verbatim sentence(s) supporting each edge, per chunk
  communities      topic communities with grounded summaries
  community_links  cross-topic connections (bridge relations)
  summary_cache    topic summaries keyed by member signature
  meta             graph_version counter etc.

All access goes through one connection guarded by an RLock (FastAPI handlers and
the ingestion task share it). Optional Neo4j mirroring lives in neo4j_sync.py.
"""

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from backend.kb.documents import Chunk

_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    doc_id TEXT PRIMARY KEY, filename TEXT NOT NULL, title TEXT, sha256 TEXT NOT NULL UNIQUE,
    file_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, num_pages INTEGER DEFAULT 0,
    num_chunks INTEGER DEFAULT 0, num_entities INTEGER DEFAULT 0, num_relations INTEGER DEFAULT 0,
    status TEXT NOT NULL, error TEXT, extractor TEXT, stored_path TEXT,
    uploaded_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
    chunk_id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, page INTEGER NOT NULL, chunk_index INTEGER NOT NULL,
    start_char INTEGER NOT NULL, end_char INTEGER NOT NULL, text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
CREATE TABLE IF NOT EXISTS entities (
    entity_id TEXT PRIMARY KEY, name TEXT NOT NULL, norm TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'Other',
    description TEXT NOT NULL DEFAULT '', community_id TEXT, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS aliases (
    norm TEXT PRIMARY KEY, entity_id TEXT NOT NULL, alias TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alias_entity ON aliases(entity_id);
CREATE TABLE IF NOT EXISTS mentions (
    entity_id TEXT NOT NULL, chunk_id TEXT NOT NULL, doc_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'extract',
    PRIMARY KEY (entity_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_mentions_chunk ON mentions(chunk_id);
CREATE INDEX IF NOT EXISTS idx_mentions_doc ON mentions(doc_id);
CREATE TABLE IF NOT EXISTS relations (
    relation_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, predicate TEXT NOT NULL, object_id TEXT NOT NULL,
    created_at REAL NOT NULL, UNIQUE (subject_id, predicate, object_id)
);
CREATE INDEX IF NOT EXISTS idx_rel_subject ON relations(subject_id);
CREATE INDEX IF NOT EXISTS idx_rel_object ON relations(object_id);
CREATE TABLE IF NOT EXISTS evidence (
    relation_id TEXT NOT NULL, chunk_id TEXT NOT NULL, doc_id TEXT NOT NULL, sentence TEXT NOT NULL,
    method TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5,
    PRIMARY KEY (relation_id, chunk_id, sentence)
);
CREATE INDEX IF NOT EXISTS idx_evidence_doc ON evidence(doc_id);
CREATE TABLE IF NOT EXISTS communities (
    community_id TEXT PRIMARY KEY, label TEXT NOT NULL, summary TEXT NOT NULL, keywords TEXT NOT NULL,
    size INTEGER NOT NULL, method TEXT NOT NULL, evidence_chunk_ids TEXT NOT NULL, doc_ids TEXT NOT NULL,
    signature TEXT NOT NULL, rank INTEGER NOT NULL DEFAULT 0, top_entities TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS community_links (
    source TEXT NOT NULL, target TEXT NOT NULL, weight REAL NOT NULL, bridges TEXT NOT NULL,
    PRIMARY KEY (source, target)
);
CREATE TABLE IF NOT EXISTS summary_cache (
    cache_key TEXT PRIMARY KEY, label TEXT NOT NULL, summary TEXT NOT NULL, keywords TEXT NOT NULL,
    method TEXT NOT NULL, evidence_chunk_ids TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


class StoreError(RuntimeError):
    pass


class KnowledgeStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        try:
            self._conn = sqlite3.connect(str(self.path), check_same_thread=False, timeout=30)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.executescript(_SCHEMA)
            self._conn.commit()
        except sqlite3.DatabaseError as e:
            raise StoreError(f"Knowledge store at {self.path} is unreadable: {e}") from e

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

    def _q(self, sql: str, args: Sequence = ()) -> List[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, args).fetchall()

    def _one(self, sql: str, args: Sequence = ()) -> Optional[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, args).fetchone()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def graph_version(self) -> int:
        row = self._one("SELECT value FROM meta WHERE key='graph_version'")
        return int(row["value"]) if row else 0

    def bump_version(self, conn: Optional[sqlite3.Connection] = None) -> None:
        c = conn or self._conn
        with self._lock:
            c.execute(
                "INSERT INTO meta(key, value) VALUES('graph_version', '1') "
                "ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"
            )
            if conn is None:
                self._conn.commit()

    # ── documents ─────────────────────────────────────────────────────────────
    def add_document(self, doc: Dict[str, Any]) -> None:
        now = time.time()
        with self.tx() as c:
            c.execute(
                "INSERT INTO documents(doc_id, filename, title, sha256, file_type, size_bytes, status, stored_path, "
                "uploaded_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (doc["doc_id"], doc["filename"], doc.get("title"), doc["sha256"], doc["file_type"],
                 doc["size_bytes"], doc.get("status", "queued"), doc.get("stored_path"), now, now),
            )

    def update_document(self, doc_id: str, **fields) -> None:
        if not fields:
            return
        fields["updated_at"] = time.time()
        cols = ", ".join(f"{k}=?" for k in fields)
        with self.tx() as c:
            c.execute(f"UPDATE documents SET {cols} WHERE doc_id=?", (*fields.values(), doc_id))

    def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT * FROM documents WHERE doc_id=?", (doc_id,))
        return dict(row) if row else None

    def get_document_by_hash(self, sha: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT * FROM documents WHERE sha256=?", (sha,))
        return dict(row) if row else None

    def list_documents(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        if status:
            rows = self._q("SELECT * FROM documents WHERE status=? ORDER BY uploaded_at", (status,))
        else:
            rows = self._q("SELECT * FROM documents ORDER BY uploaded_at")
        return [dict(r) for r in rows]

    def mark_interrupted(self) -> int:
        """Documents left mid-pipeline by a crash/restart are marked failed (retryable)."""
        with self.tx() as c:
            cur = c.execute(
                "UPDATE documents SET status='failed', error='Interrupted by server restart — retry to re-ingest.', "
                "updated_at=? WHERE status IN ('queued','processing')", (time.time(),))
            return cur.rowcount

    # ── chunks ────────────────────────────────────────────────────────────────
    def add_chunks(self, chunks: Iterable[Chunk]) -> None:
        with self.tx() as c:
            c.executemany(
                "INSERT OR REPLACE INTO chunks VALUES (?,?,?,?,?,?,?)",
                [(ch.chunk_id, ch.doc_id, ch.page, ch.chunk_index, ch.start_char, ch.end_char, ch.text)
                 for ch in chunks],
            )

    def get_chunks(self, chunk_ids: Sequence[str]) -> Dict[str, Dict[str, Any]]:
        if not chunk_ids:
            return {}
        out: Dict[str, Dict[str, Any]] = {}
        ids = list(dict.fromkeys(chunk_ids))
        for i in range(0, len(ids), 500):
            part = ids[i:i + 500]
            rows = self._q(
                f"SELECT c.*, d.filename, d.title FROM chunks c JOIN documents d ON d.doc_id=c.doc_id "
                f"WHERE c.chunk_id IN ({','.join('?' * len(part))})", part)
            out.update({r["chunk_id"]: dict(r) for r in rows})
        return out

    def all_chunks(self, ready_only: bool = True) -> List[Dict[str, Any]]:
        sql = ("SELECT c.*, d.filename FROM chunks c JOIN documents d ON d.doc_id=c.doc_id "
               + ("WHERE d.status='ready' " if ready_only else "") + "ORDER BY c.doc_id, c.chunk_index")
        return [dict(r) for r in self._q(sql)]

    def chunk_ids_for_docs(self, doc_ids: Sequence[str]) -> List[str]:
        if not doc_ids:
            return []
        rows = self._q(f"SELECT chunk_id FROM chunks WHERE doc_id IN ({','.join('?' * len(doc_ids))})", list(doc_ids))
        return [r["chunk_id"] for r in rows]

    # ── entities / aliases / mentions ────────────────────────────────────────
    def alias_index(self) -> Dict[str, str]:
        return {r["norm"]: r["entity_id"] for r in self._q("SELECT norm, entity_id FROM aliases")}

    def aliases_by_entity(self) -> Dict[str, List[str]]:
        out: Dict[str, List[str]] = {}
        for r in self._q("SELECT entity_id, alias FROM aliases"):
            out.setdefault(r["entity_id"], []).append(r["alias"])
        return out

    def entity_info(self) -> Dict[str, Tuple[str, str]]:
        return {r["entity_id"]: (r["name"], r["type"]) for r in self._q("SELECT entity_id, name, type FROM entities")}

    def concept_norms(self) -> List[str]:
        return [r["norm"] for r in self._q("SELECT norm FROM entities WHERE type='Concept'")]

    def named_norms(self) -> List[str]:
        return [r["norm"] for r in self._q("SELECT norm FROM entities WHERE type!='Concept'")]

    def write_extraction(
        self,
        entities: Dict[str, Dict[str, Any]],          # entity_id → {name, norm, type, description}
        aliases: Dict[str, Tuple[str, str]],          # norm → (entity_id, surface)
        mentions: Iterable[Tuple[str, str, str, str]],  # (entity_id, chunk_id, doc_id, source)
        relations: Iterable[Dict[str, Any]],          # {relation_id, subject_id, predicate, object_id, chunk_id, doc_id, sentence, method, confidence}
    ) -> None:
        now = time.time()
        with self.tx() as c:
            for eid, e in entities.items():
                row = c.execute("SELECT type, description FROM entities WHERE entity_id=?", (eid,)).fetchone()
                if row is None:
                    c.execute("INSERT INTO entities(entity_id, name, norm, type, description, created_at) VALUES (?,?,?,?,?,?)",
                              (eid, e["name"], e["norm"], e.get("type") or "Other", e.get("description") or "", now))
                else:
                    new_type = row["type"]
                    if row["type"] in ("Other", "Concept") and e.get("type") not in (None, "Other", "Concept"):
                        new_type = e["type"]
                    desc = row["description"] or e.get("description") or ""
                    c.execute("UPDATE entities SET type=?, description=? WHERE entity_id=?", (new_type, desc, eid))
            c.executemany("INSERT OR IGNORE INTO aliases(norm, entity_id, alias) VALUES (?,?,?)",
                          [(n, eid, surf) for n, (eid, surf) in aliases.items()])
            c.executemany("INSERT OR IGNORE INTO mentions(entity_id, chunk_id, doc_id, source) VALUES (?,?,?,?)",
                          list(mentions))
            for r in relations:
                c.execute("INSERT OR IGNORE INTO relations(relation_id, subject_id, predicate, object_id, created_at) "
                          "VALUES (?,?,?,?,?)", (r["relation_id"], r["subject_id"], r["predicate"], r["object_id"], now))
                c.execute("INSERT OR IGNORE INTO evidence(relation_id, chunk_id, doc_id, sentence, method, confidence) "
                          "VALUES (?,?,?,?,?,?)", (r["relation_id"], r["chunk_id"], r["doc_id"], r["sentence"],
                                                   r["method"], r["confidence"]))
            self.bump_version(c)

    def replace_scan_mentions(self, rows: Iterable[Tuple[str, str, str]]) -> None:
        """Alias-scan mentions are recomputed wholesale on every topic rebuild."""
        with self.tx() as c:
            c.execute("DELETE FROM mentions WHERE source='scan'")
            c.executemany("INSERT OR IGNORE INTO mentions(entity_id, chunk_id, doc_id, source) VALUES (?,?,?,'scan')",
                          list(rows))

    def entity_mentions(self) -> List[Tuple[str, str, str]]:
        return [(r["entity_id"], r["chunk_id"], r["doc_id"]) for r in self._q(
            "SELECT m.entity_id, m.chunk_id, m.doc_id FROM mentions m JOIN documents d ON d.doc_id=m.doc_id "
            "WHERE d.status='ready'")]

    def get_entity(self, entity_id: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT * FROM entities WHERE entity_id=?", (entity_id,))
        return dict(row) if row else None

    def get_entities(self, ids: Sequence[str]) -> Dict[str, Dict[str, Any]]:
        if not ids:
            return {}
        ids = list(dict.fromkeys(ids))
        rows = self._q(f"SELECT * FROM entities WHERE entity_id IN ({','.join('?' * len(ids))})", ids)
        return {r["entity_id"]: dict(r) for r in rows}

    def entity_aliases(self, entity_id: str) -> List[str]:
        return [r["alias"] for r in self._q("SELECT alias FROM aliases WHERE entity_id=?", (entity_id,))]

    def entity_chunk_ids(self, entity_id: str) -> List[str]:
        return [r["chunk_id"] for r in self._q(
            "SELECT m.chunk_id FROM mentions m JOIN documents d ON d.doc_id=m.doc_id "
            "WHERE m.entity_id=? AND d.status='ready' ORDER BY m.doc_id, m.chunk_id", (entity_id,))]

    def chunk_entity_ids(self, chunk_id: str) -> List[str]:
        return [r["entity_id"] for r in self._q("SELECT entity_id FROM mentions WHERE chunk_id=?", (chunk_id,))]

    # ── relations / evidence ─────────────────────────────────────────────────
    def relations(self, ready_only: bool = True) -> List[Dict[str, Any]]:
        """All edges with distinct-sentence evidence counts (only from ready documents)."""
        sql = """
            SELECT r.relation_id, r.subject_id, r.predicate, r.object_id,
                   COUNT(DISTINCT e.sentence) AS evidence_count, COUNT(DISTINCT e.doc_id) AS doc_count,
                   MAX(e.confidence) AS confidence, GROUP_CONCAT(DISTINCT e.method) AS methods
            FROM relations r JOIN evidence e ON e.relation_id = r.relation_id
            JOIN documents d ON d.doc_id = e.doc_id
        """ + ("WHERE d.status='ready' " if ready_only else "") + "GROUP BY r.relation_id"
        return [dict(r) for r in self._q(sql)]

    def get_relation(self, relation_id: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT * FROM relations WHERE relation_id=?", (relation_id,))
        return dict(row) if row else None

    def relation_evidence(self, relation_ids: Sequence[str]) -> Dict[str, List[Dict[str, Any]]]:
        if not relation_ids:
            return {}
        ids = list(dict.fromkeys(relation_ids))
        rows = self._q(
            f"SELECT e.*, c.page, c.text AS chunk_text, d.filename FROM evidence e "
            f"JOIN chunks c ON c.chunk_id=e.chunk_id JOIN documents d ON d.doc_id=e.doc_id "
            f"WHERE e.relation_id IN ({','.join('?' * len(ids))}) AND d.status='ready' "
            f"ORDER BY e.confidence DESC, e.chunk_id", ids)
        out: Dict[str, List[Dict[str, Any]]] = {}
        seen = set()
        for r in rows:
            key = (r["relation_id"], r["sentence"])
            if key in seen:
                continue  # same sentence repeated in overlapping chunks
            seen.add(key)
            out.setdefault(r["relation_id"], []).append(dict(r))
        return out

    # ── communities ──────────────────────────────────────────────────────────
    def replace_communities(self, assignments: Dict[str, Optional[str]], communities: List[Dict[str, Any]],
                            links: List[Dict[str, Any]]) -> None:
        with self.tx() as c:
            c.execute("UPDATE entities SET community_id=NULL")
            c.executemany("UPDATE entities SET community_id=? WHERE entity_id=?",
                          [(cid, eid) for eid, cid in assignments.items()])
            c.execute("DELETE FROM communities")
            c.executemany(
                "INSERT INTO communities VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                [(t["community_id"], t["label"], t["summary"], json.dumps(t["keywords"]), t["size"], t["method"],
                  json.dumps(t["evidence_chunk_ids"]), json.dumps(t["doc_ids"]), t["signature"], t["rank"],
                  json.dumps(t["top_entities"])) for t in communities])
            c.execute("DELETE FROM community_links")
            c.executemany("INSERT INTO community_links VALUES (?,?,?,?)",
                          [(l["source"], l["target"], l["weight"], json.dumps(l["bridges"])) for l in links])
            self.bump_version(c)

    def communities(self) -> List[Dict[str, Any]]:
        out = []
        for r in self._q("SELECT * FROM communities ORDER BY rank"):
            d = dict(r)
            for k in ("keywords", "evidence_chunk_ids", "doc_ids", "top_entities"):
                d[k] = json.loads(d[k])
            out.append(d)
        return out

    def community_links(self) -> List[Dict[str, Any]]:
        out = []
        for r in self._q("SELECT * FROM community_links ORDER BY weight DESC"):
            d = dict(r)
            d["bridges"] = json.loads(d["bridges"])
            out.append(d)
        return out

    def cached_summary(self, key: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT * FROM summary_cache WHERE cache_key=?", (key,))
        if not row:
            return None
        d = dict(row)
        d["keywords"] = json.loads(d["keywords"])
        d["evidence_chunk_ids"] = json.loads(d["evidence_chunk_ids"])
        return d

    def cache_summary(self, key: str, t: Dict[str, Any]) -> None:
        with self.tx() as c:
            c.execute("INSERT OR REPLACE INTO summary_cache VALUES (?,?,?,?,?,?,?)",
                      (key, t["label"], t["summary"], json.dumps(t["keywords"]), t["method"],
                       json.dumps(t["evidence_chunk_ids"]), time.time()))

    # ── deletion ─────────────────────────────────────────────────────────────
    def delete_document(self, doc_id: str) -> Dict[str, int]:
        """Remove a document and everything derived only from it; prune orphan nodes/edges."""
        with self.tx() as c:
            c.execute("DELETE FROM evidence WHERE doc_id=?", (doc_id,))
            r_del = c.execute("DELETE FROM relations WHERE relation_id NOT IN (SELECT DISTINCT relation_id FROM evidence)").rowcount
            c.execute("DELETE FROM mentions WHERE doc_id=?", (doc_id,))
            c.execute("DELETE FROM chunks WHERE doc_id=?", (doc_id,))
            e_del = c.execute(
                "DELETE FROM entities WHERE entity_id NOT IN (SELECT entity_id FROM mentions) "
                "AND entity_id NOT IN (SELECT subject_id FROM relations) "
                "AND entity_id NOT IN (SELECT object_id FROM relations)").rowcount
            c.execute("DELETE FROM aliases WHERE entity_id NOT IN (SELECT entity_id FROM entities)")
            c.execute("DELETE FROM documents WHERE doc_id=?", (doc_id,))
            self.bump_version(c)
        return {"relations_removed": r_del, "entities_removed": e_del}

    def reset(self) -> None:
        """Wipe the knowledge base tables (documents, graph, topics). Used by the explicit reset endpoint."""
        with self.tx() as c:
            for t in ("evidence", "relations", "mentions", "aliases", "entities", "chunks", "documents",
                      "communities", "community_links"):
                c.execute(f"DELETE FROM {t}")
            self.bump_version(c)

    def doc_counts(self, doc_id: str) -> Tuple[int, int]:
        ents = self._one("SELECT COUNT(DISTINCT entity_id) AS n FROM mentions WHERE doc_id=?", (doc_id,))["n"]
        rels = self._one("SELECT COUNT(DISTINCT relation_id) AS n FROM evidence WHERE doc_id=?", (doc_id,))["n"]
        return int(ents), int(rels)

    def stats(self) -> Dict[str, int]:
        def n(sql):
            return int(self._one(sql)[0])
        return {
            "documents": n("SELECT COUNT(*) FROM documents WHERE status='ready'"),
            "documents_total": n("SELECT COUNT(*) FROM documents"),
            "chunks": n("SELECT COUNT(*) FROM chunks c JOIN documents d ON d.doc_id=c.doc_id WHERE d.status='ready'"),
            "entities": n("SELECT COUNT(*) FROM entities"),
            "relations": n("SELECT COUNT(DISTINCT r.relation_id) FROM relations r JOIN evidence e ON e.relation_id=r.relation_id"),
            "topics": n("SELECT COUNT(*) FROM communities"),
        }
