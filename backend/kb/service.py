"""
KnowledgeBaseService — the single façade the API, CLI and tests talk to.

Ingestion lifecycle (per upload batch → one job):
  register_uploads()  validate type/size/content, sha256 duplicate check, save file, status=queued
  run_job()           for each doc: extract pages → chunk → index (Chroma + BM25)
                      → extract triples (Gemini if configured, else heuristics) → resolve entities
                      → write nodes/edges/evidence → status=ready
                      then rebuild topic communities once for the batch, optional Neo4j mirror
Queries go through the LangGraph workflow in qa_graph.py.
"""

import asyncio
import time
import uuid
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional, Sequence, Tuple

from backend.kb.config import KBSettings, load_settings
from backend.kb.documents import (
    ALLOWED_TYPES, DocumentError, chunk_pages, doc_id_for, document_title, extract_pages, safe_filename,
    sha256_bytes, validate_upload,
)
from backend.kb.embeddings import load_embedder, load_reranker
from backend.kb.extraction import HeuristicExtractor, LLMExtractor
from backend.kb.llm import build_llm
from backend.kb.qa_graph import build_kb_graph
from backend.kb.resolution import EntityResolver, relation_id_for
from backend.kb.retriever import KBRetriever
from backend.kb.store import KnowledgeStore
from backend.kb.text_utils import display_name, find_all_ci, locate_sentence, normalize_name
from backend.kb.topics import rebuild_topics
from backend.kb.vector_index import ChunkIndex
from backend.utils.logger import get_logger

log = get_logger(__name__)

_AUTO = "auto"


class KnowledgeBaseService:
    def __init__(self, settings: Optional[KBSettings] = None, embedder=None, reranker: Any = _AUTO,
                 llm: Any = _AUTO):
        self.settings = settings or load_settings()
        self.settings.ensure_dirs()
        self.warnings: List[str] = []
        self.store = KnowledgeStore(self.settings.sqlite_path)
        interrupted = self.store.mark_interrupted()
        if interrupted:
            self.warnings.append(f"{interrupted} document(s) were interrupted by a restart; use Retry.")

        if embedder is None:
            embedder, w = load_embedder(self.settings.embedding_model)
            if w:
                self.warnings.append(w)
        self.embedder = embedder
        if reranker == _AUTO:
            reranker, w = load_reranker(self.settings.reranker_model)
            if w:
                self.warnings.append(w)
        self.reranker = reranker
        self.llm = build_llm(self.settings) if llm == _AUTO else llm

        self.index = ChunkIndex(self.settings.chroma_dir, self.embedder)
        if self.index.error:
            self.warnings.append(self.index.error)
        self.index.sync(self.store.all_chunks())
        self.retriever = KBRetriever(self.store, self.index, self.embedder, self.reranker)
        self.graph = build_kb_graph(self)

        self.jobs: Dict[str, Dict[str, Any]] = {}
        self._ingest_lock = asyncio.Lock()
        self._tasks: set = set()
        self.neo4j_status: Dict[str, Any] = {"enabled": bool(self.settings.neo4j_uri)}
        log.success(f"Knowledge base ready: {self.store.stats()}")

    def active_llm(self):
        return self.llm if (self.llm is not None and self.llm.available) else None

    # ═════════════════════════════════════════════════════════════════════════
    # Ingestion
    # ═════════════════════════════════════════════════════════════════════════
    def register_uploads(self, files: Sequence[Tuple[str, bytes]]) -> Dict[str, Any]:
        if len(files) > self.settings.max_files_per_upload:
            raise DocumentError("too_many_files",
                                f"At most {self.settings.max_files_per_upload} files per upload ({len(files)} sent).")
        results: List[Dict[str, Any]] = []
        queued: List[Dict[str, Any]] = []
        batch_hashes: Dict[str, str] = {}
        for raw_name, data in files:
            fname = safe_filename(raw_name)
            try:
                ftype = validate_upload(fname, data, self.settings.max_upload_bytes)
                # parse now so corrupt / encrypted / scanned files are rejected immediately with a reason
                extract_pages(data, ftype)
            except DocumentError as e:
                results.append({"filename": fname, "status": "rejected", "code": e.code, "error": e.message})
                continue
            sha = sha256_bytes(data)
            if sha in batch_hashes:
                results.append({"filename": fname, "status": "duplicate", "doc_id": doc_id_for(sha),
                                "error": f"Same content as '{batch_hashes[sha]}' in this upload."})
                continue
            existing = self.store.get_document_by_hash(sha)
            if existing and existing["status"] != "failed":
                results.append({"filename": fname, "status": "duplicate", "doc_id": existing["doc_id"],
                                "error": f"Identical content already uploaded as '{existing['filename']}'."})
                continue
            if existing:  # failed earlier → clear partial data and re-ingest
                self._purge(existing["doc_id"], keep_file=False)
            doc_id = doc_id_for(sha)
            ext = Path(fname).suffix.lower()
            path = self.settings.uploads_dir / f"{doc_id}{ext}"
            path.write_bytes(data)
            self.store.add_document({"doc_id": doc_id, "filename": fname, "sha256": sha, "file_type": ftype,
                                     "size_bytes": len(data), "status": "queued", "stored_path": str(path)})
            batch_hashes[sha] = fname
            queued.append({"doc_id": doc_id, "filename": fname})
            results.append({"filename": fname, "status": "queued", "doc_id": doc_id})
        job = self._new_job([q["doc_id"] for q in queued]) if queued else None
        return {"job": job, "results": results}

    def _new_job(self, doc_ids: List[str]) -> Dict[str, Any]:
        job_id = "j_" + uuid.uuid4().hex[:10]
        job = {"id": job_id, "status": "queued", "doc_ids": doc_ids, "done": [], "failed": [], "errors": [],
               "stage": "queued", "current": None, "progress": {"chunks_done": 0, "chunks_total": 0},
               "created_at": time.time(), "finished_at": None, "topics": None}
        self.jobs[job_id] = job
        return job

    def start_job(self, job_id: str) -> None:
        task = asyncio.get_running_loop().create_task(self.run_job(job_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def run_job(self, job_id: str) -> Dict[str, Any]:
        job = self.jobs[job_id]
        async with self._ingest_lock:
            job["status"] = "running"
            for doc_id in job["doc_ids"]:
                job["current"] = doc_id
                try:
                    await self.ingest_document(doc_id, job)
                    job["done"].append(doc_id)
                except Exception as e:
                    msg = e.message if isinstance(e, DocumentError) else f"{type(e).__name__}: {e}"
                    log.error(f"Ingestion failed for {doc_id}: {msg}")
                    self._purge(doc_id, keep_file=True, keep_row=True)
                    self.store.update_document(doc_id, status="failed", error=msg)
                    job["failed"].append({"doc_id": doc_id, "error": msg})
            job["current"] = None
            if job["done"]:
                job["stage"] = "topics"
                try:
                    job["topics"] = await self.rebuild_topics()
                except Exception as e:
                    log.exception("Topic rebuild failed")
                    job["errors"].append(f"Topic rebuild failed: {e}")
                await self._sync_neo4j()
            job["stage"] = "finished"
            job["status"] = "done" if not job["failed"] else ("partial" if job["done"] else "failed")
            job["finished_at"] = time.time()
        return job

    async def ingest_document(self, doc_id: str, job: Optional[Dict[str, Any]] = None) -> None:
        doc = self.store.get_document(doc_id)
        if doc is None:
            raise DocumentError("missing", "Document record disappeared before ingestion.")
        if job:
            job["stage"] = f"extracting text: {doc['filename']}"
        self.store.update_document(doc_id, status="processing", error=None)
        data = Path(doc["stored_path"]).read_bytes()
        pages = await asyncio.to_thread(extract_pages, data, doc["file_type"])
        chunks = chunk_pages(doc_id, pages, self.settings.chunk_size, self.settings.chunk_overlap)
        if not chunks:
            raise DocumentError("no_text", "No text chunks could be produced.")
        self.store.add_chunks(chunks)
        if job:
            job["stage"] = f"indexing: {doc['filename']}"
            job["progress"] = {"chunks_done": 0, "chunks_total": len(chunks)}
        chunk_dicts = [{"chunk_id": c.chunk_id, "doc_id": c.doc_id, "page": c.page, "chunk_index": c.chunk_index,
                        "text": c.text} for c in chunks]
        await asyncio.to_thread(self.index.add, chunk_dicts)

        if job:
            job["stage"] = f"extracting entities & relations: {doc['filename']}"
        heur = HeuristicExtractor(self.store.concept_norms(), self.store.named_norms())
        llm = self.active_llm()
        if llm is not None:
            extractor = LLMExtractor(llm, heur, self.settings.extraction_concurrency)

            async def one(c):
                r = await extractor.extract(c.chunk_id, c.text, doc["filename"], c.page)
                if job:
                    job["progress"]["chunks_done"] += 1
                return r
            results = await asyncio.gather(*(one(c) for c in chunks))
        else:
            def run_heuristic():
                out = []
                for c in chunks:
                    r = heur.extract(c.chunk_id, c.text)
                    heur.known_concepts |= {normalize_name(e.name) for e in r.entities if e.kind == "concept"}
                    heur.known_names |= {normalize_name(e.name) for e in r.entities if e.kind == "named"}
                    out.append(r)
                    if job:
                        job["progress"]["chunks_done"] += 1
                return out
            results = await asyncio.to_thread(run_heuristic)

        self._write_extractions(doc_id, results)
        n_ent, n_rel = self.store.doc_counts(doc_id)
        methods = Counter(r.method for r in results)
        self.store.update_document(
            doc_id, status="ready", title=document_title(pages, doc["filename"]), num_pages=len(pages),
            num_chunks=len(chunks), num_entities=n_ent, num_relations=n_rel,
            extractor="llm" if methods.get("llm") else "heuristic")
        self.index.rebuild_bm25(self.store.all_chunks())
        self.store.bump_version()
        log.success(f"Ingested {doc['filename']}: {len(chunks)} chunks, {n_ent} entities, {n_rel} relations "
                    f"({dict(methods)})")

    def _write_extractions(self, doc_id: str, results) -> None:
        resolver = EntityResolver(self.store.alias_index(), self.store.entity_info())
        entities: Dict[str, Dict[str, Any]] = {}
        mentions: List[Tuple[str, str, str, str]] = []
        relations: List[Dict[str, Any]] = []

        def ensure(name: str, etype: str, desc: str = "") -> Optional[str]:
            r = resolver.resolve(name, etype)
            if not r:
                return None
            eid = r[0]
            canon, ctype = resolver.info.get(eid, (name, etype))
            cur = entities.get(eid)
            if cur is None:
                stored_type = ctype if ctype not in ("Other",) else etype
                entities[eid] = {"name": canon if stored_type == "Concept" else display_name(canon),
                                 "norm": normalize_name(canon), "type": stored_type, "description": desc}
            else:
                if cur["type"] in ("Other", "Concept") and etype not in ("Other", "Concept"):
                    cur["type"] = etype
                if desc and not cur["description"]:
                    cur["description"] = desc
            return eid

        for res in results:
            types = {normalize_name(e.name): e.type for e in res.entities}
            for e in sorted(res.entities, key=lambda e: -len(e.name)):  # full names before surnames
                eid = ensure(e.name, e.type, e.description)
                if eid:
                    mentions.append((eid, res.chunk_id, doc_id, "extract"))
            for alias, canon in res.aliases:
                resolver.add_alias(alias, canon)
            for rel in res.relations:
                s = ensure(rel.subject, types.get(normalize_name(rel.subject), "Other"))
                o = ensure(rel.object, types.get(normalize_name(rel.object), "Other"))
                if not s or not o or s == o:
                    continue
                relations.append({
                    "relation_id": relation_id_for(s, rel.predicate, o), "subject_id": s, "predicate": rel.predicate,
                    "object_id": o, "chunk_id": res.chunk_id, "doc_id": doc_id, "sentence": rel.evidence,
                    "method": res.method, "confidence": rel.confidence,
                })
                mentions.extend([(s, res.chunk_id, doc_id, "extract"), (o, res.chunk_id, doc_id, "extract")])
        self.store.write_extraction(entities, resolver.new_aliases, mentions, relations)

    async def rebuild_topics(self) -> Dict[str, Any]:
        result = await rebuild_topics(self.store, self.active_llm(), self.settings.community_resolution)
        self.retriever.refresh(force=True)
        return result

    def _purge(self, doc_id: str, keep_file: bool, keep_row: bool = False) -> None:
        doc = self.store.get_document(doc_id)
        if doc is None:
            return
        self.index.delete_doc(doc_id)
        if keep_row:
            with self.store.tx() as c:
                c.execute("DELETE FROM evidence WHERE doc_id=?", (doc_id,))
                c.execute("DELETE FROM relations WHERE relation_id NOT IN (SELECT DISTINCT relation_id FROM evidence)")
                c.execute("DELETE FROM mentions WHERE doc_id=?", (doc_id,))
                c.execute("DELETE FROM chunks WHERE doc_id=?", (doc_id,))
                self.store.bump_version(c)
        else:
            self.store.delete_document(doc_id)
        if not keep_file and doc.get("stored_path"):
            self._remove_upload(Path(doc["stored_path"]))
        self.index.rebuild_bm25(self.store.all_chunks())

    def _remove_upload(self, path: Path) -> None:
        try:
            uploads = self.settings.uploads_dir.resolve()
            if path.resolve().parent == uploads and path.exists():
                path.unlink()
        except OSError as e:
            log.warning(f"Could not remove stored upload {path}: {e}")

    async def delete_document(self, doc_id: str) -> Dict[str, Any]:
        async with self._ingest_lock:
            doc = self.store.get_document(doc_id)
            if doc is None:
                raise KeyError(doc_id)
            self.index.delete_doc(doc_id)
            stats = self.store.delete_document(doc_id)
            if doc.get("stored_path"):
                self._remove_upload(Path(doc["stored_path"]))
            self.index.rebuild_bm25(self.store.all_chunks())
            stats["topics"] = await self.rebuild_topics()
            await self._sync_neo4j()
            return {"deleted": doc_id, "filename": doc["filename"], **stats}

    def retry_document(self, doc_id: str) -> Dict[str, Any]:
        doc = self.store.get_document(doc_id)
        if doc is None:
            raise KeyError(doc_id)
        if doc["status"] != "failed":
            raise DocumentError("not_failed", f"Document is '{doc['status']}', only failed documents can be retried.")
        if not doc.get("stored_path") or not Path(doc["stored_path"]).exists():
            raise DocumentError("file_missing", "The stored upload is gone; please upload the file again.")
        self._purge(doc_id, keep_file=True, keep_row=True)
        self.store.update_document(doc_id, status="queued", error=None)
        return self._new_job([doc_id])

    async def reset(self) -> Dict[str, Any]:
        async with self._ingest_lock:
            docs = self.store.list_documents()
            self.store.reset()
            self.index.reset()
            self.index.rebuild_bm25([])
            for d in docs:
                if d.get("stored_path"):
                    self._remove_upload(Path(d["stored_path"]))
            self.retriever.refresh(force=True)
            await self._sync_neo4j()
            return {"reset": True, "documents_removed": len(docs)}

    def sample_files(self) -> List[Path]:
        d = self.settings.samples_dir
        return sorted(p for p in d.glob("*") if p.suffix.lower() in ALLOWED_TYPES) if d.exists() else []

    async def ingest_files_and_wait(self, files: Sequence[Tuple[str, bytes]]) -> Dict[str, Any]:
        """Register + run synchronously (CLI, tests)."""
        reg = self.register_uploads(files)
        if reg["job"]:
            reg["job"] = await self.run_job(reg["job"]["id"])
        return reg

    async def _sync_neo4j(self) -> None:
        if not self.settings.neo4j_uri:
            return
        from backend.kb.neo4j_sync import sync_graph
        self.neo4j_status = await asyncio.to_thread(sync_graph, self.store, self.settings)

    # ═════════════════════════════════════════════════════════════════════════
    # Questions
    # ═════════════════════════════════════════════════════════════════════════
    async def answer(self, question: str, doc_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        t0 = time.monotonic()
        state = await self.graph.ainvoke({"question": question, "doc_filter": doc_ids or [], "trace": []})
        return self._payload(state, t0)

    async def answer_stream(self, question: str, doc_ids: Optional[List[str]] = None) -> AsyncGenerator[Dict, None]:
        t0 = time.monotonic()
        acc: Dict[str, Any] = {"question": question, "trace": []}
        async for update in self.graph.astream({"question": question, "doc_filter": doc_ids or [], "trace": []},
                                               stream_mode="updates"):
            for _node, delta in update.items():
                for k, v in (delta or {}).items():
                    if k == "trace":
                        acc["trace"] = acc["trace"] + v
                        for t in v:
                            yield {"type": "stage", **t}
                    else:
                        acc[k] = v
        yield {"type": "result", **self._payload(acc, t0)}

    def _payload(self, state: Dict[str, Any], t0: float) -> Dict[str, Any]:
        ev = state.get("evidence") or {"sources": [], "facts": [], "paths": [], "topics": [], "comparison": None,
                                       "notes": [], "highlight": {"nodes": [], "edges": [], "path_edges": [],
                                                                  "communities": []}}
        used = set(state.get("citations_used") or [])
        sources = [dict(s, cited=s["id"] in used) for s in ev["sources"]]
        facts = [dict(f, cited=f["id"] in used) for f in ev["facts"]]
        return {
            "question": state.get("question"), "route": state.get("route"), "route_reason": state.get("route_reason"),
            "route_method": state.get("route_method"), "answer": state.get("answer", ""),
            "sufficient": bool(state.get("sufficient")), "sufficiency_reason": state.get("sufficiency_reason"),
            "mode": state.get("mode"), "sources": sources, "graph_facts": facts, "paths": ev["paths"],
            "topics": ev["topics"], "comparison": ev["comparison"], "notes": ev.get("notes", []),
            "highlight": ev["highlight"], "linked_entities": state.get("linked", []),
            "citations_used": state.get("citations_used", []), "warnings": state.get("warnings", []),
            "followups": state.get("followups", []), "trace": state.get("trace", []),
            "latency_ms": int((time.monotonic() - t0) * 1000),
        }

    # ═════════════════════════════════════════════════════════════════════════
    # Read models for the UI
    # ═════════════════════════════════════════════════════════════════════════
    def status(self) -> Dict[str, Any]:
        llm = self.llm
        return {
            "stats": self.store.stats(), "graph_version": self.store.graph_version(),
            "llm": {"configured": self.settings.llm_enabled, "active": self.active_llm() is not None,
                    "model": self.settings.gen_model if llm else None,
                    "last_error": getattr(llm, "last_error", None),
                    "mode": "gemini" if self.active_llm() else "heuristic/extractive"},
            "embedding_model": self.embedder.name, "reranker": getattr(self.reranker, "name", None),
            "dense_index": self.index.dense_ok, "graph_store": "sqlite", "neo4j": self.neo4j_status,
            "warnings": self.warnings,
            "jobs": [j for j in self.jobs.values() if j["status"] in ("queued", "running")],
        }

    def documents(self) -> List[Dict[str, Any]]:
        docs = self.store.list_documents()
        for d in docs:
            d.pop("stored_path", None)
        return docs

    def graph_payload(self, limit: int = 600) -> Dict[str, Any]:
        R = self.retriever
        R.refresh()
        rels = list(R.relations.values())
        degree: Counter = Counter()
        for r in rels:
            degree[r["subject_id"]] += 1
            degree[r["object_id"]] += 1
        mention_count: Counter = Counter()
        doc_sets: Dict[str, set] = defaultdict(set)
        for eid, _, did in self.store.entity_mentions():
            mention_count[eid] += 1
            doc_sets[eid].add(did)
        cands = [e for e in R.entities if degree[e] > 0 or len(doc_sets[e]) >= 2]
        cands.sort(key=lambda e: -(degree[e] * 2 + mention_count[e]))
        keep = set(cands[:limit])
        comm_of = {e: R.entities[e].get("community_id") for e in keep}
        nodes = [{"id": e, "name": R.entities[e]["name"], "type": R.entities[e]["type"], "community": comm_of[e],
                  "degree": degree[e], "mentions": mention_count[e], "doc_count": len(doc_sets[e])} for e in keep]
        edges = [{"id": r["relation_id"], "source": r["subject_id"], "target": r["object_id"],
                  "predicate": r["predicate"], "evidence_count": int(r["evidence_count"]),
                  "doc_count": int(r["doc_count"]), "methods": r.get("methods"),
                  "cross_topic": bool(comm_of.get(r["subject_id"]) and comm_of.get(r["object_id"])
                                      and comm_of[r["subject_id"]] != comm_of[r["object_id"]])}
                 for r in rels if r["subject_id"] in keep and r["object_id"] in keep]
        topics = [{"id": t["community_id"], "label": t["label"], "summary": t["summary"], "keywords": t["keywords"],
                   "size": t["size"], "doc_ids": t["doc_ids"], "evidence_chunk_ids": t["evidence_chunk_ids"],
                   "method": t["method"], "color_index": t["rank"],
                   "top_entities": [R.entity_brief(e) for e in t["top_entities"][:6]]} for t in self.store.communities()]
        return {"version": self.store.graph_version(), "nodes": nodes, "edges": edges, "topics": topics,
                "topic_links": self.store.community_links(), "truncated": len(cands) > limit,
                "documents": [{"doc_id": d["doc_id"], "filename": d["filename"]} for d in self.store.list_documents("ready")]}

    def entity_detail(self, entity_id: str) -> Dict[str, Any]:
        R = self.retriever
        R.refresh()
        e = self.store.get_entity(entity_id)
        if e is None:
            raise KeyError(entity_id)
        aliases = sorted(set(self.store.entity_aliases(entity_id)) | {e["name"]}, key=len, reverse=True)
        rels = []
        for r in R.entity_relations(entity_id, limit=60):
            out = r["subject_id"] == entity_id
            other = r["object_id"] if out else r["subject_id"]
            rels.append({"id": r["relation_id"], "direction": "out" if out else "in", "predicate": r["predicate"],
                         "other": R.entity_brief(other), "evidence_count": int(r["evidence_count"])})
        chunk_ids = self.store.entity_chunk_ids(entity_id)
        rows = self.store.get_chunks(chunk_ids[:12])
        passages = []
        for cid in chunk_ids[:12]:
            row = rows.get(cid)
            if not row:
                continue
            spans = sorted({sp for a in aliases for sp in find_all_ci(row["text"], a)})
            passages.append({"chunk_id": cid, "doc_id": row["doc_id"], "filename": row["filename"], "page": row["page"],
                             "text": row["text"], "highlights": [list(s) for s in spans]})
        topic = next((t for t in self.store.communities() if t["community_id"] == e.get("community_id")), None)
        return {"id": entity_id, "name": e["name"], "type": e["type"], "description": e["description"],
                "aliases": aliases, "relations": rels, "passages": passages, "mention_count": len(chunk_ids),
                "documents": sorted({p["filename"] for p in passages}),
                "topic": {"id": topic["community_id"], "label": topic["label"], "summary": topic["summary"]} if topic else None}

    def relation_detail(self, relation_id: str) -> Dict[str, Any]:
        R = self.retriever
        R.refresh()
        r = self.store.get_relation(relation_id)
        if r is None:
            raise KeyError(relation_id)
        ev = self.store.relation_evidence([relation_id]).get(relation_id, [])
        evidence = []
        for e in ev:
            a, b = locate_sentence(e["chunk_text"], e["sentence"])
            evidence.append({"chunk_id": e["chunk_id"], "doc_id": e["doc_id"], "filename": e["filename"], "page": e["page"],
                             "sentence": e["sentence"], "text": e["chunk_text"], "highlights": [[a, b]] if a >= 0 else [],
                             "method": e["method"], "confidence": e["confidence"]})
        return {"id": relation_id, "predicate": r["predicate"], "subject": R.entity_brief(r["subject_id"]),
                "object": R.entity_brief(r["object_id"]), "evidence": evidence}

    def chunk_detail(self, chunk_id: str) -> Dict[str, Any]:
        row = self.store.get_chunks([chunk_id]).get(chunk_id)
        if row is None:
            raise KeyError(chunk_id)
        return {"chunk_id": chunk_id, "doc_id": row["doc_id"], "filename": row["filename"], "page": row["page"],
                "start_char": row["start_char"], "end_char": row["end_char"], "text": row["text"],
                "entity_ids": self.store.chunk_entity_ids(chunk_id)}


# ─── Singleton ────────────────────────────────────────────────────────────────
_kb: Optional[KnowledgeBaseService] = None
_kb_error: Optional[str] = None


def get_kb() -> KnowledgeBaseService:
    global _kb, _kb_error
    if _kb is None:
        try:
            _kb = KnowledgeBaseService()
            _kb_error = None
        except Exception as e:
            _kb_error = f"{type(e).__name__}: {e}"
            log.exception("Knowledge base failed to initialise")
            raise
    return _kb


def kb_init_error() -> Optional[str]:
    return _kb_error
