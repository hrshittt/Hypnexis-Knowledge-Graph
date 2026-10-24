"""
Knowledge-base settings — read from environment (.env is loaded once here).

Every knob has a safe default so the KB runs with zero configuration:
  - no GEMINI_API_KEY  → heuristic extraction + extractive (quoted) answers
  - KB_EMBEDDING_MODEL=hash → offline hashing embedder (used by tests)
  - KB_RERANKER_MODEL=none  → skip the CrossEncoder
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")  # never override variables already set in the shell


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


@dataclass
class KBSettings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("KB_DATA_DIR", ROOT / "data" / "kb")))
    samples_dir: Path = field(default_factory=lambda: Path(os.getenv("KB_SAMPLES_DIR", ROOT / "samples")))

    embedding_model: str = field(default_factory=lambda: os.getenv(
        "KB_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"))
    reranker_model: str = field(default_factory=lambda: os.getenv(
        "KB_RERANKER_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2"))

    # LLM: "auto" uses Gemini when GEMINI_API_KEY is set; "off" forces heuristics.
    llm_mode: str = field(default_factory=lambda: os.getenv("KB_LLM", "auto").strip().lower())
    gen_model: str = field(default_factory=lambda: os.getenv("KB_GEN_MODEL", "gemini-3.5-flash"))
    fast_model: str = field(default_factory=lambda: os.getenv("KB_FAST_MODEL", "gemini-3.5-flash-lite"))

    chunk_size: int = field(default_factory=lambda: _env_int("KB_CHUNK_SIZE", 900))
    chunk_overlap: int = field(default_factory=lambda: _env_int("KB_CHUNK_OVERLAP", 150))
    max_upload_mb: int = field(default_factory=lambda: _env_int("KB_MAX_UPLOAD_MB", 20))
    max_files_per_upload: int = field(default_factory=lambda: _env_int("KB_MAX_FILES", 20))
    extraction_concurrency: int = field(default_factory=lambda: _env_int("KB_EXTRACTION_CONCURRENCY", 4))
    community_resolution: float = field(default_factory=lambda: _env_float("KB_COMMUNITY_RESOLUTION", 1.2))

    neo4j_uri: str = field(default_factory=lambda: os.getenv("NEO4J_URI", ""))
    neo4j_user: str = field(default_factory=lambda: os.getenv("NEO4J_USER", "neo4j"))
    neo4j_password: str = field(default_factory=lambda: os.getenv("NEO4J_PASSWORD", ""))
    neo4j_database: str = field(default_factory=lambda: os.getenv("NEO4J_DATABASE", "neo4j"))

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def sqlite_path(self) -> Path:
        return self.data_dir / "knowledge.db"

    @property
    def chroma_dir(self) -> Path:
        return self.data_dir / "chroma"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def gemini_key_present(self) -> bool:
        # the placeholder copied from .env.example ("your_gemini_api_key_here") is not a key
        key = os.getenv("GEMINI_API_KEY", "").strip()
        return bool(key) and not key.lower().startswith(("your_", "your-", "changeme", "<"))

    @property
    def llm_enabled(self) -> bool:
        return self.llm_mode != "off" and self.gemini_key_present

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.uploads_dir, self.chroma_dir):
            d.mkdir(parents=True, exist_ok=True)


def load_settings(**overrides) -> KBSettings:
    s = KBSettings()
    for k, v in overrides.items():
        if not hasattr(s, k):
            raise AttributeError(f"Unknown KB setting: {k}")
        setattr(s, k, Path(v) if k in ("data_dir", "samples_dir") else v)
    return s
