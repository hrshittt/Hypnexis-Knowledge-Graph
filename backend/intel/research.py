"""
Research paper analysis — structure and key content, quoted from the paper itself.

Each field (problem, objectives, methodology, dataset, findings, limitations, future work,
references, …) is filled with sentences taken from the matching section when the paper has
one, otherwise from sentences with typical cue phrases. Every item carries its page and a
citation. A field with nothing found says so; nothing is paraphrased or invented. Authors and
year come from the lines under the title and are marked as heuristic.
"""

import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from backend.intel.common import DocText, Sentence

SECTIONS: Dict[str, Tuple[str, ...]] = {
    "abstract": ("abstract", "summary", "executive summary"),
    "introduction": ("introduction", "background", "motivation", "overview"),
    "objectives": ("objectives", "objective", "aims", "aim", "research questions", "contributions", "contribution"),
    "methodology": ("methods", "method", "methodology", "approach", "study design", "materials and methods",
                    "experimental setup", "model", "empirical strategy", "research design"),
    "data": ("data", "dataset", "datasets", "data sources", "data and sample", "participants", "sample"),
    "results": ("results", "findings", "evaluation", "experiments", "empirical results"),
    "discussion": ("discussion",),
    "limitations": ("limitations", "limitation", "threats to validity", "caveats"),
    "future_work": ("future work", "future research", "further work", "next steps"),
    "conclusion": ("conclusion", "conclusions", "concluding remarks", "recommendations"),
    "references": ("references", "bibliography", "works cited", "literature cited"),
}

CUES: Dict[str, str] = {
    "research_problem": r"\b(?:this (?:paper|study|work|article) (?:addresses|investigates|examines|asks|studies|explores)|"
                        r"we (?:address|investigate|examine|ask|study|explore) (?:whether|how|the)|the problem of|"
                        r"research question|has not been (?:studied|examined|measured)|remains? (?:unclear|unknown|open)|"
                        r"\bgap in\b|need(?:s)? (?:storage|methods|evidence|data)|little is known)",
    "objectives": r"\b(?:we propose|we present|we introduce|we estimate|we report|we develop|we evaluate|"
                  r"this (?:paper|study) (?:presents|proposes|reports|estimates)|our contribution|contributions? (?:is|are)|"
                  r"the (?:aim|goal|objective|purpose) (?:of|is)|aims? to|we aim)\b",
    "methodology": r"\b(?:we (?:use|apply|employ|train|fit|estimate|model|run|compare|simulate|cluster)|"
                   r"(?:model|design|specification|regression|estimator|algorithm|framework) (?:with|that|to)|"
                   r"fixed effects|clustered|cross-validation)\b",
    "data": r"\b(?:dataset|data set|data (?:were|was) collected|records|corpus|benchmark|participants|sample of|"
            r"telemetry|survey(?:ed)?|observations|admissions|readings come from|data come from)\b",
    "findings": r"\b(?:we find|we found|found that|results (?:show|suggest|indicate)|(?:fell|rose|increased|decreased|"
                r"dropped|declined|improved) by|outperform\w*|significant(?:ly)?|retained|show that|evidence that)\b",
    "limitations": r"\b(?:limitation|limited (?:by|to)|do(?:es)? not capture|may differ|uncertain|only covers|covers only|"
                   r"short relative|single (?:site|supplier|study)|caveat|cannot rule out|bias)\b",
    "future_work": r"\b(?:future (?:work|research|studies)|further research|should extend|will extend|remains to be|"
                   r"next step)\b",
}
# field → sections to look in, in order; True = the section is the field's own and is taken whole,
# False = only sentences with the field's typical wording are taken from it
FIELD_SECTIONS: Dict[str, Tuple[Tuple[str, bool], ...]] = {
    "abstract": (("abstract", True),),
    "research_problem": (("introduction", False), ("objectives", False), ("abstract", False)),
    "objectives": (("objectives", True), ("introduction", False), ("abstract", False)),
    "methodology": (("methodology", True),),
    "data": (("data", True),),
    "findings": (("results", True), ("conclusion", False), ("discussion", False), ("abstract", False)),
    "limitations": (("limitations", True), ("discussion", False)),
    "future_work": (("future_work", True), ("conclusion", False)),
    "conclusion": (("conclusion", True),),
}
FIELD_LABELS = {
    "abstract": "Abstract", "research_problem": "Research problem", "objectives": "Objectives & contributions",
    "methodology": "Methodology", "data": "Dataset", "techniques": "Models & techniques", "findings": "Key findings",
    "limitations": "Limitations", "future_work": "Future work", "conclusion": "Conclusion", "references": "References",
}
_TECHNIQUE = re.compile(
    r"\b((?:[A-Za-z][\w-]*\s){0,3}?(?:[\w-]+)\s(?:model|design|specification|regression|estimator|algorithm|network|"
    r"framework|analysis|test|method))\b", re.I)
_STOP_LEAD = re.compile(r"^(?:we|a|an|the|this|our|its|their|also|and|to|with|using|use|apply|estimate|run)\s+", re.I)
_INSTITUTION = re.compile(r"\b(?:institute|university|college|center|centre|department|laborator(?:y|ies)|lab|school|"
                          r"hospital|systems|inc|ltd|corporation|foundation)\b", re.I)
_NAME = r"[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?(?:\s[A-Z]\.)?(?:\s[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?){1,2}"
_AUTHORS_LINE = re.compile(rf"^{_NAME}(?:\s*(?:,|and|&)\s*{_NAME})*$")
_YEAR = re.compile(r"(?:published|©|copyright|\()\s*((?:19|20)\d{2})\b|\b((?:19|20)\d{2})\)", re.I)


def _canon_heading(h: str) -> Optional[str]:
    t = re.sub(r"^(?:[ivxlc]+\.|\d+(?:\.\d+)*\.?)\s*", "", h.strip().lower())
    t = re.sub(r"[^a-z ]", "", t).strip()
    for key, names in SECTIONS.items():
        if t in names or any(t.startswith(n + " ") for n in names if len(n) > 4):
            return key
    return None


def _item(doc: DocText, s: Sentence) -> Dict[str, Any]:
    return {"text": s.text, "page": s.page, "citation": doc.citation(s)}


def analyse_paper(doc: DocText) -> Dict[str, Any]:
    by_section: Dict[str, List[Sentence]] = defaultdict(list)
    for s in doc.sentences:
        key = _canon_heading(s.heading) if s.heading else None
        if key:
            by_section[key].append(s)
    fields: Dict[str, Dict[str, Any]] = {}

    def pick(field: str, limit: int = 4) -> None:
        sents: List[Sentence] = []
        method = None
        for sec, whole in FIELD_SECTIONS.get(field, ()):
            if by_section.get(sec):
                cand = by_section[sec]
                if not whole:
                    cand = [s for s in cand if CUES.get(field) and re.search(CUES[field], s.text, re.I)]
                if cand:
                    sents, method = cand, f"section: {cand[0].heading}"
                    break
        if not sents and field in CUES:
            sents = [s for s in doc.sentences if re.search(CUES[field], s.text, re.I)
                     and _canon_heading(s.heading or "") != "references"]
            method = "sentences with typical wording" if sents else None
        fields[field] = {"label": FIELD_LABELS[field], "found": bool(sents), "method": method,
                         "items": [_item(doc, s) for s in sents[:limit]],
                         "note": None if sents else f"No {FIELD_LABELS[field].lower()} found in the paper."}

    pick("abstract", limit=8)
    for f in ("research_problem", "objectives", "methodology", "data", "findings", "limitations", "future_work",
              "conclusion"):
        pick(f)
    method_text = " ".join(i["text"] for i in fields["methodology"]["items"])
    techniques = []
    for m in _TECHNIQUE.finditer(method_text):
        phrase = _STOP_LEAD.sub("", m.group(1).strip())
        phrase = _STOP_LEAD.sub("", phrase)
        if len(phrase.split()) >= 2 and phrase.lower() not in {t.lower() for t in techniques}:
            techniques.append(phrase)
    fields["techniques"] = {"label": FIELD_LABELS["techniques"], "found": bool(techniques),
                            "method": "phrases in the methodology section" if techniques else None,
                            "items": [{"text": t} for t in techniques[:8]],
                            "note": None if techniques else "No named models or techniques found."}
    refs = []
    for pnum, text in doc.pages:
        lines = text.split("\n")
        in_refs = False
        for line in lines:
            if _canon_heading(line) == "references" and len(line) < 40:
                in_refs = True
                continue
            if in_refs and line.strip():
                if _canon_heading(line) and len(line) < 40:
                    break
                refs.append({"text": line.strip(), "page": pnum})
    fields["references"] = {"label": FIELD_LABELS["references"], "found": bool(refs),
                            "method": "lines of the References section" if refs else None, "items": refs[:40],
                            "note": None if refs else "No references section found."}

    # title block: authors, affiliations, year (first page, before the abstract)
    first = doc.pages[0][1] if doc.pages else ""
    head = first.split("\n")[:12]
    authors: List[str] = []
    affiliations: List[str] = []
    for line in head[1:]:
        t = line.strip()
        if not t or _canon_heading(t):
            if authors and _canon_heading(t):
                break
            continue
        if _INSTITUTION.search(t) and len(t) < 160:
            affiliations += [x.strip() for x in t.split(";") if x.strip()]
        elif not authors and _AUTHORS_LINE.match(t) and not re.search(r"\d", t):
            authors = [a.strip() for a in re.split(r"\s*(?:,|\band\b|&)\s*", t) if a.strip()]
    ym = _YEAR.search(first[:1500])
    year = int(ym.group(1) or ym.group(2)) if ym else None
    return {
        "doc_id": doc.doc_id, "filename": doc.filename, "title": doc.title,
        "authors": {"value": authors, "found": bool(authors), "method": "name line under the title (heuristic)",
                    "note": None if authors else "Authors could not be extracted."},
        "affiliations": affiliations[:6],
        "year": {"value": year, "found": year is not None,
                 "note": None if year else "Publication year could not be extracted."},
        "fields": fields,
        "sections_found": sorted(by_section),
        "pages": len(doc.pages),
    }


def doc_vectors(kb, doc_ids: Sequence[str]) -> Dict[str, np.ndarray]:
    out = {}
    for d in doc_ids:
        rows = kb.store.get_chunks(kb.store.chunk_ids_for_docs([d]))
        texts = [r["text"] for r in rows.values()]
        if texts:
            v = np.asarray(kb.embedder.encode(texts)).mean(axis=0)
            n = np.linalg.norm(v)
            out[d] = v / n if n else v
    return out


def doc_entities(kb) -> Dict[str, Dict[str, str]]:
    kb.retriever.refresh()
    ents: Dict[str, Dict[str, str]] = defaultdict(dict)
    for eid, _, did in kb.store.entity_mentions():
        e = kb.retriever.entities.get(eid)
        if e and e["type"] != "Concept":
            ents[did][eid] = e["name"]
        elif e:
            ents[did].setdefault(eid, e["name"])
    return ents


def related_papers(kb, doc_id: str, candidates: Sequence[str]) -> List[Dict[str, Any]]:
    vecs = doc_vectors(kb, [doc_id, *[c for c in candidates if c != doc_id]])
    ents = doc_entities(kb)
    base = vecs.get(doc_id)
    out = []
    for c in candidates:
        if c == doc_id or c not in vecs or base is None:
            continue
        shared = sorted(set(ents.get(doc_id, {})) & set(ents.get(c, {})))
        out.append({"doc_id": c, "similarity": round(float(np.dot(base, vecs[c])), 3),
                    "shared_entities": [{"id": e, "name": ents[c][e]} for e in shared][:12]})
    return sorted(out, key=lambda x: (-len(x["shared_entities"]), -x["similarity"]))


def compare_papers(kb, a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    ents = doc_entities(kb)
    ea, eb = ents.get(a["doc_id"], {}), ents.get(b["doc_id"], {})
    shared = sorted(set(ea) & set(eb))
    rows = []
    for key in ("research_problem", "objectives", "methodology", "data", "techniques", "findings", "limitations",
                "future_work"):
        rows.append({"field": key, "label": FIELD_LABELS[key], "a": a["fields"][key], "b": b["fields"][key]})
    return {"a": {k: a[k] for k in ("doc_id", "filename", "title", "authors", "year")},
            "b": {k: b[k] for k in ("doc_id", "filename", "title", "authors", "year")},
            "rows": rows,
            "shared_entities": [{"id": e, "name": ea[e]} for e in shared],
            "only_a": [{"id": e, "name": ea[e]} for e in sorted(set(ea) - set(eb))][:25],
            "only_b": [{"id": e, "name": eb[e]} for e in sorted(set(eb) - set(ea))][:25],
            "note": "Each column quotes only its own paper. Shared entities are concepts and names extracted from both."}
