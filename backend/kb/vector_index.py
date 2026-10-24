"""
ChunkIndex — dense (ChromaDB, cosine) + sparse (BM25) indexes over KB chunks.

  - The Chroma collection name embeds the embedding-model slug, so switching models
    never mixes vector spaces; a missing/empty collection is re-embedded from SQLite.
  - BM25 is rebuilt in memory from SQLite (source of truth) whenever chunks change,
    so there are no stale pickles to keep in sync.
  - If ChromaDB fails to open, dense search is disabled and BM25 keeps working.
"""

import math
import re
import threading
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from rank_bm25 import BM25Okapi

from backend.kb.text_utils import index_terms
from backend.utils.logger import get_logger

log = get_logger(__name__)


class _LuceneBM25(BM25Okapi):
    """BM25 with Lucene's always-positive IDF; Okapi IDF is <= 0 on tiny corpora (2-3 chunks)."""

    def _calc_idf(self, nd):
        for word, freq in nd.items():
            self.idf[word] = math.log(1 + (self.corpus_size - freq + 0.5) / (freq + 0.5))


class ChunkIndex:
    def __init__(self, chroma_dir, embedder):
        self.embedder = embedder
        self.error: Optional[str] = None
        self._lock = threading.RLock()
        self._col = None
        slug = re.sub(r"[^a-z0-9]+", "_", embedder.name.lower()).strip("_")[:40]
        self.collection_name = f"kb_chunks_{slug}"
        try:
            import chromadb
            self._client = chromadb.PersistentClient(path=str(chroma_dir))
            self._col = self._client.get_or_create_collection(
                name=self.collection_name, metadata={"hnsw:space": "cosine"})
        except Exception as e:
            self.error = f"ChromaDB unavailable, dense retrieval disabled: {e}"
            log.error(self.error)
        self._bm25: Optional[_LuceneBM25] = None
        self._bm25_ids: List[str] = []
        self._bm25_docs: List[str] = []

    @property
    def dense_ok(self) -> bool:
        return self._col is not None

    def count(self) -> int:
        try:
            return self._col.count() if self._col is not None else 0
        except Exception:
            return 0

    # ── writes ────────────────────────────────────────────────────────────────
    def add(self, chunks: Sequence[Dict]) -> None:
        if not chunks or self._col is None:
            return
        with self._lock:
            texts = [c["text"] for c in chunks]
            embs = self.embedder.encode(texts)
            for i in range(0, len(chunks), 256):
                part = chunks[i:i + 256]
                self._col.upsert(
                    ids=[c["chunk_id"] for c in part],
                    embeddings=embs[i:i + 256].tolist(),
                    documents=[c["text"] for c in part],
                    metadatas=[{"doc_id": c["doc_id"], "page": int(c["page"]), "chunk_index": int(c["chunk_index"])}
                               for c in part],
                )

    def delete_doc(self, doc_id: str) -> None:
        if self._col is None:
            return
        try:
            with self._lock:
                self._col.delete(where={"doc_id": doc_id})
        except Exception as e:
            log.warning(f"Chroma delete for {doc_id} failed: {e}")

    def reset(self) -> None:
        if self._col is None:
            return
        with self._lock:
            try:
                self._client.delete_collection(self.collection_name)
            except Exception:
                pass
            self._col = self._client.get_or_create_collection(
                name=self.collection_name, metadata={"hnsw:space": "cosine"})

    def sync(self, chunks: Sequence[Dict]) -> int:
        """Embed any SQLite chunks missing from Chroma (model switch, crash, deleted dir)."""
        self.rebuild_bm25(chunks)
        if self._col is None or not chunks:
            return 0
        try:
            have = set(self._col.get(include=[])["ids"])
        except Exception as e:
            log.warning(f"Chroma id listing failed: {e}")
            return 0
        missing = [c for c in chunks if c["chunk_id"] not in have]
        if missing:
            log.info(f"Re-embedding {len(missing)} chunk(s) into {self.collection_name}")
            self.add(missing)
        return len(missing)

    def rebuild_bm25(self, chunks: Sequence[Dict]) -> None:
        with self._lock:
            self._bm25_ids = [c["chunk_id"] for c in chunks]
            self._bm25_docs = [c["doc_id"] for c in chunks]
            corpus = [index_terms(c["text"]) or ["_empty_"] for c in chunks]
            self._bm25 = _LuceneBM25(corpus) if corpus else None

    # ── reads ─────────────────────────────────────────────────────────────────
    def dense_search(self, query: str, k: int, doc_ids: Optional[Sequence[str]] = None,
                     query_emb: Optional[np.ndarray] = None) -> List[Tuple[str, float]]:
        n = self.count()
        if self._col is None or n == 0:
            return []
        emb = query_emb if query_emb is not None else self.embedder.encode([query])[0]
        where = None
        if doc_ids:
            where = {"doc_id": doc_ids[0]} if len(doc_ids) == 1 else {"doc_id": {"$in": list(doc_ids)}}
        try:
            res = self._col.query(query_embeddings=[emb.tolist()], n_results=min(k, n), where=where)
        except Exception as e:
            log.warning(f"Dense search failed: {e}")
            return []
        ids = res.get("ids", [[]])[0]
        dists = res.get("distances", [[]])[0]
        return [(i, float(1.0 - d)) for i, d in zip(ids, dists)]

    def sparse_search(self, query: str, k: int, doc_ids: Optional[Sequence[str]] = None) -> List[Tuple[str, float]]:
        with self._lock:
            if self._bm25 is None or not self._bm25_ids:
                return []
            terms = index_terms(query)
            if not terms:
                return []
            scores = self._bm25.get_scores(terms)
            allowed = set(doc_ids) if doc_ids else None
            order = np.argsort(scores)[::-1]
            out = []
            for idx in order:
                if scores[idx] <= 0:
                    break
                if allowed is not None and self._bm25_docs[idx] not in allowed:
                    continue
                out.append((self._bm25_ids[idx], float(scores[idx])))
                if len(out) >= k:
                    break
            return out
