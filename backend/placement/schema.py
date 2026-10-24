"""
Canonical placement schema: the fields Paheli stores, the spreadsheet headers that map
to them, and the normalisers that turn free-text cells into consistent values.

Two import kinds
  students       roster per academic year — the denominators (eligible / registered)
  applications   one row per student × company × opportunity — stages, results, offers,
                 internship and PPO outcomes

Data minimisation: names, contact details and sensitive characteristics (gender, caste,
category, religion, date of birth, …) are never imported, whatever the mapping says.
Students are identified only by the institution's own student id.
"""

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

UNKNOWN = "unknown"


@dataclass(frozen=True)
class FieldSpec:
    key: str
    label: str
    kind: str                       # str | int | float | bool | date | year | enum
    required: bool = False
    synonyms: Tuple[str, ...] = ()
    help: str = ""
    enum: str = ""                  # which normaliser for kind == "enum"


def _h(*names: str) -> Tuple[str, ...]:
    return tuple(names)


STUDENT_FIELDS: Tuple[FieldSpec, ...] = (
    FieldSpec("academic_year", "Academic year", "year", True,
              _h("academic year", "ay", "placement year", "placement season", "season", "cycle", "session", "year"),
              "The placement cycle, e.g. 2025-26."),
    FieldSpec("student_id", "Student ID", "str", True,
              _h("student id", "roll no", "roll number", "roll", "enrollment no", "enrolment no", "enrollment number",
                 "enrolment number", "registration no", "reg no", "registration number", "prn", "usn", "student code",
                 "admission no", "admission number", "id"),
              "Your institution's identifier. Names are never imported."),
    FieldSpec("department", "Department", "str", False,
              _h("department", "dept", "branch", "stream", "discipline", "specialisation", "specialization")),
    FieldSpec("program", "Programme", "str", False, _h("program", "programme", "course", "degree")),
    FieldSpec("graduation_year", "Graduation year", "int", False,
              _h("graduation year", "passing year", "year of passing", "yop", "grad year", "batch", "passout year")),
    FieldSpec("eligible", "Eligible for placement", "bool", False,
              _h("eligible", "eligibility", "is eligible", "placement eligible", "eligibility status")),
    FieldSpec("registered", "Registered for placement", "bool", False,
              _h("registered", "registered for placement", "registered for placements", "opted in",
                 "opted for placement", "registration status", "opted")),
)

APPLICATION_FIELDS: Tuple[FieldSpec, ...] = (
    FieldSpec("academic_year", "Academic year", "year", True, STUDENT_FIELDS[0].synonyms, STUDENT_FIELDS[0].help),
    FieldSpec("student_id", "Student ID", "str", True, STUDENT_FIELDS[1].synonyms, STUDENT_FIELDS[1].help),
    FieldSpec("company", "Company", "str", True,
              _h("company", "company name", "organisation", "organization", "employer", "recruiter", "firm")),
    FieldSpec("opportunity_type", "Opportunity type", "enum", True,
              _h("opportunity type", "offer type", "type", "job type", "employment type", "opportunity", "drive type"),
              "Internship, full-time, or PPO.", enum="opportunity_type"),
    FieldSpec("role", "Role", "str", False,
              _h("role", "profile", "job profile", "designation", "position", "job title", "job role")),
    FieldSpec("department", "Department", "str", False, STUDENT_FIELDS[2].synonyms,
              "Used when the student roster has no department for this student."),
    FieldSpec("industry", "Industry", "str", False, _h("industry", "sector", "domain", "company sector")),
    FieldSpec("stage", "Furthest stage reached", "str", False,
              _h("stage", "round", "current stage", "current round", "process stage", "furthest stage", "last round",
                 "stage reached"),
              "Matched against your pipeline stages (Placement settings)."),
    FieldSpec("result", "Status / result", "enum", False,
              _h("status", "result", "outcome", "selection status", "final status", "offer status", "application status"),
              "In process, awaiting result, rejected, withdrawn, offered, accepted or declined.", enum="result"),
    FieldSpec("internship_status", "Internship status", "enum", False,
              _h("internship status", "internship outcome", "internship completion", "internship progress"),
              enum="internship_status"),
    FieldSpec("ppo_status", "PPO status", "enum", False,
              _h("ppo status", "ppo", "ppo offered", "ppo outcome", "pre placement offer", "pre-placement offer",
                 "ppo received", "converted to ppo"),
              enum="ppo_status"),
    FieldSpec("ctc", "CTC", "float", False,
              _h("ctc", "ctc (lpa)", "ctc lpa", "package", "package (lpa)", "salary", "lpa", "annual ctc", "compensation",
                 "ctc offered")),
    FieldSpec("stipend", "Stipend", "float", False, _h("stipend", "monthly stipend", "stipend (per month)", "stipend pm")),
    FieldSpec("applied_on", "Applied on", "date", False, _h("applied on", "application date", "applied date", "date applied")),
    FieldSpec("result_on", "Result date", "date", False, _h("result date", "result on", "decision date", "date of result")),
    FieldSpec("offer_on", "Offer date", "date", False,
              _h("offer date", "offer on", "offer letter date", "selection date", "date of offer", "date of selection")),
)

FIELDS = {"students": STUDENT_FIELDS, "applications": APPLICATION_FIELDS}

# Columns that are never imported, even if someone maps them: names (exact header forms, so
# "Company Name" is fine), and any header containing a sensitive word as a whole token.
# Academic scores are excluded too: Paheli does not rank or profile students.
SENSITIVE_EXACT = frozenset({
    "name", "student name", "full name", "first name", "last name", "middle name", "candidate name",
    "name of student", "name of the student", "category", "social category", "reservation category",
    "caste category",
})
SENSITIVE_TOKENS = frozenset({
    "email", "e-mail", "mail", "phone", "mobile", "contact", "address", "gender", "sex", "caste", "religion",
    "dob", "birth", "age", "aadhaar", "aadhar", "pan", "marital", "disability", "nationality", "father", "mother",
    "parent", "guardian", "photo", "cgpa", "cpi", "gpa", "percentage", "marks", "backlog", "backlogs",
})

# ── value vocabularies ───────────────────────────────────────────────────────
RESULTS = ("in_process", "awaiting_result", "rejected", "withdrawn", "offered", "accepted", "declined", UNKNOWN)
OFFER_RESULTS = frozenset({"offered", "accepted", "declined"})
OPEN_OR_ACCEPTED = frozenset({"offered", "accepted"})
PPO_STATUSES = ("offered", "accepted", "declined", "no_offer", "pending", UNKNOWN)
PPO_RECEIVED = frozenset({"offered", "accepted", "declined"})
PPO_KNOWN = frozenset({"offered", "accepted", "declined", "no_offer"})
INTERNSHIP_STATUSES = ("not_started", "ongoing", "completed", "terminated", UNKNOWN)

_SYNONYMS: Dict[str, Dict[str, Tuple[str, ...]]] = {
    "result": {
        "in_process": ("in process", "in progress", "ongoing", "applied", "shortlisted", "under process", "scheduled",
                       "interview scheduled", "test scheduled", "active", "process ongoing", "in pipeline", "open"),
        "awaiting_result": ("awaiting result", "result awaited", "awaited", "awaiting", "pending", "on hold", "hold",
                            "waitlisted", "waitlist", "waiting", "result pending", "pending result", "under review"),
        "rejected": ("rejected", "not selected", "not shortlisted", "failed", "unsuccessful", "not cleared",
                     "rejected by company", "no offer", "eliminated", "not qualified"),
        "withdrawn": ("withdrawn", "withdrew", "dropped", "absent", "did not appear", "not appeared", "opted out",
                      "not interested", "backed out", "dropped out", "no show"),
        "offered": ("selected", "offered", "offer received", "offer extended", "offer made", "cleared",
                    "offer pending acceptance", "offer letter received"),
        "accepted": ("accepted", "offer accepted", "joined", "placed", "confirmed", "onboarded", "joining confirmed"),
        "declined": ("declined", "offer declined", "rejected offer", "refused", "reneged", "not joined",
                     "declined offer", "offer rejected by student"),
        UNKNOWN: ("", "na", "n/a", "-", "--", "unknown", "nil", "none", "not available", "tbd", "?"),
    },
    "opportunity_type": {
        "internship": ("internship", "intern", "summer internship", "summer intern", "winter internship",
                       "6 month internship", "six month internship", "6m intern", "6m internship", "si", "int",
                       "internship only", "industrial training"),
        "full_time": ("full time", "full-time", "fulltime", "fte", "ft", "placement", "job", "permanent", "regular",
                      "full time employment", "full time job", "final placement", "campus placement"),
        "ppo": ("ppo", "pre placement offer", "pre-placement offer", "preplacement offer", "pre placement"),
    },
    "ppo_status": {
        "offered": ("yes", "y", "offered", "received", "ppo offered", "ppo received", "ppo extended", "ppo given"),
        "accepted": ("accepted", "ppo accepted", "converted", "joined", "converted and accepted"),
        "declined": ("declined", "ppo declined", "refused", "rejected by student", "not accepted"),
        "no_offer": ("no", "n", "not offered", "no ppo", "not converted", "ppo not offered", "not received"),
        "pending": ("pending", "awaited", "result awaited", "in review", "under review", "decision pending", "awaiting"),
        UNKNOWN: ("", "na", "n/a", "-", "--", "unknown", "not applicable", "tbd", "?"),
    },
    "internship_status": {
        "not_started": ("not started", "upcoming", "yet to start", "to start", "scheduled"),
        "ongoing": ("ongoing", "in progress", "current", "active", "running", "started"),
        "completed": ("completed", "complete", "done", "finished", "successfully completed"),
        "terminated": ("terminated", "discontinued", "left", "dropped", "incomplete", "left midway"),
        UNKNOWN: ("", "na", "n/a", "-", "--", "unknown", "tbd", "?"),
    },
}

_TRUE = ("yes", "y", "true", "t", "1", "eligible", "registered", "opted in", "opted", "ok", "✓")
_FALSE = ("no", "n", "false", "f", "0", "not eligible", "ineligible", "not registered", "unregistered", "opted out",
          "debarred", "not opted")

DEFAULT_STAGES: List[Dict[str, Any]] = [
    {"key": "applied", "label": "Application submitted",
     "synonyms": ["applied", "application", "application submitted", "registered", "registration"]},
    {"key": "screening", "label": "Eligibility screening",
     "synonyms": ["screening", "eligibility", "eligibility screening", "shortlisting", "resume shortlisting",
                  "resume screening", "cv shortlist", "shortlisted", "cv screening"]},
    {"key": "assessment", "label": "Online assessment",
     "synonyms": ["online assessment", "oa", "online test", "aptitude", "aptitude test", "test", "coding test",
                  "written test", "assessment", "coding round"]},
    {"key": "technical", "label": "Technical interview",
     "synonyms": ["technical interview", "technical", "tech interview", "technical round", "interview",
                  "tech round", "technical interview 1", "technical interview 2"]},
    {"key": "hr", "label": "HR interview",
     "synonyms": ["hr interview", "hr", "hr round", "managerial round", "managerial interview", "final interview"]},
    {"key": "offer", "label": "Offer extended",
     "synonyms": ["offer", "offer extended", "selected", "offer stage", "final selection", "selection"]},
    {"key": "joined", "label": "Joined", "synonyms": ["joined", "onboarded", "joining", "onboarding"]},
]

DEFAULT_CONFIG: Dict[str, Any] = {
    "stages": DEFAULT_STAGES,
    "placement_denominator": "eligible",      # eligible | registered
    "placed_definition": "offer_received",    # offer_received (open or accepted) | offer_accepted
    "count_ppo_as_placement": True,
    "ctc_unit": "LPA",
    "cycles": {},                             # "2026-27": {"status": "ongoing"|"completed", "start_date": "2026-07-01"}
}


# ── normalisers ──────────────────────────────────────────────────────────────
def norm_header(h: str) -> str:
    s = (h or "").strip().lower()
    s = re.sub(r"[_\.]+", " ", s)
    s = re.sub(r"[^a-z0-9+()\-/ ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_token(v: Any) -> str:
    s = "" if v is None else str(v)
    s = s.replace("–", "-").replace("—", "-").strip().lower()
    s = re.sub(r"[_]+", " ", s)
    return re.sub(r"\s+", " ", s)


def norm_company(name: str) -> str:
    s = norm_token(name)
    s = re.sub(r"[.,'’()]", "", s)
    s = re.sub(r"\b(pvt|private|ltd|limited|inc|llp|llc|corp|corporation|co|company|technologies|technology|"
               r"solutions|services|india)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip() or norm_token(name)


def is_sensitive_header(header: str) -> bool:
    h = norm_header(header)
    if h in SENSITIVE_EXACT:
        return True
    return bool(set(re.split(r"[\s/()]+", h)) & SENSITIVE_TOKENS)


_AY = re.compile(r"(?:ay|a\.y\.|academic year|fy)?\s*((?:19|20)\d{2})\s*[-/–—to ]+\s*((?:19|20)?\d{2})\b", re.I)


def normalize_academic_year(v: Any) -> Optional[str]:
    """'2024-25', '2024-2025', '2024/25', 'AY 2024–25' → '2024-25'. Single years are ambiguous → None."""
    m = _AY.search(norm_token(v))
    if not m:
        return None
    start = int(m.group(1))
    end_raw = m.group(2)
    end = int(end_raw) if len(end_raw) == 4 else (start // 100) * 100 + int(end_raw)
    if end != start + 1:
        return None
    return f"{start}-{str(end)[-2:]}"


def year_start(ay: str) -> int:
    return int(ay[:4])


def enum_value(kind: str, v: Any) -> Optional[str]:
    """Canonical enum value, or None when the text isn't recognised."""
    t = norm_token(v)
    for canon, words in _SYNONYMS[kind].items():
        if t in words:
            return canon
    t2 = re.sub(r"[^a-z0-9 ]", "", t).strip()
    for canon, words in _SYNONYMS[kind].items():
        if t2 in words:
            return canon
    return None


def bool_value(v: Any) -> Tuple[bool, Optional[int]]:
    """(recognised, 1/0/None)."""
    t = norm_token(v)
    if t in ("", "na", "n/a", "-", "unknown", "?"):
        return True, None
    if t in _TRUE:
        return True, 1
    if t in _FALSE:
        return True, 0
    return False, None


def number_value(v: Any) -> Tuple[bool, Optional[float]]:
    t = norm_token(v)
    if t in ("", "na", "n/a", "-", "--", "nil"):
        return True, None
    t = re.sub(r"(rs\.?|inr|usd|lpa|per annum|p\.a\.|per month|pm|pa)(?=\s|$)", " ", t)
    t = t.replace("₹", "").replace("$", "").replace("/-", "").replace(",", "").strip()
    try:
        return True, float(t)
    except ValueError:
        return False, None


_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def date_value(v: Any) -> Tuple[bool, Optional[str]]:
    """ISO date string. Accepts ISO, DD-MM-YYYY / DD/MM/YYYY (day first), '5 Aug 2025', Excel serials."""
    t = norm_token(v)
    if t in ("", "na", "n/a", "-", "--"):
        return True, None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[ t].*)?", t):
            return True, date.fromisoformat(t[:10]).isoformat()
        m = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", t)
        if m:
            return True, date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat()
        m = re.fullmatch(r"(\d{1,2})[ -]([a-z]{3})[a-z]*[ ,-]*(\d{4})", t)
        if m and m.group(2) in _MONTHS:
            return True, date(int(m.group(3)), _MONTHS[m.group(2)], int(m.group(1))).isoformat()
        m = re.fullmatch(r"([a-z]{3})[a-z]* (\d{1,2}),? (\d{4})", t)
        if m and m.group(1) in _MONTHS:
            return True, date(int(m.group(3)), _MONTHS[m.group(1)], int(m.group(2))).isoformat()
        if re.fullmatch(r"\d{5}(?:\.0+)?", t):  # Excel serial (1900 date system)
            return True, (date(1899, 12, 30) + timedelta(days=int(float(t)))).isoformat()
    except ValueError:
        return False, None
    return False, None


def stage_lookup(stages: Sequence[Dict[str, Any]]) -> Dict[str, Tuple[str, int]]:
    """normalised label/synonym → (stage key, index)."""
    out: Dict[str, Tuple[str, int]] = {}
    for i, s in enumerate(stages):
        for w in [s["key"], s["label"], *s.get("synonyms", [])]:
            out.setdefault(norm_token(w), (s["key"], i))
    return out


def default_cycle_status(ay: str, today: Optional[date] = None) -> str:
    """Completed once the academic year has ended (30 June of its second calendar year)."""
    today = today or datetime.now().date()
    end = date(year_start(ay) + 1, 6, 30)
    return "completed" if today > end else "ongoing"


def default_cycle_start(ay: str) -> str:
    return date(year_start(ay), 7, 1).isoformat()
