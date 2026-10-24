"""
LangGraph workflow for knowledge-base questions.

  START → route_query ─┬─ thematic   → retrieve_thematic ──┐
                       ├─ factual    → retrieve_factual ───┤
                       ├─ multi_hop  → retrieve_multi_hop ─┼→ assess_evidence ─┬─ sufficient   → generate_answer → finalize → END
                       └─ comparison → retrieve_comparison ┘                   ├─ rewrite (LLM, once) → rewrite_query → retrieve_factual
                                                                               └─ insufficient → insufficient_answer → finalize → END

Mirrors the CEO twin's CRAG pattern (grade → rewrite → re-retrieve) but every node is
evidence-first: generation only ever sees the numbered evidence pack.
"""

import operator
import time
from collections import Counter
from typing import Annotated, Any, Dict, List, Optional

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from backend.kb.answer import (
    EvidenceBuilder, assess_evidence, extractive_answer, generate_llm_answer, insufficient_answer,
    predicate_terms, suggest_followups, validate_citations,
)
from backend.kb.router import comparison_targets, match_documents, route_question
from backend.kb.text_utils import content_terms, index_terms
from backend.utils.logger import get_logger

log = get_logger(__name__)

QUERY_REWRITE_PROMPT = """\
Rewrite this question as a short keyword search query for a document collection. Keep all names.
Question: {question}
Respond with only the rewritten query."""


class KBQueryState(TypedDict, total=False):
    question: str
    search_query: str
    doc_filter: List[str]
    route: str
    route_reason: str
    route_method: str
    linked: List[Dict[str, Any]]
    doc_hits: List[Dict[str, Any]]
    evidence: Dict[str, Any]
    sufficient: bool
    sufficiency_reason: str
    borderline: bool
    rewrites: int
    answer: str
    mode: str
    citations_used: List[str]
    warnings: List[str]
    followups: List[str]
    trace: Annotated[List[Dict[str, Any]], operator.add]


def _t(node: str, detail: str, **extra) -> List[Dict[str, Any]]:
    return [{"node": node, "detail": detail, "t": round(time.time(), 3), **extra}]


def build_kb_graph(svc):
    """`svc` is the KnowledgeBaseService (store, retriever, llm)."""
    store, R = svc.store, svc.retriever

    # ── routing ──────────────────────────────────────────────────────────────
    async def route_query(state: KBQueryState) -> dict:
        q = state["question"]
        linked = R.link_entities(q)
        docs = store.list_documents(status="ready")
        doc_hits = match_documents(q, docs)
        r = await route_question(q, linked, doc_hits, len(docs), svc.active_llm())
        names = ", ".join(l["name"] for l in linked) or "none"
        return {"route": r["route"], "route_reason": r["reason"], "route_method": r["method"], "linked": linked,
                "doc_hits": doc_hits, "search_query": q, "rewrites": state.get("rewrites", 0),
                "trace": _t("route_query", f"route={r['route']} ({r['reason']}); linked entities: {names}",
                            route=r["route"], linked=[l["name"] for l in linked])}

    def pick_route(state: KBQueryState) -> str:
        return state["route"]

    # ── retrieval strategies ─────────────────────────────────────────────────
    def _factual(state: KBQueryState, b: EvidenceBuilder) -> str:
        q = state.get("search_query") or state["question"]
        linked = state.get("linked", [])
        passages = R.search(q, k=6, doc_ids=state.get("doc_filter") or None, extra_terms=[l["name"] for l in linked])
        for p in passages:
            b.add_passage(p)
        terms = set(content_terms(state["question"]))
        retrieved_chunks = {p["chunk_id"] for p in passages}
        n_facts = 0
        for l in linked[:3]:
            rels = R.entity_relations(l["id"], limit=25)
            def score(r):
                pred_hit = len(terms & predicate_terms(r["predicate"]))
                other = r["object_id"] if r["subject_id"] == l["id"] else r["subject_id"]
                other_hit = len(terms & set(index_terms(R.entity_brief(other)["name"])))
                return (pred_hit + other_hit, int(r["evidence_count"]))
            ranked = sorted(rels, key=score, reverse=True)
            chosen = [r for r in ranked if score(r)[0] > 0][:3]
            if not chosen:
                ev = store.relation_evidence([r["relation_id"] for r in ranked[:10]])
                chosen = [r for r in ranked[:10] if any(e["chunk_id"] in retrieved_chunks
                                                        for e in ev.get(r["relation_id"], []))][:2]
            for r in chosen:
                b.add_relation(r)
                n_facts += 1
        b.highlight(nodes=[l["id"] for l in linked])
        return f"{len(passages)} passages, {n_facts} graph facts"

    async def retrieve_factual(state: KBQueryState) -> dict:
        b = EvidenceBuilder(store, R)
        detail = _factual(state, b)
        return {"evidence": b.pack(), "trace": _t("retrieve_factual", detail)}

    async def retrieve_multi_hop(state: KBQueryState) -> dict:
        b = EvidenceBuilder(store, R)
        linked = [l for l in state.get("linked", [])]
        found = 0
        if len(linked) >= 2:
            pairs = [(linked[0], linked[1])] + ([(linked[0], linked[2]), (linked[1], linked[2])] if len(linked) > 2 else [])
            for a, c in pairs:
                for p in R.paths(a["id"], c["id"], max_hops=4, k=3):
                    b.add_path(p)
                    found += 1
            if not found:
                b.notes.append(f"No chain of extracted relations connects {linked[0]['name']} and {linked[1]['name']}.")
                for l in linked[:2]:
                    for r in R.entity_relations(l["id"], limit=2):
                        b.add_relation(r)
        elif len(linked) == 1:
            for p in R.paths_from(linked[0]["id"], k=3):
                b.add_path(p)
                found += 1
        names = [n["name"] for p in b.paths[:1] for n in p["nodes"]]
        for p in R.search(" ".join([state["question"], *names]), k=3, doc_ids=state.get("doc_filter") or None):
            b.add_passage(p)
        detail = (f"{found} graph path(s) via {R.traversal.name}"
                  + (f"; best: {b.paths[0]['text']}" if b.paths else ""))
        return {"evidence": b.pack(), "trace": _t("retrieve_multi_hop", detail)}

    async def retrieve_thematic(state: KBQueryState) -> dict:
        b = EvidenceBuilder(store, R)
        linked = state.get("linked", [])
        generic = not [l for l in linked if l["type"] != "Concept"]
        topics = R.rank_topics(state["question"], [l["id"] for l in linked], k=5 if generic else 3, generic=generic)
        for t in topics:
            b.add_topic(t)
        chosen = {t["community_id"] for t in topics}
        bridges = 0
        for link in store.community_links():
            if link["source"] in chosen and link["target"] in chosen and link["bridges"] and bridges < 3:
                rel = R.relations.get(link["bridges"][0]["relation_id"])
                if rel:
                    b.add_relation(rel)
                    bridges += 1
        return {"evidence": b.pack(),
                "trace": _t("retrieve_thematic", f"{len(topics)} topic communities, {bridges} cross-topic bridges")}

    async def retrieve_comparison(state: KBQueryState) -> dict:
        b = EvidenceBuilder(store, R)
        docs = store.list_documents(status="ready")
        tg = comparison_targets(state["question"], state.get("linked", []), state.get("doc_hits", []), docs)
        q = state["question"]
        if tg["kind"] == "none":
            detail = _factual(state, b)
            return {"evidence": b.pack(), "route": "factual",
                    "route_reason": state.get("route_reason", "") + "; no comparison targets identified → factual",
                    "trace": _t("retrieve_comparison", f"no comparison targets; fell back to factual ({detail})")}
        comms = {c["community_id"]: c for c in store.communities()}
        targets = []
        if tg["kind"] == "documents":
            mentions = store.entity_mentions()
            ent_by_doc: Dict[str, Counter] = {}
            for eid, _, did in mentions:
                ent_by_doc.setdefault(did, Counter())[eid] += 1
            rels = list(R.relations.values())
            rel_docs: Dict[str, set] = {}
            for rid, evs in store.relation_evidence([r["relation_id"] for r in rels]).items():
                rel_docs[rid] = {e["doc_id"] for e in evs}
            for t in tg["targets"]:
                did = t["doc_id"]
                sids = [b.add_passage(p) for p in R.search(q, k=3, doc_ids=[did])]
                doc_rel_ids = {rid for rid, ds in rel_docs.items() if did in ds}
                doc_rels = sorted((r for r in rels if r["relation_id"] in doc_rel_ids),
                                  key=lambda r: -int(r["evidence_count"]))[:3]
                gids = [b.add_relation(r) for r in doc_rels]
                top_ents = [e for e, _ in ent_by_doc.get(did, Counter()).most_common(12)]
                share: Counter = Counter()
                for e, n in ent_by_doc.get(did, Counter()).items():
                    c = (R.entities.get(e) or {}).get("community_id")
                    if c in comms:
                        share[c] += n
                topic_names = [comms[c]["label"] for c, _ in share.most_common(2)]
                targets.append({"kind": "document", "id": did, "label": t.get("title") or t["filename"],
                                "filename": t["filename"], "source_ids": sids, "fact_ids": gids,
                                "entities": top_ents, "topics": topic_names})
            sets = [set(ent_by_doc.get(t["id"], {})) for t in targets]
            shared_ids = set.intersection(*sets) if sets else set()
            shared = [R.entity_brief(e)["name"] for e in shared_ids][:8]
            distinct = {t["label"]: [R.entity_brief(e)["name"] for e in t["entities"] if e not in shared_ids][:6]
                        for t in targets}
            b.highlight(nodes=list(shared_ids)[:10])
        else:
            neigh = {}
            for t in tg["targets"]:
                eid = t["id"]
                gids = [b.add_relation(r) for r in R.entity_relations(eid, limit=4)]
                chunk_ids = store.entity_chunk_ids(eid)[:10]
                rows = store.get_chunks(chunk_ids)
                texts = [rows[c]["text"] for c in chunk_ids if c in rows]
                scores = R.rerank_texts(f"{q} {t['name']}", texts) if texts else []
                best = [c for _, c in sorted(zip(scores, [c for c in chunk_ids if c in rows]), reverse=True)[:2]]
                sids = [s for s in (b.add_chunk_id(c) for c in best) if s]
                e = R.entities.get(eid, {})
                topic = comms.get(e.get("community_id") or "", {}).get("label")
                neigh[eid] = R.neighbors(eid)
                targets.append({"kind": "entity", "id": eid, "label": t["name"], "source_ids": sids, "fact_ids": gids,
                                "entities": list(neigh[eid]), "topics": [topic] if topic else []})
                b.highlight(nodes=[eid])
            sets = list(neigh.values())
            shared_ids = set.intersection(*sets) if sets else set()
            shared = [R.entity_brief(e)["name"] for e in shared_ids][:8]
            same_topic = len({tuple(t["topics"]) for t in targets}) == 1 and targets[0]["topics"]
            if same_topic:
                shared.append(f"same topic community ({targets[0]['topics'][0]})")
            distinct = {t["label"]: [R.entity_brief(e)["name"] for e in t["entities"] if e not in shared_ids][:6]
                        for t in targets}
            b.highlight(nodes=list(shared_ids))
        b.comparison = {"kind": tg["kind"], "targets": targets, "shared": shared, "distinct": distinct,
                        "note": tg.get("note")}
        return {"evidence": b.pack(),
                "trace": _t("retrieve_comparison", f"compared {len(targets)} {tg['kind']}: "
                            + " vs ".join(t["label"] for t in targets))}

    # ── assessment / rewrite ─────────────────────────────────────────────────
    async def assess(state: KBQueryState) -> dict:
        ok, reason, borderline = assess_evidence(state["route"], state["evidence"], state["question"],
                                                 state.get("linked", []), R.reranker is not None)
        return {"sufficient": ok, "sufficiency_reason": reason, "borderline": borderline,
                "trace": _t("assess_evidence", ("sufficient: " if ok else "insufficient: ") + reason)}

    def after_assess(state: KBQueryState) -> str:
        if state["sufficient"]:
            return "generate"
        llm = svc.active_llm()
        if llm is not None and state.get("borderline"):
            return "generate"  # let the grounded LLM decide; it can still answer INSUFFICIENT_EVIDENCE
        if llm is not None and state["route"] == "factual" and state.get("rewrites", 0) < 1:
            return "rewrite"
        return "insufficient"

    async def rewrite_query(state: KBQueryState) -> dict:
        llm = svc.active_llm()
        new_q = state["question"]
        try:
            new_q = (await llm.complete(QUERY_REWRITE_PROMPT.format(question=state["question"]), fast=True,
                                        max_tokens=60)).strip().strip('"') or new_q
        except Exception as e:
            log.warning(f"Query rewrite failed: {e}")
        return {"search_query": new_q, "rewrites": state.get("rewrites", 0) + 1,
                "trace": _t("rewrite_query", f"retrying retrieval with: {new_q}")}

    # ── generation ───────────────────────────────────────────────────────────
    async def generate_answer(state: KBQueryState) -> dict:
        pack, route, q = state["evidence"], state["route"], state["question"]
        llm = svc.active_llm()
        warnings: List[str] = []
        if llm is not None:
            res = await generate_llm_answer(llm, route, q, pack)
            if res and res.get("insufficient"):
                return {"answer": insufficient_answer(q, pack, state.get("sufficiency_reason", ""), res.get("missing", "")),
                        "sufficient": False, "mode": "llm", "citations_used": [], "warnings": [],
                        "trace": _t("generate_answer", "LLM judged the evidence insufficient")}
            if res and not res.get("rejected"):
                return {"answer": res["text"], "mode": "llm", "citations_used": res["used"],
                        "warnings": res["warnings"], "sufficient": True,
                        "trace": _t("generate_answer", f"LLM answer with {len(res['used'])} valid citations")}
            warnings.extend((res or {}).get("warnings", ["LLM unavailable — extractive answer used"]))
        if not state["sufficient"]:
            return {"answer": insufficient_answer(q, pack, state.get("sufficiency_reason", "")), "mode": "extractive",
                    "citations_used": [], "warnings": warnings, "sufficient": False,
                    "trace": _t("generate_answer", "insufficient evidence")}
        text = extractive_answer(route, q, pack, R, state.get("linked", []))
        v = validate_citations(text, pack)
        return {"answer": v["text"], "mode": "extractive", "citations_used": v["used"],
                "warnings": warnings + [w for w in v["warnings"] if w.startswith("Removed")],
                "trace": _t("generate_answer", f"extractive answer with {len(v['used'])} citations")}

    async def insufficient(state: KBQueryState) -> dict:
        pack = state["evidence"]
        return {"answer": insufficient_answer(state["question"], pack, state.get("sufficiency_reason", "")),
                "mode": "llm" if svc.active_llm() else "extractive", "citations_used": [], "warnings": [],
                "trace": _t("insufficient_answer", state.get("sufficiency_reason", ""))}

    async def finalize(state: KBQueryState) -> dict:
        pack = state["evidence"]
        if not state.get("sufficient"):
            # don't present graph facts or paint the graph with evidence that doesn't answer the question;
            # the retrieved passages stay, labelled as "closest passages"
            linked_ids = [l["id"] for l in state.get("linked", [])]
            pack = dict(pack, facts=[], paths=[], topics=[], comparison=None,
                        highlight={"nodes": linked_ids, "edges": [], "path_edges": [], "communities": []})
        follow = suggest_followups(pack, R, state.get("linked", []), state["route"]) if state.get("sufficient") else []
        return {"evidence": pack, "followups": follow, "trace": _t("finalize", f"{len(follow)} follow-up suggestions")}

    g = StateGraph(KBQueryState)
    g.add_node("route_query", route_query)
    g.add_node("retrieve_factual", retrieve_factual)
    g.add_node("retrieve_multi_hop", retrieve_multi_hop)
    g.add_node("retrieve_thematic", retrieve_thematic)
    g.add_node("retrieve_comparison", retrieve_comparison)
    g.add_node("assess_evidence", assess)
    g.add_node("rewrite_query", rewrite_query)
    g.add_node("generate_answer", generate_answer)
    g.add_node("insufficient_answer", insufficient)
    g.add_node("finalize", finalize)

    g.add_edge(START, "route_query")
    g.add_conditional_edges("route_query", pick_route, {
        "factual": "retrieve_factual", "multi_hop": "retrieve_multi_hop",
        "thematic": "retrieve_thematic", "comparison": "retrieve_comparison",
    })
    for n in ("retrieve_factual", "retrieve_multi_hop", "retrieve_thematic", "retrieve_comparison"):
        g.add_edge(n, "assess_evidence")
    g.add_conditional_edges("assess_evidence", after_assess, {
        "generate": "generate_answer", "rewrite": "rewrite_query", "insufficient": "insufficient_answer",
    })
    g.add_edge("rewrite_query", "retrieve_factual")
    g.add_edge("generate_answer", "finalize")
    g.add_edge("insufficient_answer", "finalize")
    g.add_edge("finalize", END)
    return g.compile()
