"""
Financial intelligence for annual reports and financial documents (rule-based, provenance-first).

Extraction
  - Figures are taken only from text: a money amount next to a metric label in a sentence
    ("Net profit declined to $31.2 million in fiscal 2024 …"), or a table line under a header
    of years with a stated unit. Every figure keeps its document, page, sentence, reported
    label, currency, scale and period, and how the period was determined.
  - Amounts are normalised to millions of their own currency; different currencies are never
    combined. Segment figures ("the storage segment generated revenue of …") are kept apart
    from company totals.
  - Two different values for the same metric, period and currency are flagged as a conflict;
    nothing is averaged or silently picked.

Calculated figures (growth, margins, free cash flow, net debt, ratios) are labelled as
calculated, show their formula and inputs, and are only computed from inputs that share a
currency, a period and — for growth — the same reported label.

Risks
  - Disclosed: sentences that use risk language, grouped into categories by keywords.
    Severity is indicative and wording-based ("materially", "significant" → high).
  - Inferred: threshold rules over the extracted figures (METHODOLOGY). These are flags for
    follow-up, not a credit rating or a validated score.
"""

import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.intel.common import DocText, Sentence, doc_year, years_in


@dataclass(frozen=True)
class MetricDef:
    key: str
    label: str
    patterns: Tuple[str, ...]


METRICS: Tuple[MetricDef, ...] = (
    MetricDef("operating_cash_flow", "Operating cash flow", (
        r"net cash (?:generated |provided |inflow )?(?:from|by|in) operating activities",
        r"cash (?:flows? )?(?:generated )?from operations", r"operating cash flows?",
        r"cash (?:flows? )?from operating activities")),
    MetricDef("free_cash_flow", "Free cash flow", (r"free cash flows?",)),
    MetricDef("capex", "Capital expenditure", (r"capital expenditures?", r"capex",
                                               r"purchases? of property,? plant and equipment")),
    MetricDef("cash", "Cash and cash equivalents", (r"cash and cash equivalents", r"cash and equivalents",
                                                    r"cash balances?", r"cash reserves", r"cash on hand")),
    MetricDef("net_debt", "Net debt", (r"net debt",)),
    MetricDef("total_debt", "Total debt", (r"total debt", r"total borrowings", r"long-term debt", r"borrowings",
                                           r"gross debt")),
    MetricDef("total_assets", "Total assets", (r"total assets",)),
    MetricDef("total_liabilities", "Total liabilities", (r"total liabilities",)),
    MetricDef("ebitda", "EBITDA", (r"adjusted ebitda", r"ebitda")),
    MetricDef("operating_profit", "Operating profit", (r"operating profit", r"operating income", r"profit from operations",
                                                       r"\bebit\b", r"operating loss")),
    MetricDef("net_profit", "Net profit", (r"net profit", r"net income", r"profit after tax", r"\bpat\b",
                                           r"profit for the (?:year|period)", r"net loss", r"loss for the (?:year|period)",
                                           r"net earnings")),
    MetricDef("revenue", "Revenue", (r"total revenues?", r"net revenues?", r"revenues? from operations", r"total income",
                                     r"net sales", r"turnover", r"revenues?", r"sales")),
)
METRIC_LABEL = {m.key: m.label for m in METRICS}
_LOSS = re.compile(r"\b(?:net loss|operating loss|loss for the (?:year|period))\b", re.I)

_CUR = {"us$": "USD", "usd": "USD", "$": "USD", "dollars": "USD", "€": "EUR", "eur": "EUR", "euros": "EUR",
        "£": "GBP", "gbp": "GBP", "₹": "INR", "rs": "INR", "rs.": "INR", "inr": "INR", "rupees": "INR"}
_SYMBOL = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹"}
_SCALE = {"thousand": 1e-3, "k": 1e-3, "million": 1.0, "millions": 1.0, "mn": 1.0, "m": 1.0, "mm": 1.0,
          "billion": 1e3, "billions": 1e3, "bn": 1e3, "b": 1e3, "crore": 10.0, "crores": 10.0, "cr": 10.0,
          "lakh": 0.1, "lakhs": 0.1, "lac": 0.1, "lacs": 0.1}
_NUM = r"\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?"
MONEY_RE = re.compile(
    rf"(?P<cur>US\$|USD|EUR|GBP|INR|Rs\.?|₹|€|£|\$)\s?(?P<num>{_NUM})\s?"
    r"(?P<scale>thousand|millions?|billions?|crores?|lakhs?|lacs?|mn|bn|cr|mm|m|b|k)?(?![A-Za-z])"
    rf"|(?P<num2>{_NUM})\s?(?P<scale2>thousand|millions?|billions?|crores?|lakhs?|mn|bn|cr)\b"
    r"(?:\s(?:of\s)?(?P<cur2>USD|EUR|GBP|INR|dollars|euros|rupees)\b)?", re.I)
MARGIN_RE = re.compile(
    r"\b(?P<kind>ebitda|operating(?: profit)?|net(?: profit)?|pat)\s+margins?\b[^.%\d]{0,30}?"
    r"(?P<pct>\d+(?:\.\d+)?)\s?(?:%|percent|per cent)", re.I)
_RELATIVE_PREV = re.compile(r"^\W{0,3}(?:a year earlier|the prior year|the previous year|last year|a year ago)", re.I)
_DOC_CURRENCY = re.compile(
    r"(?:figures|amounts|all amounts|all figures)\s+(?:are\s+)?(?:stated\s+|presented\s+|expressed\s+)?in\s+"
    r"(?P<cur>us dollars|usd|us\$|euros?|eur|pounds|gbp|indian rupees|rupees|inr|₹)|\(in (?P<cur2>usd|us\$|eur|gbp|inr|₹)",
    re.I)
_TABLE_UNIT = re.compile(r"(?P<cur>US\$|USD|EUR|GBP|INR|Rs\.?|₹|€|£|\$)\s?(?:in\s)?(?P<scale>thousands?|millions?|"
                         r"billions?|crores?|lakhs?|mn|bn|cr)\b|(?:in|\()\s?(?P<scale2>thousands?|millions?|billions?|"
                         r"crores?|lakhs?)\s(?:of\s)?(?P<cur2>US dollars|USD|EUR|euros|GBP|INR|rupees|₹)", re.I)
_SEGMENT = re.compile(r"\b([A-Za-z][\w&\- ]{1,40}?)\s+(?:segment|division|business unit|business)\b", re.I)

RISK_CUE = re.compile(
    r"\b(?:risks?|uncertain(?:ty|ties)?|advers(?:e|ely)|exposure|exposed to|volatil\w*|litigation|lawsuits?|"
    r"penalt\w+|fines? (?:of|imposed)|fined|non-compliance|breach\w*|covenants?|defaults?|impairments?|going concern|"
    r"concentration|"
    r"depend(?:s|ent|ence)? on|relies on|reliance on|shortages?|cyber|disrupt\w*|downgrade\w*|delay\w*|outages?|"
    r"could (?:harm|affect|reduce|delay|disrupt|increase)|may (?:harm|affect|reduce|increase|not be able))\b", re.I)
RISK_CATEGORIES: Tuple[Tuple[str, str, Tuple[str, ...]], ...] = (
    ("liquidity", "Liquidity risk", (r"liquidit", r"working capital", r"refinanc", r"going concern", r"cash shortfall",
                                     r"short-term obligations", r"funding")),
    ("credit_debt", "Credit & debt risk", (r"\bdebt", r"borrowing", r"covenant", r"interest rate", r"credit rating",
                                           r"leverage", r"default", r"\bloans?\b", r"bonds?\b", r"credit facilit")),
    ("cash_flow", "Cash-flow risk", (r"cash flow", r"operating cash", r"cash generation")),
    ("profitability", "Profitability risk", (r"margin", r"profitab", r"\blosses\b", r"\bloss\b", r"cost increases?",
                                             r"pricing pressure", r"inflation", r"earnings", r"depreciation")),
    ("operational", "Operational risk", (r"supply chain", r"supplier", r"supply disruption", r"outage", r"cyber",
                                         r"it systems?", r"control systems?", r"workforce", r"safety", r"\bplants?\b",
                                         r"equipment", r"accident", r"construction", r"operations")),
    ("regulatory", "Regulatory risk", (r"regulat", r"compliance", r"\blaws?\b", r"legislation", r"permit", r"licen[cs]",
                                       r"tariff", r"\bact\b", r"commission", r"rate plans?", r"policy")),
    ("governance", "Governance risk", (r"governance", r"\bboard\b", r"related part", r"internal control", r"\baudit",
                                       r"fraud", r"whistleblow", r"management override")),
    ("market_concentration", "Market & concentration risk", (r"customer concentration", r"single (?:customer|supplier)",
                                                             r"largest customer", r"competition", r"competitor",
                                                             r"market share", r"commodit", r"demand", r"foreign exchange",
                                                             r"currency")),
)
CATEGORY_LABEL = {k: label for k, label, _ in RISK_CATEGORIES}
_HIGH = re.compile(r"\b(materially|material adverse|significant(?:ly)?|substantial(?:ly)?|severe(?:ly)?|"
                   r"going concern|default|critical)\b", re.I)
_MEDIUM = re.compile(r"\b(could|may|might|would)\b", re.I)

FOLLOW_UPS = {
    "liquidity": ["How does management plan to meet short-term obligations?",
                  "What liquidity headroom do the credit facilities provide?"],
    "credit_debt": ["What are the maturities and interest terms of the company's debt?",
                    "How close is the company to its covenant limits?"],
    "cash_flow": ["Why did operating cash flow change between the last two years?",
                  "How is capital expenditure being funded?"],
    "profitability": ["What drove the change in margins this year?",
                      "Which costs grew faster than revenue?"],
    "operational": ["What mitigation does management describe for operational disruptions?",
                    "How dependent are operations on single suppliers or systems?"],
    "regulatory": ["Which regulatory decisions affect revenue, and when are they due?",
                   "What compliance obligations does the company disclose?"],
    "governance": ["What did the audit committee report about internal controls?",
                   "Are there related-party transactions that deserve scrutiny?"],
    "market_concentration": ["How concentrated are the company's customers and suppliers?",
                             "How exposed is the company to commodity or currency movements?"],
}

METHODOLOGY = [
    {"rule": "net_loss", "category": "profitability", "severity": "high",
     "condition": "Net profit is negative in the latest period."},
    {"rule": "profit_decline", "category": "profitability", "severity": "medium",
     "condition": "Net profit fell by more than 20% year on year."},
    {"rule": "margin_decline", "category": "profitability", "severity": "medium",
     "condition": "Operating or net margin fell by 2 percentage points or more year on year."},
    {"rule": "revenue_decline", "category": "market_concentration", "severity": "medium",
     "condition": "Revenue fell year on year (same reported label)."},
    {"rule": "negative_ocf", "category": "cash_flow", "severity": "high",
     "condition": "Operating cash flow is negative in the latest period."},
    {"rule": "negative_fcf", "category": "cash_flow", "severity": "medium",
     "condition": "Free cash flow (reported, or operating cash flow − capital expenditure) is negative."},
    {"rule": "ocf_decline", "category": "cash_flow", "severity": "low",
     "condition": "Operating cash flow fell by more than 15% year on year."},
    {"rule": "debt_growth", "category": "credit_debt", "severity": "medium",
     "condition": "Total debt grew by more than 15% year on year."},
    {"rule": "debt_exceeds_cash", "category": "credit_debt", "severity": "low",
     "condition": "Total debt exceeds cash and cash equivalents (positive net debt)."},
    {"rule": "cash_decline", "category": "liquidity", "severity": "medium",
     "condition": "Cash and cash equivalents fell by more than 30% year on year."},
]
LIMITATIONS = [
    "Figures are extracted by pattern matching from the documents you uploaded; anything phrased unusually, held in "
    "images, or in tables without a stated unit can be missed.",
    "Reported labels are kept as written. Revenue growth is only calculated between periods that use the same label.",
    "Inferred risks are rule-based flags for follow-up — not a credit rating, audit opinion or validated score.",
    "Periods come from the sentence when it names one; otherwise from the document's fiscal year or title, which is "
    "shown next to each figure.",
]


# ═════════════════════════════════════════════════════════════════════════════
# Extraction
# ═════════════════════════════════════════════════════════════════════════════

def _num(s: str) -> float:
    return float(s.replace(",", ""))


def _display(value_m: float, currency: Optional[str]) -> str:
    sym = _SYMBOL.get(currency or "", (currency + " ") if currency else "")
    if abs(value_m) >= 1000:
        return f"{'-' if value_m < 0 else ''}{sym}{abs(value_m) / 1000:,.2f} billion"
    return f"{'-' if value_m < 0 else ''}{sym}{abs(value_m):,.1f} million"


def _label_spans(text: str) -> List[Tuple[int, int, MetricDef, str]]:
    spans: List[Tuple[int, int, MetricDef, str]] = []
    taken: List[Tuple[int, int]] = []
    for md in METRICS:  # most specific families first; a span claimed once isn't reused
        for pat in md.patterns:
            for m in re.finditer(pat, text, re.I):
                if any(not (m.end() <= a or m.start() >= b) for a, b in taken):
                    continue
                spans.append((m.start(), m.end(), md, m.group(0)))
                taken.append((m.start(), m.end()))
    return sorted(spans, key=lambda s: s[0])


def document_currency(doc: DocText) -> Optional[str]:
    for _, text in doc.pages[:3]:
        m = _DOC_CURRENCY.search(text)
        if m:
            raw = (m.group("cur") or m.group("cur2") or "").lower()
            for k, v in (("us", "USD"), ("usd", "USD"), ("eur", "EUR"), ("euro", "EUR"), ("pound", "GBP"),
                         ("gbp", "GBP"), ("rupee", "INR"), ("inr", "INR"), ("₹", "INR")):
                if k in raw:
                    return v
    return None


def _period_for(mstart: int, mend: int, years: List[Tuple[int, int, int, str]],
                fallback: Optional[Tuple[int, str, str]]) -> Optional[Dict[str, Any]]:
    best, best_d = None, 61
    for ys, ye, y, label in years:
        d = ys - mend if ys >= mend else (mstart - ye) + 15
        if 0 <= d < best_d:
            best, best_d = (y, label), d
    if best:
        return {"year": best[0], "label": best[1], "source": "sentence"}
    distinct = {y for _, _, y, _ in years}
    if len(distinct) == 1:
        y, label = years[0][2], years[0][3]
        return {"year": y, "label": label, "source": "sentence"}
    if fallback:
        return {"year": fallback[0], "label": fallback[1], "source": fallback[2]}
    return None


def extract_figures(doc: DocText, meta: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[str]]:
    """(company figures, segment figures, notes) for one document."""
    figures: List[Dict[str, Any]] = []
    segments: List[Dict[str, Any]] = []
    notes: List[str] = []
    default_cur = document_currency(doc)
    fallback = doc_year(doc, meta.get("fiscal_year"))
    for s in doc.sentences:
        text = s.text
        labels = _label_spans(text)
        if not labels:
            continue
        years = years_in(text)
        for m in MONEY_RE.finditer(text):
            cur_raw = (m.group("cur") or m.group("cur2") or "").lower()
            currency = _CUR.get(cur_raw.rstrip(".")) or _CUR.get(cur_raw) or default_cur
            scale_raw = (m.group("scale") or m.group("scale2") or "").lower()
            if not scale_raw and not m.group("cur"):
                continue
            scale = _SCALE.get(scale_raw, 1e-6 if not scale_raw else None)
            if scale is None:
                continue
            value = _num(m.group("num") or m.group("num2")) * scale
            # the nearest metric label before the amount (or "… $X in revenue" right after it)
            before = [lb for lb in labels if lb[1] <= m.start() and m.start() - lb[1] <= 120]
            after = [lb for lb in labels if 0 <= lb[0] - m.end() <= 12
                     and re.fullmatch(r"\s+(?:in|of)\s+", text[m.end():lb[0]] or "x")]
            lb = before[-1] if before else (after[0] if after else None)
            if lb is None:
                continue
            md = lb[2]
            if _LOSS.search(lb[3]) and value > 0:
                value = -value
            rest = text[m.end():]
            if _RELATIVE_PREV.search(rest) and years:
                period = {"year": max(y for _, _, y, _ in years) - 1, "label": f"{max(y for _, _, y, _ in years) - 1}",
                          "source": "sentence (relative: 'a year earlier')"}
            else:
                period = _period_for(m.start(), m.end(), years, fallback)
            if period is None:
                continue
            seg_m = _SEGMENT.search(text[:lb[0]])
            fig = {"metric": md.key, "metric_label": md.label, "reported_label": lb[3].strip(), "value": round(value, 4),
                   "currency": currency, "display": _display(value, currency), "as_written": m.group(0).strip(),
                   "period": period, "basis": "reported", "method": "sentence",
                   "citation": doc.citation(s)}
            if seg_m and md.key == "revenue" and "total" not in lb[3].lower():
                seg = seg_m.group(1).strip()
                seg = re.sub(r"^(?:the|our|its)\s+", "", seg, flags=re.I)
                fig["segment"] = seg[:60]
                segments.append(fig)
            else:
                figures.append(fig)
        for m in MARGIN_RE.finditer(text):
            kind = m.group("kind").lower()
            key = ("ebitda_margin" if kind.startswith("ebitda") else "operating_margin" if kind.startswith("operating")
                   else "net_margin")
            period = _period_for(m.start(), m.end(), years, fallback)
            if period:
                figures.append({"metric": key, "metric_label": key.replace("_", " ").capitalize() + " (%)",
                                "reported_label": m.group(0).strip(), "value": float(m.group("pct")), "currency": None,
                                "display": f"{float(m.group('pct')):.1f}%", "as_written": m.group(0).strip(),
                                "period": period, "basis": "reported", "method": "sentence", "unit": "%",
                                "citation": doc.citation(s)})
    figures.extend(_table_figures(doc, default_cur, notes))
    return figures, segments, notes


def _table_figures(doc: DocText, default_cur: Optional[str], notes: List[str]) -> List[Dict[str, Any]]:
    """Lines like 'Revenue  412.5  380.2' under a header line of years, with a unit stated nearby."""
    out: List[Dict[str, Any]] = []
    skipped = 0
    for pnum, text in doc.pages:
        lines = text.split("\n")
        header: Optional[List[Tuple[int, str]]] = None
        unit: Optional[Tuple[Optional[str], float]] = None
        pos = 0
        for line in lines:
            line_start = pos
            pos += len(line) + 1
            u = _TABLE_UNIT.search(line)
            if u:
                cur_raw = (u.group("cur") or u.group("cur2") or "").lower().rstrip(".")
                cur = _CUR.get(cur_raw) or ("USD" if "dollar" in cur_raw else "EUR" if "euro" in cur_raw else
                                            "INR" if "rupee" in cur_raw else None) or default_cur
                sc = (u.group("scale") or u.group("scale2") or "").lower().rstrip("s")
                unit = (cur, _SCALE.get(sc, _SCALE.get(sc + "s", 1.0)))
            ys = years_in(line)
            words = re.sub(r"(?:fy\s?)?\d{2,4}(?:[-/]\d{2,4})?", "", line, flags=re.I).strip()
            if len(ys) >= 2 and len(words) <= 25:
                header = [(y, label) for _, _, y, label in ys]
                continue
            if not header:
                continue
            labels = _label_spans(line)
            if not labels or labels[0][0] > 3:
                continue
            nums = re.findall(r"\(?-?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?\)?", line[labels[0][1]:])
            nums = [n for n in nums if not re.fullmatch(r"(?:19|20)\d{2}", n.strip("()"))]
            if len(nums) != len(header):
                continue
            if unit is None:
                skipped += 1
                continue
            md = labels[0][2]
            for raw, (y, label) in zip(nums, header):
                neg = raw.startswith("(") or raw.startswith("-") or _LOSS.search(labels[0][3]) is not None
                v = _num(raw.strip("()-")) * unit[1] * (-1 if neg else 1)
                sent = Sentence(doc.doc_id, doc.filename, pnum, line_start, line_start + len(line), line.strip(), "", -1)
                out.append({"metric": md.key, "metric_label": md.label, "reported_label": labels[0][3].strip(),
                            "value": round(v, 4), "currency": unit[0], "display": _display(v, unit[0]),
                            "as_written": raw, "period": {"year": y, "label": label, "source": "table header"},
                            "basis": "reported", "method": "table", "citation": doc.citation(sent)})
    if skipped:
        notes.append(f"{skipped} table row(s) in {doc.filename} were skipped because no unit (currency and scale) "
                     "was stated near the table.")
    return out


# ═════════════════════════════════════════════════════════════════════════════
# Series, calculations, risks
# ═════════════════════════════════════════════════════════════════════════════

def build_series(figures: Sequence[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """metric → {label, points: [{period, currency, value, conflict, variants, …}]} (one point per period+currency)."""
    groups: Dict[Tuple[str, Optional[str], int], List[Dict[str, Any]]] = defaultdict(list)
    for f in figures:
        groups[(f["metric"], f["currency"], f["period"]["year"])].append(f)
    series: Dict[str, Dict[str, Any]] = {}
    for (metric, currency, year), figs in groups.items():
        # prefer periods stated in the sentence, then sentences over tables, then document order
        figs = sorted(figs, key=lambda f: (f["period"]["source"] != "sentence", f["method"] != "sentence"))
        chosen = figs[0]
        distinct = []
        for f in figs:
            if all(abs(f["value"] - d["value"]) > max(0.005 * abs(d["value"]), 1e-9) for d in distinct):
                distinct.append(f)
        point = {**chosen, "conflict": len(distinct) > 1, "variants": distinct if len(distinct) > 1 else [],
                 "sources": [f["citation"] for f in figs], "labels": sorted({f["reported_label"] for f in figs})}
        s = series.setdefault(metric, {"metric": metric, "label": chosen["metric_label"], "points": []})
        s["points"].append(point)
    for s in series.values():
        s["points"].sort(key=lambda p: (p["currency"] or "", p["period"]["year"]))
    return series


def _point(series: Dict[str, Dict[str, Any]], metric: str, year: int, currency: Optional[str]) -> Optional[Dict[str, Any]]:
    for p in series.get(metric, {}).get("points", []):
        if p["period"]["year"] == year and p["currency"] == currency and not p["conflict"]:
            return p
    return None


def _ref(p: Dict[str, Any]) -> Dict[str, Any]:
    return {"metric": p["metric"], "label": p["metric_label"], "period": p["period"]["label"], "value": p["value"],
            "display": p["display"], "basis": p["basis"], "citation": p["citation"]}


def derived_metrics(series: Dict[str, Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    out: List[Dict[str, Any]] = []
    notes: List[str] = []
    periods = sorted({(p["period"]["year"], p["currency"]) for s in series.values() for p in s["points"]
                      if p.get("unit") != "%"})

    def add(key, label, year, currency, value, unit, formula, inputs):
        out.append({"metric": key, "label": label, "period": {"year": year, "label": next(
            (i["period"] for i in inputs), str(year))}, "currency": currency, "value": round(value, 2), "unit": unit,
            "display": f"{value:.1f}%" if unit == "%" else f"{value:.2f}×" if unit == "x" else _display(value, currency),
            "basis": "calculated", "formula": formula, "inputs": inputs})

    for year, cur in periods:
        rev = _point(series, "revenue", year, cur)
        for key, label, num_key in (("ebitda_margin_calc", "EBITDA margin", "ebitda"),
                                    ("operating_margin_calc", "Operating margin", "operating_profit"),
                                    ("net_margin_calc", "Net margin", "net_profit")):
            n = _point(series, num_key, year, cur)
            if rev and n and rev["value"]:
                add(key, label, year, cur, 100 * n["value"] / rev["value"], "%",
                    f"{METRIC_LABEL[num_key]} ÷ Revenue × 100", [_ref(n), _ref(rev)])
        prev = _point(series, "revenue", year - 1, cur)
        if rev and prev and prev["value"]:
            if {x.lower() for x in rev["labels"]} & {x.lower() for x in prev["labels"]}:
                add("revenue_growth", "Revenue growth", year, cur, 100 * (rev["value"] - prev["value"]) / abs(prev["value"]),
                    "%", "(Revenue this year − Revenue last year) ÷ Revenue last year × 100", [_ref(rev), _ref(prev)])
            else:
                notes.append(f"Revenue growth for {year} not calculated: the two years use different labels "
                             f"({', '.join(prev['labels'])} vs {', '.join(rev['labels'])}).")
        ocf, capex = _point(series, "operating_cash_flow", year, cur), _point(series, "capex", year, cur)
        if ocf and capex and not _point(series, "free_cash_flow", year, cur):
            add("free_cash_flow_calc", "Free cash flow", year, cur, ocf["value"] - abs(capex["value"]), "currency",
                "Operating cash flow − Capital expenditure", [_ref(ocf), _ref(capex)])
        debt, cash = _point(series, "total_debt", year, cur), _point(series, "cash", year, cur)
        if debt and cash and not _point(series, "net_debt", year, cur):
            add("net_debt_calc", "Net debt", year, cur, debt["value"] - cash["value"], "currency",
                "Total debt − Cash and cash equivalents", [_ref(debt), _ref(cash)])
        if debt and cash and cash["value"] > 0:
            add("debt_to_cash", "Debt to cash", year, cur, debt["value"] / cash["value"], "x",
                "Total debt ÷ Cash and cash equivalents", [_ref(debt), _ref(cash)])
        ta, tl = _point(series, "total_assets", year, cur), _point(series, "total_liabilities", year, cur)
        if ta and tl and ta["value"]:
            add("liabilities_to_assets", "Liabilities to assets", year, cur, 100 * tl["value"] / ta["value"], "%",
                "Total liabilities ÷ Total assets × 100", [_ref(tl), _ref(ta)])
    return out, notes


def _category(text: str) -> Optional[str]:
    scores = []
    for i, (key, _, pats) in enumerate(RISK_CATEGORIES):
        n = sum(1 for p in pats if re.search(p, text, re.I))
        if n:
            scores.append((-n, i, key))
    return min(scores)[2] if scores else None


def disclosed_risks(docs: Sequence[DocText], meta: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for doc in docs:
        fallback = doc_year(doc, (meta.get(doc.doc_id) or {}).get("fiscal_year"))
        for s in doc.sentences:
            if len(s.text) < 30 or not RISK_CUE.search(s.text):
                continue
            cat = _category(s.text)
            if cat is None:
                continue
            in_risk_section = "risk" in (s.heading or "").lower()
            severity = "high" if _HIGH.search(s.text) else "medium" if _MEDIUM.search(s.text) else "low"
            ys = years_in(s.text)
            words = re.sub(r"\s+", " ", s.text).split(" ")
            out.append({
                "category": cat, "category_label": CATEGORY_LABEL[cat], "basis": "disclosed",
                "title": " ".join(words[:12]) + ("…" if len(words) > 12 else ""),
                "explanation": s.text, "severity": severity, "severity_basis": "wording",
                "in_risk_section": in_risk_section,
                "period": ({"year": ys[0][2], "label": ys[0][3], "source": "sentence"} if ys else
                           {"year": fallback[0], "label": fallback[1], "source": fallback[2]} if fallback else None),
                "evidence": [doc.citation(s)], "follow_ups": FOLLOW_UPS[cat],
            })
    counts = Counter(r["category"] for r in out)
    for r in out:
        n = counts[r["category"]]
        r["evidence_strength"] = "strong" if n >= 3 or (r["in_risk_section"] and n >= 2) else \
            "moderate" if n == 2 or r["in_risk_section"] else "limited"
        r["supporting_sentences_in_category"] = n
    return out


def inferred_risks(series: Dict[str, Dict[str, Any]], derived: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    rule = {m["rule"]: m for m in METHODOLOGY}

    def latest_pair(metric: str, source: Optional[List[Dict[str, Any]]] = None):
        pts = source if source is not None else [p for p in series.get(metric, {}).get("points", []) if not p["conflict"]]
        by_cur: Dict[Optional[str], List[Dict[str, Any]]] = defaultdict(list)
        for p in pts:
            by_cur[p["currency"]].append(p)
        best = None
        for cur, ps in by_cur.items():
            ps = sorted(ps, key=lambda p: p["period"]["year"])
            if best is None or ps[-1]["period"]["year"] > best[0]["period"]["year"]:
                prev = ps[-2] if len(ps) >= 2 and ps[-2]["period"]["year"] == ps[-1]["period"]["year"] - 1 else None
                best = (ps[-1], prev)
        return best or (None, None)

    def flag(rule_id: str, title: str, explanation: str, inputs: List[Dict[str, Any]], period: Dict[str, Any]):
        m = rule[rule_id]
        out.append({"category": m["category"], "category_label": CATEGORY_LABEL[m["category"]], "basis": "inferred",
                    "title": title, "explanation": explanation, "severity": m["severity"], "severity_basis": "rule",
                    "rule": rule_id, "condition": m["condition"], "period": period, "evidence": [],
                    "inputs": inputs, "follow_ups": FOLLOW_UPS[m["category"]], "evidence_strength": "calculated"})

    np_now, np_prev = latest_pair("net_profit")
    if np_now and np_now["value"] < 0:
        flag("net_loss", f"Net loss in {np_now['period']['label']}", f"Net profit was {np_now['display']}.",
             [_ref(np_now)], np_now["period"])
    elif np_now and np_prev and np_prev["value"] > 0 and (np_prev["value"] - np_now["value"]) / np_prev["value"] > 0.2:
        pct = 100 * (np_prev["value"] - np_now["value"]) / np_prev["value"]
        flag("profit_decline", f"Net profit down {pct:.0f}% in {np_now['period']['label']}",
             f"Net profit fell from {np_prev['display']} to {np_now['display']}.", [_ref(np_now), _ref(np_prev)],
             np_now["period"])
    for key, label in (("operating_margin_calc", "Operating margin"), ("net_margin_calc", "Net margin")):
        pts = [d for d in derived if d["metric"] == key]
        now, prev = latest_pair(key, [{**d, "conflict": False} for d in pts])
        if now and prev and prev["value"] - now["value"] >= 2:
            flag("margin_decline", f"{label} down {prev['value'] - now['value']:.1f} pp in {now['period']['label']}",
                 f"{label} fell from {prev['value']:.1f}% to {now['value']:.1f}% (calculated).",
                 [{"metric": key, "label": label, "period": p["period"]["label"], "value": p["value"],
                   "display": p["display"], "basis": "calculated", "formula": p["formula"]} for p in (now, prev)],
                 now["period"])
    rev_now, rev_prev = latest_pair("revenue")
    if rev_now and rev_prev and rev_now["value"] < rev_prev["value"] and \
            {x.lower() for x in rev_now["labels"]} & {x.lower() for x in rev_prev["labels"]}:
        flag("revenue_decline", f"Revenue fell in {rev_now['period']['label']}",
             f"Revenue went from {rev_prev['display']} to {rev_now['display']}.", [_ref(rev_now), _ref(rev_prev)],
             rev_now["period"])
    ocf_now, ocf_prev = latest_pair("operating_cash_flow")
    if ocf_now and ocf_now["value"] < 0:
        flag("negative_ocf", f"Negative operating cash flow in {ocf_now['period']['label']}",
             f"Operating cash flow was {ocf_now['display']}.", [_ref(ocf_now)], ocf_now["period"])
    elif ocf_now and ocf_prev and ocf_prev["value"] > 0 and (ocf_prev["value"] - ocf_now["value"]) / ocf_prev["value"] > 0.15:
        flag("ocf_decline", f"Operating cash flow down {100 * (ocf_prev['value'] - ocf_now['value']) / ocf_prev['value']:.0f}%",
             f"Operating cash flow fell from {ocf_prev['display']} to {ocf_now['display']}.",
             [_ref(ocf_now), _ref(ocf_prev)], ocf_now["period"])
    fcf_pts = [p for p in series.get("free_cash_flow", {}).get("points", []) if not p["conflict"]] or \
        [{**d, "conflict": False} for d in derived if d["metric"] == "free_cash_flow_calc"]
    fcf_now, _ = latest_pair("free_cash_flow", fcf_pts)
    if fcf_now and fcf_now["value"] < 0:
        flag("negative_fcf", f"Negative free cash flow in {fcf_now['period']['label']}",
             f"Free cash flow was {fcf_now['display']}" + (" (calculated)." if fcf_now["basis"] == "calculated" else "."),
             fcf_now.get("inputs") or [_ref(fcf_now)], fcf_now["period"])
    debt_now, debt_prev = latest_pair("total_debt")
    if debt_now and debt_prev and debt_prev["value"] > 0 and (debt_now["value"] - debt_prev["value"]) / debt_prev["value"] > 0.15:
        flag("debt_growth", f"Debt up {100 * (debt_now['value'] - debt_prev['value']) / debt_prev['value']:.0f}% in "
             f"{debt_now['period']['label']}", f"Total debt rose from {debt_prev['display']} to {debt_now['display']}.",
             [_ref(debt_now), _ref(debt_prev)], debt_now["period"])
    cash_now, cash_prev = latest_pair("cash")
    if debt_now and cash_now and debt_now["period"]["year"] == cash_now["period"]["year"] \
            and debt_now["currency"] == cash_now["currency"] and debt_now["value"] > cash_now["value"]:
        flag("debt_exceeds_cash", f"Debt exceeds cash in {debt_now['period']['label']}",
             f"Total debt {debt_now['display']} vs cash {cash_now['display']} "
             f"({debt_now['value'] / cash_now['value']:.1f}× cash)." if cash_now["value"] > 0 else
             f"Total debt {debt_now['display']} vs cash {cash_now['display']}.",
             [_ref(debt_now), _ref(cash_now)], debt_now["period"])
    if cash_now and cash_prev and cash_prev["value"] > 0 and (cash_prev["value"] - cash_now["value"]) / cash_prev["value"] > 0.3:
        flag("cash_decline", f"Cash down {100 * (cash_prev['value'] - cash_now['value']) / cash_prev['value']:.0f}% in "
             f"{cash_now['period']['label']}", f"Cash and cash equivalents fell from {cash_prev['display']} to "
             f"{cash_now['display']}.", [_ref(cash_now), _ref(cash_prev)], cash_now["period"])
    return out


def analyse(docs: Sequence[DocText], meta: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    figures: List[Dict[str, Any]] = []
    segments: List[Dict[str, Any]] = []
    notes: List[str] = []
    for d in docs:
        f, s, n = extract_figures(d, meta.get(d.doc_id) or {})
        figures += f
        segments += s
        notes += n
    series = build_series(figures)
    derived, dnotes = derived_metrics(series)
    disclosed = disclosed_risks(docs, meta)
    inferred = inferred_risks(series, derived)
    periods = sorted({p["period"]["year"] for s in series.values() for p in s["points"]})
    summary = []
    for key, label, _ in RISK_CATEGORIES:
        items = [r for r in disclosed + inferred if r["category"] == key]
        if items:
            sev = max(items, key=lambda r: {"high": 3, "medium": 2, "low": 1}[r["severity"]])["severity"]
            summary.append({"category": key, "label": label, "disclosed": sum(1 for r in items if r["basis"] == "disclosed"),
                            "inferred": sum(1 for r in items if r["basis"] == "inferred"), "max_severity": sev})
    conflicts = [p for s in series.values() for p in s["points"] if p["conflict"]]
    if conflicts:
        notes.append(f"{len(conflicts)} figure(s) appear with different values in the documents; they are flagged "
                     "and excluded from calculations.")
    if not figures:
        notes.append("No financial figures were found. Upload an annual report or financial statements with amounts "
                     "written as text (e.g. “revenue of $412.5 million in fiscal 2024”).")
    return {"metrics": series, "derived": derived, "segments": segments, "periods": periods,
            "currencies": sorted({f["currency"] for f in figures if f["currency"]}),
            "risks": {"disclosed": disclosed, "inferred": inferred, "summary": summary},
            "methodology": METHODOLOGY, "limitations": LIMITATIONS, "notes": notes + dnotes,
            "figure_count": len(figures)}


def corporate_graph(analysis: Dict[str, Any], kb, company: Optional[str]) -> Dict[str, Any]:
    """Company ↔ reporting periods, figures, segments and risk categories (from the analysis), joined to the
    workspace KB's own entities and relations around the company (KB ids are kept, so their evidence opens
    in the normal inspector). Communities: one per reporting period, plus risks and organisation."""
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: Dict[str, Dict[str, Any]] = {}

    def node(nid, name, ntype, community=None, detail=None):
        n = nodes.setdefault(nid, {"id": nid, "name": name, "type": ntype, "community": community, "degree": 0,
                                   "mentions": 1, "doc_count": 1, "detail": detail or {}})
        return n

    def edge(eid, src, dst, pred, n=1, detail=None):
        e = edges.setdefault(eid, {"id": eid, "source": src, "target": dst, "predicate": pred, "evidence_count": 0,
                                   "doc_count": 1, "cross_topic": False, "methods": "analysis", "detail": detail or {}})
        e["evidence_count"] += n
        return e

    kb.retriever.refresh()
    company_id = None
    if company:
        linked = [e for e in kb.retriever.link_entities(company) if e["type"] in ("Organization", "Other")]
        if linked:
            company_id = linked[0]["id"]
            node(company_id, kb.retriever.entities[company_id]["name"], "Company", "org")
    if company_id is None:
        company_id = "co:company"
        node(company_id, company or "Company", "Company", "org")

    periods = analysis["periods"]
    topics = [{"id": f"period:{y}", "label": f"Reporting period {y}", "summary": "Figures reported for this period.",
               "keywords": [], "size": 0, "doc_ids": [], "evidence_chunk_ids": [], "method": "extractive",
               "color_index": i, "top_entities": []} for i, y in enumerate(periods)]
    topics += [{"id": "risk", "label": "Risks", "summary": "Disclosed and inferred risk categories.", "keywords": [],
                "size": 0, "doc_ids": [], "evidence_chunk_ids": [], "method": "extractive",
                "color_index": len(topics), "top_entities": []},
               {"id": "org", "label": "Organisation", "summary": "The company and the people and organisations the "
                "documents relate to it.", "keywords": [], "size": 0, "doc_ids": [], "evidence_chunk_ids": [],
                "method": "extractive", "color_index": len(topics) + 1, "top_entities": []}]
    for y in periods:
        node(f"period:{y}", str(y), "Reporting period", f"period:{y}")
    for key, s in analysis["metrics"].items():
        for p in s["points"]:
            y = p["period"]["year"]
            nid = f"fig:{key}:{y}:{p['currency']}"
            node(nid, f"{s['label']} {p['period']['label']}: {p['display']}", "Financial metric", f"period:{y}",
                 {"value": p["display"], "basis": p["basis"], "period": p["period"], "conflict": p["conflict"],
                  "citation": p["citation"], "reported_label": p["reported_label"]})
            edge(f"{company_id}>reported>{nid}", company_id, nid, "reported", detail={"basis": "reported"})
            edge(f"{nid}>for>{y}", nid, f"period:{y}", "for period")
    for d in analysis["derived"]:
        y = d["period"]["year"]
        nid = f"calc:{d['metric']}:{y}"
        node(nid, f"{d['label']} {d['period']['label']}: {d['display']}", "Calculated metric", f"period:{y}",
             {"value": d["display"], "basis": "calculated", "formula": d["formula"], "inputs": d["inputs"]})
        for inp in d["inputs"]:
            src = next((n for n in nodes if n.startswith(f"fig:{inp['metric']}:") and n.split(":")[2] == str(y)), None)
            if src:
                edge(f"{src}>input>{nid}", src, nid, "input to")
    for seg in {f["segment"] for f in analysis["segments"]}:
        figs = [f for f in analysis["segments"] if f["segment"] == seg]
        nid = f"seg:{seg.lower()}"
        node(nid, f"{seg.title()} segment", "Business segment", "org",
             {"figures": [{"period": f["period"]["label"], "value": f["display"], "citation": f["citation"]} for f in figs]})
        edge(f"{company_id}>segment>{nid}", company_id, nid, "has segment", n=len(figs))
    for r in analysis["risks"]["summary"]:
        nid = f"risk:{r['category']}"
        node(nid, r["label"], "Risk", "risk", r)
        edge(f"{company_id}>risk>{nid}", company_id, nid, "faces", n=r["disclosed"] + r["inferred"],
             detail={"disclosed": r["disclosed"], "inferred": r["inferred"], "max_severity": r["max_severity"]})
    if not company_id.startswith("co:"):
        for rel in kb.retriever.entity_relations(company_id, limit=40):
            other = rel["object_id"] if rel["subject_id"] == company_id else rel["subject_id"]
            e = kb.retriever.entities.get(other)
            if not e:
                continue
            node(other, e["name"], e["type"], "org")
            ed = edge(rel["relation_id"], rel["subject_id"], rel["object_id"], rel["predicate"],
                      n=int(rel.get("evidence_count") or 1))
            ed["methods"] = rel.get("methods") or "text"
            ed["kb_relation"] = True
    for e in edges.values():
        if e["source"] in nodes and e["target"] in nodes:
            nodes[e["source"]]["degree"] += 1
            nodes[e["target"]]["degree"] += 1
    for t in topics:
        members = [n for n in nodes.values() if n["community"] == t["id"]]
        t["size"] = len(members)
        t["top_entities"] = [{"id": n["id"], "name": n["name"], "type": n["type"], "community": t["id"]}
                             for n in members[:6]]
    return {"version": len(edges), "nodes": list(nodes.values()),
            "edges": [e for e in edges.values() if e["source"] in nodes and e["target"] in nodes],
            "topics": [t for t in topics if t["size"]], "topic_links": [], "truncated": False, "documents": [],
            "company_entity": company_id}
