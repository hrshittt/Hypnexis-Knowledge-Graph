"""
Knowledge Base API — Topic-Augmented Knowledge Graph Builder.

Routes (prefix /api/kb):
  GET    /status                    component health, counts, LLM mode, running jobs
  GET    /documents                 uploaded documents + ingestion status
  POST   /documents                 multipart upload (files=...), returns a job id (202)
  POST   /documents/{id}/retry      re-run a failed ingestion
  DELETE /documents/{id}            remove a document and everything derived only from it
  GET    /jobs/{id}                 ingestion job progress
  GET    /graph                     nodes, edges, topic communities, cross-topic links
  GET    /entities/{id}             entity inspector: aliases, relations, source passages
  GET    /relations/{id}            edge inspector: verbatim evidence sentences
  GET    /chunks/{id}               a source passage + entities mentioned in it
  GET    /topics                    topic communities with grounded summaries
  POST   /topics/rebuild            recompute communities + summaries
  POST   /graph/resync              re-extract documents missing from the active graph store
  POST   /query                     grounded answer (JSON)
  POST   /query/stream              grounded answer with live LangGraph stage events (SSE)
  GET    /examples                  demo questions (samples/questions.json)
  POST   /samples/load              ingest the bundled sample documents
  DELETE /?confirm=true             wipe the knowledge base (data/kb only)

The same route set is mounted for every workspace at /api/workspaces/{id}/kb (see
backend/api/workspaces.py) via build_kb_routes(); only the service resolver and the
access guards differ. On the shared /api/kb corpus, reads stay public and the write
guard applies the deployment's KB_SHARED_WRITE policy (set on app.state by main.py;
an app assembled without it keeps the original open behaviour).
"""

import json
from dataclasses import dataclass, field
from typing import Any, Callable, List, Optional, Sequence

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.params import Depends as DependsParam
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.kb.documents import DocumentError
from backend.kb.store import StoreError
from backend.utils.logger import get_logger

log = get_logger(__name__)
router = APIRouter(prefix="/api/kb", tags=["knowledge-base"])
limiter = Limiter(key_func=get_remote_address)


def _kb():
    """Resolve the KB singleton or fail with a 503 that explains why."""
    from backend.kb.service import get_kb
    try:
        return get_kb()
    except StoreError as e:
        raise HTTPException(status_code=503, detail=f"Knowledge store unavailable: {e}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Knowledge base failed to initialise: {e}")


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    doc_ids: Optional[List[str]] = None


@dataclass
class KBRouteOptions:
    """How one mounted copy of the KB routes finds its service and who may call what."""
    resolve: Callable[[Request], Any]
    read_deps: Sequence[DependsParam] = ()
    write_deps: Sequence[DependsParam] = ()     # upload, retry, samples, topic rebuild
    delete_deps: Sequence[DependsParam] = ()    # delete a document, wipe the KB
    name_suffix: str = ""                       # keeps slowapi's per-endpoint counters separate
    on_uploaded: Optional[Callable[[Request, dict, bool], None]] = None
    on_deleted: Optional[Callable[[Request, str], None]] = None
    on_reset: Optional[Callable[[Request], None]] = None
    on_query: Optional[Callable[[Request, str], None]] = None
    extra: dict = field(default_factory=dict)


def build_kb_routes(r: APIRouter, o: KBRouteOptions) -> APIRouter:
    read, write, delete = list(o.read_deps), list(o.write_deps), list(o.delete_deps)

    def named(fn, name: str):
        fn.__name__ = fn.__qualname__ = name + o.name_suffix
        return fn

    def hook(fn, *args):
        if fn is None:
            return
        try:
            fn(*args)
        except Exception as e:  # hooks (activity log, metadata) must never break the KB call
            log.warning(f"KB route hook failed: {e}")

    # ── status & documents ───────────────────────────────────────────────────
    async def status(request: Request):
        from backend.kb.service import kb_init_error
        try:
            return o.resolve(request).status()
        except HTTPException as e:
            if e.status_code != 503:
                raise
            return JSONResponse(status_code=503, content={"ready": False, "error": e.detail or kb_init_error()})
    r.get("/status", dependencies=read)(named(status, "status"))

    async def list_documents(request: Request):
        return {"documents": o.resolve(request).documents()}
    r.get("/documents", dependencies=read)(named(list_documents, "list_documents"))

    async def upload_documents(request: Request, files: List[UploadFile] = File(...)):
        kb = o.resolve(request)
        payload = []
        limit = kb.settings.max_upload_bytes
        for f in files:
            data = await f.read(limit + 1)  # read one byte past the limit so oversize files are detected
            payload.append((f.filename or "upload", data))
        try:
            reg = kb.register_uploads(payload)
        except DocumentError as e:
            raise HTTPException(status_code=400, detail=e.message)
        if reg["job"]:
            kb.start_job(reg["job"]["id"])
        log.info(f"Upload: {[(x['filename'], x['status']) for x in reg['results']]}")
        hook(o.on_uploaded, request, reg, False)
        return reg
    r.post("/documents", status_code=202, dependencies=write)(
        limiter.limit("20/minute")(named(upload_documents, "upload_documents")))

    async def retry_document(request: Request, doc_id: str):
        kb = o.resolve(request)
        try:
            job = kb.retry_document(doc_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Document not found")
        except DocumentError as e:
            raise HTTPException(status_code=409, detail=e.message)
        kb.start_job(job["id"])
        return {"job": job}
    r.post("/documents/{doc_id}/retry", status_code=202, dependencies=write)(named(retry_document, "retry_document"))

    async def delete_document(request: Request, doc_id: str):
        try:
            res = await o.resolve(request).delete_document(doc_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Document not found")
        hook(o.on_deleted, request, doc_id)
        return res
    r.delete("/documents/{doc_id}", dependencies=delete)(named(delete_document, "delete_document"))

    async def get_job(request: Request, job_id: str):
        job = o.resolve(request).jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found (jobs are kept in memory until restart)")
        return job
    r.get("/jobs/{job_id}", dependencies=read)(named(get_job, "get_job"))

    # ── graph read models ────────────────────────────────────────────────────
    async def graph(request: Request, limit: int = Query(600, ge=10, le=5000)):
        return o.resolve(request).graph_payload(limit=limit)
    r.get("/graph", dependencies=read)(named(graph, "graph"))

    async def entity(request: Request, entity_id: str):
        try:
            return o.resolve(request).entity_detail(entity_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Entity not found")
    r.get("/entities/{entity_id}", dependencies=read)(named(entity, "entity"))

    async def relation(request: Request, relation_id: str):
        try:
            return o.resolve(request).relation_detail(relation_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Relation not found")
    r.get("/relations/{relation_id}", dependencies=read)(named(relation, "relation"))

    async def chunk(request: Request, chunk_id: str):
        try:
            return o.resolve(request).chunk_detail(chunk_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Passage not found")
    r.get("/chunks/{chunk_id}", dependencies=read)(named(chunk, "chunk"))

    async def topics(request: Request):
        g = o.resolve(request).graph_payload(limit=5000)
        return {"topics": g["topics"], "topic_links": g["topic_links"]}
    r.get("/topics", dependencies=read)(named(topics, "topics"))

    async def rebuild_topics(request: Request):
        kb = o.resolve(request)
        async with kb._ingest_lock:
            return await kb.rebuild_topics()
    r.post("/topics/rebuild", dependencies=write)(named(rebuild_topics, "rebuild_topics"))

    async def resync_graph(request: Request):
        """E.g. after switching KB_GRAPH_STORE or wiping Neo4j: rebuild missing graph data from stored chunks."""
        kb = o.resolve(request)
        job = kb.start_graph_resync(recheck=True)
        return {"job": job, "graph_store": kb.store.graph_backend}
    r.post("/graph/resync", status_code=202, dependencies=write)(named(resync_graph, "resync_graph"))

    # ── questions ────────────────────────────────────────────────────────────
    async def query(request: Request, body: QueryRequest):
        kb = o.resolve(request)
        hook(o.on_query, request, body.question.strip())
        return await kb.answer(body.question.strip(), body.doc_ids)
    r.post("/query", dependencies=read)(limiter.limit("30/minute")(named(query, "query")))

    async def query_stream(request: Request, body: QueryRequest):
        kb = o.resolve(request)
        hook(o.on_query, request, body.question.strip())

        async def events():
            try:
                async for ev in kb.answer_stream(body.question.strip(), body.doc_ids):
                    yield f"data: {json.dumps(ev, default=str)}\n\n"
            except Exception as e:
                log.exception("KB query stream failed")
                yield f"data: {json.dumps({'type': 'error', 'message': f'{type(e).__name__}: {e}'})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    r.post("/query/stream", dependencies=read)(limiter.limit("30/minute")(named(query_stream, "query_stream")))

    # ── demo helpers ─────────────────────────────────────────────────────────
    async def examples(request: Request):
        path = o.resolve(request).settings.samples_dir / "questions.json"
        if not path.exists():
            return {"questions": []}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            raise HTTPException(status_code=500, detail=f"samples/questions.json is unreadable: {e}")
    r.get("/examples", dependencies=read)(named(examples, "examples"))

    async def load_samples(request: Request):
        kb = o.resolve(request)
        files = [(p.name, p.read_bytes()) for p in kb.sample_files()]
        if not files:
            raise HTTPException(status_code=404, detail=f"No sample documents in {kb.settings.samples_dir}")
        reg = kb.register_uploads(files)
        if reg["job"]:
            kb.start_job(reg["job"]["id"])
        hook(o.on_uploaded, request, reg, True)
        return reg
    r.post("/samples/load", status_code=202, dependencies=write)(named(load_samples, "load_samples"))

    async def reset(request: Request, confirm: bool = Query(False)):
        if not confirm:
            raise HTTPException(status_code=400, detail="Pass ?confirm=true to wipe the knowledge base.")
        res = await o.resolve(request).reset()
        hook(o.on_reset, request)
        return res
    r.delete("", dependencies=delete)(named(reset, "reset"))
    return r


# ── the shared corpus (/api/kb) ──────────────────────────────────────────────

def shared_kb_write_guard(request: Request) -> None:
    """Apply the deployment's KB_SHARED_WRITE policy to writes on the shared corpus."""
    policy = getattr(request.app.state, "shared_kb_write", "public")
    if policy == "public":
        return
    from backend.auth.deps import check_csrf, http_error, optional_user
    user = optional_user(request)
    if user is None:
        raise http_error(401, "not_authenticated", "Sign in to change the shared knowledge graph.")
    if policy == "admin" and not user.is_admin:
        raise http_error(403, "admin_required",
                         "Only administrators can change the shared knowledge graph. "
                         "Use one of your workspaces to upload your own documents.")
    check_csrf(request, user)


def _signed_in(request: Request):
    from backend.auth.deps import SESSION_COOKIE, optional_user
    return optional_user(request) if request.cookies.get(SESSION_COOKIE) else None


def _log_shared(kind: str):
    def fn(request: Request, *args):
        user = _signed_in(request)
        if user is None:
            return
        from backend import services
        if kind == "query":
            services.workspaces().log(user.id, None, "query", args[0][:200], {"scope": "shared"})
        elif kind == "upload":
            reg, sample = args
            queued = [x["filename"] for x in reg["results"] if x["status"] == "queued"]
            if queued:
                services.workspaces().log(user.id, None, "upload",
                                          f"{'Loaded samples' if sample else 'Uploaded'} into the shared graph: "
                                          f"{', '.join(queued)[:200]}", {"scope": "shared"})
    return fn


build_kb_routes(router, KBRouteOptions(
    resolve=lambda request: _kb(),
    write_deps=[Depends(shared_kb_write_guard)],
    delete_deps=[Depends(shared_kb_write_guard)],
    on_query=_log_shared("query"),
    on_uploaded=_log_shared("upload"),
))
