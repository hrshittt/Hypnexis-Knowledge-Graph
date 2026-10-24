---
title: CEO Digital Twin
emoji: 🧠
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
app_file: Dockerfile
pinned: false
tags:
  - rag
  - langchain
  - langgraph
  - fastapi
  - gemini
  - sentence-transformers
  - chromadb
---

# Interactive Knowledge Base — Topic-Augmented Knowledge Graph Builder

Upload PDF and TXT documents. The app extracts entities and relationships into a persistent knowledge graph, discovers topic communities, and answers questions with **cited source passages and the supporting graph path highlighted** in an interactive, zoomable graph.

```
Upload documents → extract entities & relations → build the knowledge graph → discover topic communities
      → ask a question → route (thematic / factual / multi-hop / comparison) → retrieve evidence
      → grounded, cited answer → highlight the entities, edges, communities and exact evidence path
```

The repository also still contains the original **CEO Digital Twin** (agentic RAG chat). See [Legacy: CEO Digital Twin](#legacy-ceo-digital-twin).

---

## Quick start (local)

Requirements: Python 3.12, Node 18+. A Gemini key is **optional**.

```powershell
# 1. Backend (from the repo root)
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
copy .env.example .env            # optional: add GEMINI_API_KEY for LLM mode
.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

macOS/Linux: use `.venv/bin/python` instead of `.venv\Scripts\python.exe`, and `cp` instead of `copy`.

The first start downloads two small models (~90 MB each, cached afterwards): the `all-MiniLM-L6-v2` embedder and the `ms-marco-MiniLM-L-6-v2` cross-encoder.

### Troubleshooting the terminals

| You see | Meaning / fix |
|---|---|
| Vite: `http proxy error: /api/kb/... ECONNREFUSED` | The backend isn't running or is still loading models. Start the backend first. The UI shows "Backend not reachable" and retries with back-off. To use a backend elsewhere, set `VITE_PROXY_TARGET=http://host:port`. |
| Vite: `Port 5173 is in use, trying another one...` | Another dev server (often a forgotten one) holds 5173. Use the URL Vite prints (for example 5174), or stop the old process. |
| Backend: `Model '...' not cached yet — downloading once` | Only on first start; models are cached afterwards and later starts are offline and take ~2 s. |
| Backend: `No GEMINI_API_KEY set — ... extractive mode` | Informational: the KB works without a key. Add one to `.env` for Gemini mode. |

### Demo in 30 seconds

1. Open http://localhost:5173 and click **Load sample documents** (5 docs: 4 TXT + 1 two-page PDF).
2. Watch the graph build: about 39 entities, 51 relations and 4 topic communities shown as coloured hulls.
3. Click an example question, or try one from the table below. Then click citation chips, nodes, edges and topics.

You can also load the samples from a terminal: `.venv\Scripts\python.exe -m backend.kb.cli load-samples`, then `... -m backend.kb.cli ask "How is the Clean Horizon Act connected to childhood asthma?"`.

---

## What it does

| Capability | Implementation |
|---|---|
| **Ingestion** | Multiple PDF / TXT / MD files per upload. pypdf extracts text per page. Layout normalisation de-hyphenates, joins soft-wrapped lines and keeps headings. Sentence-aligned chunks (900 chars, 150 overlap) store exact `page` + `start_char/end_char` offsets. |
| **Validation** | Type, size (20 MB), empty, binary, corrupt, encrypted and scanned (no-text) files are rejected *at upload* with a reason. SHA-256 duplicate detection covers both earlier uploads and duplicates within one batch. Failed documents can be retried. |
| **Triple extraction** | **Gemini** JSON extraction (when a key is set) is validated against the passage: an entity must occur in the chunk, the evidence must be a verbatim sentence of the chunk, and an endpoint must appear in that sentence. Anything else is dropped. Without a key, a **rule-based extractor** handles active and passive voice, role phrases ("X is the CEO of Y"), possessive roles, appositives, relative clauses, coordination, concept noun phrases and pronoun/definite-NP coreference. |
| **Entity dedup** | Normalised names, so "The Voltaic Systems Inc." equals "Voltaic Systems". Also acronym aliases ("Coastal Energy Commission (CEC)"), surname-only mentions, conservative fuzzy matching (≥0.92, type-compatible) and deterministic IDs, so the same entity in another document merges into one node. |
| **Graph store** | SQLite (WAL) tables for nodes, aliases, mentions, edges and per-sentence evidence, communities and cross-topic links. NetworkX runs the algorithms. Deleting a document prunes orphan nodes and edges. An optional **Neo4j mirror** activates when `NEO4J_URI` is set. |
| **Topic augmentation** | Louvain communities over relation edges plus co-mentions (fixed seed, so topics are stable). Each topic gets a label, keywords and a **grounded summary**: Gemini with validated `[n]` citations, or extractive sentences. **Cross-topic links** come from bridge relations. |
| **Retrieval** | ChromaDB (dense) and BM25 (sparse), fused with RRF, then CrossEncoder rerank and MMR. This is the recipe of the CEO twin's retriever, reusing `backend/core/ranking.py`. Questions are linked to graph entities via aliases, distinctive name tokens and fuzzy matches. |
| **Query routing** | LangGraph workflow: **thematic** ranks topic communities, **factual** combines passages and the linked entities' relations, **multi-hop** uses k-shortest evidence paths (hub-penalised), and **comparison** handles both entities and documents. Each route has its own retrieval node, followed by evidence assessment and a CRAG-style query rewrite (LLM only). |
| **Grounded answers** | Evidence is numbered `[S#]` (passages) and `[G#]` (graph relations, each linked to its source sentence). The LLM may cite only listed IDs. Invalid citations are stripped, and an uncited answer is rejected for the extractive one. `INSUFFICIENT_EVIDENCE` is honoured. Without an LLM, answers quote source sentences verbatim. Questions the documents can't answer get an **Insufficient evidence** reply instead of a guess. |
| **UI** | Split screen. Left: drag-and-drop uploads with live job progress and a chat with streamed LangGraph stages. Right: a zoomable force-directed graph with topic hulls. Answers highlight nodes, edges and communities and draw the exact evidence path. Clicking a node, edge, citation or topic opens an inspector with the verbatim source passages and the supporting sentence marked. |

### Two modes

| | **Gemini mode** (`GEMINI_API_KEY` set) | **Extractive mode** (no key) |
|---|---|---|
| Triple extraction | Gemini, validated against the text | Rule-based |
| Topic summaries | Gemini with validated citations | Extractive sentences |
| Answers | Generated, citation-checked | Verbatim source sentences + graph facts |
| Routing | Heuristics, Gemini for low-confidence cases | Heuristics |

Both modes use the same retrieval, graph, evidence-sufficiency checks and UI. When Gemini fails repeatedly (bad key, quota), a circuit breaker switches to extractive mode for 5 minutes instead of stalling.

---

## Sample data and example questions

`samples/` contains a small **fictional** corpus: an energy research lab, a battery startup, a grid operator (PDF), an energy regulator and a public-health study. It's fictional on purpose, so answers can only come from the documents. `samples/questions.json` feeds the example chips in the UI (`GET /api/kb/examples`). Regenerate the PDF with `python scripts/make_sample_pdf.py`.

| Category | Question | Expected behaviour |
|---|---|---|
| Topic discovery | What are the main themes across these documents? | 4 communities with cited summaries; all hulls highlighted |
| Factual | Who founded Voltaic Systems? | Ravi Menon, cited; *founded* edge highlighted |
| Factual | Where is Ferrite Labs based? | Kestrel Bay (matches the *located in* relation) |
| Multi-hop | How is the Clean Horizon Act connected to childhood asthma? | Clean Horizon Act → *requires closure of* → Harbor Coal Plant → *contributes to* → fine particulate pollution → *linked to* → childhood asthma (crosses the PDF and the health study) |
| Multi-hop | How is Dr. Lena Park connected to Voltaic Systems? | Lena Park → Aurora Institute ← Ravi Menon → Voltaic Systems |
| Comparison | Compare Aurora Institute and Voltaic Systems. | Entity comparison: relations, passages, shared and distinct neighbours |
| Comparison | Compare the Voltaic Systems brief with the Meridian Grid annual report. | Document comparison |
| Insufficient | What is Voltaic Systems' current stock price? | **Insufficient evidence**: closest passages shown, nothing invented |
| Insufficient | Who won the 2022 FIFA World Cup? | **Insufficient evidence** |

---

## Architecture

```
frontend/ (React + Vite + Tailwind + react-force-graph-2d)
  App.tsx ── DocumentPanel · ChatPanel/AnswerCard ── GraphView · TopicLegend · Inspector
        │  REST + SSE (/api/kb/*, proxied by Vite to :8000)
backend/
  main.py                FastAPI app: KB routes + legacy CEO-twin routes
  api/kb.py              upload / jobs / graph / inspectors / query (JSON + SSE) / samples / reset
  kb/
    documents.py         validation, PDF/TXT extraction, normalisation, offset-exact chunking
    extraction.py        heuristic + LLM (validated) triple extraction      lexicon.py  predicate/role lexicons
    resolution.py        entity resolution & deterministic ids
    store.py             SQLite graph + document store                      neo4j_sync.py  optional mirror
    vector_index.py      ChromaDB + BM25 chunk index                        embeddings.py  embedder/reranker
    topics.py            alias-scan mentions, Louvain communities, grounded summaries, cross-topic links
    retriever.py         hybrid passage search, entity linking, paths, topic ranking
    router.py            thematic | factual | multi_hop | comparison (+ comparison targets)
    answer.py            evidence packs, sufficiency, LLM generation, citation validation, extractive answers
    qa_graph.py          LangGraph workflow (route → retrieve → assess → [rewrite] → generate → finalize)
    service.py           façade: ingestion jobs, queries, read models      cli.py  terminal interface
  core/ranking.py        RRF / sigmoid / MMR shared with the CEO twin's retriever
samples/                 demo corpus + questions.json
tests/                   pytest suite (offline: hashing embedder, no reranker, no LLM)
```

Runtime data lives in `data/kb/` (git-ignored): `uploads/`, `knowledge.db` (graph) and `chroma/` (vectors). The original `data/` contents of the CEO twin are untouched.

### Main API (`/docs` has the full OpenAPI)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/kb/documents` | multipart `files=…` → per-file result (`queued` / `duplicate` / `rejected` + reason) and a job id (202) |
| `GET` | `/api/kb/jobs/{id}` | ingestion progress (stage, chunks done/total, failures) |
| `GET` | `/api/kb/documents` · `DELETE /api/kb/documents/{id}` · `POST …/{id}/retry` | manage documents |
| `GET` | `/api/kb/graph` | nodes, edges, topic communities, cross-topic links |
| `GET` | `/api/kb/entities/{id}` · `/relations/{id}` · `/chunks/{id}` | inspectors with verbatim evidence and highlight offsets |
| `POST` | `/api/kb/query` · `/api/kb/query/stream` | grounded answer (JSON / SSE with LangGraph stage events) |
| `GET` | `/api/kb/topics` · `POST /api/kb/topics/rebuild` | topic communities |
| `POST` | `/api/kb/samples/load` · `GET /api/kb/examples` | demo helpers |
| `GET` | `/api/kb/status` · `/health` | component status, LLM mode, counts |
| `DELETE` | `/api/kb?confirm=true` | wipe the knowledge base (only `data/kb/`) |

### Configuration

All settings are optional and documented in [.env.example](.env.example). The main ones:

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | enables Gemini mode |
| `KB_LLM` | `auto` | `off` forces extractive mode even when a key exists |
| `KB_GEN_MODEL` / `KB_FAST_MODEL` | `gemini-3.5-flash` / `gemini-3.5-flash-lite` | same tiers as the CEO twin |
| `KB_EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | `hash` = offline embedder (no download) |
| `KB_RERANKER_MODEL` | `cross-encoder/ms-marco-MiniLM-L-6-v2` | `none` disables reranking |
| `KB_DATA_DIR` | `data/kb` | |
| `KB_COMMUNITY_RESOLUTION` | `1.2` | higher = more, smaller topics |
| `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` | — | optional Neo4j mirror (`pip install neo4j`) |
| `WARMUP_LEGACY_CEO` | `0` | `1` preloads the CEO twin's models at startup |

---

## Tests

```powershell
.venv\Scripts\python.exe -m pytest          # ~80 tests, offline, ~30 s
cd frontend; npm run build                  # strict TypeScript check + production build
```

The tests run against temporary data directories, with an offline hashing embedder and no network. They cover:
- ingestion: validation, encodings, layout normalisation, offset-exact chunks, PDF round-trip, corrupt and scanned PDFs
- extraction patterns, plus rejection of fabricated LLM relations and citations
- entity resolution, store persistence and deletion pruning, grounded topic summaries, cross-topic bridges
- entity linking, routing, hybrid search, evidence paths
- end-to-end answers for every route, citation integrity, insufficient-evidence handling, LLM grounding through a fake LLM
- the full HTTP API: upload, background job, graph, inspectors, JSON/SSE query, delete, reset and 503 handling
- legacy compatibility

## Limitations

- **Rule-based extraction is precise but incomplete.** It understands common English relation patterns (≈45 predicate families). Unusual phrasing, long-range coreference and tables yield fewer relations than Gemini mode. Every extracted relation still has a verbatim evidence sentence.
- **Scanned/image-only PDFs need OCR** before upload. They are rejected with a clear message.
- **Ingestion jobs run in-process.** Progress is kept in memory, and a server restart marks unfinished documents *failed* (retryable). One worker process is assumed.
- **Neo4j mirroring is implemented but was not exercised against a live Neo4j server** in this environment. SQLite is the source of truth.
- **The Gemini code paths are tested with a fake LLM**, not live calls; the default model names follow the existing project's configuration.
- **The graph view renders the top 800 entities** (ranked by degree and mentions); larger graphs are truncated in the UI, not in storage.

---

## Legacy: CEO Digital Twin

The original agentic 3-DB RAG chat (Govind Agrawal / Anaxee Digital Runners) is still served by the same backend at `/api/chat/stream` and `/api/voice/transcribe`. Its React components remain in `frontend/src/components/` (`ChatInterface`, `MessageBubble`).

- **Pipeline:** LangGraph state machine (semantic router → query planner → triple-hybrid retrieval over `facts_db` / `style_db` / `reasoning_db` with BM25 + CrossEncoder + MMR → CRAG grader/rewriter → generator → Self-RAG hallucination check → follow-ups) and a 3-layer memory.
- **Data:** place transcript JSONs in `data/jsons/` and run `.venv\Scripts\python.exe ingest.py` (use `--force` to re-embed). It requires `GEMINI_API_KEY`.
- **Startup:** the twin's two `bge-base` models load lazily on the first `/api/chat` request. Set `WARMUP_LEGACY_CEO=1` to preload them, as the Hugging Face Space did before.
- **Deploy:** `Dockerfile` (Hugging Face Spaces, port 7860) and `hf_deploy_check.py` are unchanged in purpose. The image now also serves the Knowledge Base API.
