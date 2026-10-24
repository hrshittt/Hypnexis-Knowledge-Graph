"""
Query routing: thematic | factual | multi_hop | comparison.

Heuristics run first (fast, deterministic, explainable). When Gemini is configured it
is consulted only for questions the rules can't place confidently; its answer is then
sanity-checked against what the graph can actually support (e.g. multi_hop needs
linked entities).
"""

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.kb.text_utils import tokenize
from backend.utils.logger import get_logger

log = get_logger(__name__)

ROUTES = ("thematic", "factual", "multi_hop", "comparison")

_COMPARE_RE = re.compile(
    r"\b(compare|comparison|comparing|contrast|differ|differs|difference|differences|different|versus|vs\.?|"
    r"similarit(?:y|ies)|in common|both .* and|how does .* stack up)\b", re.I)
_THEMATIC_RE = re.compile(
    r"\b((main|key|major|common|overall|recurring|central|dominant|biggest)\s+(themes?|topics?|ideas?|issues?|"
    r"areas?|takeaways?|subjects?|threads?)|themes?|topics?|overview|summari[sz]e|summary|big picture|"
    r"what (?:is|are) (?:this|these|the) (?:documents?|corpus|collection|files?|sources?|reports?) about|"
    r"across (?:all|the|these) (?:documents|sources|reports|files)|high[- ]level)\b", re.I)
_MULTIHOP_RE = re.compile(
    r"\b(connect(?:ed|ion|s)?|link(?:ed|s)?|relat(?:ed|ion|ionship)|path|chain|bridge|between|through|via|"
    r"indirect(?:ly)?|lead(?:s)? to|tie[sd]? (?:to|together)|associated|affect(?:s|ed)?|impact(?:s|ed)?)\b", re.I)
_DOC_WORDS = {"document", "documents", "doc", "docs", "report", "reports", "brief", "briefs", "study", "studies",
              "paper", "papers", "file", "files", "source", "sources", "profile", "article", "articles"}
_FILENAME_GENERIC = {"report", "brief", "study", "profile", "annual", "document", "doc", "paper", "notes",
                     "final", "draft", "pdf", "txt", "md", "the", "and", "company", "policy"}

ROUTER_PROMPT = """\
Classify the question for a document knowledge base into exactly one route:
- thematic: asks for themes, topics, an overview or summary across the collection
- factual: asks for a specific fact about one thing
- multi_hop: asks how two or more things are connected / related, needing a chain of facts
- comparison: asks to compare or contrast two or more entities or documents
Question: {question}
Answer with one word: thematic, factual, multi_hop or comparison."""


def match_documents(question: str, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Documents referenced by filename or title tokens in the question."""
    q_tokens = set(tokenize(question))
    hits = []
    for d in documents:
        stem_tokens = [t for t in re.split(r"[_\-\s.]+", Path(d["filename"]).stem.lower())
                       if t and t not in _FILENAME_GENERIC and not t.isdigit()]
        title_tokens = [t for t in tokenize(d.get("title") or "") if t not in _FILENAME_GENERIC and len(t) > 2]
        best = 0.0
        for toks in (stem_tokens, title_tokens):
            if toks:
                best = max(best, sum(1 for t in toks if t in q_tokens) / len(toks))
        if best >= 0.5:
            hits.append({"doc_id": d["doc_id"], "filename": d["filename"], "title": d.get("title"), "score": best})
    hits.sort(key=lambda h: -h["score"])
    return hits


def heuristic_route(question: str, linked: List[Dict[str, Any]], doc_hits: List[Dict[str, Any]],
                    n_docs: int) -> Tuple[str, str, float]:
    q = question.strip()
    qt = set(tokenize(q))
    named = [l for l in linked if l["type"] != "Concept"]
    if _COMPARE_RE.search(q):
        if (len(doc_hits) >= 2 or n_docs >= 2) and qt & _DOC_WORDS:
            return "comparison", "comparison wording + documents referenced", 0.95
        if len(linked) >= 2:
            return "comparison", "comparison wording + ≥2 entities", 0.95
        return "comparison", "comparison wording", 0.6
    if _THEMATIC_RE.search(q) and len(named) <= 1:
        return "thematic", "asks for themes / overview", 0.9
    if len(linked) >= 2 and _MULTIHOP_RE.search(q):
        return "multi_hop", "≥2 entities + connection wording", 0.95
    if len(linked) >= 2 and re.match(r"^\s*how\b", q, re.I):
        return "multi_hop", "'how' question spanning ≥2 entities", 0.75
    if len(linked) == 1 and re.search(r"\b(indirect(?:ly)?|two[- ]hop|chain|network|connections?)\b", q, re.I):
        return "multi_hop", "asks for indirect connections of one entity", 0.8
    if not linked and _THEMATIC_RE.search(q):
        return "thematic", "overview wording", 0.8
    return "factual", "default: specific fact lookup", 0.7 if linked else 0.5


async def route_question(question: str, linked, doc_hits, n_docs: int, llm=None) -> Dict[str, Any]:
    route, reason, conf = heuristic_route(question, linked, doc_hits, n_docs)
    method = "heuristic"
    if llm is not None and llm.available and conf < 0.8:
        try:
            raw = (await llm.complete(ROUTER_PROMPT.format(question=question), fast=True, max_tokens=8)).strip().lower()
            word = re.sub(r"[^a-z_]", "", raw.split()[0]) if raw else ""
            word = "multi_hop" if word in ("multihop", "multi_hop", "multi") else word
            if word in ROUTES and word != route:
                if word == "multi_hop" and not linked:
                    reason += "; LLM suggested multi_hop but no entities were linked"
                else:
                    route, reason, method = word, f"LLM router (heuristic said {route})", "llm"
            elif word == route:
                method = "heuristic+llm"
        except Exception as e:
            log.warning(f"LLM router failed, keeping heuristic route: {e}")
    return {"route": route, "reason": reason, "method": method, "confidence": conf}


def comparison_targets(question: str, linked: List[Dict[str, Any]], doc_hits: List[Dict[str, Any]],
                       documents: List[Dict[str, Any]]) -> Dict[str, Any]:
    qt = set(tokenize(question))
    talks_docs = bool(qt & _DOC_WORDS)
    if len(doc_hits) >= 2 and (talks_docs or len(linked) < 2):
        return {"kind": "documents", "targets": doc_hits[:3]}
    if len(linked) >= 2:
        return {"kind": "entities", "targets": linked[:3]}
    if len(doc_hits) >= 2:
        return {"kind": "documents", "targets": doc_hits[:3]}
    if qt & _DOC_WORDS and len(documents) >= 2:
        if len(doc_hits) == 1:
            others = [d for d in documents if d["doc_id"] != doc_hits[0]["doc_id"]]
            return {"kind": "documents", "targets": doc_hits + [
                {"doc_id": d["doc_id"], "filename": d["filename"], "title": d.get("title"), "score": 0.0}
                for d in others[:1]], "note": "second document not named — compared with the next document"}
        if len(documents) == 2:
            return {"kind": "documents", "targets": [
                {"doc_id": d["doc_id"], "filename": d["filename"], "title": d.get("title"), "score": 0.0}
                for d in documents]}
    return {"kind": "none", "targets": []}
