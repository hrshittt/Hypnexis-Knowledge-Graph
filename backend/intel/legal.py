"""
Legal & policy research over the sources uploaded to a workspace — information, not advice.

Provisions
  Headings such as "Section 7. Breach notification", "Article 5", "Rule 3(1)" or "§ 4" open a
  provision; every sentence until the next heading belongs to it. Sentences are classified by
  their wording (obligation, prohibition, definition, penalty, exemption, condition, scope,
  deadline). Cross-references ("exempt from Section 6") link provisions.

Applicability analysis
  1. facts are spotted in the question by keyword (shown to the user as such)
  2. jurisdiction: the user's choice, a jurisdiction named in the question, or — when sources
     cover several and none is given — a clarifying question
  3. provisions are retrieved with the workspace's hybrid search plus term overlap
  4. results are grouped per law: why it may apply (its scope provisions + matched facts),
     obligations, conditions and exceptions, penalties, sources
  5. every law is "potentially applicable". Paheli never confirms applicability: thresholds
     and conditions found in the text are turned into facts the user must confirm, and
     metadata such as effective dates is shown only when a workspace member entered it.
"""

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.intel.common import DocText, Sentence
from backend.kb.text_utils import content_terms

DISCLAIMER = ("Paheli provides legal information and research assistance based only on the sources in this "
              "workspace. It is not legal advice and does not confirm that a law applies to you. Check the current "
              "official text and consult a qualified professional before acting.")

PROVISION_RE = re.compile(
    r"^\s*(?P<kind>section|sec\.|article|art\.|rule|regulation|reg\.|clause|chapter|part|schedule|§)\s*"
    r"(?P<num>[0-9IVXLC]+[A-Za-z]?(?:\(\d+[a-z]?\))*(?:\.\d+)*)\s*[.:\-–—]?\s*(?P<title>.{0,90})$", re.I)
XREF_RE = re.compile(r"\b(?P<kind>section|sec\.|article|art\.|rule|regulation|clause|§)\s*(?P<num>\d+[A-Za-z]?(?:\(\d+[a-z]?\))*)",
                     re.I)
CLASSES: Dict[str, str] = {
    "prohibition": r"\b(?:shall not|must not|may not|is prohibited|are prohibited|no person shall|prohibits?|"
                   r"is not permitted)\b",
    "obligation": r"\b(?:shall|must|is required to|are required to|has to|have to|is obliged to|are obliged to|"
                  r"requires|is responsible for)\b",
    "definition": r"(?:[\"“][^\"”]{2,60}[\"”]\s+(?:means|includes|refers to)\b|\bis defined as\b|\bmeans any\b)",
    "penalty": r"\b(?:penalt(?:y|ies)|a fine\b|fines? (?:of|up to|not exceeding)|fined\b|imprisonment|liable to|"
               r"punishable|sanctions?)\b",
    "exemption": r"\b(?:does not apply|shall not apply|do not apply|is exempt|are exempt|exempt from|exemptions?|"
                 r"except\b|unless\b|notwithstanding)\b",
    "condition": r"(?:^(?:where|if|in case|provided that|when)\b|\bprovided that\b|\bon condition that\b|"
                 r"\b(?:below|above|fewer than|more than|at least|less than) \$?[\d,.]+)",
    "scope": r"\b(?:applies to|shall apply to|applicable to|this (?:act|regulation|rule|law|policy) applies)\b",
    "deadline": r"\bwithin \d+ (?:hours?|days?|working days|business days|months?|weeks?)\b",
    "commencement": r"\b(?:comes? into force|takes? effect|effective (?:from|on))\b",
}
AUTHORITY_RE = re.compile(r"\b(?!The\b)((?:[A-Z][a-z]+\s){1,4}(?:Authority|Commission|Ministry|Board|Regulator|Agency|"
                          r"Bureau|Council|Tribunal|Legislature))\b")
THRESHOLD_RE = re.compile(r"\b(?:below|above|fewer than|more than|at least|less than|exceeding|up to)\s+\$?[\d,.]+"
                          r"(?:\s?(?:million|billion|percent|%))?(?:\s[a-z]+){0,4}", re.I)

FACTS: Dict[str, Tuple[str, str]] = {
    "personal_data": ("Collects or processes personal data",
                      r"personal data|customer data|user data|collect\w* (?:customer |user )?data|privacy|"
                      r"personal information|customer information|data of (?:customers|users|residents)"),
    "payments": ("Takes payments", r"payments?\b|\bcards?\b|upi|wallets?|checkout|merchant|refunds?"),
    "online": ("Operates online", r"online|website|\bapps?\b|e-?commerce|digital"),
    "employees": ("Has employees", r"employ\w*|staff|hiring|workers?|payroll"),
    "energy": ("Energy or utilities", r"electric\w*|energy|utilit\w+|\bgrid\b|power plant|coal"),
    "environment": ("Environmental impact", r"emission\w*|pollution|environment\w*|waste"),
    "health": ("Health information", r"health|medical|patients?|hospital"),
    "small_business": ("Small business / startup", r"startup|start-up|small business|\bsme\b|turnover"),
}


@dataclass
class Provision:
    pid: str
    doc_id: str
    ref: str                 # "Section 7"
    title: str
    page: int
    sentences: List[Sentence] = field(default_factory=list)
    classes: Dict[int, List[str]] = field(default_factory=dict)   # sentence index → classes

    def label(self) -> str:
        return f"{self.ref}. {self.title}".strip(". ") if self.title else self.ref


def classify(text: str) -> List[str]:
    out = [k for k, p in CLASSES.items() if re.search(p, text, re.I)]
    if "prohibition" in out and "obligation" in out:
        out.remove("obligation")
    return out


def provisions(doc: DocText) -> List[Provision]:
    out: List[Provision] = []
    current: Optional[Provision] = None
    heads: List[Tuple[int, int, int, str, str]] = []      # (page, line start, line end, ref, title)
    for pnum, text in doc.pages:
        pos = 0
        for line in text.split("\n"):
            m = PROVISION_RE.match(line)
            if m and len(line) < 110:
                kind = m.group("kind").rstrip(".").capitalize()
                kind = {"Sec": "Section", "Art": "Article", "Reg": "Regulation", "§": "Section"}.get(kind, kind)
                heads.append((pnum, pos, pos + len(line), f"{kind} {m.group('num')}",
                              (m.group("title") or "").strip(" .:-–—")))
            pos += len(line) + 1
    pending = sorted(heads)
    for s in doc.sentences:
        while pending and (pending[0][0] < s.page or (pending[0][0] == s.page and pending[0][1] <= s.start)):
            pnum, _, _, ref, title = pending.pop(0)
            current = Provision(f"{doc.doc_id}:{ref}", doc.doc_id, ref, title, pnum)
            out.append(current)
        if any(h[0] == s.page and h[1] <= s.start < h[2] for h in heads):
            continue  # part of a provision heading ("Section 10." / "Penalties"), not of its text
        m = PROVISION_RE.match(s.text)
        if m and len(s.text) <= 60:
            # a heading the layout normaliser merged into the following text ("Rule 2. Definitions “…” means")
            kind = m.group("kind").rstrip(".").capitalize()
            kind = {"Sec": "Section", "Art": "Article", "Reg": "Regulation", "§": "Section"}.get(kind, kind)
            current = Provision(f"{doc.doc_id}:{kind} {m.group('num')}", doc.doc_id, f"{kind} {m.group('num')}",
                                (m.group("title") or "").strip(" .:-–—"), s.page)
            out.append(current)
            continue
        if current is None:
            current = Provision(f"{doc.doc_id}:preamble", doc.doc_id, "Preamble", "", s.page)
            out.append(current)
        current.sentences.append(s)
        current.classes[s.index] = classify(s.text)
    return [p for p in out if p.sentences]


def _sentence_out(doc: DocText, p: Provision, s: Sentence) -> Dict[str, Any]:
    return {"text": s.text, "classes": p.classes.get(s.index, []), "provision": p.label(), "citation": doc.citation(s)}


def provisions_payload(doc: DocText) -> Dict[str, Any]:
    ps = provisions(doc)
    authorities = sorted({m.group(1).strip() for s in doc.sentences for m in AUTHORITY_RE.finditer(s.text)})
    return {"doc_id": doc.doc_id, "title": doc.title, "filename": doc.filename,
            "authorities_mentioned": authorities,
            "provisions": [{"id": p.pid, "ref": p.ref, "title": p.title, "label": p.label(), "page": p.page,
                            "counts": {k: sum(1 for s in p.sentences if k in p.classes.get(s.index, []))
                                       for k in CLASSES},
                            "sentences": [_sentence_out(doc, p, s) for s in p.sentences],
                            "references": sorted({f"{m.group('kind').rstrip('.').capitalize()} {m.group('num')}"
                                                  for s in p.sentences for m in XREF_RE.finditer(s.text)} - {p.ref})}
                           for p in ps]}


def facts_in(question: str) -> List[Dict[str, str]]:
    q = question.lower()
    return [{"key": k, "label": label} for k, (label, pat) in FACTS.items() if re.search(pat, q)]


def _jurisdictions(meta: Dict[str, Dict[str, Any]], doc_ids: Sequence[str]) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = defaultdict(list)
    for d in doc_ids:
        j = (meta.get(d) or {}).get("jurisdiction")
        out[j or ""].append(d)
    return out


def analyse_question(kb, docs: Dict[str, DocText], meta: Dict[str, Dict[str, Any]], question: str,
                     jurisdiction: Optional[str] = None, topic: Optional[str] = None) -> Dict[str, Any]:
    facts = facts_in(question + " " + (topic or ""))
    by_j = _jurisdictions(meta, list(docs))
    named = {j for j in by_j if j}
    clarifications: List[str] = []
    want = (jurisdiction or "").strip().lower()
    used_j = next((j for j in named if j.lower() == want), None) if want else None
    if want and used_j is None:
        # an explicit jurisdiction the sources don't cover never widens to other jurisdictions' laws
        clarifications.append(f"No sources in this workspace are tagged with the jurisdiction “{jurisdiction}”. "
                              f"Available: {', '.join(sorted(named)) or 'none tagged yet'}.")
        return _empty(question, facts, clarifications, None,
                      f"None of the sources in this workspace cover “{jurisdiction}”, so no provisions can be suggested "
                      "for it. Upload the official texts for that jurisdiction, or choose one your sources cover.")
    if used_j is None:
        q = question.lower()
        hits = [j for j in named if re.sub(r"\s*\(.*\)$", "", j).lower() in q]
        if len(hits) == 1:
            used_j = hits[0]
        elif len(named) > 1:
            clarifications.append(f"Which jurisdiction applies? Your sources cover: {', '.join(sorted(named))}.")
        elif len(named) == 1:
            clarifications.append(f"Is your situation governed by {next(iter(named))}? That is the only jurisdiction your "
                                  "sources cover; if another applies, these results may not, so upload its official texts.")
        else:
            clarifications.append("None of your sources is tagged with a jurisdiction. Tag them on the Documents tab so "
                                  "results can be scoped to the jurisdiction that applies to you.")
    scope_ids = list(by_j.get(used_j, [])) + (list(by_j.get("", [])) if used_j else []) if used_j else list(docs)
    if not facts:
        clarifications.append("Describe the activity in more detail (for example: what data you collect, whether you "
                              "take payments, where your customers are, how many people you employ).")
    if not scope_ids:
        return _empty(question, facts, clarifications, used_j, "No sources match the selected jurisdiction.")

    # retrieval: hybrid search over the scoped sources + overlap with the question's content terms
    query = question if not facts else f"{question} {' '.join(f['label'] for f in facts)}"
    hits = kb.retriever.search(query, k=16, doc_ids=scope_ids, pool=40)
    chunk_score = {h["chunk_id"]: float(h.get("score") or 0) for h in hits}
    terms = set(content_terms(question)) | {t for f in facts for t in content_terms(f["label"])}

    laws = []
    for did in scope_ids:
        doc = docs[did]
        ps = provisions(doc)
        scored: List[Tuple[float, Provision]] = []
        shared_terms: Dict[str, set] = {}
        for p in ps:
            cites = [doc.citation(s) for s in p.sentences]
            retr = max((chunk_score.get(c["chunk_id"], 0.0) for c in cites if c["chunk_id"]), default=0.0)
            words = set(content_terms(" ".join(s.text for s in p.sentences)))
            shared = words & terms
            overlap = len(shared) / max(1, len(terms))
            score = 0.6 * retr + 0.4 * overlap
            # retrieval scores are relative within the workspace, so a provision must also share wording with the
            # question; otherwise a small library would surface unrelated sources
            if shared and score > 0.12 and any(c in ("obligation", "prohibition", "scope", "exemption", "penalty", "condition")
                                               for cls in p.classes.values() for c in cls):
                scored.append((score, p))
                shared_terms[p.ref] = shared
        if not scored:
            continue
        scored.sort(key=lambda x: -x[0])
        top = [p for _, p in scored[:6]]
        scope_ps = [p for p in ps if any("scope" in p.classes.get(s.index, []) for s in p.sentences)]
        for p in scope_ps:
            if p not in top:
                top.insert(0, p)

        def collect(cls: str, among: Sequence[Provision]) -> List[Dict[str, Any]]:
            return [_sentence_out(doc, p, s) for p in among for s in p.sentences if cls in p.classes.get(s.index, [])]

        all_ps = ps
        obligations = collect("obligation", top) + collect("prohibition", top)
        scope = collect("scope", scope_ps or top)
        exemptions = collect("exemption", all_ps)
        conditions = [x for x in collect("condition", all_ps) if x not in exemptions]
        penalties = collect("penalty", all_ps)
        deadlines = collect("deadline", top)
        commencement = collect("commencement", all_ps)
        thresholds = []
        for x in exemptions + conditions + scope:
            for m in THRESHOLD_RE.finditer(x["text"]):
                thresholds.append({"phrase": m.group(0).strip(), "provision": x["provision"], "citation": x["citation"]})
        matched_facts = [f for f in facts if any(re.search(FACTS[f["key"]][1], s.text, re.I)
                                                 for p in top for s in p.sentences)]
        m = meta.get(did) or {}
        best = scored[0][0]
        strength = "strong" if best >= 0.45 and len(obligations) >= 2 else "moderate" if best >= 0.25 else "limited"
        mentioned = sorted({a.group(1).strip() for s in doc.sentences for a in AUTHORITY_RE.finditer(s.text)})
        why = []
        if matched_facts:
            why.append("Your question mentions: " + ", ".join(f["label"].lower() for f in matched_facts) + ".")
        if scope:
            why.append(f"{scope[0]['provision']} sets out who it covers: “{scope[0]['text']}”")
        if not why:
            best_p = scored[0][1]
            why.append(f"{best_p.label()} uses wording from your question: "
                       f"{', '.join(sorted(shared_terms.get(best_p.ref, set()))[:6])}.")
        limitations = ["Based only on the text of this document as uploaded; later amendments are not reflected."]
        if not m.get("effective_date"):
            limitations.append("Effective date not entered for this source." +
                               (f" The text says: “{commencement[0]['text']}”" if commencement else ""))
        if not m.get("verified_at"):
            limitations.append("Not marked as verified against the official current text.")
        laws.append({
            "doc_id": did, "law": doc.title, "filename": doc.filename,
            "jurisdiction": m.get("jurisdiction"), "authority": m.get("authority"),
            "authorities_mentioned": mentioned, "effective_date": m.get("effective_date"),
            "source_url": m.get("source_url"), "verified_at": m.get("verified_at"), "is_sample": bool(m.get("is_sample")),
            "applicability": "potential", "why": why, "matched_facts": matched_facts,
            "provisions": [{"ref": p.ref, "label": p.label(), "page": p.page} for p in top],
            "scope": scope[:4], "obligations": obligations[:10], "deadlines": deadlines[:6],
            "exceptions": exemptions[:6], "conditions": conditions[:6], "penalties": penalties[:6],
            "facts_to_confirm": thresholds[:8], "evidence_strength": strength, "score": round(best, 3),
            "limitations": limitations,
        })
    laws.sort(key=lambda x: -x["score"])
    if not laws:
        return _empty(question, facts, clarifications, used_j,
                      "No provisions in the available sources match this question. The workspace may not contain "
                      "the relevant laws — upload the official texts that cover your situation.")
    return {"question": question, "facts": facts, "jurisdiction": used_j, "clarifications": clarifications,
            "laws": laws, "sources_considered": len(scope_ids), "disclaimer": DISCLAIMER,
            "status_note": "Every law is marked as potentially applicable. Applicability depends on facts Paheli "
                           "cannot verify — confirm the listed conditions and thresholds before relying on it."}


def _empty(question, facts, clarifications, used_j, message) -> Dict[str, Any]:
    return {"question": question, "facts": facts, "jurisdiction": used_j, "clarifications": clarifications,
            "laws": [], "sources_considered": 0, "message": message, "disclaimer": DISCLAIMER}


def legal_graph(docs: Dict[str, DocText]) -> Dict[str, Any]:
    """Laws, provisions, defined terms and authorities, linked only where a sentence supports it."""
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: Dict[str, Dict[str, Any]] = {}

    def node(nid, name, ntype, community=None):
        return nodes.setdefault(nid, {"id": nid, "name": name, "type": ntype, "community": community, "degree": 0,
                                      "mentions": 0, "doc_count": 1, "detail": {}})

    def edge(src, dst, pred, doc: DocText, s: Sentence):
        eid = f"{src}>{pred}>{dst}"
        e = edges.setdefault(eid, {"id": eid, "source": src, "target": dst, "predicate": pred, "evidence_count": 0,
                                   "doc_count": 1, "cross_topic": False, "methods": "text", "evidence": []})
        e["evidence_count"] += 1
        if len(e["evidence"]) < 4:
            e["evidence"].append(doc.citation(s))

    titles = {did: d.title for did, d in docs.items()}
    topics = []
    for i, (did, doc) in enumerate(docs.items()):
        tid = f"law:{did}"
        node(tid, doc.title, "Law", tid)
        topics.append({"id": tid, "label": doc.title, "summary": doc.filename, "keywords": [], "size": 0,
                       "doc_ids": [did], "evidence_chunk_ids": [], "method": "extractive", "color_index": i,
                       "top_entities": []})
        ps = provisions(doc)
        refs = {p.ref.lower(): p for p in ps}
        for p in ps:
            pn = node(p.pid, p.label(), "Provision", tid)
            pn["mentions"] = len(p.sentences)
            pn["detail"] = {k: sum(1 for s in p.sentences if k in p.classes.get(s.index, [])) for k in CLASSES}
            if p.sentences:
                edge(tid, p.pid, "contains", doc, p.sentences[0])
            for s in p.sentences:
                cls = p.classes.get(s.index, [])
                for m in XREF_RE.finditer(s.text):
                    kind = m.group("kind").rstrip(".").capitalize()
                    kind = {"Sec": "Section", "Art": "Article", "§": "Section"}.get(kind, kind)
                    target = refs.get(f"{kind} {m.group('num')}".lower())
                    if target and target is not p:
                        pred = ("exempts from" if "exemption" in cls else "penalises breach of" if "penalty" in cls
                                else "references")
                        edge(p.pid, target.pid, pred, doc, s)
                for m in re.finditer(r"[\"“]([^\"”]{2,60})[\"”]\s+(?:means|includes|refers to)\b", s.text):
                    term = m.group(1).strip()
                    tn = node(f"term:{did}:{term.lower()}", term, "Defined term", tid)
                    tn["mentions"] += 1
                    edge(p.pid, tn["id"], "defines", doc, s)
                for m in AUTHORITY_RE.finditer(s.text):
                    a = m.group(1).strip()
                    an = node(f"auth:{a.lower()}", a, "Authority")
                    an["mentions"] += 1
                    edge(p.pid, an["id"], "names authority", doc, s)
                for odid, otitle in titles.items():
                    if odid != did and otitle and otitle.lower() in s.text.lower():
                        node(f"law:{odid}", otitle, "Law", f"law:{odid}")
                        edge(p.pid, f"law:{odid}", "cross-refers to", doc, s)
    for e in edges.values():
        nodes[e["source"]]["degree"] += 1
        nodes[e["target"]]["degree"] += 1
    for t in topics:
        members = [n for n in nodes.values() if n["community"] == t["id"]]
        t["size"] = len(members)
        t["top_entities"] = [{"id": n["id"], "name": n["name"], "type": n["type"], "community": t["id"]}
                             for n in sorted(members, key=lambda n: -n["degree"])[:6]]
    return {"version": len(edges), "nodes": list(nodes.values()), "edges": list(edges.values()), "topics": topics,
            "topic_links": [], "truncated": False, "documents": [{"doc_id": d, "filename": x.filename} for d, x in docs.items()]}
