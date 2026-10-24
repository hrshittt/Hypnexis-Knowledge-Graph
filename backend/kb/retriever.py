"""
KBRetriever — passage retrieval + graph retrieval for the knowledge base.

Passages:  dense (Chroma) + sparse (BM25) → Reciprocal Rank Fusion → CrossEncoder rerank
           (sigmoid-normalised) → MMR diversity. Same recipe as the CEO twin's
           TripleHybridRetriever, reusing backend/core/ranking.py.
Graph:     question → entity linking (aliases, distinctive name tokens, fuzzy),
           k-shortest evidence paths between entities (multi-hop), neighbourhoods,
           and topic-community ranking for thematic questions.
"""

import difflib
import math
import re
import threading
from collections import defaultdict
from typing import Any, Dict, List, Optional, Sequence, Set

import networkx as nx
import numpy as np

from backend.core.ranking import mmr, rrf
from backend.kb import lexicon as L
from backend.kb.embeddings import cosine
from backend.kb.text_utils import QUERY_FILLER, STOPWORDS, content_terms, normalize_name, term_coverage
from backend.utils.logger import get_logger

log = get_logger(__name__)

_WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’\-&]*")
_NON_DISTINCTIVE = (L.ORG_WORDS | L.LOCATION_WORDS | L.FACILITY_WORDS | L.POLICY_WORDS | L.COMMON_WORDS
                    | L.LOCATION_FIRST_WORDS | STOPWORDS | QUERY_FILLER)


class KBRetriever:
    def __init__(self, store, index, embedder, reranker=None):
        self.store = store
        self.index = index
        self.embedder = embedder
        self.reranker = reranker
        self._lock = threading.RLock()
        self._version = -1
        self.U = nx.Graph()
        self.entities: Dict[str, Dict[str, Any]] = {}
        self.relations: Dict[str, Dict[str, Any]] = {}
        self.alias: Dict[str, str] = {}
        self.token_index: Dict[str, Set[str]] = {}
        self.topics: List[Dict[str, Any]] = []
        self.topic_vecs: Optional[np.ndarray] = None

    # ── cache of graph structures, keyed by store.graph_version() ───────────
    def refresh(self, force: bool = False) -> None:
        with self._lock:
            v = self.store.graph_version()
            if v == self._version and not force:
                return
            rels = self.store.relations()
            self.alias = self.store.alias_index()
            ids = set(self.alias.values()) | {r["subject_id"] for r in rels} | {r["object_id"] for r in rels}
            self.entities = self.store.get_entities(list(ids))
            self.relations = {r["relation_id"]: r for r in rels}
            U = nx.Graph()
            for r in rels:
                s, o = r["subject_id"], r["object_id"]
                if s == o or s not in self.entities or o not in self.entities:
                    continue
                if U.has_edge(s, o):
                    U[s][o]["rels"].append(r)
                else:
                    U.add_edge(s, o, rels=[r])
            for u, v2 in U.edges:
                U[u][v2]["rels"].sort(key=lambda r: -int(r["evidence_count"]))
            self.U = U
            tok: Dict[str, Set[str]] = defaultdict(set)
            for eid, e in self.entities.items():
                if e["type"] == "Concept":
                    continue
                for t in e["norm"].split():
                    if len(t) >= 4 and t not in _NON_DISTINCTIVE:
                        tok[t].add(eid)
            self.token_index = dict(tok)
            self.topics = self.store.communities()
            if self.topics:
                texts = [f"{t['label']}. {t['summary']} {' '.join(t['keywords'])}" for t in self.topics]
                self.topic_vecs = self.embedder.encode(texts)
            else:
                self.topic_vecs = None
            self._version = v

    def entity_brief(self, eid: str) -> Dict[str, Any]:
        e = self.entities.get(eid) or self.store.get_entity(eid) or {}
        return {"id": eid, "name": e.get("name", eid), "type": e.get("type", "Other"),
                "community": e.get("community_id")}

    def relation_brief(self, r: Dict[str, Any]) -> Dict[str, Any]:
        return {"id": r["relation_id"], "predicate": r["predicate"],
                "subject": self.entity_brief(r["subject_id"]), "object": self.entity_brief(r["object_id"]),
                "evidence_count": int(r.get("evidence_count") or 0)}

    # ── passages ─────────────────────────────────────────────────────────────
    def search(self, query: str, k: int = 6, doc_ids: Optional[Sequence[str]] = None,
               pool: int = 30, extra_terms: Sequence[str] = ()) -> List[Dict[str, Any]]:
        q_emb = self.embedder.encode([query])[0]
        dense = self.index.dense_search(query, pool, doc_ids, query_emb=q_emb)
        sparse = self.index.sparse_search(" ".join([query, *extra_terms]), pool, doc_ids)
        fused: Dict[str, float] = defaultdict(float)
        for rank, (cid, _) in enumerate(dense):
            fused[cid] += rrf(rank)
        for rank, (cid, _) in enumerate(sparse):
            fused[cid] += rrf(rank)
        if not fused:
            return []
        dense_map, sparse_map = dict(dense), dict(sparse)
        ids = sorted(fused, key=lambda c: -fused[c])[:pool]
        rows = self.store.get_chunks(ids)
        cands = []
        top_fused = max(fused.values())
        terms = content_terms(query)
        for cid in ids:
            row = rows.get(cid)
            if not row or (doc_ids and row["doc_id"] not in doc_ids):
                continue
            cands.append({
                "chunk_id": cid, "doc_id": row["doc_id"], "filename": row["filename"], "page": row["page"],
                "chunk_index": row["chunk_index"], "start_char": row["start_char"], "end_char": row["end_char"],
                "text": row["text"], "dense": round(dense_map.get(cid, 0.0), 4),
                "sparse": round(sparse_map.get(cid, 0.0), 4), "fused": fused[cid],
                "lexical": round(term_coverage(terms, row["text"]), 3),
            })
        if not cands:
            return []
        if self.reranker is not None:
            try:
                scores = self.reranker.score(query, [c["text"] for c in cands])
                for c, s in zip(cands, scores):
                    c["rerank"] = round(s, 4)
                    c["score"] = s
            except Exception as e:
                log.warning(f"Rerank failed, using fused scores: {e}")
                self.reranker_error = str(e)
        for c in cands:
            if "score" not in c:
                c["score"] = round(0.6 * c["lexical"] + 0.4 * (c["fused"] / top_fused), 4)
        cands.sort(key=lambda c: -c["score"])
        return mmr(cands[: max(k * 3, 12)], top_k=k, lambda_param=0.8, score_key="score", content_key="text")

    def rerank_texts(self, query: str, texts: List[str]) -> List[float]:
        if self.reranker is not None and texts:
            try:
                return self.reranker.score(query, texts)
            except Exception:
                pass
        terms = content_terms(query)
        return [term_coverage(terms, t) for t in texts]

    # ── entity linking ───────────────────────────────────────────────────────
    def link_entities(self, question: str, limit: int = 6) -> List[Dict[str, Any]]:
        self.refresh()
        words = [(m.group(), m.start(), m.end()) for m in _WORD_RE.finditer(question)]
        taken = [False] * len(words)
        links: List[Dict[str, Any]] = []

        def add(eid: str, i: int, n: int, score: float, how: str):
            if eid not in self.entities or any(l["id"] == eid for l in links):
                for t in range(i, i + n):
                    taken[t] = True
                return
            for t in range(i, i + n):
                taken[t] = True
            links.append({**self.entity_brief(eid), "matched": question[words[i][1]:words[i + n - 1][2]],
                          "score": score, "how": how, "pos": words[i][1]})

        for n in range(6, 0, -1):
            for i in range(0, len(words) - n + 1):
                if any(taken[i:i + n]):
                    continue
                surface = question[words[i][1]:words[i + n - 1][2]]
                norm = normalize_name(surface)
                if not norm or norm in STOPWORDS or norm in QUERY_FILLER:
                    continue
                eid = self.alias.get(norm)
                if not eid:
                    continue
                if n == 1 and len(norm) < 3:
                    continue
                add(eid, i, n, 1.0, "alias")

        for i, (w, _, _) in enumerate(words):
            if taken[i] or not w[:1].isupper():
                continue
            tok = normalize_name(w)
            cands = self.token_index.get(tok, set())
            if len(cands) == 1:
                add(next(iter(cands)), i, 1, 0.6, "name-token")

        keys = list(self.alias)
        for n in (4, 3, 2):
            for i in range(0, len(words) - n + 1):
                if any(taken[i:i + n]) or not words[i][0][:1].isupper():
                    continue
                norm = normalize_name(question[words[i][1]:words[i + n - 1][2]])
                if len(norm) < 6:
                    continue
                close = difflib.get_close_matches(norm, keys, n=1, cutoff=0.88)
                if close:
                    add(self.alias[close[0]], i, n, 0.7, "fuzzy")

        links.sort(key=lambda l: l["pos"])
        return links[:limit]

    # ── graph queries ────────────────────────────────────────────────────────
    def entity_relations(self, eid: str, limit: int = 12) -> List[Dict[str, Any]]:
        self.refresh()
        if eid not in self.U:
            return []
        rels = [r for nb in self.U.neighbors(eid) for r in self.U[eid][nb]["rels"]]
        rels.sort(key=lambda r: (-int(r["evidence_count"]), r["predicate"]))
        return rels[:limit]

    def paths(self, a: str, b: str, max_hops: int = 4, k: int = 3) -> List[Dict[str, Any]]:
        self.refresh()
        if a == b or a not in self.U or b not in self.U:
            return []
        cands: List[Dict[str, Any]] = []
        shortest = None
        try:
            for nodes in nx.shortest_simple_paths(self.U, a, b):
                hops = len(nodes) - 1
                shortest = shortest or hops
                if hops > max_hops or hops > shortest + 1 or len(cands) >= 12:
                    break
                edges = [self.U[u][v]["rels"][0] for u, v in zip(nodes, nodes[1:])]
                # prefer short, well-evidenced paths that avoid generic hub nodes
                hub = sum(math.log1p(self.U.degree(n)) for n in nodes[1:-1])
                ev = sum(min(int(e["evidence_count"]), 3) for e in edges)
                concept = sum(1 for n in nodes[1:-1] if self.entities.get(n, {}).get("type") == "Concept")
                score = -1.0 * hops - 0.25 * hub + 0.1 * ev - 0.3 * concept
                cands.append({"nodes": nodes, "edges": edges, "hops": hops, "score": round(score, 3)})
        except nx.NetworkXNoPath:
            return []
        cands.sort(key=lambda p: -p["score"])
        return cands[:k]

    def neighborhood(self, eid: str, hops: int = 2, limit: int = 15) -> List[Dict[str, Any]]:
        self.refresh()
        if eid not in self.U:
            return []
        lengths = nx.single_source_shortest_path_length(self.U, eid, cutoff=hops)
        rels: Dict[str, Dict[str, Any]] = {}
        for u in lengths:
            for v in self.U.neighbors(u):
                if v in lengths:
                    for r in self.U[u][v]["rels"]:
                        rels[r["relation_id"]] = r
        ranked = sorted(rels.values(), key=lambda r: (min(lengths.get(r["subject_id"], 9), lengths.get(r["object_id"], 9)),
                                                      -int(r["evidence_count"])))
        return ranked[:limit]

    def rank_topics(self, question: str, linked_ids: Sequence[str] = (), k: int = 4,
                    generic: bool = False) -> List[Dict[str, Any]]:
        self.refresh()
        if not self.topics:
            return []
        if generic:
            return [dict(t, score=1.0) for t in self.topics[:k]]
        q = self.embedder.encode([question])[0]
        terms = content_terms(question)
        linked_comms = {self.entities[e]["community_id"] for e in linked_ids if e in self.entities}
        scored = []
        for t, vec in zip(self.topics, self.topic_vecs):
            names = " ".join(self.entities[e]["name"] for e in t["top_entities"] if e in self.entities)
            lex = term_coverage(terms, f"{t['label']} {t['summary']} {' '.join(t['keywords'])} {names}") if terms else 0
            s = cosine(q, vec) + 0.3 * lex + (0.4 if t["community_id"] in linked_comms else 0.0)
            scored.append(dict(t, score=round(s, 4)))
        scored.sort(key=lambda t: -t["score"])
        return scored[:k]
