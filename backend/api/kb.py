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
  POST   /query                     grounded answer (JSON)
  POST   /query/stream              grounded answer with live LangGraph stage events (SSE)
  GET    /examples                  demo questions (samples/questions.json)
  POST   /samples/load              ingest the bundled sample documents
  DELETE /?confirm=true             wipe the knowledge base (data/kb only)
"""

import json
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
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


# ── status & documents ───────────────────────────────────────────────────────

@router.get("/status")
async def status():
    from backend.kb.service import kb_init_error
    try:
        return _kb().status()
    except HTTPException as e:
        return JSONResponse(status_code=503, content={"ready": False, "error": e.detail or kb_init_error()})


@router.get("/documents")
async def list_documents():
    return {"documents": _kb().documents()}


@router.post("/documents", status_code=202)
@limiter.limit("20/minute")
async def upload_documents(request: Request, files: List[UploadFile] = File(...)):
    kb = _kb()
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
    log.info(f"Upload: {[(r['filename'], r['status']) for r in reg['results']]}")
    return reg


@router.post("/documents/{doc_id}/retry", status_code=202)
async def retry_document(doc_id: str):
    kb = _kb()
    try:
        job = kb.retry_document(doc_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Document not found")
    except DocumentError as e:
        raise HTTPException(status_code=409, detail=e.message)
    kb.start_job(job["id"])
    return {"job": job}


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    try:
        return await _kb().delete_document(doc_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Document not found")


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = _kb().jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found (jobs are kept in memory until restart)")
    return job


# ── graph read models ────────────────────────────────────────────────────────

@router.get("/graph")
async def graph(limit: int = Query(600, ge=10, le=5000)):
    return _kb().graph_payload(limit=limit)


@router.get("/entities/{entity_id}")
async def entity(entity_id: str):
    try:
        return _kb().entity_detail(entity_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Entity not found")


@router.get("/relations/{relation_id}")
async def relation(relation_id: str):
    try:
        return _kb().relation_detail(relation_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Relation not found")


@router.get("/chunks/{chunk_id}")
async def chunk(chunk_id: str):
    try:
        return _kb().chunk_detail(chunk_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Passage not found")


@router.get("/topics")
async def topics():
    g = _kb().graph_payload(limit=5000)
    return {"topics": g["topics"], "topic_links": g["topic_links"]}


@router.post("/topics/rebuild")
async def rebuild_topics():
    kb = _kb()
    async with kb._ingest_lock:
        return await kb.rebuild_topics()


# ── questions ────────────────────────────────────────────────────────────────

@router.post("/query")
@limiter.limit("30/minute")
async def query(request: Request, body: QueryRequest):
    return await _kb().answer(body.question.strip(), body.doc_ids)


@router.post("/query/stream")
@limiter.limit("30/minute")
async def query_stream(request: Request, body: QueryRequest):
    kb = _kb()

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


# ── demo helpers ─────────────────────────────────────────────────────────────

@router.get("/examples")
async def examples():
    path = _kb().settings.samples_dir / "questions.json"
    if not path.exists():
        return {"questions": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=500, detail=f"samples/questions.json is unreadable: {e}")


@router.post("/samples/load", status_code=202)
async def load_samples():
    kb = _kb()
    files = [(p.name, p.read_bytes()) for p in kb.sample_files()]
    if not files:
        raise HTTPException(status_code=404, detail=f"No sample documents in {kb.settings.samples_dir}")
    reg = kb.register_uploads(files)
    if reg["job"]:
        kb.start_job(reg["job"]["id"])
    return reg


@router.delete("")
async def reset(confirm: bool = Query(False)):
    if not confirm:
        raise HTTPException(status_code=400, detail="Pass ?confirm=true to wipe the knowledge base.")
    return await _kb().reset()
