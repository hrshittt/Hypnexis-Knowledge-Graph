"""
Grounded answering: evidence packs, sufficiency checks, cited generation, citation validation.

Evidence is numbered for citation:
  [S#] source passages (chunk text + filename + page + offsets)
  [G#] knowledge-graph relations; every [G#] links to the [S#] passage it was extracted from
Generation:
  - Gemini (if configured) must cite only listed IDs; invalid IDs are stripped, uncited
    answers are rejected in favour of the extractive answer, and "INSUFFICIENT_EVIDENCE"
    is honoured.
  - Without an LLM, an extractive answer is composed from verbatim source sentences and
    graph facts — it can only say what the documents say.
"""

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.kb.lexicon import predicate_surface_forms
from backend.kb.text_utils import (
    content_terms, find_all_ci, index_terms, locate_sentence, normalize_ws, split_sentences, term_coverage, tokenize,
)
from backend.utils.logger import get_logger

log = get_logger(__name__)

INSUFFICIENT_PREFIX = "INSUFFICIENT_EVIDENCE"


def predicate_terms(predicate: str) -> set:
    """Stemmed terms of a predicate and all its surface forms (so 'based' matches 'located in')."""
    return {t for form in predicate_surface_forms(predicate) for t in index_terms(form)}


# ═════════════════════════════════════════════════════════════════════════════
# Evidence pack
# ═════════════════════════════════════════════════════════════════════════════

class EvidenceBuilder:
    def __init__(self, store, retriever):
        self.store = store
        self.r = retriever
        self.sources: List[Dict[str, Any]] = []
        self.facts: List[Dict[str, Any]] = []
        self.paths: List[Dict[str, Any]] = []
        self.topics: List[Dict[str, Any]] = []
        self.comparison: Optional[Dict[str, Any]] = None
        self.notes: List[str] = []
        self.hl_nodes: List[str] = []
        self.hl_edges: List[str] = []
        self.hl_path_edges: List[str] = []
        self.hl_communities: List[str] = []
        self._by_chunk: Dict[str, str] = {}
        self._by_rel: Dict[str, str] = {}

    # sources ------------------------------------------------------------------
    def add_passage(self, p: Dict[str, Any], highlight: Optional[str] = None) -> str:
        cid = p["chunk_id"]
        if cid in self._by_chunk:
            sid = self._by_chunk[cid]
        else:
            sid = f"S{len(self.sources) + 1}"
            self._by_chunk[cid] = sid
            self.sources.append({
                "id": sid, "chunk_id": cid, "doc_id": p["doc_id"], "filename": p["filename"],
                "page": p["page"], "text": p["text"], "start_char": p.get("start_char"),
                "end_char": p.get("end_char"), "score": round(float(p.get("score", 0.0)), 4),
                "rerank": p.get("rerank"), "highlights": [],
            })
        if highlight:
            src = self.sources[int(sid[1:]) - 1]
            a, b = locate_sentence(src["text"], highlight)
            if a >= 0 and [a, b] not in src["highlights"]:
                src["highlights"].append([a, b])
        return sid

    def add_chunk_id(self, chunk_id: str, highlight: Optional[str] = None) -> Optional[str]:
        if chunk_id in self._by_chunk and not highlight:
            return self._by_chunk[chunk_id]
        row = self.store.get_chunks([chunk_id]).get(chunk_id)
        return self.add_passage(row, highlight) if row else None

    # graph facts --------------------------------------------------------------
    def add_relation(self, rel: Dict[str, Any], highlight: bool = True) -> str:
        rid = rel["relation_id"]
        if rid in self._by_rel:
            return self._by_rel[rid]
        ev = self.store.relation_evidence([rid]).get(rid, [])
        source_ids, evidence = [], []
        for e in ev[:2]:
            sid = self.add_passage({"chunk_id": e["chunk_id"], "doc_id": e["doc_id"], "filename": e["filename"],
                                    "page": e["page"], "text": e["chunk_text"], "score": e["confidence"]},
                                   highlight=e["sentence"])
            if sid not in source_ids:
                source_ids.append(sid)
            evidence.append({"source_id": sid, "sentence": e["sentence"], "method": e["method"]})
        gid = f"G{len(self.facts) + 1}"
        self._by_rel[rid] = gid
        brief = self.r.relation_brief(rel)
        self.facts.append({
            "id": gid, "relation_id": rid, "subject": brief["subject"], "predicate": rel["predicate"],
            "object": brief["object"], "evidence_count": brief["evidence_count"], "source_ids": source_ids,
            "evidence": evidence, "sentence": ev[0]["sentence"] if ev else "",
        })
        if highlight:
            self.highlight(nodes=[rel["subject_id"], rel["object_id"]], edges=[rid])
        return gid

    def add_path(self, path: Dict[str, Any]) -> Dict[str, Any]:
        fact_ids = [self.add_relation(e) for e in path["edges"]]
        names = [self.r.entity_brief(n)["name"] for n in path["nodes"]]
        steps = []
        for e, gid in zip(path["edges"], fact_ids):
            s, o = self.r.entity_brief(e["subject_id"])["name"], self.r.entity_brief(e["object_id"])["name"]
            steps.append(f"{s} —{e['predicate']}→ {o}")
        p = {"nodes": [self.r.entity_brief(n) for n in path["nodes"]], "edge_ids": [e["relation_id"] for e in path["edges"]],
             "fact_ids": fact_ids, "hops": path["hops"], "text": " → ".join(names), "steps": steps}
        self.paths.append(p)
        self.highlight(nodes=path["nodes"], edges=p["edge_ids"])
        if len(self.paths) == 1:
            self.hl_path_edges.extend(p["edge_ids"])
        return p

    def add_topic(self, t: Dict[str, Any]) -> Dict[str, Any]:
        sids = []
        for cid in t["evidence_chunk_ids"]:
            sids.append(self.add_chunk_id(cid))
        # topic summaries carry [n] markers indexing evidence_chunk_ids → rewrite to [S#]
        def repl(m):
            n = int(m.group(1))
            return f"[{sids[n - 1]}]" if 1 <= n <= len(sids) and sids[n - 1] else ""
        summary = re.sub(r"\[(\d+)\]", repl, t["summary"])
        topic = {"id": t["community_id"], "label": t["label"], "summary": summary, "keywords": t["keywords"],
                 "size": t["size"], "doc_ids": t["doc_ids"], "source_ids": [s for s in sids if s],
                 "method": t["method"], "top_entities": [self.r.entity_brief(e) for e in t["top_entities"][:6]]}
        self.topics.append(topic)
        self.highlight(nodes=t["top_entities"][:8], communities=[t["community_id"]])
        return topic

    def highlight(self, nodes: Sequence[str] = (), edges: Sequence[str] = (), communities: Sequence[str] = ()):
        for n in nodes:
            if n not in self.hl_nodes:
                self.hl_nodes.append(n)
            c = self.r.entity_brief(n).get("community")
            if c and c not in self.hl_communities:
                self.hl_communities.append(c)
        for e in edges:
            if e not in self.hl_edges:
                self.hl_edges.append(e)
        for c in communities:
            if c not in self.hl_communities:
                self.hl_communities.append(c)

    def pack(self) -> Dict[str, Any]:
        return {
            "sources": self.sources, "facts": self.facts, "paths": self.paths, "topics": self.topics,
            "comparison": self.comparison, "notes": self.notes,
            "highlight": {"nodes": self.hl_nodes, "edges": self.hl_edges, "path_edges": self.hl_path_edges,
                          "communities": self.hl_communities},
        }


# ═════════════════════════════════════════════════════════════════════════════
# Sufficiency
# ═════════════════════════════════════════════════════════════════════════════

def _question_terms(question: str, linked: Sequence[Dict[str, Any]]) -> List[str]:
    exclude = [t for l in linked for t in tokenize(l["name"]) + tokenize(l.get("matched", ""))]
    return content_terms(question, exclude=exclude)


def assess_evidence(route: str, pack: Dict[str, Any], question: str, linked: Sequence[Dict[str, Any]],
                    reranker_on: bool) -> Tuple[bool, str, bool]:
    """Return (sufficient, reason, borderline). Borderline cases may still go to the LLM."""
    sources, facts = pack["sources"], pack["facts"]
    if route == "thematic":
        if pack["topics"]:
            return True, f"{len(pack['topics'])} topic communities matched", False
        return False, "no topic communities exist yet (ingest documents first)", False
    if route == "comparison":
        comp = pack.get("comparison") or {}
        targets = comp.get("targets", [])
        if len(targets) < 2:
            return False, "could not identify two things to compare", False
        missing = [t["label"] for t in targets if not (t["source_ids"] or t["fact_ids"])]
        if missing:
            return False, f"no evidence found for: {', '.join(missing)}", False
        return True, f"evidence found for all {len(targets)} compared items", False
    if route == "multi_hop" and pack["paths"]:
        p = pack["paths"][0]
        return True, f"graph path with {p['hops']} hop(s) found, every hop has a source sentence", False
    if route == "multi_hop" and len([l for l in linked]) >= 2 and not pack["paths"]:
        names = " and ".join(l["name"] for l in linked[:2])
        return False, f"no chain of extracted relations connects {names}", bool(sources)

    if not sources and not facts:
        return False, "no relevant passages retrieved", False
    terms = _question_terms(question, linked)
    top_text = " ".join(s["text"] for s in sources[:3]) + " " + " ".join(f["predicate"] for f in facts)
    cov = term_coverage(terms, top_text) if terms else 1.0
    fact_terms = {st for f in facts for st in predicate_terms(f["predicate"])}
    fact_match = bool(terms) and any(t in fact_terms for t in terms)
    best = max((s.get("rerank") or 0.0 for s in sources), default=0.0)
    if reranker_on:
        ok = fact_match or cov >= 0.6 or best >= 0.85 or (best >= 0.4 and cov >= 0.34)
        borderline = not ok and (best >= 0.2 or cov >= 0.34)
        reason = f"question-term coverage {cov:.0%}, best rerank {best:.2f}" + (", graph fact matches" if fact_match else "")
    else:
        ok = fact_match or cov >= 0.6
        borderline = not ok and cov >= 0.34
        reason = f"question-term coverage {cov:.0%}" + (", graph fact matches" if fact_match else "")
    if not terms and linked:
        ok = bool(sources or facts)
        reason = "entity lookup: evidence found for the linked entity"
    return ok, reason, borderline


# ═════════════════════════════════════════════════════════════════════════════
# LLM generation + validation
# ═════════════════════════════════════════════════════════════════════════════

ROUTE_INSTRUCTIONS = {
    "factual": "Answer the specific question directly in the first sentence, then add supporting detail.",
    "multi_hop": "Explain the connection step by step following the graph path(s); cite every hop.",
    "thematic": "Describe the main themes, one bullet per topic community, citing passages.",
    "comparison": "Compare item by item, then state the similarities and differences explicitly.",
}

ANSWER_PROMPT = """\
You answer questions about the user's uploaded documents using ONLY the evidence below.

Rules:
- Every sentence that states a fact must end with citations such as [S1] or [G2][S3].
  [S#] = source passage. [G#] = knowledge-graph relation extracted from the cited passage.
- Cite only IDs listed below. Never invent sources, entities, relationships, numbers or dates.
- If the evidence does not answer the question, reply with ONE line that starts with
  "INSUFFICIENT_EVIDENCE:" followed by what is missing.
- {route_instructions}
- At most {max_words} words. Markdown is fine (short paragraphs or bullets).

Question: {question}
{sections}
"""


def _evidence_sections(pack: Dict[str, Any]) -> str:
    parts = []
    if pack["paths"]:
        parts.append("Graph paths:\n" + "\n".join(
            f"- Path {i + 1}: " + "; ".join(f"{st} [{g}]" for st, g in zip(p["steps"], p["fact_ids"]))
            for i, p in enumerate(pack["paths"])))
    if pack["facts"]:
        parts.append("Graph relations:\n" + "\n".join(
            f"[{f['id']}] {f['subject']['name']} —{f['predicate']}→ {f['object']['name']} "
            f"(from {', '.join(f['source_ids']) or 'n/a'})" for f in pack["facts"]))
    if pack["topics"]:
        parts.append("Topic communities:\n" + "\n".join(
            f"- {t['label']} ({t['size']} entities): {t['summary']}" for t in pack["topics"]))
    if pack.get("comparison"):
        comp = pack["comparison"]
        parts.append("Comparison targets:\n" + "\n".join(
            f"- {t['label']}: sources {', '.join(t['source_ids']) or 'none'}; relations {', '.join(t['fact_ids']) or 'none'}"
            for t in comp["targets"]) + (f"\nShared: {', '.join(comp['shared'])}" if comp.get("shared") else ""))
    parts.append("Source passages:\n" + "\n\n".join(
        f"[{s['id']}] ({s['filename']}, p.{s['page']}) {normalize_ws(s['text'])[:1200]}" for s in pack["sources"]))
    return "\n\n".join(parts)


_CITE_GROUP_RE = re.compile(r"\[((?:[SG]\d+)(?:\s*[,;]\s*[SG]\d+)+)\]")
_CITE_RE = re.compile(r"\[([SG])(\d+)\]")


def validate_citations(text: str, pack: Dict[str, Any]) -> Dict[str, Any]:
    text = _CITE_GROUP_RE.sub(lambda m: "".join(f"[{x.strip()}]" for x in re.split(r"[,;]", m.group(1))), text)
    valid = {s["id"] for s in pack["sources"]} | {f["id"] for f in pack["facts"]}
    used, invalid = [], []

    def repl(m):
        cid = f"{m.group(1)}{m.group(2)}"
        if cid in valid:
            if cid not in used:
                used.append(cid)
            return f"[{cid}]"
        invalid.append(cid)
        return ""

    clean = _CITE_RE.sub(repl, text)
    clean = re.sub(r"[ \t]+([.,;:])", r"\1", clean)
    warnings = []
    if invalid:
        warnings.append(f"Removed {len(invalid)} citation(s) to non-existent evidence: {', '.join(sorted(set(invalid)))}")
    # sentence-level support check: cited sentences should share vocabulary with their passages
    src_text = {s["id"]: s["text"] for s in pack["sources"]}
    for f in pack["facts"]:
        src_text[f["id"]] = f"{f['subject']['name']} {f['predicate']} {f['object']['name']} {f['sentence']}"
    weak = 0
    uncited = 0
    for _, _, sent in split_sentences(re.sub(r"^[\s*\-#>\d.]+", "", clean, flags=re.M)):
        ids = [f"{a}{b}" for a, b in _CITE_RE.findall(sent)]
        terms = content_terms(_CITE_RE.sub("", sent))
        if not ids:
            if len(terms) >= 4:
                uncited += 1
            continue
        if terms and term_coverage(terms, " ".join(src_text.get(i, "") for i in ids)) < 0.25:
            weak += 1
    if uncited:
        warnings.append(f"{uncited} sentence(s) without a citation")
    if weak:
        warnings.append(f"{weak} cited sentence(s) share little wording with their sources — verify them")
    return {"text": clean.strip(), "used": used, "invalid": invalid, "warnings": warnings}


async def generate_llm_answer(llm, route: str, question: str, pack: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    prompt = ANSWER_PROMPT.format(
        route_instructions=ROUTE_INSTRUCTIONS.get(route, ROUTE_INSTRUCTIONS["factual"]),
        max_words=260 if route in ("thematic", "comparison") else 180,
        question=question, sections=_evidence_sections(pack),
    )
    try:
        raw = await llm.complete(prompt, max_tokens=1200, temperature=0.1)
    except Exception as e:
        log.warning(f"LLM answer failed, extractive fallback: {e}")
        return None
    raw = raw.strip()
    if raw.upper().startswith(INSUFFICIENT_PREFIX):
        missing = raw.split(":", 1)[1].strip() if ":" in raw else ""
        return {"insufficient": True, "missing": missing, "text": "", "used": [], "warnings": []}
    v = validate_citations(raw, pack)
    if not v["used"]:
        log.warning("LLM answer contained no valid citations — rejected in favour of extractive answer.")
        return {"rejected": True, "warnings": ["LLM answer had no valid citations and was replaced"]}
    return {"insufficient": False, **v}


# ═════════════════════════════════════════════════════════════════════════════
# Extractive answers (no LLM)
# ═════════════════════════════════════════════════════════════════════════════

def _best_sentences(retriever, question: str, pack: Dict[str, Any], linked, k: int = 3,
                    source_ids: Optional[Sequence[str]] = None) -> List[Tuple[str, str]]:
    pool = [s for s in pack["sources"] if source_ids is None or s["id"] in source_ids][:5]
    cands: List[Tuple[str, str]] = []
    for s in pool:
        for _, _, sent in split_sentences(s["text"]):
            if len(sent) >= 20 and sent.endswith((".", "!", "?", '"')):
                cands.append((sent, s["id"]))
    if not cands:
        return []
    scores = retriever.rerank_texts(question, [c[0] for c in cands])
    names = [l["name"] for l in linked]
    ranked = []
    for (sent, sid), sc in zip(cands, scores):
        bonus = 0.15 * sum(1 for n in names if find_all_ci(sent, n))
        ranked.append((sc + bonus, sent, sid))
    ranked.sort(key=lambda x: -x[0])
    best = ranked[0][0]
    out, seen = [], set()
    for sc, sent, sid in ranked:
        if sc < max(0.05, 0.5 * best) or sent in seen:
            continue
        seen.add(sent)
        out.append((sent, sid))
        if len(out) >= k:
            break
    return out


def _fact_line(f: Dict[str, Any]) -> str:
    return f"{f['subject']['name']} → *{f['predicate']}* → {f['object']['name']} [{f['id']}]"


def extractive_answer(route: str, question: str, pack: Dict[str, Any], retriever, linked) -> str:
    lines: List[str] = []
    if route == "multi_hop" and pack["paths"]:
        p = pack["paths"][0]
        lines.append(f"**Connection found ({p['hops']} hop{'s' if p['hops'] != 1 else ''}):** {p['text']}")
        lines.append("")
        for i, gid in enumerate(p["fact_ids"], start=1):
            f = next(x for x in pack["facts"] if x["id"] == gid)
            first = f["evidence"][0] if f.get("evidence") else None
            quote = f' — "{first["sentence"]}" [{first["source_id"]}]' if first else ""
            lines.append(f"{i}. {_fact_line(f)}{quote}")
        others = pack["paths"][1:]
        if others:
            lines.append("")
            lines.append("**Other connecting paths:**")
            for op in others:
                lines.append(f"- {op['text']} " + "".join(f"[{g}]" for g in op["fact_ids"]))
    elif route == "thematic" and pack["topics"]:
        lines.append(f"The knowledge graph groups this collection into **{len(pack['topics'])} topic "
                     f"communit{'ies' if len(pack['topics']) != 1 else 'y'}** (most relevant first):")
        lines.append("")
        for t in pack["topics"]:
            ents = ", ".join(e["name"] for e in t["top_entities"][:4])
            lines.append(f"- **{t['label']}** ({t['size']} entities: {ents}) — {t['summary']}")
    elif route == "comparison" and pack.get("comparison"):
        comp = pack["comparison"]
        for t in comp["targets"]:
            lines.append(f"**{t['label']}**")
            facts = [f for f in pack["facts"] if f["id"] in t["fact_ids"]][:4]
            for f in facts:
                lines.append(f"- {_fact_line(f)}")
            for sent, sid in _best_sentences(retriever, f"{question} {t['label']}", pack, linked, k=2,
                                             source_ids=t["source_ids"]):
                lines.append(f"- {sent} [{sid}]")
            if t.get("topics"):
                lines.append(f"- Topics: {', '.join(t['topics'])}")
            lines.append("")
        overlap = []
        if comp.get("shared"):
            overlap.append(f"- **In common:** {', '.join(comp['shared'])}")
        for label, items in (comp.get("distinct") or {}).items():
            if items:
                overlap.append(f"- **Only {label}:** {', '.join(items[:6])}")
        if overlap:
            lines.append("**Overlap in the knowledge graph** (shared vs. distinct connections)")
            lines.extend(overlap)
        if comp.get("note"):
            lines.append(f"\n_{comp['note']}_")
    else:
        sents = _best_sentences(retriever, question, pack, linked)
        if sents:
            lines.append("According to the documents:")
            lines.append("")
            lines.extend(f"- {s} [{sid}]" for s, sid in sents)
        facts = pack["facts"][:4]
        if facts:
            lines.append("")
            lines.append("**Knowledge-graph evidence:**")
            lines.extend(f"- {_fact_line(f)}" for f in facts)
    lines.append("")
    lines.append("_Extractive answer — quoted from your documents (no LLM configured)._")
    return "\n".join(lines).strip()


def insufficient_answer(question: str, pack: Dict[str, Any], reason: str, missing: str = "") -> str:
    lines = ["**Insufficient evidence.** I couldn't find support in the uploaded documents for an answer to this question."]
    if missing:
        lines.append(f"\nMissing: {missing}")
    elif reason:
        lines.append(f"\n_Why:_ {reason}.")
    near = pack["sources"][:2]
    if near:
        lines.append("\nClosest passages retrieved (they do **not** answer the question):")
        for s in near:
            snippet = normalize_ws(s["text"])[:220]
            lines.append(f'- "{snippet}…" [{s["id"]}]')
    return "\n".join(lines)


def suggest_followups(pack: Dict[str, Any], retriever, linked, route: str) -> List[str]:
    out: List[str] = []
    seen_rel = {f["relation_id"] for f in pack["facts"]}
    if route == "thematic":
        # cross-topic questions invite a multi-hop answer through the graph
        heads = [t["top_entities"][0]["name"] for t in pack["topics"] if t["top_entities"]]
        for a, b in zip(heads, heads[1:]):
            out.append(f"How is {a} connected to {b}?")
        if pack["topics"] and pack["topics"][0]["top_entities"]:
            out.append(f"What does {pack['topics'][0]['top_entities'][0]['name']} do?")
    for l in linked[:2]:
        for r in retriever.entity_relations(l["id"], limit=8):
            if r["relation_id"] in seen_rel:
                continue
            other = r["object_id"] if r["subject_id"] == l["id"] else r["subject_id"]
            name = retriever.entity_brief(other)["name"]
            q = f"How is {l['name']} connected to {name}?"
            if q not in out:
                out.append(q)
                break
    if pack["paths"]:
        mid = pack["paths"][0]["nodes"][1:-1]
        if mid:
            out.append(f"What else is {mid[0]['name']} involved in?")
    return out[:3]
