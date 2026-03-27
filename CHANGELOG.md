# Changelog

## [2026-03-27] dev/droplet — Qdrant Migration + ReAct Agent Architecture

### Architecture Changes
- **ChromaDB → Qdrant**: Replaced ChromaDB with Qdrant for production-grade vector search
  - Cosine similarity with HNSW tuning (ef=128, m=16), typed payload indexes, on-disk payloads
- **MongoDB Atlas → DO Managed MongoDB**: Migrated to DigitalOcean managed database ($15/mo)
- **ReAct Agent**: Chain-of-thought reasoning replaces RAG-only pipeline
  - 5 tools: qdrant_search, mongo_query, formula_calculate, web_search, context_memory
  - Gemini function calling drives tool selection with multi-step reasoning
  - Graceful fallback to existing flow

### Infrastructure
- DO droplet provisioning script (doctl CLI), 4GB + 2GB swap
- docker-compose: Qdrant replaces ChromaDB, mem_limit on all services
- .env.production updated for Qdrant + DO MongoDB

### New Files
- apps/ai/services/vector/qdrant-service.ts
- apps/ai/services/rag/qdrant-rag-service.ts
- apps/ai/config/qdrant-config.ts
- apps/ai/agents/react/react-agent-service.ts
- apps/ai/agents/react/react-system-prompt.ts
- apps/ai/agents/react/tool-definitions.ts
- apps/ai/agents/react/tool-handlers/ (5 files)
- apps/ai/scripts/index-qdrant.ts
- scripts/provision-droplet.sh

### Deleted Files
- apps/ai/services/vector/chroma-service.ts
- apps/ai/services/rag/chroma-rag-service.ts
- apps/ai/services/rag/pinecone-service-stub.ts
- apps/ai/scripts/index-chromadb-simple.ts

---

## [2026-03-27] Refactor: Update auto-index service to target Qdrant

### Summary
- Migrated `apps/ai/server/services/auto-index-service.ts` from ChromaDB to Qdrant.
- Removed all ChromaDB/GoogleGenerativeAI embedding logic; delegated to `QdrantRAGService` and `get_qdrant_service`.

### Details
- **Import swap**: `getChromaService` replaced with `get_qdrant_service` and `QdrantRAGService`
- **Removed**: `GoogleGenerativeAI` import, `CHROMA_COLLECTION` constant, `EMBEDDING_MODEL` constant, `format_document()`, `generate_embedding()` helpers (now owned by `QdrantRAGService`)
- **`auto_index_material`**: Constructs `QdrantRAGService('rawMaterialsAI')`, calls `prepare_raw_material_document()` then `upsert_documents()` — identical public signature
- **`auto_delete_material`**: Uses `get_qdrant_service()` → `ensure_initialised()` → `delete('raw_materials_console', [rm_code])` — identical public signature
- Log format standardised to `[auto-index] <fn_name>: rm_code=<x>, start|success|error`

### Files Changed
- `apps/ai/server/services/auto-index-service.ts` — MODIFIED: ChromaDB -> Qdrant migration

---

## [2026-03-27] Tasks 14 & 15: Replace ChromaDB with Qdrant in docker-compose + env

### Summary
- Replaced ChromaDB service with Qdrant in `docker-compose.yml`
- Updated `.env.production` to use Qdrant and DO Managed MongoDB URIs

### Details — docker-compose.yml (Task 14)
- Removed `chromadb` service; added `qdrant` service (qdrant/qdrant:latest) with mem_limit 512m, healthcheck
- Added `mem_limit: 768m` to both `web` and `ai` services
- Updated `depends_on`: chromadb -> qdrant (ai uses `condition: service_healthy`)
- Replaced `VECTOR_DB_PROVIDER` + `CHROMA_URL` with `QDRANT_URL=http://qdrant:6333`
- Removed `PINECONE_API_KEY` from both services
- Removed old chromadb-data volume mount from ai service
- Renamed volume: `chromadb-data` -> `qdrant-data` (rnd-ai-qdrant-data)

### Details — .env.production (Task 15)
- Replaced MongoDB Atlas URIs with DO Managed MongoDB template URIs (tls=true&authSource=admin)
- Replaced `VECTOR_DB_PROVIDER` + `CHROMA_URL` with `QDRANT_URL` and `QDRANT_API_KEY`
- Added `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_CSE_ID` (optional, for ReAct web_search)
- Removed `PINECONE_API_KEY`

### Files Changed
- `docker-compose.yml` — Replaced ChromaDB with Qdrant, added mem_limit, updated depends_on/volumes
- `.env.production` — Qdrant + DO MongoDB URIs + Google Search keys

---

## [2026-03-27] Task 9: Update EnhancedHybridSearchService to Use Qdrant

### Summary
- Migrated `apps/ai/services/rag/enhanced-hybrid-search-service.ts` from ChromaDB to Qdrant.
- All search strategies (semantic, keyword, fuzzy, metadata, hybrid) remain functional.

### Details
- **Import swap**: `getChromaService / ChromaService` replaced with `get_qdrant_service / QdrantService`
- **Property rename**: `chromaService` -> `qdrantService`, `chromaCollectionName` -> `qdrantCollectionName`
- **Initialize**: Calls `qdrantService.ensure_initialised()` + `get_collection_info()` instead of ChromaDB `initialize()` / `getCollectionStats()`
- **Semantic search**: ChromaDB `query()` replaced with Qdrant `search()` using `QdrantSearchOptions` (topK, scoreThreshold, filter, ef, withPayload)
- **Filter conversion**: ChromaDB where-filter `{ category, userId: { $ne } }` converted to Qdrant `must` / `must_not` conditions
- **Result mapping**: `match.document` -> `match.payload.details || match.payload.content`, `match.metadata` -> `match.payload`, score used directly (Qdrant returns similarity score, not distance)
- MongoDB text search (keyword), metadata search, and fuzzy search strategies unchanged

### Files Changed
- `apps/ai/services/rag/enhanced-hybrid-search-service.ts` — MODIFIED: ChromaDB -> Qdrant migration

---

## [2026-03-27] Task 13: Create Qdrant Re-Indexing Script

### Summary
- Created `apps/ai/scripts/index-qdrant.ts` to read raw materials from MongoDB and index them into Qdrant.

### Details
- **Index targets**:
  1. `rnd_ai.raw_materials_console` → Qdrant `raw_materials_fda` (RAG service: rawMaterialsAllAI)
  2. `raw_materials.raw_materials_real_stock` → Qdrant `raw_materials_stock` (RAG service: rawMaterialsAI)
- **Flow**: CLI arg parsing → Qdrant collection provisioning → cursor-based streaming from MongoDB → `batch_process_documents()` per batch → progress tracking (rate, ETA) → verification via `get_collection_info`
- **CLI flags**: `--collection <name>` to index a specific collection, `--batch-size <n>` to override default (env BATCH_SIZE or 50)
- **Environment**: reads MONGODB_URI, RAW_MATERIALS_REAL_STOCK_MONGODB_URI, BATCH_SIZE, GEMINI_API_KEY, QDRANT_URL, QDRANT_API_KEY
- **Pattern**: matches `index-chromadb-simple.ts` — cursor streaming, batch processing, progress logging, final verification
- All functions use snake_case, have docstrings, and include console.log entry/exit logging

### Files Changed
- `apps/ai/scripts/index-qdrant.ts` — NEW: Qdrant re-indexing script (MongoDB → embeddings → Qdrant)

---

## [2026-03-27] Task 12: Wire ReactAgentService into API Routes

### Summary
- Wired `ReactAgentService` into both `raw-materials-agent` and `enhanced-chat` API routes.
- ReAct agent is attempted first; on success it returns immediately. On failure or non-success, the existing flow runs as fallback.

### Details
- Added `import { ReactAgentService } from '@/ai/agents/react/react-agent-service'` to both route files.
- Inserted a try/catch ReAct agent block in each POST handler before existing logic.
- Response includes `type: 'react-agent'`, tool call metadata, iteration count, and processing time.
- Existing code paths (enhanced response, Gemini service, ML learning) remain intact as fallback.

### Files Changed
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — MODIFIED: Added ReactAgentService import and ReAct agent path in POST handler
- `apps/web/app/api/ai/enhanced-chat/route.ts` — MODIFIED: Added ReactAgentService import and ReAct agent path in POST handler

---

## [2026-03-27] Task 8: Create ReactAgentService (Main Reasoning Loop)

### Summary
- Created `apps/ai/agents/react/react-agent-service.ts` — the main ReAct agent that uses Gemini function calling to implement a Thought -> Action -> Observation -> Answer loop.

### Details
- **Types exported**: `ReactAgentConfig`, `ReactAgentRequest`, `ReactAgentResponse`
- **ReactAgentConfig**: model (default 'gemini-2.0-flash'), temperature (0.7), max_tokens (9000), max_iterations (5)
- **Constructor**: accepts optional api_key and config_override; falls back to GEMINI_API_KEY / NEXT_PUBLIC_GEMINI_API_KEY env vars
- **execute(request)**: Main entry point — builds Gemini model with tool declarations from `get_react_tool_declarations()` and system prompt from `get_react_system_prompt()`, converts conversation history to Gemini Content format, runs the ReAct loop up to max_iterations
- **ReAct loop logic**: Each iteration calls `model.generateContent()`, checks for functionCall parts (execute tools, feed results back) or text parts (final answer, break). If max iterations hit, synthesises a partial answer from accumulated tool results.
- **_execute_tool(name, args, session_id)**: Routes tool calls through TOOL_HANDLER_MAP to handler functions: qdrant_search -> handle_qdrant_search, mongo_query -> handle_mongo_query, formula_calculate -> handle_formula_calculate, web_search -> handle_web_search, context_memory -> handle_context_memory
- **_build_contents(request)**: Converts conversation_history + current prompt to Gemini Content[] format
- **_synthesise_partial_answer(tool_calls)**: Best-effort markdown summary when max iterations exhausted
- All functions use snake_case, have docstrings, and include console.log entry/exit logging
- Follows existing patterns from `gemini-tool-service.ts` (GoogleGenerativeAI init, tool iteration loop, function response handling)

### Files Changed
- `apps/ai/agents/react/react-agent-service.ts` — NEW: ReAct reasoning loop with Gemini function calling

---

## [2026-03-27] Task 4: Create QdrantRAGService (High-Level RAG)

### Summary
- Created `apps/ai/services/rag/qdrant-rag-service.ts` as a drop-in replacement for `chroma-rag-service.ts`.
- Matches ChromaRAGService interface so consumers can switch with minimal changes.

### Details
- **Types exported**: `RawMaterialDocument`, `RAGSearchConfig`, `RAGSearchResult`, `RAGServicesConfig`
- **Service name -> collection mapping**: rawMaterialsAllAI -> raw_materials_fda, rawMaterialsAI -> raw_materials_console, salesRndAI -> sales_rnd
- **Constructor**: accepts service_name, optional config override, optional custom embedding service; resolves defaults from SERVICE_DEFAULTS map
- **Embedding**: `create_embeddings(texts)` delegates to UniversalEmbeddingService (lazy singleton)
- **Upsert**: `upsert_documents(docs)` embeds texts then upserts as QdrantPoints with `indexed_at` timestamp
- **Batch**: `batch_process_documents(materials, batch_size)` with inter-batch EMBEDDING_BATCH_DELAY_MS delay
- **Search**: `search_similar(query, options)` embeds query -> Qdrant search -> maps to RAGSearchResult
- **Format**: `search_and_format(query, options)` convenience wrapper for search + markdown formatting
- **Delete**: `delete_documents(ids)` delegates to QdrantService.delete
- **Stats**: `get_index_stats()` returns pointsCount/status/config via QdrantService.get_collection_info
- **Config**: `update_config(partial)` / `get_config()` for runtime config changes
- **Static helpers**: `prepare_raw_material_document(material)` and `format_search_results(results)`
- **Backward compat**: exports `PineconeRAGService` alias
- All functions use snake_case, have docstrings, and include console.log entry/exit logging

### Files Changed
- `apps/ai/services/rag/qdrant-rag-service.ts` — NEW: High-level Qdrant RAG service

---

## [2026-03-27] Tasks 5 & 7: ReAct Agent Tool Definitions and System Prompt

### Summary
- Created `apps/ai/agents/react/tool-definitions.ts` with Gemini function calling declarations for 5 tools.
- Created `apps/ai/agents/react/react-system-prompt.ts` with full ReAct system prompt.

### Details — Tool Definitions (Task 5)
- **qdrant_search**: Semantic similarity search across 4 Qdrant collections (raw_materials_console, raw_materials_fda, raw_materials_stock, sales_rnd). Params: query, collection (enum), top_k, score_threshold, filters.
- **mongo_query**: Read-only MongoDB queries against rnd_ai or raw_materials databases. Params: collection, database (enum), operation (enum: find/findOne/aggregate/count), filter, projection, sort, limit.
- **formula_calculate**: Batch cost, scaling, unit conversion, ingredient percentage. Params: operation (enum), ingredients (array of objects), batch_size, target_unit (enum), formula_id.
- **web_search**: External web search for regulatory/market info. Params: query, max_results.
- **context_memory**: Conversation history look-back. Params: session_id, lookback.
- Exported: `get_react_tool_declarations()` returning `GeminiFunctionDeclaration[]`, type `ReactToolName`.
- Declarations use plain-object format compatible with `@google/generative-ai` (STRING/NUMBER/OBJECT/ARRAY types), aligned with existing `gemini-tool-service.ts` patterns.

### Details — System Prompt (Task 7)
- 7 composable sections: persona, classification, tool selection guide, execution flow, synthesis, safety rules, domain context.
- **Intent classification**: 6 categories (EXACT_LOOKUP, SEMANTIC_SEARCH, CALCULATION, EXTERNAL_INFO, CONTEXTUAL, MULTI_STEP) with clear routing rules.
- **Tool selection guide**: Thai/English phrase-to-tool mapping table with key parameters.
- **ReAct loop**: Thought -> Action -> Observation -> Repeat, max 5 tool calls per query.
- **Safety rules**: Read-only only, max 20 results, no secret exposure, no hallucinated data, PII handling, prompt injection defense.
- **Domain context**: INCI terminology, data field descriptions, Thai cosmetic keyword dictionary, formulation context.
- Exported: `get_react_system_prompt()` returning assembled string.

### Files Changed
- `apps/ai/agents/react/tool-definitions.ts` — NEW: Gemini function declarations for 5 ReAct tools
- `apps/ai/agents/react/react-system-prompt.ts` — NEW: ReAct agent system prompt with 7 sections

---

## [2026-03-27] Task 3: Create QdrantService (Low-Level Vector Client)

### Summary
- Created `apps/ai/services/vector/qdrant-service.ts` as a drop-in replacement for `chroma-service.ts`.
- Singleton pattern (`get_qdrant_service()` / `reset_qdrant_service()`) mirrors ChromaService's architecture.
- Lazy initialisation via `ensure_initialised()` reads connection config from qdrant-config.

### Details
- **Types exported**: `QdrantPoint`, `QdrantSearchOptions`, `QdrantSearchResult`, `QdrantCollectionInfo`
- **Collection mgmt**: `ensure_collection(schema)` creates collection with HNSW config + payload indexes;
  `ensure_all_collections()` iterates all QDRANT_COLLECTIONS; `delete_collection(name)` drops a collection
- **Upsert**: Batched at UPSERT_BATCH_SIZE (100) with `wait: true` for durability
- **Search**: Merges caller options with per-collection QDRANT_SEARCH_DEFAULTS; supports pre-filter,
  scoreThreshold, HNSW ef override, and selective withPayload
- **Delete**: Accepts either string[] of IDs or a Qdrant filter object
- **Info**: `get_collection_info()` returns pointsCount/status/config; `health_check()` verifies connectivity;
  `scroll()` provides paginated point reads with optional filter and offset
- All functions use snake_case, have docstrings, and include console.log entry/exit logging
- Imports `QdrantClient` from `@qdrant/js-client-rest`, config from `../../config/qdrant-config`
- Uses same Logger + ErrorHandler patterns as chroma-service.ts

### Files Changed
- `apps/ai/services/vector/qdrant-service.ts` — NEW: Low-level Qdrant vector client with typed payloads

---

## [2026-03-27] Task 2: Create Qdrant Configuration

### Summary
- Created `apps/ai/config/qdrant-config.ts` with full collection schemas, HNSW tuning,
  connection settings, search defaults, and batch constants for Qdrant.

### Details
- 4 collections defined: `raw_materials_console`, `raw_materials_fda`, `raw_materials_stock`, `sales_rnd`
- All collections use vectorSize=768 (Gemini text-embedding-004), Cosine distance, HNSW m=16/efConstruct=128
- Shared payload indexes extracted to DRY constant (rm_code, trade_name, inci_name, supplier, source, stock_status, cost, indexed_at)
- Per-collection search defaults mirror rag-config.ts topK/threshold values with added Qdrant-specific `ef` param
- `get_qdrant_connection_config()` reads QDRANT_URL and QDRANT_API_KEY from env
- Batch constants: UPSERT_BATCH_SIZE=100, EMBEDDING_BATCH_DELAY_MS=1000
- All functions use snake_case, have docstrings, and include entry/exit console.log

### Files Changed
- `apps/ai/config/qdrant-config.ts` — NEW: Qdrant collection schemas and configuration

---

## [2026-03-27] Task 1: Replace ChromaDB with Qdrant client

### Dependencies
- Removed `chromadb` (1.8.1) from `apps/ai/package.json`
- Added `@qdrant/js-client-rest` (^1.12.0) to `apps/ai/package.json`
- Replaced chromadb-related npm scripts with qdrant equivalents in both root and apps/ai package.json
- Old scripts removed: `index:chromadb`, `index:chromadb:resume`, `index:chromadb:fast`, `check:chromadb`
- New scripts added: `index:qdrant`, `check:qdrant`

### Files Changed
- `package.json` (root) — Replaced chromadb workspace scripts with qdrant equivalents
- `apps/ai/package.json` — Swapped chromadb dep for @qdrant/js-client-rest, updated scripts

---

## [2026-03-27] dev/droplet — Full Codebase Audit + Droplet Deployment Setup

### Audit Findings

#### BLOCKERS FIXED
- **Auth middleware cookie mismatch**: `middleware.ts` checked `"auth_token"` but login/verify/logout all use `"rnd-ai-auth-session"`. Users were stuck in infinite login redirect. Fixed.
- **Missing `Dockerfile.ai`**: `docker-compose.yml` referenced it but file didn't exist. AI service couldn't start. Created.
- **Secrets baked into Docker images**: Server-side secrets (MONGODB_URI, API keys, ADMIN_PASSWORD) were embedded into image layers via ARG->ENV. Now only NEXT_PUBLIC_* build-time vars are embedded; secrets injected at runtime.

#### CRITICAL AI WIRING FIXES
- **Cosmetic-enhanced broken await chain** (`route.ts:307-317`): `.response` was accessed on a Promise object instead of the resolved value. Result was always `undefined`. Fixed with proper `await` then property access.
- **Cosmetic-enhanced zero timing** (`route.ts:473`): `Date.now() - Date.now()` always produced 0. Fixed to use captured `streamStartTime`.
- **Raw-materials-agent health check** (`route.ts:214-215`): Referenced `services.enhancedService` and `services.responseReranker` which don't exist in `initialize_services()` return. Removed phantom properties.

#### KNOWN ISSUES (Not fixed in this branch — require architectural decisions)
- **Dead LangGraph route**: `langgraph-route.ts` not named `route.ts`, never served by Next.js
- **Missing `/api/index-data/manage`**: Admin AI indexing page calls it but route doesn't exist (404)
- **AI Hub dead link**: `/ai/agents` page doesn't exist
- **AI Analytics page**: Entirely mock data, no real API integration
- **Shared-types orphaned**: Created during deduplication but zero consumers; full duplicate in `apps/ai/lib/types.ts`
- **Insecure auth**: Plain text password comparison, unsigned session cookie string "authenticated"
- **NEXT_PUBLIC_GEMINI_API_KEY as server fallback**: Used in `enhanced-chat` and `raw-materials-agent` routes
- **Dead imports**: `AgentFactory` in agent chat, `getEmbeddingService` in ai-chat, `GoogleGenerativeAI` in enhanced-chat
- **AI-chat simulated streaming**: Full response generated then chunked with setTimeout, not real streaming
- **MongoDB connection leak in index-data**: Client never closed after use
- **PreferenceLearningService inconsistent API**: Called with different schemas across routes

#### HITL Flow Status
- Shipping: STRONG (full confirmation modal)
- Calculation, Formulas, Orders, Credits: GOOD (confirm dialogs, role-based)
- Admin Vector Indexing: GOOD (batch controls)
- Admin AI Indexing: BROKEN (missing API route)
- Sales/Raw Materials AI Chat: PARTIAL (feedback buttons, no approval gate)
- AI Analytics: NONE (mock data)

### Deployment Changes
- Created `Dockerfile.ai` for AI backend service
- Upgraded all Dockerfiles from Node 18 (EOL) to Node 20
- Added missing workspace package.json copies to Docker deps stages (shared-utils, shared-database, apps/ai)
- Removed server-side secrets from Docker build-time ARGs (security fix)
- Created `.env.production` template for droplet deployment
- Created `scripts/deploy-droplet.sh` deployment automation script
- Fixed `apps/web/middleware.ts` cookie name to match auth system

### Files Changed
- `apps/web/middleware.ts` — Fixed cookie name from `auth_token` to `rnd-ai-auth-session`
- `apps/web/app/api/ai/cosmetic-enhanced/route.ts` — Fixed broken await chain + zero timing
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — Fixed phantom health check properties
- `Dockerfile` — Node 20, removed secret baking, added missing package copies
- `apps/web/Dockerfile` — Node 20, removed secret baking, added missing package copies
- `Dockerfile.ai` — NEW: AI backend service Dockerfile
- `.env.production` — NEW: Production env template for droplet
- `scripts/deploy-droplet.sh` — NEW: Droplet deployment automation
- `CHANGELOG.md` — This file
