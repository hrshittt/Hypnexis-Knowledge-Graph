"""
Entity & relation extraction → (subject, predicate, object) triples with verbatim evidence.

Two extractors share one output type (ChunkExtraction):

  HeuristicExtractor — no API key needed. Capitalised-run NER + concept phrases,
      lexicon-driven predicates (active/passive/role/possessive), appositive and
      relative-clause splitting, coordination, and light pronoun/definite-NP
      coreference. Every relation's evidence is the exact source sentence.

  LLMExtractor — Gemini JSON extraction, then *validated against the passage*:
      entities must occur in the chunk, evidence must be a verbatim sentence of the
      chunk, and at least one endpoint must appear in that sentence. Anything that
      fails is dropped, so the graph never contains relations the text doesn't state.
"""

import asyncio
import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Set, Tuple

from backend.kb import lexicon as L
from backend.kb.text_utils import (
    STOPWORDS, display_name, find_all_ci, index_terms, locate_sentence, normalize_name, normalize_ws,
    split_sentences, tokenize,
)
from backend.utils.logger import get_logger

log = get_logger(__name__)

ENTITY_TYPES = ("Person", "Organization", "Location", "Facility", "Policy", "Publication", "Project",
                "Product", "Technology", "Concept", "Event", "Other")


@dataclass
class ExtractedEntity:
    name: str
    type: str = "Other"
    description: str = ""
    kind: str = "named"  # named | concept


@dataclass
class ExtractedRelation:
    subject: str
    predicate: str
    object: str
    evidence: str
    confidence: float = 0.6


@dataclass
class ChunkExtraction:
    chunk_id: str
    entities: List[ExtractedEntity] = field(default_factory=list)
    relations: List[ExtractedRelation] = field(default_factory=list)
    aliases: List[Tuple[str, str]] = field(default_factory=list)  # (alias, canonical name)
    method: str = "heuristic"
    rejected: int = 0


# ═════════════════════════════════════════════════════════════════════════════
# Shared helpers
# ═════════════════════════════════════════════════════════════════════════════

_WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’\-&]*[A-Za-z0-9]|[A-Za-z0-9]|[^\sA-Za-z0-9]")
_CONNECTORS = {"of", "for", "the", "de", "du", "la", "von", "van", "upon", "&", "on"}
_GAP_BLOCKERS = {"which", "that", "who", "whom", "whose", "because", "although", "though", "while", "when",
                 "if", "unless", "whereas", "but", "however", "after", "before", "since", "until", "where"}
_PREP_SUFFIX = {"in", "at", "to", "for", "with", "on", "from", "into", "of"}
_CONCEPT_LEAD_SKIP = {"the", "a", "an", "its", "their", "his", "her", "our", "this", "these", "those",
                      "several", "many", "some", "new", "multiple", "various", "all", "more", "most", "other",
                      "additional", "two", "three", "four", "five", "first", "both", "further", "continued"}
_CONCEPT_STOP = set(STOPWORDS) | {"used", "using", "based", "located", "called", "known", "including", "such",
                                  "via", "per", "than", "across", "within", "during", "through", "because"}
_HEAD_PREPOSITIONS = {"from", "of", "in", "on", "at", "near", "with", "among", "across", "around"}


def guess_type(name: str, honorific: bool = False, prev_word: str = "") -> str:
    toks = [t.lower().strip(".") for t in name.split()]
    if not toks:
        return "Other"
    if honorific:
        return "Person"
    if name[:1].islower():
        return "Concept"
    last, first = toks[-1], toks[0]
    if first in L.PUBLICATION_WORDS or last in L.PUBLICATION_WORDS:
        return "Publication"
    if last in L.POLICY_WORDS:
        return "Policy"
    if last in L.FACILITY_WORDS:
        return "Facility"
    if last in L.PROJECT_WORDS:
        return "Project"
    if any(t in L.ORG_WORDS for t in toks[1:]) or last in L.ORG_WORDS:
        return "Organization"
    if last in L.LOCATION_WORDS or first in L.LOCATION_FIRST_WORDS:
        return "Location"
    if len(toks) == 1 and name.isupper() and len(name) >= 2:
        return "Organization"
    if (2 <= len(toks) <= 4 and all(t.isalpha() and len(t) >= 2 for t in toks)
            and not any(t in L.COMMON_WORDS for t in toks)):
        return "Location" if prev_word.lower() in ("in", "near", "from") else "Person"
    if prev_word.lower() in ("in", "near"):
        return "Location"
    return "Other"


@dataclass
class _Span:
    start: int
    end: int
    name: str
    type: str
    kind: str = "named"
    honorific: bool = False


@dataclass
class _Pred:
    start: int
    end: int
    canonical: str
    passive: bool
    kind: str  # verb | role | role_poss


# Passive forms tolerate an adverb after the auxiliary and a time adverbial before "by":
#   "was founded in 2015 by", "was originally established by", "was acquired in March 2021 by".
# Without this, the shorter active form ("founded") matched instead and the triple came out reversed.
_ADVERB = r"(?:[a-z]+ly|also|later|first|then|once|subsequently|eventually|recently|originally)"
_MONTH = (r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|"
          r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?")
_DATE = (r"(?:(?:the\s+)?(?:early\s+|mid-?|late\s+)?\d{4}s?|" + _MONTH + r"\s+(?:\d{1,2},?\s+)?\d{4}|"
         r"\d{1,2}\s+" + _MONTH + r"\s+\d{4})")
_TIME_ADVERBIAL = r"(?:in|on|during|around|circa|since|from)\s+" + _DATE + r"(?:\s+(?:to|and|until)\s+" + _DATE + r")?"
_AUX = {"is", "was", "are", "were", "been", "being"}


def _form_re(form: str) -> str:
    return r"\s+".join(re.escape(w) for w in form.split())


def _passive_re(form: str) -> str:
    words = form.split()
    if words[-1] != "by" or len(words) < 2:
        return _form_re(form)
    core = [re.escape(w) for w in words[:-1]]
    if words[0] in _AUX and len(core) >= 2:
        core[0] += rf"(?:\s+{_ADVERB})?"
    return r"\s+".join(core) + rf"(?:\s+{_ADVERB})?(?:\s*,?\s+{_TIME_ADVERBIAL},?)?\s+by"


def _build_pred_regexes() -> List[Tuple[re.Pattern, str, bool, str]]:
    form_re = _form_re
    out = []
    for canon, forms in L.ACTIVE_PREDICATES.items():
        for f in sorted(forms, key=len, reverse=True):
            out.append((re.compile(r"(?<![A-Za-z\-])" + form_re(f) + r"(?![A-Za-z\-])", re.I), canon, False, "verb"))
    for canon, forms in L.PASSIVE_PREDICATES.items():
        for f in sorted(forms, key=len, reverse=True):
            out.append((re.compile(r"(?<![A-Za-z\-])" + _passive_re(f) + r"(?![A-Za-z\-])", re.I), canon, True, "verb"))
    out.append((re.compile(r"(?<![A-Za-z])" + L.RECEIVED_FROM_PATTERN + r"(?![A-Za-z])", re.I), "funds", True, "verb"))

    roles = sorted(((r, c) for c, rs in L.ROLE_PREDICATES.items() for r in rs), key=lambda x: -len(x[0]))
    for role, canon in roles:
        r = form_re(role)
        copula = (
            r"(?:\s*,\s*|\s+(?:is|was|serves\s+as|served\s+as|became|has\s+been|remains|works\s+as|worked\s+as)\s+)"
            r"(?:the\s+|a\s+|an\s+)?(?:[a-z][a-z\-]*\s+){0,2}?" + r + r"s?\s+(?:of|at|for|with)\s+(?:the\s+)?"
        )
        out.append((re.compile(copula, re.I), canon, False, "role"))
        poss = r"(?:'s|’s|'|’)\s+(?:[a-z][a-z\-]*\s+){0,2}?" + r + r"\s*,?\s+"
        out.append((re.compile(poss, re.I), canon, True, "role_poss"))
    return out


_PRED_REGEXES = _build_pred_regexes()


def _words(text: str) -> List[str]:
    return re.findall(r"[A-Za-z0-9$%][A-Za-z0-9$%'\-]*", text)


_PASSIVE_AGENT_RE = re.compile(
    r"\b(?:is|was|are|were|been|being)\b(?:\s+[\w\-]+){0,2}?\s+([\w\-]+)(?:\s+[^,.;]{0,40}?)?\s+by\s+(?:the\s+)?$", re.I)


def passive_reversed(sentence: str, subject: str, predicate: str, obj: str) -> bool:
    """True when the evidence says "<subject> was <predicate-verb> … by <object>" — i.e. the
    object is the agent, so the triple (subject, predicate, object) states the reverse of the text.
    Predicates already phrased passively ("founded by") are left alone."""
    if predicate.split()[-1:] == ["by"]:
        return False
    stems = {t for form in L.predicate_surface_forms(predicate) for t in index_terms(form)}
    subj_ends = [b for _, b in find_all_ci(sentence, subject)]
    for start, _ in find_all_ci(sentence, obj):
        m = _PASSIVE_AGENT_RE.search(sentence[:start])
        if m and set(index_terms(m.group(1))) & stems and any(e <= m.start() for e in subj_ends):
            return True
    return False


def _gap_ok(gap: str, max_words: int, allow_comma: bool = False) -> bool:
    if any(c in gap for c in ";:()\"") or (not allow_comma and "," in gap):
        return False
    w = _words(gap)
    if len(w) > max_words:
        return False
    return not any(x.lower() in _GAP_BLOCKERS for x in w)


# ═════════════════════════════════════════════════════════════════════════════
# Heuristic extractor
# ═════════════════════════════════════════════════════════════════════════════

class HeuristicExtractor:
    def __init__(self, known_concepts: Optional[Iterable[str]] = None,
                 known_names: Optional[Iterable[str]] = None):
        # normalised concept names already in the graph (e.g. "sodium ion battery")
        self.known_concepts: Set[str] = set(known_concepts or [])
        self.known_names: Set[str] = set(known_names or [])

    # ── public ────────────────────────────────────────────────────────────────
    def extract(self, chunk_id: str, text: str) -> ChunkExtraction:
        sentences = split_sentences(text)
        mid_caps = self._mid_sentence_caps(sentences)
        aliases = self._acronym_aliases(text)

        # pass 1: discover concept phrases (objects/subjects of predicates) chunk-wide
        concepts: Set[str] = set(self.known_concepts)
        first = self._run(sentences, mid_caps, concepts)
        named_heads = {normalize_name(e.name).split()[-1] for e in first[0].values() if e.kind == "named"}
        for e in first[0].values():
            n = normalize_name(e.name)
            # a bare head noun of a named entity ("institute", "plant") is an anaphor, not a concept
            if e.kind == "concept" and not (len(n.split()) == 1 and n in named_heads):
                concepts.add(n)

        # pass 2: full extraction with concept spans available
        entities, relations = self._run(sentences, mid_caps, concepts)
        for alias, canon in aliases:
            self._add_entity(entities, canon, guess_type(canon))
        kept = [r for r in relations.values() if not passive_reversed(r.evidence, r.subject, r.predicate, r.object)]
        return ChunkExtraction(chunk_id=chunk_id, entities=list(entities.values()), relations=kept,
                               aliases=aliases, method="heuristic", rejected=len(relations) - len(kept))

    def _run(self, sentences, mid_caps, concepts):
        entities: Dict[str, ExtractedEntity] = {}
        relations: Dict[Tuple[str, str, str], ExtractedRelation] = {}
        recent: List[_Span] = []
        prev_subject: Optional[_Span] = None
        for _, _, sent in sentences:
            heading = self._is_heading(sent)
            spans_main = self._spans(sent, mid_caps, concepts, heading)
            for sp in spans_main:
                if sp.kind == "named":
                    self._add_entity(entities, sp.name, sp.type)
            if heading:
                recent.extend(s for s in spans_main if s.kind == "named")
                continue
            sentence_subject: Optional[_Span] = None
            for ci, (clause, _) in enumerate(self._clauses(sent, mid_caps, concepts, recent, prev_subject)):
                for subj, pred, obj, sk, ok, st, ot in self._clause_relations(clause, mid_caps, concepts, recent, sent):
                    if normalize_name(subj) == normalize_name(obj):
                        continue
                    st = "Person" if pred in L.PERSON_SUBJECT_PREDICATES and st == "Other" else st
                    ot = "Location" if pred in L.LOCATION_OBJECT_PREDICATES and ot in ("Other", "Person") else ot
                    self._add_entity(entities, subj, st, sk)
                    self._add_entity(entities, obj, ot, ok)
                    if ci == 0 and sentence_subject is None and sk == "named":
                        sentence_subject = _Span(0, 0, subj, entities[normalize_name(subj)].type)
                    key = (normalize_name(subj), pred, normalize_name(obj))
                    if key not in relations:
                        relations[key] = ExtractedRelation(subj, pred, obj, sent, 0.55 if sk == "concept" or ok == "concept" else 0.65)
            recent.extend(s for s in spans_main if s.kind == "named")
            recent[:] = recent[-12:]
            prev_subject = sentence_subject or prev_subject
        return entities, relations

    # ── entities ─────────────────────────────────────────────────────────────
    @staticmethod
    def _add_entity(store: Dict[str, ExtractedEntity], name: str, etype: str, kind: str = "named"):
        key = normalize_name(name)
        if not key:
            return
        cur = store.get(key)
        if cur is None:
            store[key] = ExtractedEntity(name=name, type=etype, kind=kind)
        elif cur.type in ("Other", "Concept") and etype not in ("Other", "Concept"):
            cur.type = etype

    @staticmethod
    def _mid_sentence_caps(sentences) -> Set[str]:
        caps = set()
        for _, _, s in sentences:
            toks = _WORD_RE.findall(s)
            for t in toks[1:]:
                if t[:1].isupper():
                    caps.add(t.lower())
        return caps

    @staticmethod
    def _acronym_aliases(text: str) -> List[Tuple[str, str]]:
        """'Coastal Energy Commission (CEC)' → ('CEC', 'Coastal Energy Commission')."""
        out = []
        pat = r"([A-Z][\w&'\-]*(?:\s+(?:of|for|and|the|on|[A-Z][\w&'\-]*))*)\s+\(([A-Z][A-Z0-9&]{1,9})\)"
        for m in re.finditer(pat, text):
            words = m.group(1).split()
            while words and words[0].lower() in L.LEADING_STOP:
                words = words[1:]
            acr = m.group(2).replace("&", "")
            for k in range(len(words)):
                cand = words[k:]
                caps = "".join(w[0] for w in cand if w[0].isupper())
                alls = "".join(w[0] for w in cand).upper()
                if acr in (caps, alls):
                    if len(cand) >= 2:
                        out.append((m.group(2), " ".join(cand)))
                    break
        return out

    @staticmethod
    def _is_heading(sent: str) -> bool:
        s = sent.strip()
        if s.endswith((".", "!", "?")) or len(s) > 80:
            return False
        words = _words(s)
        if not words or len(words) > 9:
            return False
        lowers = [w for w in words if w[:1].islower() and w.lower() not in L.LEADING_STOP and w.lower() not in _CONNECTORS]
        return len(lowers) == 0

    def _spans(self, sent: str, mid_caps: Set[str], concepts: Set[str], heading: bool = False) -> List[_Span]:
        toks = [(m.group(), m.start(), m.end()) for m in _WORD_RE.finditer(sent)]
        spans: List[_Span] = []
        i = 0
        while i < len(toks):
            tok, s, e = toks[i]
            if not tok[:1].isupper():
                i += 1
                continue
            run = [i]
            j = i + 1
            while j < len(toks):
                t = toks[j][0]
                if t[:1].isupper() and t[0].isalpha():
                    run.append(j); j += 1; continue
                if t == "." and toks[run[-1]][0].lower() in L.TITLE_PREFIXES and j + 1 < len(toks) and toks[j + 1][0][:1].isupper():
                    run.append(j); j += 1; continue
                if t.lower() in _CONNECTORS and j + 1 < len(toks) and toks[j + 1][0][:1].isupper():
                    # 'the' only after 'of' (Bank of the West)
                    if t.lower() == "the" and toks[j - 1][0].lower() != "of":
                        break
                    run.append(j); j += 1; continue
                break
            span = self._clean_run(sent, toks, run, mid_caps, heading)
            if span:
                spans.append(span)
            i = j
        spans.extend(self._concept_spans(sent, toks, spans, concepts))
        spans.sort(key=lambda x: x.start)
        return spans

    def _clean_run(self, sent, toks, run, mid_caps, heading) -> Optional[_Span]:
        idxs = list(run)
        at_start = idxs[0] == 0
        honorific = False
        # leading determiners / sentence starters
        while idxs and (toks[idxs[0]][0].lower() in L.LEADING_STOP or toks[idxs[0]][0].lower() in _CONNECTORS):
            idxs = idxs[1:]
            at_start = False
        # honorific / title prefix (Dr. Lena Park, Commissioner Hana Okafor)
        while len(idxs) >= 2 and toks[idxs[0]][0].lower().rstrip(".") in L.TITLE_PREFIXES:
            honorific = True
            idxs = idxs[1:]
            if idxs and toks[idxs[0]][0] == ".":
                idxs = idxs[1:]
        # role prefix: "Chief Executive Officer of Voltaic Systems" → "Voltaic Systems"
        words = [toks[k][0].lower() for k in idxs]
        if "of" in words or "at" in words:
            cut = words.index("of") if "of" in words else words.index("at")
            if cut > 0 and all(w in L.ROLE_WORDS for w in words[:cut]):
                idxs = idxs[cut + 1:]
        # trailing connectors
        while idxs and toks[idxs[-1]][0].lower() in _CONNECTORS:
            idxs = idxs[:-1]
        if heading:
            keywords = L.ORG_WORDS | L.POLICY_WORDS | L.FACILITY_WORDS
            while len(idxs) > 1:
                last = toks[idxs[-1]][0].lower()
                if last in L.HEADING_TAIL_WORDS or last.isdigit() or (last in L.COMMON_WORDS and last not in keywords):
                    idxs = idxs[:-1]
                else:
                    break
        if not idxs:
            return None
        start, end = toks[idxs[0]][1], toks[idxs[-1]][2]
        name = sent[start:end]
        if name.endswith(("'s", "’s")):
            name, end = name[:-2], end - 2
        low = [toks[k][0].lower().strip("'’") for k in idxs if toks[k][0] not in (".",)]
        low = [w[:-2] if w.endswith("'s") else w for w in low]
        if not low or all(w in _CONNECTORS for w in low):
            return None
        if len(low) == 1:
            w = low[0]
            if w in L.MONTHS_DAYS or w in L.LEADING_STOP or w in STOPWORDS or len(w) < 2:
                return None
            is_acr = name.isupper() and len(name) >= 2
            known = normalize_name(name) in self.known_names
            if (at_start or heading) and not (is_acr or known or w in mid_caps):
                return None
            if w in L.COMMON_WORDS and not is_acr and not known:
                return None
        else:
            kw = L.ORG_WORDS | L.POLICY_WORDS | L.FACILITY_WORDS
            if all(w in L.COMMON_WORDS or w in L.HEADING_TAIL_WORDS for w in low) and low[-1] not in kw:
                return None
        prev_word = sent[:start].split()[-1] if sent[:start].split() else ""
        return _Span(start, end, display_name(name), guess_type(display_name(name), honorific, prev_word),
                     "named", honorific)

    @staticmethod
    def _concept_spans(sent, toks, named: List[_Span], concepts: Set[str]) -> List[_Span]:
        if not concepts:
            return []
        out: List[_Span] = []
        taken = [(s.start, s.end) for s in named]
        words = [(t, s, e) for t, s, e in toks if t[0].isalnum()]
        for n in (5, 4, 3, 2, 1):
            for i in range(0, len(words) - n + 1):
                seg = words[i:i + n]
                if seg[0][0].lower() in _CONCEPT_LEAD_SKIP:
                    continue
                s, e = seg[0][1], seg[-1][2]
                if any(not (e <= a or s >= b) for a, b in taken):
                    continue
                if any(not sent[seg[k][2]:seg[k + 1][1]].isspace() for k in range(n - 1)):
                    continue
                surface = sent[s:e]
                norm = normalize_name(surface)
                if n == 1 and len(norm) < 5:
                    continue
                if norm in concepts:
                    out.append(_Span(s, e, surface.lower() if surface[:1].isupper() and i == 0 else surface,
                                     "Concept", "concept"))
                    taken.append((s, e))
        return out

    # ── clauses (appositives, relative clauses, coreference) ────────────────
    def _clauses(self, sent: str, mid_caps, concepts, recent: List[_Span],
                 prev_subject: Optional[_Span] = None) -> List[Tuple[str, Optional[_Span]]]:
        """Main clause (appositives/relative clauses cut out, coref resolved) + one clause per cut-out."""
        spans = [s for s in self._spans(sent, mid_caps, concepts) if s.kind == "named"]
        sub_clauses: List[Tuple[str, Optional[_Span]]] = []
        cuts: List[Tuple[int, int, str]] = []  # (start, end, replacement) in `sent`
        for sp in spans:
            if cuts and sp.end < cuts[-1][1]:
                continue
            tail = sent[sp.end:]
            m = re.match(r"\s*,\s*(who|which)\s+([^,;]+?)\s*(,|\.?\s*$)", tail)
            kind = "rel"
            if not m:
                m = re.match(r"\s*,\s*(a|an|the)\s+([a-z][^,;]+?)\s*(,|\.?\s*$)", tail)
                kind = "appos"
            if not m:
                continue
            body = m.group(2)
            sub_clauses.append((f"{sp.name} {body}" if kind == "rel" else f"{sp.name} is {m.group(1)} {body}", sp))
            mid_sentence = m.group(3).strip() == ","
            cuts.append((sp.end, sp.end + m.end(), " " if mid_sentence else "."))
        main = sent
        for a, b, rep in reversed(cuts):
            main = main[:a] + rep + main[b:]
        main = re.sub(r"\s{2,}", " ", main)
        return [(self._resolve_coref(main, recent, prev_subject), None)] + sub_clauses

    @staticmethod
    def _resolve_coref(clause: str, recent: List[_Span], prev_subject: Optional[_Span] = None) -> str:
        """Replace a clause-initial pronoun / 'The <noun>' with its antecedent's name."""
        m = re.match(r"^(?:(It|He|She|They)|(?:The|This)\s+([a-z][a-z\-]+))\b", clause)
        if not m or not (recent or prev_subject):
            return clause
        referent: Optional[_Span] = None
        if m.group(1):
            want_person = m.group(1) in ("He", "She")
            ok = (lambda sp: sp.type == "Person") if want_person else \
                 (lambda sp: sp.type not in ("Person", "Location", "Concept"))
            if prev_subject is not None and ok(prev_subject):
                referent = prev_subject
            else:
                referent = next((sp for sp in reversed(recent) if ok(sp)), None)
        else:
            noun = normalize_name(m.group(2))
            matches = lambda sp: (normalize_name(sp.name).split()[-1:] or [""])[0] == noun
            if prev_subject is not None and matches(prev_subject):
                referent = prev_subject
            else:
                referent = next((sp for sp in reversed(recent) if matches(sp)), None)
            if referent is None and m.group(2).lower() in L.COREF_GENERIC_ORG:
                if prev_subject is not None and prev_subject.type == "Organization":
                    referent = prev_subject
                else:
                    referent = next((sp for sp in reversed(recent) if sp.type == "Organization"), None)
        if referent is None:
            return clause
        return referent.name + clause[m.end():]

    # ── relations ─────────────────────────────────────────────────────────────
    def _find_preds(self, clause: str, spans: List[_Span]) -> List[_Pred]:
        found: List[_Pred] = []
        for rx, canon, passive, kind in _PRED_REGEXES:
            for m in rx.finditer(clause):
                found.append(_Pred(m.start(), m.end(), canon, passive, kind))
        found.sort(key=lambda p: (-(p.end - p.start), p.start))
        chosen: List[_Pred] = []
        for p in found:
            if any(not (p.end <= c.start or p.start >= c.end) for c in chosen):
                continue
            if p.kind == "verb" and any(not (p.end <= s.start or p.start >= s.end) for s in spans):
                continue
            if p.kind == "verb" and self._is_plural_noun(clause, p):
                continue
            chosen.append(p)
        chosen.sort(key=lambda p: p.start)
        return chosen

    @staticmethod
    def _is_plural_noun(clause: str, p: _Pred) -> bool:
        """'the efficiency results in…' / 'its funds' — an -s verb form used as a plural noun."""
        first = clause[p.start:p.end].split()[0].lower()
        if not first.endswith("s") or first in ("is", "was", "has", "does"):
            return False
        prev = [w.lower() for w in _words(clause[:p.start])][-2:]
        dets = {"the", "a", "an", "its", "their", "his", "her", "our", "these", "those", "this", "that", "of"}
        if prev and prev[-1] in dets:
            return True
        return len(prev) == 2 and prev[0] in dets and prev[1] not in STOPWORDS and prev[1][:1].islower()

    def _concept_after(self, clause: str, pos: int, limit: Optional[int] = None) -> Optional[Tuple[int, int, str]]:
        """Noun phrase after a predicate; stops at `limit` (the next predicate), so
        'operates autonomous tractors built by X' yields 'autonomous tractors', not '... tractors built'."""
        toks = [(m.group(), pos + m.start(), pos + m.end()) for m in _WORD_RE.finditer(clause[pos:])]
        k = 0
        while k < len(toks) and (toks[k][0].lower() in _CONCEPT_LEAD_SKIP or toks[k][0].isdigit()):
            k += 1
        picked = []
        while k < len(toks) and len(picked) < 4:
            if limit is not None and toks[k][1] >= limit:
                break
            t = toks[k][0]
            tl = t.lower()
            if not t[0].isalnum() or t[:1].isupper() or tl in _CONCEPT_STOP:
                break
            if picked and tl.endswith("ed"):
                break
            # "-ing" ends the phrase only when it acts as a participle taking an object
            nxt = toks[k + 1][0].lower() if k + 1 < len(toks) else ""
            if picked and tl.endswith("ing") and nxt in _CONCEPT_LEAD_SKIP:
                break
            picked.append(toks[k]); k += 1
        if not picked:
            return None
        s, e = picked[0][1], picked[-1][2]
        phrase = clause[s:e]
        return (s, e, phrase) if self._valid_concept(phrase) else None

    @staticmethod
    def _valid_concept(phrase: str) -> bool:
        toks = tokenize(phrase)
        if not toks or all(t.isdigit() for t in toks):
            return False
        if len(toks) == 1:
            return len(toks[0]) >= 5 and toks[0] not in L.GENERIC_NOUNS and toks[0] not in STOPWORDS
        return any(len(t) >= 4 and t not in L.GENERIC_NOUNS and t not in STOPWORDS for t in toks)

    def _concept_before(self, clause: str, p: _Pred) -> Optional[Tuple[int, int, str]]:
        head = clause[:p.start]
        words = head.split()
        definite = bool(words) and words[0].lower() in ("the", "this", "that", "these", "those")
        while words and words[0].lower() in _CONCEPT_LEAD_SKIP:
            words = words[1:]
        # "Soil compaction from heavy machinery reduces …" → head noun phrase before a short
        # prepositional phrase (multi-word heads only; a lone noun there is usually too vague)
        cut = next((i for i, w in enumerate(words) if w.lower() in _HEAD_PREPOSITIONS), None)
        if cut is not None and cut >= 2 and len(words) - cut <= 5 \
                and not any(w[:1].isupper() for w in words[cut:]):
            words = words[:cut]
        if not words or len(words) > 4 or (definite and len(words) == 1):
            return None  # "The pilot installed…" is an anaphor, not a concept
        phrase = " ".join(words)
        if not re.fullmatch(r"[A-Za-z][A-Za-z\-]*(?: [a-z][A-Za-z\-]*)*", phrase):
            return None
        if any(w.lower() in STOPWORDS for w in words) or not self._valid_concept(phrase):
            return None
        s = clause.find(phrase)
        return (s, s + len(phrase), phrase[0].lower() + phrase[1:])

    def _clause_relations(self, clause, mid_caps, concepts, recent, sent, discover=False):
        """Yields tuples (subj, pred, obj, subj_kind, obj_kind, subj_type, obj_type)."""
        spans = self._spans(clause, mid_caps, concepts)
        preds = self._find_preds(clause, [s for s in spans if s.kind == "named"])
        # concept spans never swallow a predicate ("received rebates from")
        spans = [s for s in spans if s.kind == "named"
                 or not any(not (s.end <= p.start or s.start >= p.end) for p in preds)]
        results = []
        # previous predicate's spans in *surface* order: (before-spans, pred, after-spans)
        prev: Optional[Tuple[List[_Span], _Pred, List[_Span]]] = None
        for p in preds:
            # ── subject ──
            before = [s for s in spans if s.end <= p.start]
            if before:
                cand = before[-1]
                gap = clause[cand.end:p.start]
                gap_words = [w.lower() for w in _words(gap)]
                # "X leads Y and directs Z": second verb inherits X
                if prev and prev[2] and cand is prev[2][-1] and gap_words in (["and"], ["and", "also"]) \
                        and p.kind == "verb" and not prev[1].passive:
                    subjects = prev[0]
                elif p.kind in ("role", "role_poss"):
                    subjects = [cand] if not clause[cand.end:p.start].strip() else []
                elif _gap_ok(gap, 10) and not any(q.start >= cand.end and q.end <= p.start for q in preds if q is not p):
                    subjects = self._coordinated_before(clause, before, cand, preds)
                else:
                    subjects = []
            else:
                subjects = []
            if not subjects and p.kind == "verb":
                cb = self._concept_before(clause, p)
                if cb:
                    subjects = [_Span(cb[0], cb[1], cb[2], "Concept", "concept")]
            if not subjects:
                prev = None
                continue
            # ── object ──
            pred_label = p.canonical
            after = [s for s in spans if s.start >= p.end]
            objects: List[_Span] = []
            direct_too = False  # also keep the direct-object noun phrase as its own relation
            next_pred = next((q.start for q in preds if q.start >= p.end), len(clause))
            if after and after[0].start <= next_pred:
                cand = after[0]
                gap = clause[p.end:cand.start]
                gap_words = [w.lower() for w in _words(gap)]
                gap_content = [w for w in gap_words if w not in STOPWORDS and w not in _CONCEPT_LEAD_SKIP
                               and not w.isdigit()]
                trimmed = list(gap_words)
                while trimmed and trimmed[-1] in ("the", "a", "an"):
                    trimmed.pop()
                last_prep = trimmed[-1] if trimmed else ""
                if p.kind in ("role", "role_poss"):
                    if not gap.strip():
                        objects = self._coordinated_after(clause, spans, cand)
                elif cand.kind == "concept" and gap_content:
                    pass  # "runs a rooftop solar pilot": take the full noun phrase below instead
                elif len(gap_content) >= 2 and last_prep in ("in", "at", "on", "near"):
                    pass  # entity is a locative adjunct ("installed panels on homes in Port Calder")
                elif _gap_ok(gap, 6):
                    objects = self._coordinated_after(clause, spans, cand)
                    pred_label = self._suffix_predicate(p.canonical, gap)
                    direct_too = len(gap_content) >= 2 and p.kind == "verb" and not p.passive
            direct: Optional[_Span] = None
            if (not objects or direct_too) and p.kind == "verb":
                ca = self._concept_after(clause, p.end, next_pred)
                if ca and ca[1] <= next_pred:
                    obj = self._coref_object(ca[2], recent)
                    direct = obj or _Span(ca[0], ca[1], ca[2], "Concept", "concept")
                    if not obj:
                        spans.append(direct); spans.sort(key=lambda x: x.start)
                    if not objects:
                        objects, direct = [direct], None
            if not objects:
                prev = None
                continue
            prev = (subjects, p, objects)
            if p.passive:
                subjects, objects = objects, subjects
            for s in subjects:
                for o in objects:
                    results.append((s.name, pred_label, o.name, s.kind, o.kind, s.type, o.type))
                if direct is not None:
                    results.append((s.name, p.canonical, direct.name, s.kind, direct.kind, s.type, direct.type))
        return results

    @staticmethod
    def _suffix_predicate(canon: str, gap: str) -> str:
        """'required the closure of X' → 'requires closure of'; 'published results in X' → 'published in'."""
        words = [w.lower() for w in _words(gap)]
        while words and words[-1] in ("the", "a", "an"):
            words = words[:-1]
        if not words or words[-1] not in _PREP_SUFFIX or canon.split()[-1] in _PREP_SUFFIX:
            return canon
        content = [w for w in words[:-1] if w not in STOPWORDS and not w.isdigit()]
        if len(content) == 1:
            return f"{canon} {content[0]} {words[-1]}"
        if words[-1] == "with":
            return "collaborates with"
        if words[-1] != "of":
            return f"{canon} {words[-1]}"
        return canon

    @staticmethod
    def _coordinated_before(clause, before: List[_Span], cand: _Span, preds) -> List[_Span]:
        group = [cand]
        idx = before.index(cand)
        while idx > 0:
            prev = before[idx - 1]
            gap = clause[prev.end:group[0].start]
            if re.fullmatch(r"\s*(,\s*and|,|and)\s*", gap) and not any(q.end <= prev.start for q in preds):
                group.insert(0, prev); idx -= 1
            else:
                break
        return group

    @staticmethod
    def _coordinated_after(clause, spans: List[_Span], cand: _Span) -> List[_Span]:
        group = [cand]
        later = [s for s in spans if s.start >= cand.end]
        for nxt in later:
            gap = clause[group[-1].end:nxt.start]
            if re.fullmatch(r"\s*(,\s*and|,|and)\s*", gap):
                group.append(nxt)
            else:
                break
        return group

    @staticmethod
    def _coref_object(phrase: str, recent: List[_Span]) -> Optional[_Span]:
        toks = tokenize(phrase)
        if len(toks) != 1:
            return None
        noun = normalize_name(toks[0])
        for sp in reversed(recent):
            if sp.kind == "named" and normalize_name(sp.name).split()[-1:] == [noun]:
                return sp
        return None


# ═════════════════════════════════════════════════════════════════════════════
# LLM extractor (validated)
# ═════════════════════════════════════════════════════════════════════════════

LLM_EXTRACTION_PROMPT = """\
You build a knowledge graph from one passage of a user's document.

Return ONLY JSON:
{{"entities": [{{"name": "...", "type": "Person|Organization|Location|Facility|Policy|Publication|Project|Product|Technology|Concept|Event|Other", "description": "<=15 words, from the passage"}}],
 "relations": [{{"subject": "...", "predicate": "...", "object": "...", "evidence": "..."}}]}}

Rules:
- Only relations explicitly stated in the passage. No outside knowledge, no guesses.
- "evidence" = the single sentence from the passage that states the relation, copied character-for-character.
- subject and object must be entity names from your entities list, written as they appear in the passage
  (use the fullest name form; resolve "it"/"the company" only when the passage makes the referent unambiguous).
- predicate: short lowercase verb phrase, e.g. "founded", "acquired", "located in", "funds", "ceo of".
- Do not create entities for dates, money amounts, percentages or generic nouns.
- At most 15 entities and 20 relations.

Passage (from "{filename}", page {page}):
\"\"\"
{text}
\"\"\"
"""


def _norm_for_match(s: str) -> str:
    s = s.replace("’", "'").replace("“", '"').replace("”", '"')
    return normalize_ws(s).lower().strip(" \"'")


def _appears(name: str, text: str) -> bool:
    if not name:
        return False
    low = text.lower()
    if display_name(name).lower() in low or name.lower() in low:
        return True
    target = normalize_name(name)
    toks = [m.group() for m in re.finditer(r"[A-Za-z0-9][A-Za-z0-9'’\-]*", text)]
    n = len(target.split())
    for k in range(max(1, n - 1), n + 2):
        for i in range(0, max(0, len(toks) - k + 1)):
            if normalize_name(" ".join(toks[i:i + k])) == target:
                return True
    return False


def validate_llm_extraction(data, chunk_text: str, chunk_id: str) -> ChunkExtraction:
    out = ChunkExtraction(chunk_id=chunk_id, method="llm")
    if not isinstance(data, dict):
        out.rejected += 1
        return out
    sentences = [s for _, _, s in split_sentences(chunk_text)]
    norm_chunk = _norm_for_match(chunk_text)

    valid: Dict[str, ExtractedEntity] = {}
    for e in (data.get("entities") or [])[:25]:
        if not isinstance(e, dict):
            continue
        name = display_name(str(e.get("name", "")))[:120]
        etype = str(e.get("type", "Other")).strip().title()
        etype = etype if etype in ENTITY_TYPES else "Other"
        if not name or not _appears(name, chunk_text):
            out.rejected += 1
            continue
        if re.fullmatch(r"[\d\s$%.,\-]+", name):
            out.rejected += 1
            continue
        valid.setdefault(normalize_name(name), ExtractedEntity(
            name=name, type=etype, description=normalize_ws(str(e.get("description", "")))[:200],
            kind="concept" if etype == "Concept" else "named"))

    seen = set()
    for r in (data.get("relations") or [])[:30]:
        if not isinstance(r, dict):
            continue
        subj = display_name(str(r.get("subject", "")))
        obj = display_name(str(r.get("object", "")))
        pred = normalize_ws(str(r.get("predicate", "")).replace("_", " ").lower())[:60]
        ev = str(r.get("evidence", ""))
        ns, no = normalize_name(subj), normalize_name(obj)
        if not (ns and no and pred) or ns == no or len(pred.split()) > 6:
            out.rejected += 1
            continue
        for nm, n in ((subj, ns), (obj, no)):
            if n not in valid:
                if _appears(nm, chunk_text):
                    valid[n] = ExtractedEntity(name=nm, type="Other")
        if ns not in valid or no not in valid:
            out.rejected += 1
            continue
        sentence = None
        nev = _norm_for_match(ev)
        if nev and nev in norm_chunk:
            sentence = next((s for s in sentences if nev in _norm_for_match(s) or _norm_for_match(s) in nev), None)
            if sentence is None:
                a, b = locate_sentence(chunk_text, normalize_ws(ev))
                sentence = chunk_text[a:b] if a >= 0 else None
        if sentence is None:
            ev_terms = set(tokenize(ev))
            best, best_ov = None, 0.0
            for s in sentences:
                st = set(tokenize(s))
                ov = len(ev_terms & st) / max(1, len(ev_terms))
                if ov > best_ov:
                    best, best_ov = s, ov
            sentence = best if best_ov >= 0.8 else None
        if sentence is None or not (_appears(subj, sentence) or _appears(obj, sentence)):
            out.rejected += 1
            continue
        if passive_reversed(sentence, subj, pred, obj):  # "X was founded by Y" returned as X —founded→ Y
            out.rejected += 1
            continue
        key = (ns, pred, no)
        if key in seen:
            continue
        seen.add(key)
        out.relations.append(ExtractedRelation(valid[ns].name, pred, valid[no].name, sentence, 0.8))
    out.entities = list(valid.values())
    return out


class LLMExtractor:
    def __init__(self, llm, fallback: HeuristicExtractor, concurrency: int = 4):
        self.llm = llm
        self.fallback = fallback
        self._sem = asyncio.Semaphore(max(1, concurrency))

    async def extract(self, chunk_id: str, text: str, filename: str = "", page: int = 1) -> ChunkExtraction:
        heuristic = self.fallback.extract(chunk_id, text)
        if self.llm is None or not self.llm.available:
            return heuristic
        async with self._sem:
            try:
                data = await self.llm.complete_json(
                    LLM_EXTRACTION_PROMPT.format(filename=filename, page=page, text=text[:4000]),
                    fast=True, max_tokens=2048,
                )
            except Exception as e:
                log.warning(f"LLM extraction failed for {chunk_id}; heuristic used: {e}")
                return heuristic
        result = validate_llm_extraction(data, text, chunk_id)
        if not result.relations and heuristic.relations:
            heuristic.rejected = result.rejected
            return heuristic
        result.aliases = heuristic.aliases
        return result
