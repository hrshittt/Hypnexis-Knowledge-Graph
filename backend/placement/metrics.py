"""
Placement metrics — every number carries its definition, numerator and denominator.

Conventions (shown to users next to each metric)
  - Offers and students are different things: one student can hold several offers.
    "Total offers" counts offers; "students placed" counts distinct students.
  - Unknown outcomes are never failures. A record with no recorded result is reported
    as "unknown" and kept out of rejection and conversion denominators.
  - Full-time offers = full-time rows whose result is offered, accepted or declined, plus
    PPOs (see below). Declined offers were still offers made.
  - Placed (default 'offer_received') = at least one full-time offer that is accepted or
    still awaiting the student's decision; 'offer_accepted' counts accepted offers only.
  - PPOs are read from an internship row's PPO status, or from a separate row whose type
    is PPO. If both exist for the same student and company, the PPO row wins and the offer
    is counted once. PPO conversion belongs to the internship's cycle; the full-time offer
    belongs to the cycle of the row it is recorded on (the PPO row if there is one).
  - Internship-to-PPO conversion = interns who received a PPO ÷ interns whose PPO outcome
    is known (offered, accepted, declined or no offer). Pending and unrecorded outcomes are
    reported separately, never counted as "no PPO".
  - Funnel counts are applications (student × company) by the furthest stage reached.
"""

import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from backend.placement import schema as S

INTERN_TAKEN_STATUSES = frozenset({"not_started", "ongoing", "completed", "terminated"})
ACTIVE_RESULTS = frozenset({"in_process", "awaiting_result"})
PPO_RANK = {"accepted": 6, "offered": 5, "declined": 4, "pending": 3, "no_offer": 2, S.UNKNOWN: 1, None: 0}
INTERN_RANK = {"completed": 5, "ongoing": 4, "not_started": 3, "terminated": 2, S.UNKNOWN: 1, None: 0}

DEFINITIONS = {
    "eligible_students": "Students in the roster marked eligible for this cycle.",
    "registered_students": "Students in the roster marked as registered for placements.",
    "students_placed": "Distinct students with at least one full-time offer (incl. PPOs) that counts as placed under "
                       "your placement policy.",
    "placement_rate": "Placed students in the denominator group ÷ students in that group × 100 "
                      "(group = eligible students by default; configurable).",
    "total_offers": "Full-time offers made (offered, accepted or declined), including PPOs. One student can hold several.",
    "unique_students_with_offers": "Distinct students with at least one full-time offer, whatever its status.",
    "internship_offers": "Internship rows whose result is offered, accepted or declined.",
    "interns": "Internships that took place or are underway (internship status recorded, internship accepted, "
               "or a PPO outcome recorded).",
    "ppo_offers": "PPOs offered (offered, accepted or declined) to this cycle's interns, plus PPO rows with no matching "
                  "internship record; each PPO is counted once.",
    "ppo_conversion_rate": "Interns who received a PPO ÷ interns whose PPO outcome is known × 100. Pending and "
                           "unrecorded outcomes are excluded.",
    "companies_participating": "Distinct companies with at least one record in this cycle.",
    "returning_companies": "Companies in this cycle that also appear in an earlier cycle.",
    "ctc": "Statistics over full-time offers made that have a CTC value (as entered in the source data).",
    "offers_pending_decision": "Full-time offers and PPOs extended and still awaiting the student's decision.",
    "students_awaiting_results": "Distinct students with at least one application whose result is awaited.",
    "active_processes": "Applications still in process (not yet decided).",
}


def _pct(n: int, d: int) -> Optional[float]:
    return round(100.0 * n / d, 1) if d else None


def metric(key: str, value: Any, *, numerator: Optional[int] = None, denominator: Optional[int] = None,
           unit: Optional[str] = None, note: Optional[str] = None, available: bool = True) -> Dict[str, Any]:
    return {"key": key, "value": value if available else None, "numerator": numerator, "denominator": denominator,
            "unit": unit, "definition": DEFINITIONS.get(key, ""), "note": note, "available": available}


@dataclass
class Dataset:
    students: List[Dict[str, Any]]
    apps: List[Dict[str, Any]]
    config: Dict[str, Any]
    today: date = field(default_factory=lambda: datetime.now().date())

    def __post_init__(self):
        self.years: List[str] = sorted({a["academic_year"] for a in self.apps} | {s["academic_year"] for s in self.students},
                                       key=S.year_start)
        self.stages: List[Dict[str, Any]] = self.config.get("stages") or S.DEFAULT_STAGES
        self.roster: Dict[Tuple[str, str], Dict[str, Any]] = {(s["academic_year"], s["student_id"]): s for s in self.students}
        self.by_year: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for a in self.apps:
            self.by_year[a["academic_year"]].append(a)
        # PPO rows (type = PPO) win over the PPO status on an internship row for the same student + company
        self.ppo_rows: Dict[Tuple[str, str], str] = {}
        for a in self.apps:
            if a["opportunity_type"] == "full_time" and a["is_ppo"]:
                k = (a["student_id"], a["company_norm"])
                if PPO_RANK.get(a["result"], 0) >= PPO_RANK.get(self.ppo_rows.get(k), 0):
                    self.ppo_rows[k] = a["result"]
        names: Dict[str, Counter] = defaultdict(Counter)
        for a in self.apps:
            names[a["company_norm"]][a["company"]] += 1
        self.company_name = {k: c.most_common(1)[0][0] for k, c in names.items()}

    # ── per-record helpers ───────────────────────────────────────────────────
    def cycle(self, year: str) -> Dict[str, Any]:
        conf = (self.config.get("cycles") or {}).get(year) or {}
        status = conf.get("status") if conf.get("status") in ("ongoing", "completed") else None
        return {"academic_year": year,
                "status": status or S.default_cycle_status(year, self.today),
                "status_source": "configured" if status else "default",
                "start_date": conf.get("start_date") or S.default_cycle_start(year)}

    def department(self, a: Dict[str, Any]) -> str:
        s = self.roster.get((a["academic_year"], a["student_id"]))
        return (s and s.get("department")) or a.get("department") or "Unspecified"

    def ppo_outcome(self, a: Dict[str, Any]) -> str:
        """offered | accepted | declined | no_offer | pending | unknown — for an internship row."""
        twin = self.ppo_rows.get((a["student_id"], a["company_norm"]))
        if twin in S.OFFER_RESULTS:
            return twin
        st = a.get("ppo_status")
        return st if st in S.PPO_STATUSES else S.UNKNOWN

    def has_ppo_row(self, a: Dict[str, Any]) -> bool:
        return (a["student_id"], a["company_norm"]) in self.ppo_rows

    def intern_taken(self, a: Dict[str, Any]) -> bool:
        return a["opportunity_type"] == "internship" and (
            a.get("internship_status") in INTERN_TAKEN_STATUSES or a["result"] == "accepted"
            or a.get("ppo_status") not in (None, S.UNKNOWN))

    def ft_offers(self, rows: Iterable[Dict[str, Any]]) -> List[Tuple[Dict[str, Any], str]]:
        """(row, offer status) for every full-time offer incl. PPOs, each offer once."""
        out = []
        for a in rows:
            if a["opportunity_type"] == "full_time" and a["result"] in S.OFFER_RESULTS:
                out.append((a, a["result"]))
            elif a["opportunity_type"] == "internship" and not self.has_ppo_row(a):
                o = self.ppo_outcome(a)
                if o in S.PPO_RECEIVED:
                    out.append((a, o))
        return out

    def counts_as_placed(self, status: str, via_ppo: bool) -> bool:
        if via_ppo and not self.config.get("count_ppo_as_placement", True):
            return False
        if self.config.get("placed_definition") == "offer_accepted":
            return status == "accepted"
        return status in S.OPEN_OR_ACCEPTED

    def placed_students(self, year: str) -> Set[str]:
        out = set()
        for a, st in self.ft_offers(self.by_year.get(year, [])):
            via_ppo = a["opportunity_type"] == "internship" or bool(a["is_ppo"])
            if self.counts_as_placed(st, via_ppo):
                out.add(a["student_id"])
        return out

    def denominator_group(self, year: str) -> Tuple[str, List[Dict[str, Any]]]:
        which = self.config.get("placement_denominator", "eligible")
        field_ = "registered" if which == "registered" else "eligible"
        return field_, [s for s in self.students if s["academic_year"] == year and s.get(field_) == 1]


# ═════════════════════════════════════════════════════════════════════════════
# Year overview
# ═════════════════════════════════════════════════════════════════════════════

def year_metrics(ds: Dataset, year: str) -> Dict[str, Any]:
    rows = ds.by_year.get(year, [])
    roster = [s for s in ds.students if s["academic_year"] == year]
    eligible = [s for s in roster if s.get("eligible") == 1]
    registered = [s for s in roster if s.get("registered") == 1]
    placed = ds.placed_students(year)
    group_name, group = ds.denominator_group(year)
    group_ids = {s["student_id"] for s in group}
    placed_in_group = placed & group_ids
    roster_ids = {s["student_id"] for s in roster}

    offers = ds.ft_offers(rows)
    offer_students = {a["student_id"] for a, _ in offers}
    interns = [a for a in rows if ds.intern_taken(a)]
    ppo = [ds.ppo_outcome(a) for a in interns]
    ppo_known = [o for o in ppo if o in S.PPO_KNOWN]
    ppo_received = [o for o in ppo if o in S.PPO_RECEIVED]
    # PPO rows whose internship isn't in the data still count as PPO offers
    intern_pairs = {(a["student_id"], a["company_norm"]) for a in ds.apps if a["opportunity_type"] == "internship"}
    orphan_ppo = [a for a in rows if a["opportunity_type"] == "full_time" and a["is_ppo"]
                  and a["result"] in S.OFFER_RESULTS and (a["student_id"], a["company_norm"]) not in intern_pairs]
    intern_offers = [a for a in rows if a["opportunity_type"] == "internship" and a["result"] in S.OFFER_RESULTS]

    earlier = {a["company_norm"] for y in ds.years if S.year_start(y) < S.year_start(year) for a in ds.by_year.get(y, [])}
    companies = {a["company_norm"] for a in rows}
    returning = companies & earlier

    ctcs = [a["ctc"] for a, _ in offers if a["opportunity_type"] == "full_time" and a.get("ctc")]
    unit = ds.config.get("ctc_unit") or ""
    pending_decision = [1 for _, st in offers if st == "offered"]
    awaiting = {a["student_id"] for a in rows if a["result"] == "awaiting_result"}
    active = [a for a in rows if a["result"] == "in_process"]
    hiring_open = {a["company_norm"] for a in rows if a["result"] in ACTIVE_RESULTS}
    unknown_outcomes = sum(1 for a in rows if a["result"] == S.UNKNOWN)

    rate_note = None
    if not roster:
        rate_note = "No student roster imported for this cycle — import one to compute placement rates."
    elif not group:
        rate_note = f"No roster students are marked {group_name}."
    placed_outside = placed - group_ids if roster else set()

    k = [
        metric("eligible_students", len(eligible), available=bool(roster),
               note=None if roster else "Import a student roster for this cycle."),
        metric("registered_students", len(registered), available=bool(roster)),
        metric("students_placed", len(placed),
               note=f"{len(placed_outside)} placed student(s) are not in the {group_name} group."
               if placed_outside else None),
        metric("placement_rate", _pct(len(placed_in_group), len(group)), numerator=len(placed_in_group),
               denominator=len(group), unit="%", available=bool(group), note=rate_note),
        metric("total_offers", len(offers)),
        metric("unique_students_with_offers", len(offer_students)),
        metric("internship_offers", len(intern_offers)),
        metric("interns", len(interns)),
        metric("ppo_offers", len(ppo_received) + len(orphan_ppo)),
        metric("ppo_conversion_rate", _pct(len(ppo_received), len(ppo_known)), numerator=len(ppo_received),
               denominator=len(ppo_known), unit="%", available=bool(ppo_known),
               note=f"{ppo.count('pending')} pending and {ppo.count(S.UNKNOWN)} unrecorded PPO outcome(s) excluded."
               if interns else "No internships recorded for this cycle."),
        metric("companies_participating", len(companies)),
        metric("returning_companies", len(returning), numerator=len(returning), denominator=len(companies),
               note=None if earlier else "No earlier cycle in the data to compare with."),
        metric("ctc_average", round(statistics.mean(ctcs), 2) if ctcs else None, unit=unit, available=bool(ctcs),
               denominator=len(ctcs), note=None if ctcs else "No CTC values recorded."),
        metric("ctc_median", round(statistics.median(ctcs), 2) if ctcs else None, unit=unit, available=bool(ctcs),
               denominator=len(ctcs)),
        metric("ctc_highest", max(ctcs) if ctcs else None, unit=unit, available=bool(ctcs), denominator=len(ctcs),
               note="Highest full-time CTC offered in this cycle, as entered in the source data." if ctcs else None),
        metric("offers_pending_decision", len(pending_decision)),
        metric("students_awaiting_results", len(awaiting)),
        metric("active_processes", len(active), note=f"{len(hiring_open)} companies still have open processes."),
    ]
    for m in k:
        if m["key"].startswith("ctc_"):
            m["definition"] = DEFINITIONS["ctc"]
    return {
        "cycle": ds.cycle(year),
        "kpis": {m["key"]: m for m in k},
        "data_quality": {
            "records": len(rows), "roster_students": len(roster),
            "unknown_outcomes": unknown_outcomes,
            "students_not_in_roster": len({a["student_id"] for a in rows} - roster_ids) if roster else None,
            "dated_offers": sum(1 for a, _ in offers if a.get("offer_on") or a.get("result_on")),
            "offers": len(offers),
        },
        "policy": {"denominator": group_name, "placed_definition": ds.config.get("placed_definition", "offer_received"),
                   "count_ppo_as_placement": ds.config.get("count_ppo_as_placement", True)},
    }


def year_comparison(ds: Dataset) -> Dict[str, Any]:
    out = []
    for y in ds.years:
        m = year_metrics(ds, y)
        out.append({"academic_year": y, "cycle": m["cycle"],
                    **{k: m["kpis"][k]["value"] for k in ("placement_rate", "students_placed", "total_offers",
                                                           "unique_students_with_offers", "internship_offers",
                                                           "ppo_offers", "ppo_conversion_rate",
                                                           "companies_participating", "returning_companies",
                                                           "ctc_average", "ctc_median", "eligible_students")}})
    ongoing = [r["academic_year"] for r in out if r["cycle"]["status"] == "ongoing"]
    return {"years": out, "ongoing": ongoing,
            "note": ("Ongoing cycles are still in progress: their totals are partial and not directly comparable "
                     "with completed cycles. Use the equivalent-date comparison for a like-for-like view.")
            if ongoing else None}


# ═════════════════════════════════════════════════════════════════════════════
# Departments, funnel, PPO, companies, students
# ═════════════════════════════════════════════════════════════════════════════

def department_breakdown(ds: Dataset, year: str) -> List[Dict[str, Any]]:
    rows = ds.by_year.get(year, [])
    placed = ds.placed_students(year)
    group_name, group = ds.denominator_group(year)
    roster = [s for s in ds.students if s["academic_year"] == year]
    active_students = {a["student_id"] for a in rows if a["result"] in ACTIVE_RESULTS}
    offers_by_dept: Counter = Counter(ds.department(a) for a, _ in ds.ft_offers(rows))
    depts: Dict[str, Dict[str, Any]] = {}
    for s in roster:
        d = s.get("department") or "Unspecified"
        x = depts.setdefault(d, {"department": d, "roster": 0, "group": 0, "placed": 0, "unplaced": 0,
                                 "in_process": 0, "offers": 0})
        x["roster"] += 1
        if s.get(group_name) == 1:
            x["group"] += 1
            if s["student_id"] in placed:
                x["placed"] += 1
            else:
                x["unplaced"] += 1
                if s["student_id"] in active_students:
                    x["in_process"] += 1
    for d, n in offers_by_dept.items():
        depts.setdefault(d, {"department": d, "roster": 0, "group": 0, "placed": 0, "unplaced": 0,
                             "in_process": 0, "offers": 0})["offers"] = n
    out = []
    for x in depts.values():
        x["placement_rate"] = _pct(x["placed"], x["group"])
        x["denominator"] = group_name
        out.append(x)
    return sorted(out, key=lambda x: (-x["group"], x["department"]))


def department_trends(ds: Dataset) -> List[Dict[str, Any]]:
    """Placement rate by department across completed cycles (ongoing cycles excluded)."""
    completed = [y for y in ds.years if ds.cycle(y)["status"] == "completed"]
    series: Dict[str, Dict[str, Optional[float]]] = defaultdict(dict)
    for y in completed:
        for d in department_breakdown(ds, y):
            series[d["department"]][y] = d["placement_rate"]
    out = []
    for dept, by in series.items():
        pts = [(y, by[y]) for y in completed if by.get(y) is not None]
        change = round(pts[-1][1] - pts[0][1], 1) if len(pts) >= 2 else None
        out.append({"department": dept, "rates": by, "change": change,
                    "from_year": pts[0][0] if len(pts) >= 2 else None, "to_year": pts[-1][0] if len(pts) >= 2 else None})
    return sorted(out, key=lambda x: (x["change"] is None, -(x["change"] or 0)))


def funnel(ds: Dataset, year: str, opportunity_type: str = "full_time", company_norm: Optional[str] = None) -> Dict[str, Any]:
    rows = [a for a in ds.by_year.get(year, []) if a["opportunity_type"] == opportunity_type
            and (company_norm is None or a["company_norm"] == company_norm)]
    staged = [a for a in rows if a.get("stage_index") is not None]
    stages = ds.stages
    # a stage no record (in any cycle) ever reached isn't tracked by this institution's data
    deepest = max((a["stage_index"] for a in ds.apps if a.get("stage_index") is not None
                   and a["opportunity_type"] == opportunity_type), default=-1)
    out = []
    for i, st in enumerate(stages):
        reached = sum(1 for a in staged if a["stage_index"] >= i)
        at = [a for a in staged if a["stage_index"] == i]
        rejected = sum(1 for a in at if a["result"] == "rejected")
        withdrawn = sum(1 for a in at if a["result"] == "withdrawn")
        pending = sum(1 for a in at if a["result"] in ACTIVE_RESULTS)
        unknown = sum(1 for a in at if a["result"] == S.UNKNOWN)
        nxt = sum(1 for a in staged if a["stage_index"] > i)
        out.append({"key": st["key"], "label": st["label"], "tracked": i <= deepest, "reached": reached,
                    "progressed": nxt, "rejected": rejected, "withdrawn": withdrawn, "pending": pending, "unknown": unknown,
                    "conversion_to_next": _pct(nxt, reached) if i < len(stages) - 1 and i + 1 <= deepest else None,
                    "rejection_rate": _pct(rejected, reached - unknown) if reached - unknown > 0 else None,
                    "drop_off": rejected + withdrawn})
    worst = max((s for s in out if s["reached"]), key=lambda s: (s["drop_off"], s["reached"]), default=None)
    highest_rejection = max((s for s in out if s["rejection_rate"] is not None), key=lambda s: s["rejection_rate"],
                            default=None)
    return {"academic_year": year, "opportunity_type": opportunity_type, "stages": out,
            "applications": len(rows), "without_stage": len(rows) - len(staged),
            "largest_drop_off": worst["key"] if worst and worst["drop_off"] else None,
            "highest_rejection_rate": highest_rejection["key"] if highest_rejection else None,
            "note": "Counts are applications (one student may apply to several companies), by the furthest stage "
                    "reached. Rejection rates exclude applications whose outcome is unknown.",
            "stage_durations": {"available": False,
                                "note": "Time spent in each stage needs per-stage dates; the current import format "
                                        "records only the furthest stage reached."}}


def ppo_breakdown(ds: Dataset, by: str = "company", year: Optional[str] = None) -> List[Dict[str, Any]]:
    groups: Dict[str, Counter] = defaultdict(Counter)
    for a in ds.apps:
        if year and a["academic_year"] != year:
            continue
        if not ds.intern_taken(a):
            continue
        key = {"company": ds.company_name.get(a["company_norm"], a["company"]), "department": ds.department(a),
               "year": a["academic_year"]}[by]
        o = ds.ppo_outcome(a)
        c = groups[key]
        c["interns"] += 1
        c[o] += 1
        if a.get("internship_status") == "completed":
            c["completed"] += 1
        if a.get("internship_status") in ("ongoing", "completed", "terminated"):
            c["started"] += 1
    out = []
    for key, c in groups.items():
        known = sum(c[k] for k in S.PPO_KNOWN)
        received = sum(c[k] for k in S.PPO_RECEIVED)
        out.append({by: key, "interns": c["interns"], "started": c["started"], "completed": c["completed"],
                    "ppo_offered": received, "ppo_accepted": c["accepted"], "ppo_declined": c["declined"],
                    "no_ppo": c["no_offer"], "pending": c["pending"], "unknown": c[S.UNKNOWN], "known": known,
                    "conversion_rate": _pct(received, known)})
    if by == "year":
        return sorted(out, key=lambda x: S.year_start(x["year"]))
    return sorted(out, key=lambda x: (-(x["conversion_rate"] or -1), -x["interns"]))


def company_profiles(ds: Dataset) -> List[Dict[str, Any]]:
    by_co: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for a in ds.apps:
        by_co[a["company_norm"]].append(a)
    ongoing = {y for y in ds.years if ds.cycle(y)["status"] == "ongoing"}
    latest = ds.years[-1] if ds.years else None
    prev = ds.years[-2] if len(ds.years) >= 2 else None
    out = []
    for cn, rows in by_co.items():
        years = sorted({a["academic_year"] for a in rows}, key=S.year_start)
        offers = ds.ft_offers(rows)
        offers_by_year = Counter(a["academic_year"] for a, _ in offers)
        interns = [a for a in rows if ds.intern_taken(a)]
        ppo_out = [ds.ppo_outcome(a) for a in interns]
        known = sum(1 for o in ppo_out if o in S.PPO_KNOWN)
        received = sum(1 for o in ppo_out if o in S.PPO_RECEIVED)
        ctcs = [a["ctc"] for a, _ in offers if a["opportunity_type"] == "full_time" and a.get("ctc")]
        active_now = [a for a in rows if a["academic_year"] in ongoing and a["result"] in ACTIVE_RESULTS]
        in_ongoing = [a for a in rows if a["academic_year"] in ongoing]
        industries = Counter(a["industry"] for a in rows if a.get("industry"))
        ft_apps = [a for a in rows if a["opportunity_type"] == "full_time"]
        out.append({
            "company": ds.company_name.get(cn, rows[0]["company"]), "company_norm": cn,
            "industry": industries.most_common(1)[0][0] if industries else None,
            "years": years, "returning": len(years) >= 2,
            "roles": [r for r, _ in Counter(a["role"] for a in rows if a.get("role")).most_common(8)],
            "departments": [d for d, _ in Counter(ds.department(a) for a in rows).most_common(8)],
            "applications": len(rows), "full_time_applications": len(ft_apps),
            "offers": len(offers), "offers_by_year": dict(offers_by_year),
            "offers_change": (offers_by_year.get(latest, 0) - offers_by_year.get(prev, 0)) if latest and prev and prev in years else None,
            "internship_offers": sum(1 for a in rows if a["opportunity_type"] == "internship" and a["result"] in S.OFFER_RESULTS),
            "interns": len(interns), "ppo_offered": received, "ppo_known": known,
            "ppo_conversion_rate": _pct(received, known),
            "selection_rate": _pct(sum(1 for a in ft_apps if a["result"] in S.OFFER_RESULTS),
                                   sum(1 for a in ft_apps if a["result"] != S.UNKNOWN)),
            "ctc_average": round(statistics.mean(ctcs), 2) if ctcs else None,
            "ctc_highest": max(ctcs) if ctcs else None,
            "status": ("hiring in progress" if active_now else "process complete" if in_ongoing
                       else "not in the current cycle" if ongoing else "no ongoing cycle"),
            "open_processes": len(active_now),
        })
    return sorted(out, key=lambda x: (-x["offers"], x["company"]))


def best(values: Iterable[Optional[str]], rank: Dict[Optional[str], int]) -> Optional[str]:
    vals = list(values)
    return max(vals, key=lambda v: rank.get(v, 0)) if vals else None


def student_rows(ds: Dataset, year: str) -> List[Dict[str, Any]]:
    rows = ds.by_year.get(year, [])
    cyc = ds.cycle(year)
    by_student: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for a in rows:
        by_student[a["student_id"]].append(a)
    placed = ds.placed_students(year)
    roster = {s["student_id"]: s for s in ds.students if s["academic_year"] == year}
    group_name = "registered" if ds.config.get("placement_denominator") == "registered" else "eligible"
    out = []
    for sid in sorted(set(roster) | set(by_student)):
        s = roster.get(sid, {})
        apps = by_student.get(sid, [])
        ft = [a for a in apps if a["opportunity_type"] == "full_time"]
        interns = [a for a in apps if a["opportunity_type"] == "internship"]
        offers = ds.ft_offers(apps)
        furthest = max((a["stage_index"] for a in ft if a.get("stage_index") is not None), default=None)
        active = any(a["result"] in ACTIVE_RESULTS for a in apps)
        if sid in placed:
            status = "placed"
        elif offers and all(st == "declined" for _, st in offers):
            status = "offers_declined"
        elif offers:
            status = "offer_pending"
        elif active:
            status = "in_process"
        elif not apps:
            status = "no_applications"
        elif cyc["status"] == "completed":
            status = "not_placed"
        else:
            status = "no_active_process"
        in_group = s.get(group_name) == 1
        out.append({
            "student_id": sid, "department": s.get("department") or (apps[0].get("department") if apps else None),
            "graduation_year": s.get("graduation_year"), "eligible": s.get("eligible"), "registered": s.get("registered"),
            "in_roster": bool(s), "applications": len(apps), "offers": len(offers),
            "furthest_stage": ds.stages[furthest]["label"] if furthest is not None and furthest < len(ds.stages) else None,
            "internship_status": best((a.get("internship_status") for a in interns), INTERN_RANK),
            "ppo_status": best((ds.ppo_outcome(a) for a in interns if ds.intern_taken(a)), PPO_RANK),
            "status": status,
            "needs_attention": cyc["status"] == "ongoing" and in_group and status in ("no_applications", "no_active_process"),
        })
    return out


def as_of_comparison(ds: Dataset, year: str) -> Dict[str, Any]:
    """Offers made by the same point of each cycle (days since cycle start), using offer/result dates."""
    cyc = ds.cycle(year)
    start = date.fromisoformat(cyc["start_date"])
    elapsed = (ds.today - start).days
    if cyc["status"] != "ongoing":
        return {"available": False, "note": f"{year} is a completed cycle; equivalent-date comparison is for the ongoing cycle."}
    if elapsed < 0:
        return {"available": False, "note": f"The {year} cycle starts on {start.isoformat()}."}
    rows_out = []
    undated_total = 0
    for y in ds.years:
        if S.year_start(y) > S.year_start(year):
            continue
        ys = date.fromisoformat(ds.cycle(y)["start_date"])
        cutoff = date.fromordinal(ys.toordinal() + elapsed)
        offers = ds.ft_offers(ds.by_year.get(y, []))
        dated = [(a, st) for a, st in offers if a.get("offer_on") or a.get("result_on")]
        undated_total += len(offers) - len(dated)
        by_cutoff = [(a, st) for a, st in dated if date.fromisoformat(a.get("offer_on") or a.get("result_on")) <= cutoff]
        students = {a["student_id"] for a, st in by_cutoff
                    if ds.counts_as_placed(st, a["opportunity_type"] == "internship" or bool(a["is_ppo"]))}
        rows_out.append({"academic_year": y, "cutoff": cutoff.isoformat(), "offers_by_cutoff": len(by_cutoff),
                         "students_placed_by_cutoff": len(students), "dated_offers": len(dated),
                         "undated_offers": len(offers) - len(dated), "is_current": y == year})
    return {"available": True, "current": year, "days_into_cycle": elapsed, "rows": rows_out,
            "note": ("Each cycle is cut off the same number of days after its start date. Offers without an offer "
                     "or result date can't be placed in time and are excluded"
                     + (f" ({undated_total} offer(s) across these cycles)." if undated_total else "."))}
