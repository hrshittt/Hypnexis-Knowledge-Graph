"""
Placement assistant — answers coordinator questions from the imported records only.

Questions are matched to a fixed set of supported analyses (keyword intents). Every figure
in an answer comes from backend.placement.metrics, with its definition and calculation, and
links back to the dashboard tab that shows the underlying table. Nothing is generated
freely: an unsupported question gets the list of questions that can be answered.
Student identifiers appear only for members allowed to see student-level records.
"""

import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from backend.placement import metrics as M
from backend.placement import schema as S

_YEAR = re.compile(r"\b((?:19|20)\d{2})\s*[-/–]\s*((?:19|20)?\d{2})\b")

SUPPORTED = [
    "Compare PPO conversion rates across the last three completed academic years.",
    "Which companies had the highest internship-to-PPO conversion rates?",
    "How many students are currently waiting for interview results?",
    "Which recruitment stages have the largest drop-off?",
    "Which companies returned this year?",
    "Compare current placement progress with the equivalent date last year.",
    "Which departments have the largest number of unplaced eligible students?",
    "How many offers were made, and how many unique students received them?",
    "How many students were placed last year?",
    "Which companies hired the most students?",
    "Which departments have improving placement outcomes?",
    "Which companies have not completed their hiring process?",
    "Which students still need intervention?",
    "How many internship offers were made this year?",
]


def _has(q: str, *patterns: str) -> bool:
    return any(re.search(p, q) for p in patterns)


def _years_in(q: str) -> List[str]:
    out = []
    for m in _YEAR.finditer(q):
        ay = S.normalize_academic_year(m.group(0))
        if ay:
            out.append(ay)
    return out


def _fmt(v: Any, unit: Optional[str] = None) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        s = f"{v:.1f}" if unit == "%" else f"{v:,.2f}".rstrip("0").rstrip(".")
    else:
        s = f"{v:,}" if isinstance(v, int) else str(v)
    return f"{s}%" if unit == "%" else f"{s} {unit}" if unit else s


def _answer(intent: str, title: str, text: str, year: Optional[str] = None, table: Optional[Dict] = None,
            definitions: Optional[List[Tuple[str, str]]] = None, calculation: Optional[str] = None,
            links: Optional[List[Dict[str, str]]] = None, notes: Optional[List[str]] = None) -> Dict[str, Any]:
    return {"intent": intent, "title": title, "answer": text, "year": year, "table": table,
            "definitions": [{"term": t, "definition": d} for t, d in (definitions or [])],
            "calculation": calculation, "links": links or [], "notes": [n for n in (notes or []) if n],
            "supported": None}


class PlacementAssistant:
    def __init__(self, ds: M.Dataset, can_see_students: bool):
        self.ds = ds
        self.students_ok = can_see_students
        self.completed = [y for y in ds.years if ds.cycle(y)["status"] == "completed"]
        self.ongoing = [y for y in ds.years if ds.cycle(y)["status"] == "ongoing"]

    # ── year resolution ──────────────────────────────────────────────────────
    def _year(self, q: str, prefer: str = "current") -> Optional[str]:
        ys = [y for y in _years_in(q) if y in self.ds.years]
        if ys:
            return ys[0]
        if _has(q, r"last year", r"previous year", r"last (academic )?cycle", r"previous cycle"):
            # "last year" = the most recent completed cycle before the current one
            if self.ongoing:
                prev = [y for y in self.completed if S.year_start(y) < S.year_start(self.ongoing[-1])]
                return prev[-1] if prev else None
            return self.completed[-2] if len(self.completed) >= 2 else (self.completed[-1] if self.completed else None)
        if _has(q, r"this year", r"current", r"ongoing", r"so far", r"now", r"currently"):
            return self.ongoing[-1] if self.ongoing else (self.ds.years[-1] if self.ds.years else None)
        if prefer == "completed" and self.completed:
            return self.completed[-1]
        return self.ds.years[-1] if self.ds.years else None

    def _partial_note(self, year: Optional[str]) -> Optional[str]:
        if year and self.ds.cycle(year)["status"] == "ongoing":
            return f"{year} is still in progress, so its figures are partial."
        return None

    # ── dispatch ─────────────────────────────────────────────────────────────
    def answer(self, question: str) -> Dict[str, Any]:
        q = " " + question.lower().strip() + " "
        if not self.ds.apps and not self.ds.students:
            return {**_answer("no_data", "No placement data yet",
                              "There are no placement records in this workspace yet. Import a student roster and "
                              "application records (or load the clearly-labelled sample data) first.",
                              links=[{"label": "Import data", "tab": "import"}]), "supported": SUPPORTED}
        routes: List[Tuple[Callable[[str], bool], Callable[[str], Dict[str, Any]]]] = [
            (lambda q: _has(q, r"ppo", r"pre.?placement") and _has(q, r"compan", r"recruiter", r"employer", r"firm"),
             self.ppo_companies),
            (lambda q: _has(q, r"ppo", r"pre.?placement") and _has(q, r"department", r"branch"), self.ppo_departments),
            (lambda q: _has(q, r"ppo", r"pre.?placement", r"intern.*conver"), self.ppo_years),
            (lambda q: _has(q, r"equivalent", r"same (time|date|point|stage)", r"this time last year",
                            r"by this date", r"progress.*(last|previous) year", r"compared? .*progress"), self.as_of),
            (lambda q: _has(q, r"wait", r"await", r"pending result", r"result pending", r"results? (are )?pending"),
             self.awaiting),
            (lambda q: _has(q, r"drop.?off", r"drop out", r"dropping", r"rejection rate", r"funnel",
                            r"(which|what) (recruitment |hiring )?(stage|round)"), self.dropoff),
            (lambda q: _has(q, r"return", r"came back", r"repeat", r"again this year"), self.returning),
            (lambda q: _has(q, r"not (yet )?completed", r"still hiring", r"open process", r"hiring process",
                            r"in progress") and _has(q, r"compan", r"recruiter"), self.open_companies),
            (lambda q: _has(q, r"intervention", r"attention", r"at risk", r"need help", r"needs? support",
                            r"stuck", r"follow.?up"), self.intervention),
            (lambda q: _has(q, r"department", r"branch") and _has(q, r"improv", r"trend", r"better", r"declin",
                                                                  r"worse", r"over time"), self.improving),
            (lambda q: _has(q, r"unplaced", r"not (been )?placed", r"yet to be placed", r"without (an )?offer"),
             self.unplaced),
            (lambda q: _has(q, r"intern") and _has(q, r"offer", r"how many"), self.internships),
            (lambda q: _has(q, r"unique", r"distinct") or (_has(q, r"offers") and _has(q, r"students")), self.offers),
            (lambda q: _has(q, r"hired the most", r"most offers", r"top (recruiter|compan)", r"biggest recruiter",
                            r"hired most", r"most students", r"top hiring"), self.top_recruiters),
            (lambda q: _has(q, r"placed", r"placement rate", r"placement percentage"), self.placed),
            (lambda q: _has(q, r"offer"), self.offers),
        ]
        for match, handler in routes:
            if match(q):
                return handler(q)
        return {**_answer("unsupported", "I can't answer that from placement records yet",
                          "That question isn't one of the analyses I can compute from the imported records. "
                          "Here are the questions I can answer:"), "supported": SUPPORTED}

    # ── handlers ─────────────────────────────────────────────────────────────
    def ppo_years(self, q: str) -> Dict[str, Any]:
        rows = M.ppo_breakdown(self.ds, by="year")
        want_completed = _has(q, r"complet", r"last (two|three|four|\d) ")
        n = 3 if _has(q, r"three", r" 3 ") else 2 if _has(q, r"two", r" 2 ") else None
        if want_completed:
            rows = [r for r in rows if r["year"] in self.completed]
        if n:
            rows = rows[-n:]
        if not rows:
            return _answer("ppo_years", "PPO conversion by year", "No internships with recorded outcomes in the selected years.",
                           links=[{"label": "Open PPO tracking", "tab": "ppo"}])
        lines = []
        for r in rows:
            status = self.ds.cycle(r["year"])["status"]
            rate = _fmt(r["conversion_rate"], "%")
            lines.append(f"- **{r['year']}**{' (in progress)' if status == 'ongoing' else ''}: {rate} "
                         f"({r['ppo_offered']} of {r['known']} interns with a known outcome; "
                         f"{r['pending']} pending, {r['unknown']} unrecorded)")
        rated = [r for r in rows if r["conversion_rate"] is not None]
        trend = ""
        if len(rated) >= 2:
            d = round(rated[-1]["conversion_rate"] - rated[0]["conversion_rate"], 1)
            trend = (f"\n\nFrom {rated[0]['year']} to {rated[-1]['year']} conversion "
                     f"{'rose' if d > 0 else 'fell' if d < 0 else 'held steady'}"
                     f"{f' by {abs(d)} percentage points' if d else ''}.")
        return _answer(
            "ppo_years", "Internship-to-PPO conversion by academic year", "\n".join(lines) + trend,
            table={"columns": ["Year", "Interns", "Known outcome", "PPOs offered", "Accepted", "Declined", "No PPO",
                               "Pending", "Unrecorded", "Conversion"],
                   "rows": [[r["year"], r["interns"], r["known"], r["ppo_offered"], r["ppo_accepted"], r["ppo_declined"],
                             r["no_ppo"], r["pending"], r["unknown"], _fmt(r["conversion_rate"], "%")] for r in rows]},
            definitions=[("PPO conversion rate", M.DEFINITIONS["ppo_conversion_rate"])],
            calculation="Conversion = PPOs offered ÷ interns with a known PPO outcome × 100",
            links=[{"label": "Open PPO tracking", "tab": "ppo"}],
            notes=["Ongoing cycles are partial; most PPO decisions arrive after internships end." if any(
                self.ds.cycle(r["year"])["status"] == "ongoing" for r in rows) else None,
                   None if not want_completed or len(rows) >= (n or 0) else
                   f"Only {len(rows)} completed cycle(s) are in the data."])

    def ppo_companies(self, q: str) -> Dict[str, Any]:
        year = _years_in(q)[0] if _years_in(q) else None
        rows = [r for r in M.ppo_breakdown(self.ds, by="company", year=year) if r["known"] > 0]
        if not rows:
            return _answer("ppo_companies", "PPO conversion by company", "No internships with a known PPO outcome yet.",
                           links=[{"label": "Open PPO tracking", "tab": "ppo"}])
        top = rows[:10]
        small = [r["company"] for r in top if r["known"] < 3]
        text = "\n".join(f"{i}. **{r['company']}** — {_fmt(r['conversion_rate'], '%')} "
                         f"({r['ppo_offered']} of {r['known']} interns with a known outcome)"
                         for i, r in enumerate(top, 1))
        return _answer(
            "ppo_companies", f"Highest internship-to-PPO conversion{f' in {year}' if year else ' (all cycles)'}", text,
            year=year,
            table={"columns": ["Company", "Interns", "Known outcome", "PPOs offered", "Accepted", "Pending", "Conversion"],
                   "rows": [[r["company"], r["interns"], r["known"], r["ppo_offered"], r["ppo_accepted"], r["pending"],
                             _fmt(r["conversion_rate"], "%")] for r in top]},
            definitions=[("PPO conversion rate", M.DEFINITIONS["ppo_conversion_rate"])],
            calculation="Per company: PPOs offered ÷ interns with a known PPO outcome × 100",
            links=[{"label": "Open PPO tracking", "tab": "ppo"}],
            notes=[f"Small samples (fewer than 3 known outcomes): {', '.join(small)} — rates can swing a lot." if small else None])

    def ppo_departments(self, q: str) -> Dict[str, Any]:
        year = self._year(q) if _years_in(q) or _has(q, r"this year", r"last year") else None
        rows = [r for r in M.ppo_breakdown(self.ds, by="department", year=year) if r["interns"]]
        text = "\n".join(f"- **{r['department']}**: {_fmt(r['conversion_rate'], '%')} ({r['ppo_offered']} of {r['known']})"
                         for r in rows) or "No internships recorded."
        return _answer("ppo_departments", "PPO conversion by department", text, year=year,
                       table={"columns": ["Department", "Interns", "Known outcome", "PPOs offered", "Conversion"],
                              "rows": [[r["department"], r["interns"], r["known"], r["ppo_offered"],
                                        _fmt(r["conversion_rate"], "%")] for r in rows]},
                       definitions=[("PPO conversion rate", M.DEFINITIONS["ppo_conversion_rate"])],
                       links=[{"label": "Open PPO tracking", "tab": "ppo"}])

    def awaiting(self, q: str) -> Dict[str, Any]:
        year = self._year(q)
        rows = [a for a in self.ds.by_year.get(year, []) if a["result"] == "awaiting_result"]
        students = sorted({a["student_id"] for a in rows})
        by_co: Dict[str, int] = {}
        for a in rows:
            name = self.ds.company_name.get(a["company_norm"], a["company"])
            by_co[name] = by_co.get(name, 0) + 1
        text = (f"In **{year}**, **{len(students)}** student(s) are waiting for results across **{len(rows)}** "
                f"application(s) at {len(by_co)} compan{'y' if len(by_co) == 1 else 'ies'}.")
        if self.students_ok and students:
            text += "\n\nStudent IDs: " + ", ".join(students[:60]) + (" …" if len(students) > 60 else "")
        return _answer("awaiting", "Students waiting for results", text, year=year,
                       table={"columns": ["Company", "Applications awaiting a result"],
                              "rows": sorted(([k, v] for k, v in by_co.items()), key=lambda x: -x[1])},
                       definitions=[("Waiting for results", M.DEFINITIONS["students_awaiting_results"])],
                       links=[{"label": "Open student records", "tab": "students"}] if self.students_ok else
                       [{"label": "Open pipeline", "tab": "pipeline"}],
                       notes=[None if self.students_ok else
                              "Student-level details are hidden for your role (viewer)."])

    def dropoff(self, q: str) -> Dict[str, Any]:
        year = self._year(q, prefer="completed")  # a finished cycle shows real exits, not open applications
        typ = "internship" if _has(q, r"intern") else "full_time"
        f = M.funnel(self.ds, year, typ)
        stages = [s for s in f["stages"] if s["reached"]]
        if not stages:
            return _answer("dropoff", "Stage drop-off", f"No {typ.replace('_', '-')} applications with a recorded stage in {year}.",
                           year=year, links=[{"label": "Open pipeline", "tab": "pipeline"}])
        worst = next((s for s in stages if s["key"] == f["largest_drop_off"]), None)
        rej = next((s for s in stages if s["key"] == f["highest_rejection_rate"]), None)
        parts = []
        if worst:
            parts.append(f"The largest drop-off in **{year}** is at **{worst['label']}**: {worst['drop_off']} of "
                         f"{worst['reached']} applications that reached it ended there "
                         f"({worst['rejected']} rejected, {worst['withdrawn']} withdrawn).")
        if rej:
            parts.append(f"The highest rejection rate is at **{rej['label']}** ({_fmt(rej['rejection_rate'], '%')}).")
        return _answer(
            "dropoff", f"Recruitment-stage drop-off ({typ.replace('_', '-')})", " ".join(parts), year=year,
            table={"columns": ["Stage", "Reached", "Progressed", "Rejected", "Withdrawn", "Pending", "Unknown",
                               "Conversion to next", "Rejection rate"],
                   "rows": [[s["label"], s["reached"], s["progressed"], s["rejected"], s["withdrawn"], s["pending"],
                             s["unknown"], _fmt(s["conversion_to_next"], "%"), _fmt(s["rejection_rate"], "%")]
                            for s in stages]},
            definitions=[("Drop-off at a stage", "Applications whose furthest stage is this one and that were rejected or "
                                                 "withdrawn."),
                         ("Rejection rate", "Rejected at the stage ÷ applications that reached it with a known outcome.")],
            links=[{"label": "Open pipeline", "tab": "pipeline"}],
            notes=[f["note"], self._partial_note(year),
                   f"{f['without_stage']} application(s) have no recorded stage and are excluded." if f["without_stage"] else None])

    def returning(self, q: str) -> Dict[str, Any]:
        year = self._year(q)
        rows = self.ds.by_year.get(year, [])
        earlier_years = [y for y in self.ds.years if S.year_start(y) < S.year_start(year)]
        if not earlier_years:
            return _answer("returning", "Returning companies", f"{year} is the earliest cycle in the data, so there's "
                           "nothing to compare with.", year=year)
        now = {a["company_norm"] for a in rows}
        profiles = {p["company_norm"]: p for p in M.company_profiles(self.ds)}
        ret = sorted((profiles[c] for c in now if any(y in profiles[c]["years"] for y in earlier_years)),
                     key=lambda p: -p["offers_by_year"].get(year, 0))
        new = sorted(profiles[c]["company"] for c in now if c not in {p["company_norm"] for p in ret})
        text = (f"**{len(ret)}** of {len(now)} companies in **{year}** also recruited in an earlier cycle"
                + (f"; {len(new)} are new." if new else "."))
        return _answer(
            "returning", f"Returning companies in {year}", text, year=year,
            table={"columns": ["Company", "Earlier cycles", f"Offers {year}", "Offers (previous cycle)"],
                   "rows": [[p["company"], ", ".join(y for y in p["years"] if y in earlier_years),
                             p["offers_by_year"].get(year, 0),
                             p["offers_by_year"].get(earlier_years[-1], 0)] for p in ret]},
            definitions=[("Returning company", M.DEFINITIONS["returning_companies"])],
            links=[{"label": "Open company intelligence", "tab": "companies"}],
            notes=[self._partial_note(year), f"New this cycle: {', '.join(new[:15])}" if new else None])

    def as_of(self, q: str) -> Dict[str, Any]:
        year = self.ongoing[-1] if self.ongoing else None
        if not year:
            return _answer("as_of", "Equivalent-date comparison", "There's no ongoing cycle to compare: every cycle in the "
                           "data is complete. Mark a cycle as ongoing in Placement settings if that's wrong.")
        r = M.as_of_comparison(self.ds, year)
        if not r["available"]:
            return _answer("as_of", "Equivalent-date comparison", r["note"], year=year)
        cur = next(x for x in r["rows"] if x["is_current"])
        prev = [x for x in r["rows"] if not x["is_current"]]
        text = (f"**{r['days_into_cycle']} days** into {year}: **{cur['offers_by_cutoff']}** offers and "
                f"**{cur['students_placed_by_cutoff']}** students placed.")
        if prev:
            p = prev[-1]
            text += (f" At the same point of {p['academic_year']} (by {p['cutoff']}) there were "
                     f"**{p['offers_by_cutoff']}** offers and **{p['students_placed_by_cutoff']}** students placed.")
        return _answer("as_of", "Placement progress at the equivalent date", text, year=year,
                       table={"columns": ["Cycle", "Cut-off date", "Offers by cut-off", "Students placed by cut-off",
                                          "Offers without a date"],
                              "rows": [[x["academic_year"], x["cutoff"], x["offers_by_cutoff"],
                                        x["students_placed_by_cutoff"], x["undated_offers"]] for x in r["rows"]]},
                       calculation=f"Cut-off = each cycle's start date + {r['days_into_cycle']} days",
                       links=[{"label": "Open year comparison", "tab": "years"}], notes=[r["note"]])

    def unplaced(self, q: str) -> Dict[str, Any]:
        year = self._year(q)
        rows = M.department_breakdown(self.ds, year)
        if not rows:
            return _answer("unplaced", "Unplaced students by department",
                           f"No student roster for {year}: unplaced students can't be counted without one.",
                           year=year, links=[{"label": "Import a roster", "tab": "import"}])
        rows = sorted(rows, key=lambda r: -r["unplaced"])
        group = rows[0]["denominator"]
        text = "\n".join(f"- **{r['department']}**: {r['unplaced']} unplaced of {r['group']} {group} "
                         f"({r['in_process']} still in process)" for r in rows[:10])
        return _answer("unplaced", f"Unplaced {group} students by department — {year}", text, year=year,
                       table={"columns": ["Department", f"{group.title()} students", "Placed", "Unplaced",
                                          "Unplaced but in process", "Placement rate"],
                              "rows": [[r["department"], r["group"], r["placed"], r["unplaced"], r["in_process"],
                                        _fmt(r["placement_rate"], "%")] for r in rows]},
                       definitions=[("Placed", M.DEFINITIONS["students_placed"])],
                       links=[{"label": "Open overview", "tab": "overview"}],
                       notes=[self._partial_note(year)])

    def offers(self, q: str) -> Dict[str, Any]:
        year = self._year(q)
        k = M.year_metrics(self.ds, year)["kpis"]
        t, u = k["total_offers"]["value"], k["unique_students_with_offers"]["value"]
        text = (f"In **{year}**, **{t}** full-time offers (including PPOs) were made to **{u}** unique students"
                + (f" — on average {t / u:.2f} offers per student who received one." if u else "."))
        return _answer("offers", f"Offers vs unique students — {year}", text, year=year,
                       definitions=[("Total offers", M.DEFINITIONS["total_offers"]),
                                    ("Unique students with offers", M.DEFINITIONS["unique_students_with_offers"])],
                       calculation=f"{t} offers ÷ {u} students = {t / u:.2f} offers per student" if u else None,
                       links=[{"label": "Open overview", "tab": "overview"}], notes=[self._partial_note(year)])

    def placed(self, q: str) -> Dict[str, Any]:
        year = self._year(q, prefer="completed")
        k = M.year_metrics(self.ds, year)["kpis"]
        p, r = k["students_placed"], k["placement_rate"]
        text = f"**{p['value']}** students were placed in **{year}**."
        calc = None
        if r["available"]:
            text += f" Placement rate: **{_fmt(r['value'], '%')}** ({r['numerator']} of {r['denominator']})."
            calc = f"{r['numerator']} ÷ {r['denominator']} × 100 = {_fmt(r['value'], '%')}"
        elif r["note"]:
            text += f" {r['note']}"
        return _answer("placed", f"Students placed — {year}", text, year=year,
                       definitions=[("Students placed", M.DEFINITIONS["students_placed"]),
                                    ("Placement rate", M.DEFINITIONS["placement_rate"])],
                       calculation=calc, links=[{"label": "Open overview", "tab": "overview"}],
                       notes=[self._partial_note(year), p.get("note")])

    def internships(self, q: str) -> Dict[str, Any]:
        year = self._year(q)
        k = M.year_metrics(self.ds, year)["kpis"]
        text = (f"In **{year}**: **{k['internship_offers']['value']}** internship offers, **{k['interns']['value']}** "
                f"internships taken or underway, and **{k['ppo_offers']['value']}** PPOs offered.")
        return _answer("internships", f"Internships — {year}", text, year=year,
                       definitions=[("Internship offers", M.DEFINITIONS["internship_offers"]),
                                    ("Interns", M.DEFINITIONS["interns"])],
                       links=[{"label": "Open PPO tracking", "tab": "ppo"}], notes=[self._partial_note(year)])

    def top_recruiters(self, q: str) -> Dict[str, Any]:
        year = self._year(q)
        rows = sorted(M.company_profiles(self.ds), key=lambda p: -p["offers_by_year"].get(year, 0))
        rows = [p for p in rows if p["offers_by_year"].get(year, 0)][:10]
        if not rows:
            return _answer("top_recruiters", "Top recruiters", f"No full-time offers recorded in {year}.", year=year)
        text = "\n".join(f"{i}. **{p['company']}** — {p['offers_by_year'][year]} offer(s)" for i, p in enumerate(rows, 1))
        return _answer("top_recruiters", f"Companies with the most offers — {year}", text, year=year,
                       table={"columns": ["Company", f"Offers {year}", "Cycles recruited", "Highest CTC"],
                              "rows": [[p["company"], p["offers_by_year"][year], len(p["years"]),
                                        _fmt(p["ctc_highest"], self.ds.config.get("ctc_unit"))] for p in rows]},
                       definitions=[("Offers", M.DEFINITIONS["total_offers"])],
                       links=[{"label": "Open company intelligence", "tab": "companies"}],
                       notes=[self._partial_note(year)])

    def improving(self, q: str) -> Dict[str, Any]:
        rows = M.department_trends(self.ds)
        rated = [r for r in rows if r["change"] is not None]
        if not rated:
            return _answer("improving", "Department trends",
                           "At least two completed cycles with a roster are needed to see department trends.",
                           links=[{"label": "Open year comparison", "tab": "years"}])
        up = [r for r in rated if r["change"] > 0]
        text = ("\n".join(f"- **{r['department']}**: {'+' if r['change'] > 0 else ''}{r['change']} pp "
                          f"({r['from_year']} → {r['to_year']})" for r in rated))
        return _answer("improving", "Placement-rate change by department (completed cycles)",
                       (f"{len(up)} of {len(rated)} departments improved.\n\n" if rated else "") + text,
                       definitions=[("Placement rate", M.DEFINITIONS["placement_rate"])],
                       calculation="Change = rate in the latest completed cycle − rate in the earliest completed cycle "
                                   "(percentage points)",
                       links=[{"label": "Open year comparison", "tab": "years"}],
                       notes=["Ongoing cycles are excluded so partial results don't look like declines."])

    def open_companies(self, q: str) -> Dict[str, Any]:
        rows = [p for p in M.company_profiles(self.ds) if p["open_processes"]]
        year = self.ongoing[-1] if self.ongoing else None
        if not year:
            return _answer("open_companies", "Companies still hiring", "No cycle is marked ongoing.")
        text = (f"**{len(rows)}** compan{'y has' if len(rows) == 1 else 'ies have'} applications still in process or "
                f"awaiting results in {year}.")
        return _answer("open_companies", f"Companies with open hiring processes — {year}", text, year=year,
                       table={"columns": ["Company", "Open applications"],
                              "rows": [[p["company"], p["open_processes"]] for p in
                                       sorted(rows, key=lambda p: -p["open_processes"])]},
                       links=[{"label": "Open company intelligence", "tab": "companies"}])

    def intervention(self, q: str) -> Dict[str, Any]:
        year = self.ongoing[-1] if self.ongoing else None
        if not year:
            return _answer("intervention", "Students who may need support",
                           "No cycle is marked ongoing, so there's no one to follow up with right now.")
        rows = [r for r in M.student_rows(self.ds, year) if r["needs_attention"]]
        by_dept: Dict[str, int] = {}
        for r in rows:
            by_dept[r["department"] or "Unspecified"] = by_dept.get(r["department"] or "Unspecified", 0) + 1
        text = (f"**{len(rows)}** students in {year} are in the placement group but have no offer and no active "
                "application. They may need outreach.")
        if self.students_ok and rows:
            text += "\n\nStudent IDs: " + ", ".join(r["student_id"] for r in rows[:60]) + (" …" if len(rows) > 60 else "")
        return _answer("intervention", f"Students who may need support — {year}", text, year=year,
                       table={"columns": ["Department", "Students"],
                              "rows": sorted(([k, v] for k, v in by_dept.items()), key=lambda x: -x[1])},
                       definitions=[("Needs attention", "In the placement group (eligible by default), cycle ongoing, "
                                                        "no offer and no application in process. Based only on "
                                                        "placement records — never on personal characteristics.")],
                       links=[{"label": "Open student records", "tab": "students"}] if self.students_ok else [],
                       notes=[None if self.students_ok else "Student-level details are hidden for your role (viewer)."])
