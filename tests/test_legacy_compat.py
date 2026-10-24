"""The original CEO-twin code paths still import and expose their routes."""

from backend.core import ranking


def test_ranking_helpers():
    assert abs(ranking.sigmoid(0.0) - 0.5) < 1e-9
    assert ranking.sigmoid(-1000) >= 0.0 and ranking.sigmoid(1000) <= 1.0
    assert ranking.rrf(0) > ranking.rrf(5)
    docs = [{"content": "a b c", "confidence": 0.9}, {"content": "a b c", "confidence": 0.8},
            {"content": "x y z", "confidence": 0.5}]
    picked = ranking.mmr(docs, top_k=2, lambda_param=0.5)
    assert [d["content"] for d in picked] == ["a b c", "x y z"]


def test_legacy_retriever_aliases_still_exist():
    from backend.core import rag_pipeline
    assert rag_pipeline._sigmoid is ranking.sigmoid
    assert rag_pipeline._mmr is ranking.mmr
    assert rag_pipeline._recency_score({"date": ""}) == 0.5


def test_main_app_mounts_kb_and_ceo_routes():
    from backend.main import app
    paths = set(app.openapi()["paths"])
    assert {"/api/kb/query/stream", "/api/kb/graph", "/api/kb/documents"} <= paths
    assert {"/api/chat/stream", "/api/voice/transcribe", "/health"} <= paths


def test_legacy_ingest_script_imports():
    import importlib
    mod = importlib.import_module("ingest")  # previously crashed on the removed groq modules
    assert mod.ChunkClassifier.MODEL.startswith("gemini")
