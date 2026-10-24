"""
Embedding + reranking backends for the knowledge base.

  SentenceTransformerEmbedder — default (all-MiniLM-L6-v2, same library as the CEO twin)
  HashingEmbedder             — deterministic, offline; used by tests and as a fallback
                                when a model cannot be downloaded/loaded
  CrossEncoderReranker        — ms-marco MiniLM, scores sigmoid-normalised to (0, 1)
"""

import hashlib
import math
from typing import List, Optional, Sequence

import numpy as np

from backend.core.ranking import sigmoid
from backend.kb.text_utils import index_terms
from backend.utils.logger import get_logger

log = get_logger(__name__)


def _quiet_model_loading() -> None:
    """Silence per-start progress bars from transformers / huggingface_hub (terminal noise)."""
    try:
        from huggingface_hub.utils import disable_progress_bars
        disable_progress_bars()
    except Exception:
        pass
    try:
        from transformers.utils import logging as hf_logging
        hf_logging.disable_progress_bar()
    except Exception:
        pass


def _load_cached_first(factory, model_name: str):
    """Load from the local HF cache without touching the network; download only on first use.
    Avoids the 'unauthenticated requests to the HF Hub' warning and makes restarts work offline."""
    _quiet_model_loading()
    try:
        return factory(model_name, local_files_only=True)
    except Exception:
        log.info(f"Model '{model_name}' not cached yet — downloading once (cached afterwards)...")
        return factory(model_name)


class HashingEmbedder:
    """Feature-hashed bag of stemmed unigrams + bigrams, L2-normalised."""

    def __init__(self, dim: int = 384):
        self.dim = dim
        self.name = f"hash-{dim}"

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        terms = index_terms(text)
        feats = terms + [f"{a}_{b}" for a, b in zip(terms, terms[1:])]
        for f in feats:
            h = int.from_bytes(hashlib.md5(f.encode("utf-8")).digest()[:8], "little")
            v[h % self.dim] += 1.0 if (h >> 63) & 1 else -1.0
        n = float(np.linalg.norm(v))
        return v / n if n > 0 else v

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)
        return np.vstack([self._vec(t) for t in texts])


class SentenceTransformerEmbedder:
    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer  # heavy import kept lazy
        self._model = _load_cached_first(SentenceTransformer, model_name)
        self.name = model_name
        dim_fn = getattr(self._model, "get_embedding_dimension", None) or self._model.get_sentence_embedding_dimension
        self.dim = int(dim_fn())

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)
        return np.asarray(
            self._model.encode(list(texts), batch_size=32, normalize_embeddings=True, show_progress_bar=False),
            dtype=np.float32,
        )


class CrossEncoderReranker:
    def __init__(self, model_name: str):
        from sentence_transformers import CrossEncoder
        self._model = _load_cached_first(CrossEncoder, model_name)
        self.name = model_name

    def score(self, query: str, texts: Sequence[str]) -> List[float]:
        if not texts:
            return []
        raw = self._model.predict([[query, t] for t in texts], show_progress_bar=False)
        return [sigmoid(float(x)) for x in np.atleast_1d(raw)]


def load_embedder(model_name: str):
    """Returns (embedder, warning_or_None). Never raises."""
    if model_name.lower() in ("hash", "hashing", "offline"):
        return HashingEmbedder(), None
    try:
        emb = SentenceTransformerEmbedder(model_name)
        log.info(f"KB embedder: {model_name} (dim={emb.dim})")
        return emb, None
    except Exception as e:
        msg = f"Embedding model '{model_name}' unavailable ({e}); using offline hashing embedder."
        log.warning(msg)
        return HashingEmbedder(), msg


def load_reranker(model_name: str):
    """Returns (reranker_or_None, warning_or_None). Never raises."""
    if not model_name or model_name.lower() in ("none", "off", "false", "0"):
        return None, None
    try:
        rr = CrossEncoderReranker(model_name)
        log.info(f"KB reranker: {model_name}")
        return rr, None
    except Exception as e:
        msg = f"Reranker '{model_name}' unavailable ({e}); falling back to fused BM25+dense ranking."
        log.warning(msg)
        return None, msg


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def safe_unit(x: float) -> float:
    return 0.0 if math.isnan(x) else max(0.0, min(1.0, x))
