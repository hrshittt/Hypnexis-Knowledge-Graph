"""
Platform API — the signed-in user's cross-workspace views.

  GET    /api/overview                 dashboard: workspaces + stats, recent documents, recent queries,
                                       recently explored topics, saved analyses, processing jobs
  GET    /api/documents                every document in my workspaces (+ the shared corpus, read-only)
  GET    /api/search?q=&scope=         passage + entity search across my workspaces (and the shared corpus);
                                       scope = all | shared | <workspace id>
  GET    /api/activity?kind=&limit=    my activity log
  POST   /api/activity                 record a client-side exploration event (topic / graph views only)
  GET    /api/saved                    my saved analyses   ·  POST /api/saved  ·  GET|DELETE /api/saved/{id}

Search only ever touches workspaces the user is a member of; student identifiers are only
matched for members with the analyst or owner role.
"""

import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend import services
from backend.auth.deps import CurrentUser, http_error, require_user
from backend.kb.text_utils import content_terms, find_all_ci
from backend.workspaces.service import WorkspaceError, role_at_least

router = APIRouter(prefix="/api", tags=["platform"])
limiter = Limiter(key_func=get_remote_address)

CLIENT_EVENT_KINDS = {"topic_view", "graph_view"}


def _shared_kb():
    try:
        from backend.kb.service import get_kb
        return get_kb()
    except Exception:
        return None


def _jobs(kb) -> List[Dict[str, Any]]:
    return [j for j in kb.jobs.values() if j["status"] in ("queued", "running")] if kb else []


@router.get("/overview")
async def overview(user: CurrentUser = Depends(require_user)):
    ws_svc = services.workspaces()
    from backend.api.workspaces import workspace_stats
    workspaces = ws_svc.list_for_user(user.id)
    recent_docs: List[Dict[str, Any]] = []
    processing: List[Dict[str, Any]] = []
    for w in workspaces:
        w["stats"] = workspace_stats(w["id"], w["type"])
        try:
            kb = ws_svc.kb(w["id"])
        except Exception:
            continue
        for d in kb.documents():
            recent_docs.append({**d, "workspace_id": w["id"], "workspace_name": w["name"], "workspace_type": w["type"]})
        for j in _jobs(kb):
            processing.append({**j, "workspace_id": w["id"], "workspace_name": w["name"]})
    recent_docs.sort(key=lambda d: -d["uploaded_at"])
    ids = [w["id"] for w in workspaces]
    shared = _shared_kb()
    return {
        "user": {"id": user.id, "name": user.name, "primary_workspace_type": user.row.get("primary_workspace_type")},
        "workspaces": workspaces,
        "recent_documents": recent_docs[:8],
        "recent_queries": ws_svc.activity(user.id, limit=8, kind="query", ws_ids=ids),
        "recent_topics": ws_svc.activity(user.id, limit=6, kind="topic_view", ws_ids=ids),
        "saved": ws_svc.list_saved(user.id, ws_ids=ids, limit=6),
        "processing": processing,
        "shared_corpus": shared.store.stats() if shared else None,
    }


def shared_write_allowed(request: Request, user: Optional[CurrentUser]) -> bool:
    policy = getattr(request.app.state, "shared_kb_write", "public")
    return policy == "public" or (user is not None and (policy == "authenticated" or user.is_admin))


@router.get("/documents")
async def all_documents(request: Request, user: CurrentUser = Depends(require_user)):
    ws_svc = services.workspaces()
    out = []
    for w in ws_svc.list_for_user(user.id):
        try:
            docs = ws_svc.documents(w["id"])
        except Exception:
            continue
        can_write = role_at_least(w["role"], "analyst")
        for d in docs:
            out.append({**d, "workspace_id": w["id"], "workspace_name": w["name"], "workspace_type": w["type"],
                        "role": w["role"], "can_upload": can_write, "can_delete": w["role"] == "owner"})
    shared = _shared_kb()
    if shared:
        can = shared_write_allowed(request, user)
        for d in shared.documents():
            out.append({**d, "meta": {}, "is_sample": False, "workspace_id": None, "workspace_name": "Shared demo corpus",
                        "workspace_type": "shared", "role": "owner" if can else "viewer", "can_upload": can,
                        "can_delete": can})
    return {"documents": out, "shared_write": shared_write_allowed(request, user)}


def _highlights(text: str, terms: List[str]) -> List[List[int]]:
    spans = []
    for t in terms:
        for a, b in find_all_ci(text, t):
            spans.append([a, b])
    return sorted(spans)[:40]


@router.get("/search")
@limiter.limit("60/minute")
async def search(request: Request, q: str = Query(..., min_length=2, max_length=300), scope: str = Query("all"),
                 limit: int = Query(5, ge=1, le=20), user: CurrentUser = Depends(require_user)):
    ws_svc = services.workspaces()
    mine = ws_svc.list_for_user(user.id)
    if scope not in ("all", "shared") and scope not in {w["id"] for w in mine}:
        raise http_error(404, "workspace_not_found", "Workspace not found.")
    targets = [w for w in mine if scope in ("all", w["id"])]
    terms = [t for t in re.findall(r"[\w'-]{3,}", q) if t.lower() in set(content_terms(q)) or len(t) > 4][:8]
    passages: List[Dict[str, Any]] = []
    entities: List[Dict[str, Any]] = []
    placement: List[Dict[str, Any]] = []

    def scan(kb, ws: Optional[Dict[str, Any]]):
        info = {"workspace_id": ws["id"] if ws else None, "workspace_name": ws["name"] if ws else "Shared demo corpus",
                "workspace_type": ws["type"] if ws else "shared"}
        try:
            for h in kb.retriever.search(q, k=limit):
                passages.append({**info, "doc_id": h["doc_id"], "filename": h["filename"], "page": h["page"],
                                 "chunk_id": h["chunk_id"], "text": h["text"], "score": round(float(h["score"]), 4),
                                 "highlights": _highlights(h["text"], terms)})
            for e in kb.retriever.link_entities(q, limit=4):
                entities.append({**info, "id": e["id"], "name": e["name"], "type": e["type"]})
        except Exception as ex:
            passages.append({**info, "error": f"Search failed in this workspace: {ex}"})

    if scope in ("all", "shared"):
        shared = _shared_kb()
        if shared:
            scan(shared, None)
    for w in targets:
        try:
            scan(ws_svc.kb(w["id"]), w)
        except WorkspaceError:
            continue
        if w["type"] == "placement":
            ds = services.placement().dataset(w["id"])
            ql = q.lower()
            seen = set()
            for a in ds.apps:
                if ql in a["company"].lower() and a["company_norm"] not in seen:
                    seen.add(a["company_norm"])
                    placement.append({"workspace_id": w["id"], "workspace_name": w["name"], "kind": "company",
                                      "label": ds.company_name.get(a["company_norm"], a["company"])})
            if role_at_least(w["role"], "analyst") and len(q) >= 4:
                qu = "".join(q.split()).upper()
                for sid in sorted({s["student_id"] for s in ds.students} | {a["student_id"] for a in ds.apps}):
                    if qu in sid:
                        placement.append({"workspace_id": w["id"], "workspace_name": w["name"], "kind": "student",
                                          "label": sid})
                        if sum(1 for p in placement if p["kind"] == "student") >= 10:
                            break
    passages = [p for p in passages if "error" not in p] + [p for p in passages if "error" in p]
    passages.sort(key=lambda p: -p.get("score", -1))
    ws_svc.log(user.id, None, "search", q[:200], {"scope": scope, "results": len(passages)})
    return {"query": q, "scope": scope, "passages": passages[:40], "entities": entities[:20],
            "placement": placement[:20], "searched": len(targets) + (1 if scope in ("all", "shared") else 0)}


class EventBody(BaseModel):
    kind: str = Field(..., max_length=30)
    workspace_id: Optional[str] = Field(None, max_length=20)
    summary: str = Field(..., min_length=1, max_length=300)
    detail: Dict[str, Any] = Field(default_factory=dict)


@router.get("/activity")
async def activity(kind: Optional[str] = None, limit: int = Query(50, ge=1, le=200),
                   user: CurrentUser = Depends(require_user)):
    ids = [w["id"] for w in services.workspaces().list_for_user(user.id)]
    return {"activity": services.workspaces().activity(user.id, limit=limit, kind=kind, ws_ids=ids)}


@router.post("/activity", status_code=201)
async def record_event(body: EventBody, user: CurrentUser = Depends(require_user)):
    if body.kind not in CLIENT_EVENT_KINDS:
        raise http_error(422, "invalid_kind", "Only topic and graph views can be recorded from the client.")
    if body.workspace_id:
        try:
            services.workspaces().access(body.workspace_id, user.id)
        except WorkspaceError as e:
            raise http_error(e.status, e.code, e.message)
    services.workspaces().log(user.id, body.workspace_id, body.kind, body.summary, body.detail)
    return {"recorded": True}


class SaveBody(BaseModel):
    workspace_id: Optional[str] = Field(None, max_length=20)
    kind: str = Field(..., max_length=30)
    title: str = Field(..., min_length=1, max_length=200)
    payload: Dict[str, Any]


@router.get("/saved")
async def saved(user: CurrentUser = Depends(require_user)):
    ids = [w["id"] for w in services.workspaces().list_for_user(user.id)]
    return {"saved": services.workspaces().list_saved(user.id, ws_ids=ids)}


@router.post("/saved", status_code=201)
async def save(body: SaveBody, user: CurrentUser = Depends(require_user)):
    svc = services.workspaces()
    if body.workspace_id:
        try:
            svc.access(body.workspace_id, user.id)
        except WorkspaceError as e:
            raise http_error(e.status, e.code, e.message)
    try:
        return {"saved": svc.save_analysis(user.id, body.workspace_id, body.kind, body.title, body.payload)}
    except WorkspaceError as e:
        raise http_error(e.status, e.code, e.message)


@router.get("/saved/{analysis_id}")
async def get_saved(analysis_id: str, user: CurrentUser = Depends(require_user)):
    svc = services.workspaces()
    try:
        row = svc.get_saved(user.id, analysis_id)
        if row["workspace_id"]:
            svc.access(row["workspace_id"], user.id)
    except WorkspaceError as e:
        raise http_error(e.status, e.code, e.message)
    return {"saved": row}


@router.delete("/saved/{analysis_id}")
async def delete_saved(analysis_id: str, user: CurrentUser = Depends(require_user)):
    try:
        services.workspaces().delete_saved(user.id, analysis_id)
    except WorkspaceError as e:
        raise http_error(e.status, e.code, e.message)
    return {"deleted": analysis_id}
