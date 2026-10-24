---
title: Interactive Knowledge Base
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

# Hypnexis — Knowledge Graph Intelligence Platform

Hypnexis turns documents and records into evidence-backed answers and interactive knowledge graphs. One platform, four purpose-built workspaces:

| Workspace | For | What it does |
|---|---|---|
| **Corporate Intelligence** | CFOs, finance teams, analysts | Revenue, profit, cash-flow, debt and margin figures with period, currency, source and page; reported vs calculated values; disclosed risks vs rule-based inferred flags; a CFO assistant; a company graph |
| **Research Intelligence** | Students, researchers | Problem, method, data, findings and limitations per paper, each cited to its section; side-by-side comparison; related papers; a concept graph and assistant |
| **Legal & Policy Intelligence** | Compliance and legal researchers | "What may apply to my situation?": provisions, obligations, conditions, exceptions and penalties quoted from your sources, always marked *potentially* applicable; a provision graph |
| **Placement Intelligence** | Placement coordinators | CSV/XLSX import with mapping and validation; placement rate, offers, PPO conversion and CTC with explicit definitions; year comparison, funnel, companies, students (role-restricted), a placement assistant |

Underneath every workspace is the **Interactive Knowledge Base**: upload PDF and TXT documents, extract entities and relationships into a persistent knowledge graph, discover topic communities, and answer questions with **cited source passages and the supporting graph path highlighted** in an interactive, zoomable graph. The original single-corpus knowledge graph is kept intact as the **shared demo corpus** (`/api/kb`, the Knowledge Graph page, and the public `/demo` page).

```
Upload documents → extract entities & relations → build the knowledge graph → discover topic communities
      → ask a question → route (thematic / factual / multi-hop / comparison) → retrieve evidence
      → grounded, cited answer → highlight the entities, edges, communities and exact evidence path
```

Accounts, workspaces and roles are enforced by the API (HttpOnly session cookies, CSRF tokens, scrypt password hashing). See [Platform](#platform-accounts-workspaces-and-analyses).

The repository also still contains the original **CEO Digital Twin** (agentic RAG chat). See [Legacy: CEO Digital Twin](#legacy-ceo-digital-twin).

---

## Quick start (local)

Requirements: Python 3.12, Node 18+, and Neo4j 5 (Docker is the easiest way). A Gemini key is **optional**.

```powershell
# 1. Graph database (Neo4j 5.26, Browser at http://localhost:7474, user neo4j)
copy .env.example .env            # sets KB_GRAPH_STORE=neo4j and the local Neo4j credentials; optional GEMINI_API_KEY
docker compose up -d neo4j

# 2. Backend (from the repo root)
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000

# 3. Frontend (second terminal)
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

macOS/Linux: use `.venv/bin/python` instead of `.venv\Scripts\python.exe`, and `cp` instead of `copy`.

**Which graph store is active is always visible**: the header badge (*Graph: Neo4j* / *Graph: SQLite (local)*), `GET /api/kb/status` → `graph_store`, and `GET /health`. With `KB_GRAPH_STORE=neo4j` the backend refuses to start without Neo4j. For offline development without Neo4j set `KB_GRAPH_STORE=sqlite` (local SQLite graph + NetworkX traversal); `auto` uses Neo4j when reachable and otherwise falls back with a warning banner. Documents ingested under one store are re-extracted into the other automatically at startup (from their stored text; nothing is re-embedded), or on demand with `POST /api/kb/graph/resync`.

No Docker? Any Neo4j 5.x works (Neo4j Desktop, the Community zip with Java 17/21, or a free AuraDB instance): set `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` in `.env`.

The first start downloads two small models (~90 MB each, cached afterwards): the `all-MiniLM-L6-v2` embedder and the `ms-marco-MiniLM-L-6-v2` cross-encoder.

### Troubleshooting the terminals

| You see | Meaning / fix |
|---|---|
| Vite: `http proxy error: /api/kb/... ECONNREFUSED` | The backend isn't running or is still loading models. Start the backend first. The UI shows "The Hypnexis API is not reachable" and the knowledge graph retries with back-off. To use a backend elsewhere, set `VITE_PROXY_TARGET=http://host:port`. |
| Vite: `Port 5173 is in use, trying another one...` | Another dev server (often a forgotten one) holds 5173. Use the URL Vite prints (for example 5174), or stop the old process. |
| Backend: `Model '...' not cached yet — downloading once` | Only on first start; models are cached afterwards and later starts are offline and take ~2 s. |
| Backend: `No GEMINI_API_KEY set — ... extractive mode` | Informational: the KB works without a key. Add one to `.env` for Gemini mode. |

### Demo in a few minutes

1. Open http://localhost:5173. Click **Get started**, create an account and choose a workspace (Corporate, Research, Legal & Policy or Placement).
2. In the welcome panel, click **Load the sample documents** (or **Load the sample data** for placement). Every sample set is fictional and labelled *Sample data* wherever it appears.
3. Explore the workspace tabs: analyses, the graph, the assistant and the documents. Add the other workspaces from the sidebar.

**The original knowledge graph** (the shared demo corpus) is on the **Knowledge Graph** page when signed in, and at **http://localhost:5173/demo** without an account. By default only administrators can change it (`KB_SHARED_WRITE=admin`), so seed it once with:

```powershell
.venv\Scripts\python.exe -m backend.kb.cli load-samples      # 5 docs: ~39 entities, 51 relations, 4 topics
.venv\Scripts\python.exe -m backend.kb.cli ask "How is the Clean Horizon Act connected to childhood asthma?"
```

or make your account an administrator (`HYPNEXIS_ADMIN_EMAILS=you@example.com` in `.env`, or `python -m backend.auth.cli make-admin you@example.com`) and use **Load sample documents** on the Knowledge Graph page's Documents tab.

---

## What it does

| Capability | Implementation |
|---|---|
| **Ingestion** | Multiple PDF / TXT / MD files per upload. pypdf extracts text per page. Layout normalisation de-hyphenates, joins soft-wrapped lines and keeps headings. Sentence-aligned chunks (900 chars, 150 overlap) store exact `page` + `start_char/end_char` offsets. |
| **Validation** | Type, size (20 MB), empty, binary, corrupt, encrypted and scanned (no-text) files are rejected *at upload* with a reason. SHA-256 duplicate detection covers both earlier uploads and duplicates within one batch. Failed documents can be retried. |
| **Triple extraction** | **Gemini** JSON extraction (when a key is set) is validated against the passage: an entity must occur in the chunk, the evidence must be a verbatim sentence of the chunk, and an endpoint must appear in that sentence. Anything else is dropped. Without a key, a **rule-based extractor** handles active and passive voice, role phrases ("X is the CEO of Y"), possessive roles, appositives, relative clauses, coordination, concept noun phrases and pronoun/definite-NP coreference. |
| **Entity dedup** | Normalised names, so "The Voltaic Systems Inc." equals "Voltaic Systems". Also acronym aliases ("Coastal Energy Commission (CEC)"), surname-only mentions, conservative fuzzy matching (≥0.92, type-compatible) and deterministic IDs, so the same entity in another document merges into one node. |
| **Graph store** | **Neo4j** holds entities, aliases, mentions, `RELATES` edges, topics and cross-topic links. Provenance is explicit: `(:Evidence {sentence, method, confidence})-[:FROM_CHUNK]->(:Chunk {page, offsets})-[:PART_OF]->(:Document)`, one Evidence node per supporting sentence. Relationship reads, neighbours and multi-hop paths are **Cypher queries**. SQLite keeps document records, chunk text and ingestion status, and ChromaDB keeps the embeddings. Deleting a document prunes its evidence and any orphan nodes/edges. Nodes carry a namespace (`NEO4J_NAMESPACE`), so several knowledge bases or the test suite can share one database. Local fallback: the same graph in SQLite tables with NetworkX traversal. |
| **Topic augmentation** | Louvain communities over relation edges plus co-mentions (fixed seed and sorted inputs, so topics are identical between runs and between graph stores), stored as `(:Topic)` nodes with `IN_TOPIC` edges. Each topic gets a **theme name** (Gemini title, or its central concepts, e.g. *Fine Particulate Pollution & Childhood Asthma*), keywords and a **grounded summary**: Gemini with validated `[n]` citations, or extractive sentences. **Cross-topic links** come from bridge relations. |
| **Retrieval** | ChromaDB (dense) and BM25 (sparse), fused with RRF, then CrossEncoder rerank and MMR. This is the recipe of the CEO twin's retriever, reusing `backend/core/ranking.py`. Questions are linked to graph entities via aliases, distinctive name tokens and fuzzy matches. |
| **Query routing** | LangGraph workflow: **thematic** ranks topic communities, **factual** combines passages and the linked entities' relations, **multi-hop** uses k-shortest evidence paths (hub-penalised), and **comparison** handles both entities and documents. Each route has its own retrieval node, followed by evidence assessment and a CRAG-style query rewrite (LLM only). |
| **Grounded answers** | Evidence is numbered `[S#]` (passages) and `[G#]` (graph relations, each linked to its source sentence). The LLM may cite only listed IDs. Invalid citations are stripped, and an uncited answer is rejected for the extractive one. `INSUFFICIENT_EVIDENCE` is honoured. Without an LLM, answers quote source sentences verbatim. Questions the documents can't answer get an **Insufficient evidence** reply instead of a guess. |
| **UI** | Three-part layout. Left: a chat with streamed LangGraph stages (Ask), node-type and topic filters plus document-scoped questions (Explore), and drag-and-drop uploads with live job progress (Documents). Centre: a zoomable force-directed graph with topic hulls and source-document nodes. Right: an inspector. Answers highlight nodes, edges and communities, draw the exact evidence path, and light up the **source documents** behind the cited evidence with their links to the supporting entities. Clicking a node, edge, document, citation or topic opens the inspector with the verbatim source passages and the supporting sentence marked. A badge shows which graph store is active. |

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

## Platform: accounts, workspaces and analyses

| Area | Implementation |
|---|---|
| **Accounts** | `backend/auth/`: scrypt password hashing, server-side sessions (only a SHA-256 of the token is stored), HttpOnly cookie, a per-session CSRF token sent as `X-CSRF-Token`, absolute expiry (12 h, or 30 days with "keep me signed in"), revoke other sessions. Administrators are designated by the operator, never chosen at sign-up. There is **no email password reset** (no email service is configured): administrators reset passwords with the CLI below. |
| **Workspaces** | `backend/workspaces/`: each workspace has its own knowledge base (its own Neo4j namespace `<NEO4J_NAMESPACE>.ws-<id>`, plus documents, Chroma index and uploads under `data/workspaces/<id>/`), sharing the loaded models. Roles per workspace: **owner** (everything), **analyst** (upload, import, analyses, student-level records), **viewer** (read and aggregates only). Non-members get 404s, so workspace ids don't leak. |
| **Platform database** | `backend/storage/database.py`: SQLite at `data/platform/hypnexis.db` with versioned migrations applied at startup (accounts, sessions, workspaces, members, document metadata, activity, saved analyses, placement records and imports). |
| **Corporate analysis** | `backend/intel/financial.py`: figures come only from sentences and labelled table rows, normalised to millions of their own currency, with period, label as written, page and section. Conflicting values are flagged, never averaged. Growth, margins, free cash flow, net debt and ratios are *calculated*, with formula and cited inputs. Risks are *disclosed* (risk-language sentences) or *inferred* (documented threshold rules); neither is a credit rating. |
| **Research analysis** | `backend/intel/research.py`: fields come from the paper's own sections (abstract, introduction, methods, data, results, limitations, future work, references). Missing fields are reported as "not found". Comparison quotes each paper separately; related papers use embedding similarity and shared entities. |
| **Legal analysis** | `backend/intel/legal.py`: provisions are split by section headings and sentences are classified (obligation, prohibition, definition, condition, exemption, penalty, deadline, scope). Applicability is always *potential*, with the facts to confirm, the verification status and only the links you record. A jurisdiction your sources don't cover returns no laws rather than another jurisdiction's. |
| **Placement** | `backend/placement/`: staged CSV/XLSX imports (header auto-mapping, validation, in-file duplicates, preview, an explicit skip/update policy, provenance per row). Names, contact details and sensitive characteristics are never imported. Metrics carry definitions, numerators and denominators; unknown outcomes are never counted as failures; offers and unique students are kept apart; ongoing cycles are flagged and compared at equivalent dates. |
| **Frontend** | A React Router app: public landing page, sign-in and registration, an app shell (sidebar, breadcrumbs, global search, notifications, account menu), overview dashboard, the four workspaces, Knowledge Graph, Documents, Search & Ask, Recent Activity (with saved analyses), Settings (profile, security, members) and Help. Charts are hand-written SVG with a validated colour-blind-safe palette and a table view for every chart. |

### Administration

```powershell
.venv\Scripts\python.exe -m backend.auth.cli list-users
.venv\Scripts\python.exe -m backend.auth.cli make-admin ada@example.com      # or HYPNEXIS_ADMIN_EMAILS
.venv\Scripts\python.exe -m backend.auth.cli reset-password ada@example.com  # signs the account out everywhere
.venv\Scripts\python.exe -m backend.auth.cli disable ada@example.com
```

Migrations run automatically when the server starts; there is nothing to run by hand. To start from scratch, stop the server and delete `data/platform/` and `data/workspaces/` (the shared corpus in `data/kb/` is separate).

---

## Architecture

```
frontend/ (React 18 + Vite + Tailwind + React Router + react-force-graph-2d)
  App.tsx                routes: public (landing, login, register, demo, terms) and /app/* behind RequireAuth
  layouts/               PublicLayout · AuthLayout · AppShell (sidebar, top bar)
  pages/app/             Overview · KnowledgeGraph · Documents · Search · Activity · SavedAnalysis · Settings · Help
  workspaces/            corporate/ · research/ · legal/ · placement/ (each a tabbed module)
  components/kb/         KnowledgeWorkspace (shared corpus and workspace KBs) · GraphView · Inspector · ChatPanel ·
                         DocumentPanel · AnswerCard · TopicLegend · AnalysisGraphPanel (company / provision / placement graphs)
  components/ui, charts/ design system (green tokens, Inter) and SVG charts
  api/                   kb.ts (createKbApi: /api/kb or /api/workspaces/{id}/kb) · platform.ts
  lib/http.ts            one client: session cookie, CSRF header, error normalisation, session-expiry handling
        │  REST + SSE (/api/*, proxied by Vite to :8000)
backend/
  main.py                FastAPI app: platform + KB routes + legacy CEO-twin routes
  api/kb.py              build_kb_routes(): upload / jobs / graph / inspectors / query (JSON + SSE) / samples / reset,
                         mounted for the shared corpus (/api/kb) and for every workspace (/api/workspaces/{id}/kb)
  api/auth.py · workspaces.py · intel.py · placement.py · platform.py      platform API
  auth/ · workspaces/ · placement/ · intel/ · storage/ · config.py · services.py
  kb/
    documents.py         validation, PDF/TXT extraction, normalisation, offset-exact chunking
    extraction.py        heuristic + LLM (validated) triple extraction      lexicon.py  predicate/role lexicons
    resolution.py        entity resolution & deterministic ids
    neo4j_store.py       Neo4j graph store (primary) + Cypher traversal (paths, neighbours, reach)
    store.py             SQLite documents/chunks + local fallback graph; open_store() picks the graph store
    vector_index.py      ChromaDB + BM25 chunk index                        embeddings.py  embedder/reranker
    topics.py            alias-scan mentions, Louvain communities, theme labels, grounded summaries, cross-topic links
    retriever.py         hybrid passage search, entity linking, path scoring (Neo4j or NetworkX traversal), topic ranking
    router.py            thematic | factual | multi_hop | comparison (+ comparison targets)
    answer.py            evidence packs, sufficiency, LLM generation, citation validation, extractive answers
    qa_graph.py          LangGraph workflow (route → retrieve → assess → [rewrite] → generate → finalize)
    service.py           façade: ingestion jobs, queries, read models      cli.py  terminal interface
  core/ranking.py        RRF / sigmoid / MMR shared with the CEO twin's retriever
samples/                 demo corpus + questions.json
tests/                   pytest suite (offline: hashing embedder, no reranker, no LLM)
```

Runtime data: the knowledge graphs live in **Neo4j**, one namespace per knowledge base (`NEO4J_NAMESPACE` for the shared corpus, `<namespace>.ws-<workspace id>` for each workspace). Under `data/` (git-ignored): `data/kb/` is the shared corpus (`uploads/`, `knowledge.db` with documents, chunks and ingestion status, plus the graph only in the SQLite fallback, and `chroma/` vectors), `data/platform/hypnexis.db` the platform database, and `data/workspaces/<id>/` each workspace's knowledge base and staged imports. The original `data/` contents of the CEO twin are untouched.

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

On the shared corpus, reads stay public and writes follow `KB_SHARED_WRITE` (default: administrators only). The same routes exist per workspace under `/api/workspaces/{id}/kb/*` (viewer reads, analyst uploads, owner deletes).

**Platform API** (`…` = `/api/workspaces/{id}`)

| Group | Paths |
|---|---|
| Accounts | `GET /api/auth/config` · `GET /api/auth/session` (boot check, never 401) · `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET`/`PATCH /api/auth/me` · `POST /api/auth/password` · `POST /api/auth/sessions/revoke-others` |
| Workspaces | `GET`/`POST /api/workspaces` · `GET`/`PATCH …` · members (`GET`/`POST …/members`, `PATCH`/`DELETE …/members/{user}`) · `GET …/documents` · `PUT …/documents/{doc}/meta` |
| Corporate | `GET …/corporate/analysis?company=` · `GET …/corporate/graph?company=` |
| Research | `GET …/research/papers` · `GET …/research/papers/{doc}` · `GET …/research/papers/{doc}/related` · `POST …/research/compare` |
| Legal | `GET …/legal/sources` · `GET …/legal/provisions?doc_id=` · `POST …/legal/analyze` · `GET …/legal/graph` |
| Placement | `GET …/placement/overview`, `years`, `as-of`, `funnel`, `ppo`, `companies`, `students`, `graph` · `POST …/placement/ask` · `GET`/`PUT …/placement/config` · imports (`POST …/placement/imports`, `…/{id}/preview`, `…/{id}/commit`, `DELETE …/{id}`) · `POST …/placement/samples/load` · `DELETE …/placement/data?confirm=true` |
| Cross-workspace | `GET /api/overview` · `GET /api/documents` · `GET /api/search?q=&scope=` · `GET`/`POST /api/activity` · `GET`/`POST /api/saved` · `GET`/`DELETE /api/saved/{id}` |

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
| `KB_GRAPH_STORE` | `auto` (`.env.example`: `neo4j`) | `neo4j` = required · `auto` = Neo4j if reachable, else local fallback with a warning · `sqlite` = local only |
| `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` | — / `neo4j` / — | Neo4j connection (`bolt://localhost:7687` for docker-compose) |
| `NEO4J_DATABASE` / `NEO4J_NAMESPACE` | `neo4j` / `default` | database and namespace for this knowledge base |
| `CORS_ORIGINS` | — | extra allowed origins (comma-separated), e.g. your deployed frontend |
| `WARMUP_LEGACY_CEO` | `0` | `1` preloads the CEO twin's models at startup |
| `HYPNEXIS_DATA_DIR` | `data` | platform database and workspace stores |
| `HYPNEXIS_ADMIN_EMAILS` | — | comma-separated; these accounts are administrators |
| `HYPNEXIS_REGISTRATION` | `open` | `closed` disables self-service sign-up |
| `KB_SHARED_WRITE` | `admin` | who may change the shared demo graph: `admin`, `authenticated` or `public` |
| `AUTH_SESSION_HOURS` / `AUTH_REMEMBER_DAYS` | `12` / `30` | session lifetimes |
| `AUTH_COOKIE_SECURE` / `AUTH_COOKIE_SAMESITE` | `auto` / `lax` | use `none` with HTTPS when the frontend is on another domain (and set `CORS_ORIGINS` and `VITE_API_BASE`) |
| `PLACEMENT_MAX_UPLOAD_MB` / `PLACEMENT_MAX_ROWS` | `10` / `50000` | import limits |

Frontend (optional, in `frontend/.env`, see [frontend/.env.example](frontend/.env.example)): `VITE_API_BASE` (a backend on another origin; locally the default is same-origin via the Vite proxy, and a Vercel deployment needs it set to your backend because `vercel.json` only rewrites SPA routes), `VITE_PROXY_TARGET` (dev proxy target, default `http://127.0.0.1:8000`), `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` (analytics; the PostHog bundle is only downloaded when a key is set).

---

## Tests

```powershell
.venv\Scripts\python.exe -m pytest          # 156 tests, offline (~1 min); the 10 live Neo4j tests are skipped
cd frontend; npm run lint; npm run build    # ESLint + strict TypeScript check + production build

# live Neo4j integration tests (each test uses its own namespace and wipes it afterwards)
$env:NEO4J_TEST_URI="bolt://localhost:7687"; $env:NEO4J_TEST_PASSWORD="<password>"
.venv\Scripts\python.exe -m pytest -m neo4j
```

The tests run against temporary data directories, with an offline hashing embedder and no network. Tests marked `neo4j` run against a real Neo4j server and are **skipped, not passed**, when `NEO4J_TEST_URI` is not reachable. They check, with independent Cypher, that the graph and its provenance are stored in Neo4j (SQLite graph tables stay empty), that multi-hop paths come from Cypher traversal (an edge deleted directly in Neo4j disappears from answers), deletion pruning, namespace isolation, and re-extraction when switching graph stores. The suite covers:
- ingestion: validation, encodings, layout normalisation, offset-exact chunks, PDF round-trip, corrupt and scanned PDFs
- extraction patterns, held-out sentences (passive voice with dates/adverbs, reduced relatives), the direction guard that rejects reversed triples (heuristic and LLM), plus rejection of fabricated LLM relations and citations
- graph store selection and loud fallback (strict `neo4j` mode never falls back)
- entity resolution, store persistence and deletion pruning, grounded topic summaries, cross-topic bridges
- entity linking, routing, hybrid search, evidence paths
- end-to-end answers for every route, citation integrity, insufficient-evidence handling, LLM grounding through a fake LLM
- the full HTTP API: upload, background job, graph, inspectors, JSON/SSE query, delete, reset and 503 handling
- legacy compatibility
- accounts: validation, hashing, cookies, CSRF, expiry, logout, password change, admin designation, the session boot check, the admin CLI
- workspaces: isolation between workspaces and from the shared corpus, roles enforced server-side, metadata validation, search and saved analyses respecting membership
- placement: CSV and XLSX imports, sensitive-column exclusion, validation and in-file duplicates, skip vs update, metric arithmetic (offers vs unique students, unknown outcomes, PPO conversion), configurable policy, ongoing-cycle flags, funnel counts, student-record access by role
- document intelligence: cited corporate figures and calculated metrics, disclosed vs inferred risks, missing data not fabricated, paper structure with "not found" fields, per-paper comparison quotes, legal applicability always potential, jurisdiction handling, provisions and graph evidence

## Limitations

- **Rule-based extraction is precise but incomplete.** It understands common English relation patterns (≈45 predicate families). Verbs outside its lexicon are not recognised (e.g. in "The museum displays engines built by Harlow Motors" it takes *museum displays engines* as one noun phrase; a test records this as a known failure). Unusual phrasing, long-range coreference and tables yield fewer relations than Gemini mode. Every extracted relation still has a verbatim evidence sentence, and relations that contradict their sentence's voice are rejected.
- **Scanned/image-only PDFs need OCR** before upload. They are rejected with a clear message.
- **Ingestion jobs run in-process.** Progress is kept in memory, and a server restart marks unfinished documents *failed* (retryable). One worker process is assumed.
- **Community detection runs in Python** (NetworkX Louvain over the graph read from Neo4j); the result is written back to Neo4j as Topic nodes. The Neo4j Graph Data Science plugin is not required.
- **The Gemini code paths are tested with a fake LLM**, not live calls; the default model names follow the existing project's configuration.
- **The graph view renders the top 800 entities** (ranked by degree and mentions); larger graphs are truncated in the UI, not in storage.
- **Financial, research and legal analyses are rule-based** (pattern matching over the documents' text). They are transparent and cited, but miss figures in images, unusual phrasing and tables without stated units; research structure relies on recognisable section headings, and legal provisions on section-style headings.
- **Legal coverage is only what you upload.** Hypnexis can't know whether a text is current; effective dates, official links and verification are what users record. Results are legal information, not legal advice.
- **Placement stage durations aren't available**: the import format records the furthest stage reached, not per-stage dates.
- **No email-based password reset or invitations**: administrators reset passwords with the CLI, and owners add members who already have an account.
- **Analyses are computed on request** from a workspace's documents; very large workspaces will make the analysis pages slower.
- **The interface is light-theme only.**

## Deployment (nothing is deployed by default)

The repository contains configuration only; pushing to GitHub does not deploy anything.

- **Backend:** the [Dockerfile](Dockerfile) runs the API on port 7860 (Hugging Face Spaces convention; any container host works). Give it `KB_GRAPH_STORE=neo4j`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` for a Neo4j it can reach (e.g. a free Neo4j AuraDB instance, `neo4j+s://…`), plus `CORS_ORIGINS=https://<your-frontend>` and, because sign-in uses cookies, `AUTH_COOKIE_SAMESITE=none` over HTTPS when the frontend is on another domain. `docker compose --profile full up -d` runs backend and Neo4j together locally.
- **Frontend:** build with `VITE_API_BASE=https://<your-backend>` (for example as a Vercel environment variable). [frontend/vercel.json](frontend/vercel.json) only rewrites routes to the SPA; it does not proxy the API to any third-party server.
- Check `GET /health` on the deployed backend: `graph_store.backend` must be `neo4j` with `connected: true`.

---

## Legacy: CEO Digital Twin

The original agentic 3-DB RAG chat (Govind Agrawal / Anaxee Digital Runners) is still served by the same backend at `/api/chat/stream` and `/api/voice/transcribe` (unchanged, and not part of the platform UI). Its React components remain, unmounted, in `frontend/src/components/` (`ChatInterface`, `MessageBubble`).

- **Pipeline:** LangGraph state machine (semantic router → query planner → triple-hybrid retrieval over `facts_db` / `style_db` / `reasoning_db` with BM25 + CrossEncoder + MMR → CRAG grader/rewriter → generator → Self-RAG hallucination check → follow-ups) and a 3-layer memory.
- **Data:** place transcript JSONs in `data/jsons/` and run `.venv\Scripts\python.exe ingest.py` (use `--force` to re-embed). It requires `GEMINI_API_KEY`.
- **Startup:** the twin's two `bge-base` models load lazily on the first `/api/chat` request. Set `WARMUP_LEGACY_CEO=1` to preload them, as the Hugging Face Space did before.
- **Deploy:** the same `Dockerfile` serves both products (see [Deployment](#deployment-nothing-is-deployed-by-default)); `hf_deploy_check.py` checks the CEO twin's data files.
- **Data files:** the twin's indexes (`data/vector_store/`, `data/bm25_*.pkl`, `data/ingest_ledger.db`) are Git LFS objects. Run `git lfs pull` (or `git restore data/` if they were deleted from the working tree) before using `/api/chat`; the knowledge base does not use them.
