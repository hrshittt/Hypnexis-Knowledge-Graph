"""
Placement knowledge graph — built from imported records, never from inference.

Nodes: companies, departments, academic years, and (only for members allowed to see
student-level data, capped) students. Edges exist only where records support them:
  company —recruited in→ year            ≥1 record in that cycle
  company —made offers to→ department    ≥1 full-time offer (incl. PPOs) to that department
  company —hosted interns from→ dept     ≥1 internship taken by that department's students
  student —belongs to→ department        roster / record department
  student —received offer from→ company  full-time offer (incl. PPO)
  student —interned at→ company          internship taken
Industries act as the colour communities. The payload matches /api/kb/graph so the same
graph view renders it; every edge carries the counts behind it.
"""

from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

from backend.placement import metrics as M


def placement_graph(ds: M.Dataset, year: Optional[str] = None, include_students: bool = False,
                    student_limit: int = 250) -> Dict[str, Any]:
    rows = [a for a in ds.apps if year is None or a["academic_year"] == year]
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: Dict[str, Dict[str, Any]] = {}

    industries = Counter()
    co_industry: Dict[str, Optional[str]] = {}
    for a in rows:
        if a.get("industry"):
            co_industry.setdefault(a["company_norm"], a["industry"])
    for ind in co_industry.values():
        industries[ind] += 1
    topic_ids = {ind: f"ind:{i}" for i, (ind, _) in enumerate(industries.most_common())}

    def node(nid: str, name: str, ntype: str, community: Optional[str] = None) -> Dict[str, Any]:
        n = nodes.get(nid)
        if n is None:
            n = nodes[nid] = {"id": nid, "name": name, "type": ntype, "community": community, "degree": 0,
                              "mentions": 0, "doc_count": 0, "detail": {}}
        return n

    def edge(src: str, dst: str, predicate: str) -> Dict[str, Any]:
        eid = f"{src}>{predicate}>{dst}"
        e = edges.get(eid)
        if e is None:
            e = edges[eid] = {"id": eid, "source": src, "target": dst, "predicate": predicate, "evidence_count": 0,
                              "doc_count": 1, "cross_topic": False, "methods": "records", "detail": Counter()}
        return e

    offers = {id(a): st for a, st in ds.ft_offers(rows)}
    co_years: Dict[str, set] = defaultdict(set)
    for a in rows:
        cn = a["company_norm"]
        c = node(f"co:{cn}", ds.company_name.get(cn, a["company"]), "Company",
                 topic_ids.get(co_industry.get(cn)) if co_industry.get(cn) else None)
        c["mentions"] += 1
        co_years[cn].add(a["academic_year"])
        dept = ds.department(a)
        d = node(f"dept:{dept}", dept, "Department")
        d["mentions"] += 1
        y = node(f"year:{a['academic_year']}", a["academic_year"], "Academic year")
        y["mentions"] += 1
        e = edge(c["id"], y["id"], "recruited in")
        e["evidence_count"] += 1
        e["detail"]["records"] += 1
        if id(a) in offers:
            e["detail"]["offers"] += 1
            o = edge(c["id"], d["id"], "made offers to")
            o["evidence_count"] += 1
            o["detail"]["offers"] += 1
            o["detail"][f"offers {a['academic_year']}"] += 1
        if ds.intern_taken(a):
            i = edge(c["id"], d["id"], "hosted interns from")
            i["evidence_count"] += 1
            i["detail"]["interns"] += 1
            if ds.ppo_outcome(a) in ("offered", "accepted", "declined"):
                i["detail"]["ppos"] += 1

    truncated = False
    if include_students:
        sids = Counter(a["student_id"] for a in rows if id(a) in offers or ds.intern_taken(a))
        keep = {s for s, _ in sids.most_common(student_limit)}
        truncated = len(sids) > student_limit
        for a in rows:
            sid = a["student_id"]
            if sid not in keep:
                continue
            s = node(f"st:{sid}", sid, "Student")
            s["mentions"] += 1
            dept = ds.department(a)
            edge(s["id"], f"dept:{dept}", "belongs to")["evidence_count"] = 1
            if id(a) in offers:
                e = edge(s["id"], f"co:{a['company_norm']}", "received offer from")
                e["evidence_count"] += 1
                e["detail"][offers[id(a)]] += 1
            elif ds.intern_taken(a):
                e = edge(s["id"], f"co:{a['company_norm']}", "interned at")
                e["evidence_count"] += 1
                e["detail"][f"PPO {ds.ppo_outcome(a)}"] += 1

    for e in edges.values():
        nodes[e["source"]]["degree"] += 1
        nodes[e["target"]]["degree"] += 1
        e["detail"] = dict(e["detail"])
    for cn, ys in co_years.items():
        nodes[f"co:{cn}"]["doc_count"] = len(ys)
        nodes[f"co:{cn}"]["detail"] = {"cycles": sorted(ys)}

    topics = []
    for i, (ind, n) in enumerate(industries.most_common()):
        tid = topic_ids[ind]
        members = [nd for nd in nodes.values() if nd["community"] == tid]
        topics.append({"id": tid, "label": ind, "summary": f"{n} compan{'y' if n == 1 else 'ies'} in {ind}.",
                       "keywords": [], "size": n, "doc_ids": [], "evidence_chunk_ids": [], "method": "extractive",
                       "color_index": i,
                       "top_entities": [{"id": m["id"], "name": m["name"], "type": m["type"], "community": tid}
                                        for m in sorted(members, key=lambda m: -m["mentions"])[:6]]})
    return {"version": len(ds.apps), "nodes": list(nodes.values()), "edges": list(edges.values()),
            "topics": topics, "topic_links": [], "truncated": truncated, "documents": [],
            "scope": {"academic_year": year, "students": include_students, "student_limit": student_limit}}
