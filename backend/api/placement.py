"""
Placement API — /api/workspaces/{id}/placement   (placement workspaces only)

  GET    /overview?year=           KPIs (with definitions), departments, cycles, data quality
  GET    /years                    year-over-year comparison + department trends
  GET    /as-of                    ongoing cycle vs the same point of earlier cycles
  GET    /funnel?year=&type=&company=
  GET    /ppo?by=company|department|year&year=
  GET    /companies                company intelligence (all cycles)
  GET    /students?year=&q=&department=&status=&attention=&page=&page_size=   analyst+ only
  POST   /ask                      placement assistant (answers from records only)
  GET    /graph?year=&students=    placement knowledge graph (students: analyst+ only)
  GET    /config | PUT /config     pipeline stages, placement policy, cycle status (PUT: owner)
  GET    /imports                  import history
  POST   /imports                  upload CSV/XLSX → staged preview (analyst+)
  POST   /imports/{id}/preview     re-validate with an edited mapping
  POST   /imports/{id}/commit      write valid rows; duplicate_policy 'skip' | 'update'
  DELETE /imports/{id}             discard a staged import
  POST   /samples/load             import the clearly-labelled fictional sample data (analyst+)
  DELETE /data?confirm=true        delete every placement record in the workspace (owner)

Viewers see aggregates only; student identifiers require the analyst or owner role.
"""

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend import services
from backend.api.workspaces import WorkspaceContext, ws_member
from backend.auth.deps import http_error
from backend.placement import metrics as M
from backend.placement.assistant import PlacementAssistant
from backend.placement.graph import placement_graph
from backend.placement.service import PlacementError
from backend.workspaces.service import role_at_least

router = APIRouter(prefix="/api/workspaces/{workspace_id}/placement", tags=["placement"])
limiter = Limiter(key_func=get_remote_address)


def placement_ws(ctx: WorkspaceContext = Depends(ws_member)) -> WorkspaceContext:
    if ctx.ws["type"] != "placement":
        raise http_error(404, "not_placement_workspace", "This is not a placement workspace.")
    return ctx


def need(ctx: WorkspaceContext, minimum: str, what: str) -> None:
    if not role_at_least(ctx.role, minimum):
        raise http_error(403, "insufficient_role", f"{what} needs the {minimum} role (you are a {ctx.role}).")


def _err(e: PlacementError):
    raise http_error(e.status, e.code, e.message)


def _pick_year(ds: M.Dataset, year: Optional[str]) -> Optional[str]:
    if year and year in ds.years:
        return year
    ongoing = [y for y in ds.years if ds.cycle(y)["status"] == "ongoing"]
    return ongoing[-1] if ongoing else (ds.years[-1] if ds.years else None)


class MappingBody(BaseModel):
    mapping: Optional[Dict[str, Optional[str]]] = None
    defaults: Dict[str, Any] = Field(default_factory=dict)


class CommitBody(MappingBody):
    duplicate_policy: str = "skip"


class AskBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)


@router.get("/overview")
async def overview(year: Optional[str] = None, ctx: WorkspaceContext = Depends(placement_ws)):
    svc = services.placement()
    ds = svc.dataset(ctx.id)
    y = _pick_year(ds, year)
    base = {"years": [ds.cycle(x) for x in ds.years], "selected_year": y, "sample_data": svc.has_sample_data(ctx.id),
            "config": svc.config(ctx.id), "role": ctx.role, "can_see_students": role_at_least(ctx.role, "analyst"),
            "counts": {"students": len(ds.students), "records": len(ds.apps)}}
    if y is None:
        return {**base, "metrics": None, "departments": [], "comparison": None}
    return {**base, "metrics": M.year_metrics(ds, y), "departments": M.department_breakdown(ds, y),
            "comparison": M.year_comparison(ds)}


@router.get("/years")
async def years(ctx: WorkspaceContext = Depends(placement_ws)):
    ds = services.placement().dataset(ctx.id)
    return {**M.year_comparison(ds), "department_trends": M.department_trends(ds)}


@router.get("/as-of")
async def as_of(ctx: WorkspaceContext = Depends(placement_ws)):
    ds = services.placement().dataset(ctx.id)
    ongoing = [y for y in ds.years if ds.cycle(y)["status"] == "ongoing"]
    if not ongoing:
        return {"available": False, "note": "No cycle is ongoing; every cycle in the data is complete."}
    return M.as_of_comparison(ds, ongoing[-1])


@router.get("/funnel")
async def funnel(year: Optional[str] = None, type: str = Query("full_time", pattern="^(full_time|internship)$"),
                 company: Optional[str] = None, ctx: WorkspaceContext = Depends(placement_ws)):
    ds = services.placement().dataset(ctx.id)
    y = _pick_year(ds, year)
    if y is None:
        return {"academic_year": None, "stages": [], "applications": 0}
    return M.funnel(ds, y, type, company)


@router.get("/ppo")
async def ppo(by: str = Query("company", pattern="^(company|department|year)$"), year: Optional[str] = None,
              ctx: WorkspaceContext = Depends(placement_ws)):
    ds = services.placement().dataset(ctx.id)
    return {"by": by, "year": year, "rows": M.ppo_breakdown(ds, by=by, year=year),
            "definition": M.DEFINITIONS["ppo_conversion_rate"],
            "by_year": M.ppo_breakdown(ds, by="year")}


@router.get("/companies")
async def companies(ctx: WorkspaceContext = Depends(placement_ws)):
    ds = services.placement().dataset(ctx.id)
    return {"companies": M.company_profiles(ds), "years": ds.years,
            "ongoing": [y for y in ds.years if ds.cycle(y)["status"] == "ongoing"]}


@router.get("/students")
async def students(year: Optional[str] = None, q: str = Query("", max_length=64), department: Optional[str] = None,
                   status: Optional[str] = None, attention: bool = False, page: int = Query(1, ge=1),
                   page_size: int = Query(25, ge=5, le=200), ctx: WorkspaceContext = Depends(placement_ws)):
    need(ctx, "analyst", "Viewing student-level records")
    ds = services.placement().dataset(ctx.id)
    y = _pick_year(ds, year)
    rows = M.student_rows(ds, y) if y else []
    departments = sorted({r["department"] or "Unspecified" for r in rows})
    qq = q.strip().upper()
    if qq:
        rows = [r for r in rows if qq in r["student_id"]]
    if department:
        rows = [r for r in rows if (r["department"] or "Unspecified") == department]
    if status:
        rows = [r for r in rows if r["status"] == status]
    if attention:
        rows = [r for r in rows if r["needs_attention"]]
    total = len(rows)
    start = (page - 1) * page_size
    return {"academic_year": y, "total": total, "page": page, "page_size": page_size,
            "rows": rows[start:start + page_size], "departments": departments,
            "statuses": ["placed", "offer_pending", "offers_declined", "in_process", "no_active_process",
                         "not_placed", "no_applications"]}


@router.post("/ask")
@limiter.limit("30/minute")
async def ask(request: Request, body: AskBody, ctx: WorkspaceContext = Depends(placement_ws)):
    ds = services.placement().dataset(ctx.id)
    ans = PlacementAssistant(ds, can_see_students=role_at_least(ctx.role, "analyst")).answer(body.question)
    services.workspaces().log(ctx.user.id, ctx.id, "query", body.question[:200], {"intent": ans["intent"]})
    return ans


@router.get("/graph")
async def graph(year: Optional[str] = None, students: bool = False, ctx: WorkspaceContext = Depends(placement_ws)):
    if students:
        need(ctx, "analyst", "Showing students in the graph")
    ds = services.placement().dataset(ctx.id)
    return placement_graph(ds, year if year in ds.years else None, include_students=students)


@router.get("/config")
async def get_config(ctx: WorkspaceContext = Depends(placement_ws)):
    svc = services.placement()
    ds = svc.dataset(ctx.id)
    return {"config": svc.config(ctx.id), "cycles": [ds.cycle(y) for y in ds.years]}


@router.put("/config")
async def put_config(body: Dict[str, Any], ctx: WorkspaceContext = Depends(placement_ws)):
    need(ctx, "owner", "Changing placement settings")
    try:
        conf = services.placement().set_config(ctx.id, body)
    except PlacementError as e:
        _err(e)
    services.workspaces().log(ctx.user.id, ctx.id, "workspace", "Updated placement settings")
    return {"config": conf}


@router.get("/imports")
async def imports(ctx: WorkspaceContext = Depends(placement_ws)):
    return {"imports": services.placement().imports(ctx.id)}


@router.post("/imports", status_code=201)
@limiter.limit("20/minute")
async def stage_import(request: Request, kind: str = Form(...), file: UploadFile = File(...),
                       ctx: WorkspaceContext = Depends(placement_ws)):
    need(ctx, "analyst", "Importing placement data")
    svc = services.placement()
    data = await file.read(svc.settings.placement_max_upload_bytes + 1)
    try:
        return svc.stage(ctx.id, kind, file.filename or "upload.csv", data, ctx.user.id)
    except PlacementError as e:
        _err(e)


@router.post("/imports/{import_id}/preview")
async def preview_import(import_id: str, body: MappingBody, ctx: WorkspaceContext = Depends(placement_ws)):
    need(ctx, "analyst", "Importing placement data")
    try:
        return services.placement().preview(ctx.id, import_id, body.mapping, body.defaults)
    except PlacementError as e:
        _err(e)


@router.post("/imports/{import_id}/commit")
async def commit_import(import_id: str, body: CommitBody, ctx: WorkspaceContext = Depends(placement_ws)):
    need(ctx, "analyst", "Importing placement data")
    svc = services.placement()
    try:
        res = svc.commit(ctx.id, import_id, body.mapping or {}, body.defaults, body.duplicate_policy, ctx.user.id)
    except PlacementError as e:
        _err(e)
    s = res["summary"]
    services.workspaces().log(ctx.user.id, ctx.id, "import",
                              f"Imported {res['import']['kind']} from {res['import']['filename']}: {s['inserted']} new, "
                              f"{s['updated']} updated, {s['skipped_existing']} skipped, {s['invalid']} invalid",
                              {"import_id": import_id})
    return res


@router.delete("/imports/{import_id}")
async def discard_import(import_id: str, ctx: WorkspaceContext = Depends(placement_ws)):
    need(ctx, "analyst", "Importing placement data")
    try:
        services.placement().discard(ctx.id, import_id)
    except PlacementError as e:
        _err(e)
    return {"discarded": import_id}


@router.post("/samples/load", status_code=201)
async def load_samples(ctx: WorkspaceContext = Depends(placement_ws)):
    need(ctx, "analyst", "Loading sample data")
    try:
        res = services.placement().load_samples(ctx.id, ctx.user.id)
    except PlacementError as e:
        _err(e)
    services.workspaces().log(ctx.user.id, ctx.id, "import", "Loaded the fictional sample placement data")
    return {"loaded": res}


@router.delete("/data")
async def delete_data(confirm: bool = False, ctx: WorkspaceContext = Depends(placement_ws)):
    need(ctx, "owner", "Deleting placement records")
    if not confirm:
        raise http_error(400, "confirm_required", "Pass ?confirm=true to delete every placement record.")
    res = services.placement().delete_all(ctx.id)
    services.workspaces().log(ctx.user.id, ctx.id, "import", "Deleted all placement records", res)
    return res
