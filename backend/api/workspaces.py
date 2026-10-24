"""
Workspaces API — /api/workspaces

  GET    ""                                  my workspaces (+ counts)
  POST   ""                                  create {type, name?, description?}
  GET    /{id}                               one workspace + my role + stats
  PATCH  /{id}                               rename / describe (owner)
  GET    /{id}/members                       members and roles
  POST   /{id}/members                       add an existing account by email (owner)
  PATCH  /{id}/members/{user_id}             change a role (owner)
  DELETE /{id}/members/{user_id}             remove a member (owner) or leave (self)
  GET    /{id}/documents                     KB documents joined with user-entered metadata
  PUT    /{id}/documents/{doc_id}/meta       company / fiscal year / jurisdiction / source … (analyst)

  /api/workspaces/{id}/kb/*                  the full knowledge-base route set (see api/kb.py),
                                             isolated per workspace: viewer reads, analyst
                                             uploads, owner deletes.

Every route requires a signed-in member; non-members get 404 so workspace ids don't leak.
"""

import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel, Field

from backend import services
from backend.api.kb import KBRouteOptions, build_kb_routes
from backend.auth.deps import CurrentUser, http_error, require_user
from backend.workspaces.service import WorkspaceError, role_at_least

WS_ID = r"^w_[0-9a-f]{12}$"

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


@dataclass
class WorkspaceContext:
    ws: Dict[str, Any]
    role: str
    user: CurrentUser

    @property
    def id(self) -> str:
        return self.ws["workspace_id"]


def ws_error(e: WorkspaceError) -> HTTPException:
    return http_error(e.status, e.code, e.message)


def ws_member(request: Request, workspace_id: str = Path(..., pattern=WS_ID),
              user: CurrentUser = Depends(require_user)) -> WorkspaceContext:
    try:
        ws, role = services.workspaces().access(workspace_id, user.id)
    except WorkspaceError as e:
        raise ws_error(e)
    ctx = WorkspaceContext(ws, role, user)
    request.state.ws_ctx = ctx
    return ctx


def ws_role(minimum: str):
    def dep(ctx: WorkspaceContext = Depends(ws_member)) -> WorkspaceContext:
        if not role_at_least(ctx.role, minimum):
            raise http_error(403, "insufficient_role",
                             f"This action needs the {minimum} role in this workspace (you are a {ctx.role}).")
        return ctx
    dep.__name__ = f"ws_role_{minimum}"
    return dep


def workspace_stats(ws_id: str, wtype: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    try:
        kb = services.workspaces().kb(ws_id)
        st = kb.store.stats()
        out.update({"documents": st["documents"], "entities": st["entities"], "relations": st["relations"],
                    "topics": st["topics"], "processing": len([j for j in kb.jobs.values()
                                                               if j["status"] in ("queued", "running")])})
    except Exception as e:
        out["error"] = f"Knowledge base unavailable: {e}"
    if wtype == "placement":
        db = services.db()
        out["placement_records"] = db.one("SELECT COUNT(*) AS n FROM pl_applications WHERE workspace_id=?", (ws_id,))["n"]
        out["placement_students"] = db.one("SELECT COUNT(*) AS n FROM pl_students WHERE workspace_id=?", (ws_id,))["n"]
    return out


class CreateBody(BaseModel):
    type: str = Field(..., max_length=20)
    name: str = Field("", max_length=200)
    description: str = Field("", max_length=2000)


class UpdateBody(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)


class MemberBody(BaseModel):
    email: str = Field(..., max_length=320)
    role: str = Field("viewer", max_length=20)


class RoleBody(BaseModel):
    role: str = Field(..., max_length=20)


class MetaBody(BaseModel):
    company: Optional[str] = Field(None, max_length=300)
    fiscal_year: Optional[str] = Field(None, max_length=40)
    doc_kind: Optional[str] = Field(None, max_length=80)
    jurisdiction: Optional[str] = Field(None, max_length=120)
    authority: Optional[str] = Field(None, max_length=200)
    effective_date: Optional[str] = Field(None, max_length=40)
    source_url: Optional[str] = Field(None, max_length=500)
    verified: Optional[bool] = None


# ── workspaces ───────────────────────────────────────────────────────────────

@router.get("")
async def list_workspaces(user: CurrentUser = Depends(require_user)):
    items = services.workspaces().list_for_user(user.id)
    for w in items:
        w["stats"] = workspace_stats(w["id"], w["type"])
    return {"workspaces": items}


@router.post("", status_code=201)
async def create_workspace(body: CreateBody, user: CurrentUser = Depends(require_user)):
    try:
        ws = services.workspaces().create(user.id, body.type, body.name, body.description)
    except WorkspaceError as e:
        raise ws_error(e)
    return {"workspace": {**services.workspaces().public({**ws, "my_role": "owner", "member_count": 1}),
                          "stats": workspace_stats(ws["workspace_id"], ws["type"])}}


@router.get("/{workspace_id}")
async def get_workspace(ctx: WorkspaceContext = Depends(ws_member)):
    pub = services.workspaces().public({**ctx.ws, "my_role": ctx.role,
                                        "member_count": len(services.workspaces().members(ctx.id))})
    return {"workspace": {**pub, "stats": workspace_stats(ctx.id, ctx.ws["type"])}}


@router.patch("/{workspace_id}")
async def update_workspace(body: UpdateBody, ctx: WorkspaceContext = Depends(ws_role("owner"))):
    try:
        ws = services.workspaces().update(ctx.id, body.name, body.description)
    except WorkspaceError as e:
        raise ws_error(e)
    return {"workspace": services.workspaces().public({**ws, "my_role": ctx.role})}


# ── members ──────────────────────────────────────────────────────────────────

@router.get("/{workspace_id}/members")
async def list_members(ctx: WorkspaceContext = Depends(ws_member)):
    return {"members": services.workspaces().members(ctx.id), "my_role": ctx.role}


@router.post("/{workspace_id}/members", status_code=201)
async def add_member(body: MemberBody, ctx: WorkspaceContext = Depends(ws_role("owner"))):
    try:
        m = services.workspaces().add_member(ctx.id, body.email, body.role)
    except WorkspaceError as e:
        raise ws_error(e)
    services.workspaces().log(ctx.user.id, ctx.id, "workspace", f"Added {m['name']} as {m['role']}")
    return {"member": m}


@router.patch("/{workspace_id}/members/{user_id}")
async def change_member(user_id: str, body: RoleBody, ctx: WorkspaceContext = Depends(ws_role("owner"))):
    try:
        services.workspaces().set_member_role(ctx.id, user_id, body.role)
    except WorkspaceError as e:
        raise ws_error(e)
    return {"members": services.workspaces().members(ctx.id)}


@router.delete("/{workspace_id}/members/{user_id}")
async def remove_member(user_id: str, ctx: WorkspaceContext = Depends(ws_member)):
    if user_id != ctx.user.id and ctx.role != "owner":
        raise http_error(403, "insufficient_role", "Only owners can remove other members.")
    try:
        services.workspaces().remove_member(ctx.id, user_id)
    except WorkspaceError as e:
        raise ws_error(e)
    return {"removed": user_id}


# ── documents + metadata ─────────────────────────────────────────────────────

@router.get("/{workspace_id}/documents")
async def documents(ctx: WorkspaceContext = Depends(ws_member)):
    try:
        return {"documents": services.workspaces().documents(ctx.id), "role": ctx.role}
    except WorkspaceError as e:
        raise ws_error(e)


@router.put("/{workspace_id}/documents/{doc_id}/meta")
async def set_meta(doc_id: str, body: MetaBody, ctx: WorkspaceContext = Depends(ws_role("analyst"))):
    svc = services.workspaces()
    if svc.kb(ctx.id).store.get_document(doc_id) is None:
        raise http_error(404, "document_not_found", "Document not found in this workspace.")
    fields = body.model_dump(exclude_unset=True)
    verified = fields.pop("verified", None)
    try:
        meta = svc.set_doc_meta(ctx.id, doc_id, fields, ctx.user.id, verified=verified)
    except WorkspaceError as e:
        raise ws_error(e)
    return {"meta": meta}


# ── per-workspace knowledge base (/api/workspaces/{id}/kb/*) ─────────────────

def _kb_for(request: Request):
    ctx: WorkspaceContext = request.state.ws_ctx
    try:
        return services.workspaces().kb(ctx.id)
    except WorkspaceError as e:
        raise ws_error(e)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Workspace knowledge base failed to open: {e}")


def _sample_meta(wtype: str) -> Dict[str, Dict[str, Any]]:
    """Per-file metadata shipped with a workspace sample set (samples/workspaces/<type>/meta.json)."""
    p = services.settings().samples_dir / wtype / "meta.json"
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    except (OSError, ValueError):
        return {}


def _on_uploaded(request: Request, reg: dict, sample: bool) -> None:
    ctx: WorkspaceContext = request.state.ws_ctx
    svc = services.workspaces()
    queued = [r for r in reg["results"] if r["status"] == "queued"]
    meta = _sample_meta(ctx.ws["type"]) if sample else {}
    for r in queued:
        svc.set_doc_meta(ctx.id, r["doc_id"], meta.get(r["filename"], {}), ctx.user.id, is_sample=sample)
    if queued:
        names = ", ".join(r["filename"] for r in queued)
        svc.log(ctx.user.id, ctx.id, "upload", f"{'Loaded sample documents' if sample else 'Uploaded'}: {names}"[:300],
                {"doc_ids": [r["doc_id"] for r in queued], "sample": sample})


def _on_deleted(request: Request, doc_id: str) -> None:
    ctx: WorkspaceContext = request.state.ws_ctx
    services.workspaces().drop_doc_meta(ctx.id, doc_id)
    services.workspaces().log(ctx.user.id, ctx.id, "document", f"Removed document {doc_id}")


def _on_reset(request: Request) -> None:
    ctx: WorkspaceContext = request.state.ws_ctx
    services.workspaces().drop_doc_meta(ctx.id)
    services.workspaces().log(ctx.user.id, ctx.id, "document", "Cleared the workspace knowledge base")


def _on_query(request: Request, question: str) -> None:
    ctx: WorkspaceContext = request.state.ws_ctx
    services.workspaces().log(ctx.user.id, ctx.id, "query", question[:200])


kb_router = APIRouter(prefix="/api/workspaces/{workspace_id}/kb", tags=["workspace-knowledge-base"],
                      dependencies=[Depends(ws_member)])
build_kb_routes(kb_router, KBRouteOptions(
    resolve=_kb_for,
    write_deps=[Depends(ws_role("analyst"))],
    delete_deps=[Depends(ws_role("owner"))],
    name_suffix="_ws",
    on_uploaded=_on_uploaded, on_deleted=_on_deleted, on_reset=_on_reset, on_query=_on_query,
))
