"""
Entity resolution / deduplication.

Surface names map to one canonical entity via, in order:
  1. exact normalised-name / alias match   ("The Voltaic Systems Inc." == "Voltaic Systems")
  2. declared aliases                      ("CEC" ↔ "Coastal Energy Commission")
  3. surname-only person mentions          ("Diallo" → "Amina Diallo", only if unambiguous)
  4. conservative fuzzy match (≥0.92)      (typos, spacing) between type-compatible entities
Entity ids are deterministic (hash of the normalised name), so re-ingesting the same
content — or the same entity in another document — always lands on the same node.
"""

import difflib
import hashlib
from collections import defaultdict
from typing import Dict, Optional, Set, Tuple

from backend.kb.text_utils import normalize_name

_LOOSE_TYPES = {"Other", "Concept"}


def entity_id_for(norm: str) -> str:
    return "e_" + hashlib.sha1(norm.encode("utf-8")).hexdigest()[:12]


def relation_id_for(subject_id: str, predicate: str, object_id: str) -> str:
    return "r_" + hashlib.sha1(f"{subject_id}|{predicate}|{object_id}".encode("utf-8")).hexdigest()[:12]


def _types_compatible(a: str, b: str) -> bool:
    return a == b or a in _LOOSE_TYPES or b in _LOOSE_TYPES


class EntityResolver:
    def __init__(self, alias_index: Dict[str, str], entity_info: Dict[str, Tuple[str, str]]):
        self.alias: Dict[str, str] = dict(alias_index)          # norm → entity_id
        self.info: Dict[str, Tuple[str, str]] = dict(entity_info)  # entity_id → (name, type)
        self._persons_by_last: Dict[str, Set[str]] = defaultdict(set)
        for eid, (name, etype) in self.info.items():
            self._index_person(eid, name, etype)
        self._fuzzy_cache: Dict[str, Optional[str]] = {}
        self.new_aliases: Dict[str, Tuple[str, str]] = {}       # norm → (entity_id, surface)

    def _index_person(self, eid: str, name: str, etype: str) -> None:
        toks = normalize_name(name).split()
        if etype == "Person" and len(toks) >= 2:
            self._persons_by_last[toks[-1]].add(eid)

    def lookup(self, name: str) -> Optional[str]:
        return self.alias.get(normalize_name(name))

    def resolve(self, name: str, etype: str = "Other") -> Optional[Tuple[str, bool]]:
        """Return (entity_id, is_new) or None for empty names."""
        norm = normalize_name(name)
        if not norm:
            return None
        eid = self.alias.get(norm)
        if eid:
            self._remember(norm, eid, name)
            return eid, False

        toks = norm.split()
        if len(toks) == 1 and etype in ("Person", "Other") and len(toks[0]) >= 3:
            cands = self._persons_by_last.get(toks[0], set())
            if len(cands) == 1:
                eid = next(iter(cands))
                self._remember(norm, eid, name)
                return eid, False

        if len(norm) >= 6:
            eid = self._fuzzy(norm, etype)
            if eid:
                self._remember(norm, eid, name)
                return eid, False

        eid = entity_id_for(norm)
        self.alias[norm] = eid
        self.info[eid] = (name, etype)
        self._index_person(eid, name, etype)
        self._remember(norm, eid, name)
        return eid, True

    def add_alias(self, alias: str, canonical_name: str) -> None:
        eid = self.lookup(canonical_name)
        norm = normalize_name(alias)
        if eid and norm and norm not in self.alias:
            self.alias[norm] = eid
            self._remember(norm, eid, alias)

    def _remember(self, norm: str, eid: str, surface: str) -> None:
        self.alias.setdefault(norm, eid)  # surname / fuzzy matches become exact aliases from now on
        if norm not in self.new_aliases:
            self.new_aliases[norm] = (eid, surface)

    def _fuzzy(self, norm: str, etype: str) -> Optional[str]:
        if norm in self._fuzzy_cache:
            return self._fuzzy_cache[norm]
        keys = [k for k in self.alias if abs(len(k) - len(norm)) <= 3]
        best = difflib.get_close_matches(norm, keys, n=3, cutoff=0.92)
        found = None
        for b in best:
            eid = self.alias[b]
            if _types_compatible(self.info.get(eid, ("", "Other"))[1], etype):
                found = eid
                break
        self._fuzzy_cache[norm] = found
        return found
