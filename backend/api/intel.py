"""
Document intelligence API — analyses over a workspace's own documents.

  Corporate (corporate workspaces)
    GET  /api/workspaces/{id}/corporate/analysis?company=&doc_ids=a,b   figures, calculations, risks
    GET  /api/workspaces/{id}/corporate/graph?company=                   company knowledge graph
  Research (research workspaces)
    GET  /api/workspaces/{id}/research/papers                            structure of every paper
    GET  /api/workspaces/{id}/research/papers/{doc_id}                    one paper
    GET  /api/workspaces/{id}/research/papers/{doc_id}/related            similar papers + shared entities
    POST /api/workspaces/{id}/research/compare      {doc_ids: [a, b]}     side-by-side, each quoting itself
  Legal & policy (legal workspaces)
    GET  /api/workspaces/{id}/legal/sources                              sources, jurisdictions, provision counts
    GET  /api/workspaces/{id}/legal/provisions?doc_id=                    provisions with classified sentences
    POST /api/workspaces/{id}/legal/analyze  {question, jurisdiction?, topic?}   potential applicability
    GET  /api/workspaces/{id}/legal/graph                                provision dependency graph

All analyses are computed from the workspace's ready documents on request; nothing is
generated without a source sentence behind it.
"""

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend import services
from backend.api.workspaces import WorkspaceContext, ws_member
from backend.auth.deps import http_error
from backend.intel import financial as F
from backend.intel import legal as L
from backend.intel import research as R
from backend.intel.common import DocText, load_document

router = APIRouter(prefix="/api/workspaces/{workspace_id}", tags=["document-intelligence"])
limiter = Limiter(key_func=get_remote_address)


def of_type(wtype: str):
    def dep(ctx: WorkspaceContext = Depends(ws_member)) -> WorkspaceContext:
        if ctx.ws["type"] != wtype:
            raise http_error(404, "wrong_workspace_type", f"This endpoint is for {wtype} workspaces.")
        return ctx
    dep.__name__ = f"{wtype}_workspace"
    return dep


def _docs(ctx: WorkspaceContext, doc_ids: Optional[List[str]] = None, company: Optional[str] = None):
    svc = services.workspaces()
    kb = svc.kb(ctx.id)
    meta = svc.doc_meta(ctx.id)
    out: Dict[str, DocText] = {}
    for d in kb.documents():
        if d["status"] != "ready" or (doc_ids and d["doc_id"] not in doc_ids):
            continue
        if company and ((meta.get(d["doc_id"]) or {}).get("company") or "").lower() != company.lower():
            continue
        doc = load_document(kb, d["doc_id"])
        if doc:
            out[d["doc_id"]] = doc
    return kb, meta, out


def _meta_view(meta, did):
    m = meta.get(did) or {}
    return {k: m.get(k) for k in ("company", "fiscal_year", "doc_kind", "jurisdiction", "authority", "effective_date",
                                  "source_url", "verified_at", "is_sample")}


# ── corporate ────────────────────────────────────────────────────────────────

@router.get("/corporate/analysis")
async def corporate_analysis(company: Optional[str] = None, doc_ids: Optional[str] = None,
                             ctx: WorkspaceContext = Depends(of_type("corporate"))):
    ids = [x for x in (doc_ids or "").split(",") if x] or None
    kb, meta, docs = _docs(ctx, ids, company)
    companies = sorted({(m.get("company") or "").strip() for m in meta.values() if m.get("company")})
    result = F.analyse(list(docs.values()), meta)
    return {"company": company, "companies": companies,
            "documents": [{"doc_id": d, "title": x.title, "filename": x.filename, "meta": _meta_view(meta, d)}
                          for d, x in docs.items()],
            "unassigned_documents": sum(1 for d in kb.documents() if d["status"] == "ready"
                                        and not (meta.get(d["doc_id"]) or {}).get("company")),
            **result}


@router.get("/corporate/graph")
async def corporate_graph(company: Optional[str] = None, ctx: WorkspaceContext = Depends(of_type("corporate"))):
    kb, meta, docs = _docs(ctx, None, company)
    analysis = F.analyse(list(docs.values()), meta)
    return F.corporate_graph(analysis, kb, company)


# ── research ─────────────────────────────────────────────────────────────────

class CompareBody(BaseModel):
    doc_ids: List[str] = Field(..., min_length=2, max_length=2)


@router.get("/research/papers")
async def research_papers(ctx: WorkspaceContext = Depends(of_type("research"))):
    kb, meta, docs = _docs(ctx)
    papers = []
    for did, doc in docs.items():
        a = R.analyse_paper(doc)
        a["meta"] = _meta_view(meta, did)
        papers.append(a)
    pending = [d for d in kb.documents() if d["status"] in ("queued", "processing")]
    return {"papers": papers, "processing": len(pending)}


@router.get("/research/papers/{doc_id}")
async def research_paper(doc_id: str, ctx: WorkspaceContext = Depends(of_type("research"))):
    kb, meta, docs = _docs(ctx, [doc_id])
    if doc_id not in docs:
        raise http_error(404, "paper_not_found", "Paper not found or still processing.")
    a = R.analyse_paper(docs[doc_id])
    a["meta"] = _meta_view(meta, doc_id)
    return a


@router.get("/research/papers/{doc_id}/related")
async def research_related(doc_id: str, ctx: WorkspaceContext = Depends(of_type("research"))):
    kb, meta, docs = _docs(ctx)
    if doc_id not in docs:
        raise http_error(404, "paper_not_found", "Paper not found or still processing.")
    rel = R.related_papers(kb, doc_id, list(docs))
    for r in rel:
        r["title"] = docs[r["doc_id"]].title
        r["filename"] = docs[r["doc_id"]].filename
    return {"doc_id": doc_id, "related": rel,
            "note": "Similarity compares the papers' text embeddings; shared entities are names and concepts extracted "
                    "from both papers."}


@router.post("/research/compare")
async def research_compare(body: CompareBody, ctx: WorkspaceContext = Depends(of_type("research"))):
    a_id, b_id = body.doc_ids
    if a_id == b_id:
        raise http_error(422, "same_paper", "Choose two different papers.")
    kb, meta, docs = _docs(ctx, body.doc_ids)
    if a_id not in docs or b_id not in docs:
        raise http_error(404, "paper_not_found", "Both papers must be ready.")
    return R.compare_papers(kb, R.analyse_paper(docs[a_id]), R.analyse_paper(docs[b_id]))


# ── legal ────────────────────────────────────────────────────────────────────

class LegalBody(BaseModel):
    question: str = Field(..., min_length=3, max_length=2000)
    jurisdiction: Optional[str] = Field(None, max_length=120)
    topic: Optional[str] = Field(None, max_length=120)


@router.get("/legal/sources")
async def legal_sources(ctx: WorkspaceContext = Depends(of_type("legal"))):
    kb, meta, docs = _docs(ctx)
    out = []
    for did, doc in docs.items():
        ps = L.provisions(doc)
        counts = {k: sum(1 for p in ps for s in p.sentences if k in p.classes.get(s.index, []))
                  for k in ("obligation", "prohibition", "definition", "penalty", "exemption")}
        out.append({"doc_id": did, "title": doc.title, "filename": doc.filename, "meta": _meta_view(meta, did),
                    "provisions": len([p for p in ps if p.ref != "Preamble"]), "counts": counts})
    jurisdictions = sorted({o["meta"]["jurisdiction"] for o in out if o["meta"]["jurisdiction"]})
    return {"sources": out, "jurisdictions": jurisdictions,
            "untagged": sum(1 for o in out if not o["meta"]["jurisdiction"]), "disclaimer": L.DISCLAIMER}


@router.get("/legal/provisions")
async def legal_provisions(doc_id: str, ctx: WorkspaceContext = Depends(of_type("legal"))):
    kb, meta, docs = _docs(ctx, [doc_id])
    if doc_id not in docs:
        raise http_error(404, "source_not_found", "Source not found or still processing.")
    return {**L.provisions_payload(docs[doc_id]), "meta": _meta_view(meta, doc_id), "disclaimer": L.DISCLAIMER}


@router.post("/legal/analyze")
@limiter.limit("30/minute")
async def legal_analyze(request: Request, body: LegalBody, ctx: WorkspaceContext = Depends(of_type("legal"))):
    kb, meta, docs = _docs(ctx)
    if not docs:
        return {"question": body.question, "laws": [], "facts": L.facts_in(body.question), "clarifications": [],
                "message": "This workspace has no legal sources yet. Upload the official texts you want to research "
                           "(or load the fictional sample set).", "disclaimer": L.DISCLAIMER}
    res = L.analyse_question(kb, docs, meta, body.question, body.jurisdiction, body.topic)
    services.workspaces().log(ctx.user.id, ctx.id, "query", body.question[:200], {"kind": "legal_applicability",
                                                                                  "laws": len(res.get("laws", []))})
    return res


@router.get("/legal/graph")
async def legal_graph(ctx: WorkspaceContext = Depends(of_type("legal"))):
    kb, meta, docs = _docs(ctx)
    return L.legal_graph(docs)
