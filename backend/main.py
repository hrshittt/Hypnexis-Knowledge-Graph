"""
FastAPI Main Application
========================
Hosts two products on one server:
  - Interactive Knowledge Base (Topic-Augmented Knowledge Graph Builder) — /api/kb/*
  - CEO Digital Twin (original agentic RAG chat)                          — /api/chat/*, /api/voice/*

Run: uvicorn backend.main:app --reload --port 8000

The CEO twin's retriever/memory (2 × bge-base models) warm up only when
WARMUP_LEGACY_CEO=1; otherwise they load lazily on the first /api/chat request.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from backend.api.chat import router as chat_router
from backend.api.kb import router as kb_router
from backend.api.voice import router as voice_router
from backend.utils.logger import get_logger

log = get_logger(__name__)

# ─── Rate Limiter ─────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

# ─── Startup state (so /health can report accurately) ────────────────────────
_startup_status: dict = {
    "knowledge_base": False,
    "retriever": False,
    "memory": False,
    "gemini_client": False,
    "graph": False,
}
WARMUP_LEGACY = os.getenv("WARMUP_LEGACY_CEO", "0").strip().lower() in ("1", "true", "yes")


# ─── Lifespan (replaces deprecated @app.on_event) ────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle.

    All warm-up failures are non-fatal — the app starts regardless.
    Individual endpoints return 503 if their required component isn't ready.
    This prevents a single missing env-var from killing the entire Space.
    """
    log.info("=" * 60)
    log.info("🚀 Server starting up...")

    log.info("   Warming up Knowledge Base (embedder, reranker, graph store)...")
    try:
        from backend.kb.service import get_kb
        get_kb()
        _startup_status["knowledge_base"] = True
        log.success("   Knowledge Base ready.")
    except Exception as e:
        log.error(f"   Knowledge Base warm-up failed (API returns 503 with the reason): {e}")

    if WARMUP_LEGACY:
        log.info("   Warming up HybridRetriever...")
        try:
            from backend.core.rag_pipeline import get_retriever
            get_retriever()
            _startup_status["retriever"] = True
            log.success("   HybridRetriever ready.")
        except Exception as e:
            log.warning(f"   Retriever warm-up failed (run ingest.py first): {e}")

        log.info("   Warming up MemoryManager...")
        try:
            from backend.memory.memory_manager import get_memory
            get_memory()
            _startup_status["memory"] = True
            log.success("   MemoryManager ready.")
        except Exception as e:
            log.warning(f"   MemoryManager warm-up failed: {e}")
    else:
        log.info("   CEO twin retriever/memory: lazy (set WARMUP_LEGACY_CEO=1 to warm up)")

    gemini_key_set = bool(os.getenv("GEMINI_API_KEY", "").strip())
    if gemini_key_set:
        log.info("   Warming up Gemini Client...")
        try:
            from backend.utils.gemini_client import get_pool
            get_pool()
            _startup_status["gemini_client"] = True
            log.success("   Gemini Client ready.")
        except Exception as e:
            log.warning(f"   Gemini Client failed to start: {e} — Knowledge Base uses extractive mode.")
    else:
        # A supported mode, not a failure: rule-based extraction + quote-only cited answers.
        log.info("   No GEMINI_API_KEY set — Knowledge Base runs in extractive mode "
                 "(add the key to .env for Gemini mode; the CEO-twin chat needs it).")

    log.info("   Compiling LangGraph...")
    try:
        from backend.agents.graph import get_graph
        get_graph()
        _startup_status["graph"] = True
        log.success("   LangGraph compiled.")
    except Exception as e:
        log.warning(f"   LangGraph compile failed: {e}")

    # Only components we actually tried to start count as failures (lazy ones are not failures).
    expected = ["knowledge_base", "graph"]
    if WARMUP_LEGACY:
        expected += ["retriever", "memory"]
    if gemini_key_set:
        expected.append("gemini_client")
    failed = [k for k in expected if not _startup_status[k]]
    if failed:
        log.warning(f"⚠️  Started in degraded mode — failed: {failed} (details above)")
    else:
        mode = "Gemini mode" if _startup_status["gemini_client"] else "extractive mode"
        log.success(f"✅ Ready — Knowledge Base live ({mode}). API: http://127.0.0.1:8000/docs")
    log.info("=" * 60)

    yield  # ← app runs here

    log.info("🛑 Server shutting down...")


app = FastAPI(
    title="Interactive Knowledge Base + CEO Digital Twin",
    description="Topic-augmented knowledge graph builder with grounded, graph-aware answers "
                "(plus the original agentic RAG CEO twin).",
    version="3.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ─── Rate Limiter middleware ──────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ─── CORS (restricted to known origins) ──────────────────────────────────────
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "https://anaxee-ceo-clone.vercel.app",
    "https://theyeetguy-ceo-clone.hf.space",
]
# Allow extra origins from env (comma-separated)
extra = os.getenv("CORS_ORIGINS", "")
if extra:
    ALLOWED_ORIGINS.extend([o.strip() for o in extra.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ─────────────────────────────────────────────────────────────────
app.include_router(kb_router)
app.include_router(chat_router)
app.include_router(voice_router)


# ─── Deep Health Check ───────────────────────────────────────────────────────
@app.get("/health")
async def health():
    """
    Detailed health check used by:
    - Docker HEALTHCHECK
    - HF Spaces uptime monitoring
    - Vercel frontend pre-flight checks
    """
    checks = dict(_startup_status)  # start from warm-up state

    # Re-probe live status without forcing lazy (heavy) components to load
    import backend.kb.service as kb_service
    checks["knowledge_base"] = kb_service._kb is not None
    try:
        import backend.core.rag_pipeline as rag
        checks["retriever"] = rag._retriever is not None
    except Exception:
        checks["retriever"] = False
    try:
        import backend.memory.memory_manager as mem
        checks["memory"] = mem._memory is not None
    except Exception:
        checks["memory"] = False
    try:
        from backend.utils.gemini_client import get_pool
        checks["gemini_client"] = get_pool() is not None
    except Exception:
        checks["gemini_client"] = False
    try:
        from backend.agents.graph import get_graph
        checks["graph"] = get_graph() is not None
    except Exception:
        checks["graph"] = False

    # The knowledge base works without Gemini (heuristic/extractive mode)
    status = "ok" if checks["knowledge_base"] else "degraded"
    return {
        "status": status,
        "service": "Interactive Knowledge Base + CEO Digital Twin",
        "version": "3.0.0",
        "checks": checks,
        "kb_error": kb_service.kb_init_error(),
    }


@app.get("/")
async def root():
    return {
        "message": "Interactive Knowledge Base API (+ CEO Digital Twin)",
        "docs": "/docs",
        "health": "/health",
        "kb": {
            "status": "/api/kb/status",
            "upload": "POST /api/kb/documents",
            "graph": "/api/kb/graph",
            "query": "POST /api/kb/query/stream",
        },
        "chat": "/api/chat/stream",
        "voice": "/api/voice/transcribe",
    }
