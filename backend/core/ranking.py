"""
Shared ranking primitives
=========================
Pure-Python helpers used by both retrievers:
  - TripleHybridRetriever (backend/core/rag_pipeline.py) — CEO twin
  - KBRetriever           (backend/kb/retriever.py)       — knowledge base

Kept dependency-free so tests can import them without loading models.
"""

import math
from typing import Any, Dict, List


def sigmoid(x: float) -> float:
    """Normalise a CrossEncoder raw logit to (0, 1)."""
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    z = math.exp(x)  # numerically stable for large negative logits
    return z / (1.0 + z)


def rrf(rank: int, k: int = 60) -> float:
    """Reciprocal Rank Fusion contribution for a 0-based rank."""
    return 1.0 / (k + rank)


def jaccard_sim(text_a: str, text_b: str) -> float:
    """Fast word-overlap Jaccard similarity for MMR diversity measure."""
    words_a = set(text_a.lower().split())
    words_b = set(text_b.lower().split())
    if not words_a or not words_b:
        return 0.0
    return len(words_a & words_b) / len(words_a | words_b)


def mmr(
    candidates: List[Dict[str, Any]],
    top_k: int = 12,
    lambda_param: float = 0.75,
    score_key: str = "confidence",
    content_key: str = "content",
) -> List[Dict[str, Any]]:
    """
    Maximal Marginal Relevance — balances relevance vs diversity.
    lambda=1.0  → pure relevance
    lambda=0.75 → mostly relevance but filters near-duplicates
    lambda=0.0  → pure diversity

    Uses Jaccard word-overlap as cheap diversity proxy (no extra embeddings needed).
    """
    if len(candidates) <= top_k:
        return candidates

    selected: List[Dict[str, Any]] = []
    remaining = list(candidates)

    while len(selected) < top_k and remaining:
        if not selected:
            best = max(remaining, key=lambda d: d[score_key])
        else:
            best, best_score = None, -float("inf")
            for doc in remaining:
                rel = doc[score_key]
                max_sim = max(jaccard_sim(doc[content_key], s[content_key]) for s in selected)
                score = lambda_param * rel - (1 - lambda_param) * max_sim
                if score > best_score:
                    best_score, best = score, doc
        selected.append(best)
        remaining.remove(best)

    return selected
