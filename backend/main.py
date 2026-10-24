"""
FastAPI Main Application
========================
Paheli — knowledge graph intelligence platform. One server hosts:
  - Shared demo knowledge graph (Topic-Augmented Knowledge Graph Builder)  — /api/kb/*
  - Accounts and sessions                                                  — /api/auth/*
  - Workspaces with isolated knowledge bases                               — /api/workspaces/*
      corporate / research / legal analyses, placement intelligence
  - Cross-workspace dashboard, documents, search, activity, saved analyses — /api/overview, /api/search, …
  - CEO Digital Twin (original agentic RAG chat)                           — /api/chat/*, /api/voice/*
  - Call Paheli (OmniDimension outbound voice call)                        — /api/call/*

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

from backend import services
from backend.api.auth import router as auth_router
from backend.api.call import router as call_router
from backend.api.chat import router as chat_router
from backend.api.intel import router as intel_router
from backend.api.kb import router as kb_router
from backend.api.placement import router as placement_router
from backend.api.platform import router as platform_router
from backend.api.voice import router as voice_router
from backend.api.workspaces import kb_router as workspace_kb_router
from backend.api.workspaces import router as workspaces_router
from backend.config import real_secret
from backend.utils.logger import get_logger

log = get_logger(__name__)

# ─── Rate Limiter ─────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

# ─── Startup state (so /health can report accurately) ────────────────────────
_startup_status: dict = {
    "platform_db": False,
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

    try:
        db = services.db()
        log.success(f"   Platform database ready (schema v{db.schema_version()}): {services.settings().db_path}")
        _startup_status["platform_db"] = True
    except Exception as e:
        _startup_status["platform_db"] = False
        log.error(f"   Platform database failed to open (sign-in and workspaces unavailable): {e}")
    log.info(f"   Shared knowledge graph writes: {app.state.shared_kb_write} (KB_SHARED_WRITE)")

    log.info("   Warming up Knowledge Base (embedder, reranker, graph store)...")
    try:
        from backend.kb.service import get_kb
        kb = get_kb()
        _startup_status["knowledge_base"] = True
        log.success(f"   Knowledge Base ready (graph store: {kb.store.graph_backend}).")
        job = kb.start_graph_resync()
        if job:
            log.info(f"   Re-extracting {len(job['doc_ids'])} document(s) into the {kb.store.graph_backend} graph store "
                     f"(job {job['id']}).")
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

    gemini_key_set = real_secret(os.getenv("GEMINI_API_KEY", ""))  # the .env.example placeholder isn't a key
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
    expected = ["knowledge_base", "graph", "platform_db"]
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
    title="Paheli — Knowledge Graph Intelligence Platform",
    description="Evidence-backed answers and interactive knowledge graphs for corporate, research, legal and "
                "placement intelligence (plus the original agentic RAG CEO twin).",
    version="4.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ─── Rate Limiter middleware ──────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Who may change the shared demo graph at /api/kb (admin | authenticated | public).
app.state.shared_kb_write = services.settings().shared_kb_write


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


# The graph database dropping out mid-request is a 503 (temporarily unavailable), not a 500.
try:
    from neo4j.exceptions import ServiceUnavailable, SessionExpired

    async def _graph_db_unavailable(request: Request, exc: Exception):
        return JSONResponse(status_code=503, content={"detail": f"Graph database (Neo4j) unavailable: {exc}"})

    app.add_exception_handler(ServiceUnavailable, _graph_db_unavailable)
    app.add_exception_handler(SessionExpired, _graph_db_unavailable)
except ImportError:
    pass

# ─── CORS (restricted to known origins) ──────────────────────────────────────
# Local dev servers only; add your deployed frontend's origin(s) with CORS_ORIGINS.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
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
app.include_router(auth_router)
app.include_router(workspaces_router)
app.include_router(workspace_kb_router)
app.include_router(placement_router)
app.include_router(intel_router)
app.include_router(platform_router)
app.include_router(chat_router)
app.include_router(voice_router)
app.include_router(call_router)


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
        # the .env.example placeholder is not a key, so a pool built from it doesn't count
        checks["gemini_client"] = real_secret(os.getenv("GEMINI_API_KEY", "")) and get_pool() is not None
    except Exception:
        checks["gemini_client"] = False
    try:
        from backend.agents.graph import get_graph
        checks["graph"] = get_graph() is not None
    except Exception:
        checks["graph"] = False

    graph_store = None
    if kb_service._kb is not None:
        graph_store = kb_service._kb.store.graph_info()
        checks["graph_store"] = bool(graph_store.get("connected"))

    # The knowledge base works without Gemini (heuristic/extractive mode), but not without its graph store
    status = "ok" if checks["knowledge_base"] and checks.get("graph_store", True) else "degraded"
    try:
        services.db().one("SELECT 1 AS ok")
        checks["platform_db"] = True
    except Exception:
        checks["platform_db"] = False

    return {
        "status": status,
        "service": "Paheli — Knowledge Graph Intelligence Platform",
        "version": "4.0.0",
        "checks": checks,
        "graph_store": graph_store,
        "kb_error": kb_service.kb_init_error(),
    }


@app.get("/")
async def root():
    return {
        "message": "Paheli API",
        "docs": "/docs",
        "health": "/health",
        "kb": {
            "status": "/api/kb/status",
            "upload": "POST /api/kb/documents",
            "graph": "/api/kb/graph",
            "query": "POST /api/kb/query/stream",
        },
        "auth": "/api/auth/me",
        "workspaces": "/api/workspaces",
        "search": "/api/search?q=",
        "chat": "/api/chat/stream",
        "voice": "/api/voice/transcribe",
    }
