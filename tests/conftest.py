"""
Shared fixtures. Every test runs against an isolated temp data dir with the offline
hashing embedder, no reranker and no LLM — fast, deterministic, no network, and the
real data/ directory is never touched.
"""

import asyncio
import os
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Knowledge bases built from environment settings (e.g. workspace KBs) use the local SQLite graph in
# tests, whatever .env says (load_dotenv never overrides an existing variable); live Neo4j tests opt in.
os.environ["KB_GRAPH_STORE"] = "sqlite"

from backend.kb.config import load_settings  # noqa: E402
from backend.kb.embeddings import HashingEmbedder  # noqa: E402
from backend.kb.service import KnowledgeBaseService  # noqa: E402

SAMPLES = ROOT / "samples"


def make_service(data_dir: Path, llm=None, **overrides) -> KnowledgeBaseService:
    # graph_store="sqlite" unless a test asks otherwise, so a NEO4J_URI in .env never points the
    # suite at a developer's real graph (Neo4j tests use their own namespace, see test_neo4j_store.py)
    settings = load_settings(data_dir=data_dir, samples_dir=SAMPLES, llm_mode="off",
                             **{"graph_store": "sqlite", **overrides})
    return KnowledgeBaseService(settings, embedder=HashingEmbedder(), reranker=None, llm=llm)


def sample_payload(*names):
    paths = sorted(SAMPLES.glob("*")) if not names else [SAMPLES / n for n in names]
    return [(p.name, p.read_bytes()) for p in paths if p.suffix in (".txt", ".pdf")]


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def kb(tmp_path):
    svc = make_service(tmp_path / "kb")
    yield svc
    svc.store.close()


@pytest.fixture(scope="session")
def loaded_kb(tmp_path_factory):
    """One knowledge base with all sample documents ingested (shared, read-only use)."""
    svc = make_service(tmp_path_factory.mktemp("loaded") / "kb")
    reg = run(svc.ingest_files_and_wait(sample_payload()))
    assert reg["job"]["status"] == "done", reg
    return svc


@pytest.fixture
def client(kb, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import backend.api.kb as kb_api
    import backend.kb.service as svc_mod

    monkeypatch.setattr(svc_mod, "_kb", kb)
    monkeypatch.setattr(kb_api.limiter, "enabled", False)
    app = FastAPI()
    app.include_router(kb_api.router)
    with TestClient(app) as c:  # context manager keeps the event loop alive for background jobs
        yield c


def wait_job(client, job_id: str, timeout: float = 60.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/kb/jobs/{job_id}").json()
        if job["status"] in ("done", "partial", "failed"):
            return job
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish in {timeout}s")
