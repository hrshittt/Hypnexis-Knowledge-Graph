"""
Text utilities shared by ingestion, extraction, retrieval and answering.

Everything here is deterministic and dependency-free:
  - offset-preserving sentence splitter (abbreviation aware)
  - light stemmer used symmetrically for lexical matching / BM25
  - entity-name normalisation used for deduplication and question linking
"""

import re
import unicodedata
from typing import Iterable, List, Set, Tuple

STOPWORDS: frozenset = frozenset("""
a about above after again against all also am an and any are aren't as at be because been before
being below between both but by can cannot could did do does doing down during each few for from
further had has have having he her here hers herself him himself his how i if in into is it its
itself just me more most my myself no nor not now of off on once only or other our ours ourselves
out over own same she should so some such than that the their theirs them themselves then there
these they this those through to too under until up very was we were what when where which while
who whom why will with would you your yours yourself yourselves s t
""".split())

# Words that carry no retrieval signal inside a *question*.
QUERY_FILLER: frozenset = frozenset("""
tell explain describe list give show please know find say says said mention mentioned according
information info detail details anything something everything document documents doc docs source
sources text texts collection corpus uploaded file files paper papers report reports kind sort
way ways thing things much many main key important overall happen happened
""".split())

_TOKEN_RE = re.compile(r"[a-z0-9]+(?:['\-][a-z0-9]+)*")
# no "-ation" stripping: it collides roots ("foundation" → "found" ≈ "founded")
_SUFFIXES = ("ments", "ment", "ness", "ings", "ing", "ies", "ied", "ers", "er", "ed", "es", "ly", "s")


def normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def stem(word: str) -> str:
    """Tiny suffix stripper. Only ever compared against itself, so consistency > accuracy."""
    w = word.lower()
    if len(w) <= 3:
        return w
    for suf in _SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            if suf == "es" and not re.search(r"(s|x|z|ch|sh)es$", w):
                suf = "s"
            base = w[: -len(suf)]
            if suf in ("ies", "ied"):
                base += "y"
            w = base
            break
    if w.endswith("e") and len(w) > 4:
        w = w[:-1]
    return w


def tokenize(text: str) -> List[str]:
    return _TOKEN_RE.findall((text or "").lower())


def index_terms(text: str) -> List[str]:
    """Terms for BM25 / lexical overlap: stemmed, stopwords removed, hyphen parts added."""
    out: List[str] = []
    for tok in tokenize(text):
        if tok in STOPWORDS:
            continue
        out.append(stem(tok))
        if "-" in tok:
            out.extend(stem(p) for p in tok.split("-") if p and p not in STOPWORDS)
    return out


def content_terms(text: str, exclude: Iterable[str] = ()) -> List[str]:
    """Stemmed signal-bearing terms of a question (fillers & excluded tokens removed)."""
    excluded = {stem(e) for e in exclude}
    terms: List[str] = []
    for tok in tokenize(text):
        if tok in STOPWORDS or tok in QUERY_FILLER or len(tok) < 3:
            continue
        st = stem(tok)
        if st in excluded or st in terms:
            continue
        terms.append(st)
    return terms


def term_coverage(terms: List[str], text: str) -> float:
    """Fraction of `terms` (already stemmed) present in `text`."""
    if not terms:
        return 1.0
    have = set(index_terms(text))
    return sum(1 for t in terms if t in have) / len(terms)


# ─── Sentence splitting (offset preserving) ──────────────────────────────────

_ABBREVIATIONS = {
    "dr", "mr", "mrs", "ms", "prof", "inc", "ltd", "co", "corp", "st", "jr", "sr", "vs", "etc",
    "e.g", "i.e", "no", "fig", "al", "approx", "dept", "est", "govt", "mt", "u.s", "u.k", "jan",
    "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "gen", "sen", "rep",
}
_BOUNDARY_RE = re.compile(r"[.!?]+[\"'”’)\]]*(?=\s)|\n+")
_LAST_WORD_RE = re.compile(r"([A-Za-z][A-Za-z.]*)$")
_NEXT_CHAR_RE = re.compile(r"\s*(\S)")


def _emit(text: str, s: int, e: int, out: List[Tuple[int, int, str]]) -> None:
    while s < e and text[s].isspace():
        s += 1
    while e > s and text[e - 1].isspace():
        e -= 1
    if e > s:
        out.append((s, e, text[s:e]))


def split_sentences(text: str) -> List[Tuple[int, int, str]]:
    """Return (start, end, sentence) with text[start:end] == sentence. Newlines are hard breaks."""
    out: List[Tuple[int, int, str]] = []
    start = 0
    for m in _BOUNDARY_RE.finditer(text):
        tok = m.group()
        if tok.startswith("\n"):
            _emit(text, start, m.start(), out)
            start = m.end()
            continue
        last = _LAST_WORD_RE.search(text[start:m.start()])
        if last and tok.startswith("."):
            lw = last.group(1).lower().rstrip(".")
            if lw in _ABBREVIATIONS or (len(lw) == 1 and lw.isalpha()):
                continue
        nxt = _NEXT_CHAR_RE.match(text, m.end())
        if nxt:
            c = nxt.group(1)
            if not (c.isupper() or c.isdigit() or c in "\"'“‘(["):
                continue
        _emit(text, start, m.end(), out)
        start = m.end()
    _emit(text, start, len(text), out)
    return out


# ─── Entity-name normalisation ───────────────────────────────────────────────

HONORIFICS = {
    "dr", "prof", "professor", "mr", "mrs", "ms", "miss", "sir", "dame", "commissioner",
    "senator", "governor", "mayor", "minister", "judge", "chancellor", "president", "rev",
}
_CORP_SUFFIXES = {"inc", "incorporated", "corp", "corporation", "ltd", "limited", "llc", "plc", "gmbh", "co"}


def _singular(tok: str) -> str:
    if len(tok) > 3 and tok.endswith("ies"):
        return tok[:-3] + "y"
    if len(tok) > 3 and tok.endswith("s") and not tok.endswith(("ss", "us", "is")):
        return tok[:-1]
    return tok


def normalize_name(name: str) -> str:
    """Canonical key for entity dedup: 'The Voltaic Systems Inc.' == 'voltaic system'."""
    s = unicodedata.normalize("NFKC", name or "")
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.strip().strip("\"'.,;:()[]{}")
    s = re.sub(r"'s$", "", s)
    s = re.sub(r"s'$", "s", s)
    s = s.lower().replace("&", " and ").replace(".", "")
    s = re.sub(r"[-_/]", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    toks = s.split()
    while toks and toks[0] in ("the", "a", "an"):
        toks = toks[1:]
    while len(toks) > 1 and toks[0] in HONORIFICS:
        toks = toks[1:]
    while len(toks) > 1 and toks[-1] in _CORP_SUFFIXES:
        toks = toks[:-1]
    if toks:
        toks[-1] = _singular(toks[-1])
    return " ".join(toks)


def display_name(name: str) -> str:
    """Human-facing canonical form: strip possessives, leading 'The', honorific titles."""
    s = normalize_ws(unicodedata.normalize("NFKC", name or "")).replace("’", "'")
    s = s.strip("\"'.,;:()[]{} ")
    s = re.sub(r"'s$", "", s)
    s = re.sub(r"s'$", "s", s)
    parts = s.split(" ")
    if len(parts) > 1 and parts[0].lower() in ("the", "a", "an") and parts[1][:1].isupper():
        parts = parts[1:]
    while len(parts) > 2 and parts[0].lower().rstrip(".") in HONORIFICS:
        parts = parts[1:]
    return " ".join(parts)


def find_all_ci(haystack: str, needle: str) -> List[Tuple[int, int]]:
    """Case-insensitive whole-word occurrences of `needle` in `haystack`."""
    if not needle:
        return []
    pat = re.compile(r"(?<![A-Za-z0-9])" + re.escape(needle) + r"(?![A-Za-z0-9])", re.IGNORECASE)
    return [(m.start(), m.end()) for m in pat.finditer(haystack)]


def locate_sentence(chunk_text: str, sentence: str) -> Tuple[int, int]:
    """Offsets of `sentence` inside `chunk_text` (whitespace-insensitive). (-1, -1) if absent."""
    idx = chunk_text.find(sentence)
    if idx >= 0:
        return idx, idx + len(sentence)
    words = [re.escape(w) for w in sentence.split()]
    if not words:
        return -1, -1
    m = re.search(r"\s+".join(words), chunk_text, re.IGNORECASE)
    return (m.start(), m.end()) if m else (-1, -1)


def unique(seq: Iterable) -> list:
    seen: Set = set()
    out = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out
