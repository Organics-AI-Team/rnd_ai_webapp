# Changelog

## [2026-03-30] Performance: AI system audit — embedding cache, payload projection, HITL wiring

### Summary
Full-stack AI system audit identifying 6 performance bottlenecks and 2 HITL gaps.
Implemented 3 quick wins and 1 HITL fix.

### Audit Findings
- **Stack**: Gemini 3.1 Pro + LangChain/LangGraph + Qdrant (768-dim) + MongoDB
- **Agents**: ReactAgentService (primary), LangGraph agent, Sales/RnD agent
- **RAG**: Hybrid search (exact + fuzzy + semantic + metadata), dynamic chunking
- **HITL**: Feedback UI complete, tRPC routers mounted, but 2/3 API routes missing feedback endpoints

### Quick Win #1: LRU Embedding Cache (est. ~40% latency reduction on cache hits)
- Added `EmbeddingLRUCache` class to `universal-embedding-service.ts`
- 500-entry LRU eviction, normalised key (lowercase+trim)
- Cache-aware `createEmbedding()` and `createEmbeddings()` — only uncached texts hit the API
- Observability: `get_cache_stats()` returns size, hits, misses, hit_rate
- Configurable via `EMBEDDING_CACHE_MAX_SIZE` env var

### Quick Win #2: Qdrant Payload Field Projection (est. ~10-20% bandwidth reduction)
- `qdrant-search-handler.ts` now uses `withPayload: { include: [...] }` instead of `true`
- Only 13 field-name variants fetched (covers the 8 logical fields used by `format_result()`)
- Updated `QdrantSearchOptions.withPayload` type to accept `{ include: string[] }`

### Quick Win #3: Singleton Embedding Service (eliminates per-request instantiation)
- `createEmbeddingService()` now returns a module-level singleton
- Same instance (and its cache) shared across all callers
- `resetEmbeddingServiceSingleton()` for testing/config changes

### HITL Fix: Feedback PUT Endpoints on Missing Routes
- **`/api/ai/raw-materials-agent`** — Added PUT handler using existing `PreferenceLearningService`
- **`/api/ai/cosmetic-enhanced`** — Added PUT handler writing to `raw_materials_feedback` MongoDB collection
- Both follow the same contract as enhanced-chat: `{ userId, feedback: { type, score, messageId } }`

### Remaining Opportunities (not implemented)
- Enable streaming in API routes (SSE infrastructure exists but is disabled)
- Add HTTP Cache-Control headers for repeated identical requests
- Add Redis-backed embedding cache for cross-instance persistence
- Add rate-limit-aware retry/backoff in embedding service
- Add pre-response approval gates for destructive actions (currently feedback is retroactive only)

### Files Changed
- `apps/ai/services/embeddings/universal-embedding-service.ts` — LRU cache + singleton
- `apps/ai/agents/react/tool-handlers/qdrant-search-handler.ts` — Payload projection
- `apps/ai/services/vector/qdrant-service.ts` — Updated withPayload type
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — PUT feedback endpoint
- `apps/web/app/api/ai/cosmetic-enhanced/route.ts` — PUT feedback endpoint

---

## [2026-03-30] Feature: CAS Number backfill + display in products/ingredients tables

### Summary
- **Phase 1**: 647 ingredients matched from MySkin collection by `inci_name` (instant, no AI cost)
- **Phase 2**: 30,532 ingredients processed via Gemini AI (gemini-2.5-flash) to look up CAS numbers from EU CosIng + PubChem
- AI also flags non-ingredient items (packaging, finished products, generic labels) with `is_ingredient=false`
- CAS No. column added to `/products` and `/ingredients` tables
- CAS numbers searchable in the search bar
- CAS shown in ingredient detail dialog

### Script: `scripts/backfill-cas-numbers.ts`
- Connects to MongoDB `rnd_ai.raw_materials_console` (31,179 docs)
- Phase 1: Pre-fills CAS from `raw_materials_myskin` by inci_name match (free, no API calls)
- Phase 2: Batches of 20 → Gemini AI prompt asking for CAS from EU CosIng/PubChem → writes `cas_no`, `cas_source`, `cas_confidence`, `is_ingredient` to each doc
- Supports `--dry-run` and `--skip-existing` flags
- Run: `npx tsx scripts/backfill-cas-numbers.ts`

### Backend Changes
- `apps/ai/server/routers/products.ts` — `build_cas_no_map()` helper for runtime MySkin fallback, `cas_no` in list/getById response, cas_no in search filter

### Frontend Changes
- `apps/web/app/products/page.tsx` — CAS No. column (monospace), search placeholder updated
- `apps/web/app/ingredients/page.tsx` — CAS No. column, detail dialog field, search placeholder updated

### Data Flow (priority order)
1. `raw_materials_console.cas_no` (backfilled by script) — primary
2. `raw_materials_myskin.inci_name` match → `cas_no` — runtime fallback
3. Empty (`"-"`) if no match found

---

## [2026-03-30] Fix: AI chat failures — model upgrade to Gemini 3.1 Pro + production logging

### Root Cause
- `removeConsole: true` in next.config.js stripped ALL logging in production — AI errors silently swallowed
- Default model `gemini-3-flash-preview` intermittently failing in ReAct loop's 2nd iteration
- All fallback paths used same broken model → cascade failure → empty response → "Sorry, I could not process your request"
- `Failed to find Server Action "x"` errors from stale Next.js build

### Fixes Applied
1. **next.config.js** — `removeConsole` now preserves `console.error` and `console.warn` in production
2. **All AI services** — Default model changed from `gemini-3-flash-preview` to `gemini-3.1-pro-preview` (verified working via API)
3. **docker-compose.yml** — Added `GEMINI_MODEL` env var for runtime model switching
4. **react-agent-service.ts** — Key request tracking logs upgraded to `console.warn` for production visibility
5. **All hardcoded `gemini-2.0-flash-exp` references** — Replaced with `process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview'`

### Files Changed
- `apps/web/next.config.js` — removeConsole: exclude error/warn
- `apps/ai/agents/react/react-agent-service.ts` — Model + logging
- `apps/ai/services/providers/gemini-service.ts` — Model
- `apps/ai/services/providers/gemini-tool-service.ts` — Model
- `apps/ai/services/providers/agent-api-service.ts` — Model
- `apps/ai/services/enhanced/enhanced-ai-service.ts` — Model
- `apps/ai/agents/raw-materials-ai/langgraph-agent.ts` — Model
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — Model
- `apps/web/app/api/ai/enhanced-chat/route.ts` — Model
- `apps/web/app/api/ai/cosmetic-enhanced/route.ts` — Model
- `docker-compose.yml` — GEMINI_MODEL env var

### Verification
- `gemini-3.1-pro-preview` confirmed available and responsive via Google AI API
- Zero remaining `gemini-3-flash-preview` or `gemini-2.0-flash-exp` hardcoded references in source

---

## [2026-03-30] Feature: CAS Number mapping from MySkin to products table

### Summary
- Added CAS No. column to `/products` and `/ingredients` tables
- CAS numbers are resolved at runtime by joining `raw_materials_console.inci_name` → `raw_materials_myskin.inci_name` → `cas_no`
- No data migration needed — uses batch lookup via `build_cas_no_map()` helper
- CAS numbers are searchable in the products search bar
- CAS No. shown in ingredient detail dialog

### Approach
- `raw_materials_console` never had `cas_no` — the field only exists in `raw_materials_myskin` (4,652 MySkin cosmetic ingredients)
- Join key: `inci_name` (INCI Name) — the international standard identifier for cosmetic ingredients
- Case-insensitive regex matching handles variations ("glycerin" vs "Glycerin")
- Materials without a matching INCI in MySkin show "-" (no CAS available)

### Files Changed
- `apps/ai/server/routers/products.ts` — Added `build_cas_no_map()` helper, CAS lookup in list/getById, cas_no in search filter
- `apps/web/app/products/page.tsx` — Added CAS No. table column, updated search placeholder
- `apps/web/app/ingredients/page.tsx` — Added CAS No. table column, detail dialog field, updated search placeholder

---

## [2026-03-27] Upgrade: Gemini 3 Flash Preview + Web Search Grounding

### Summary
- Upgraded all AI model references from gemini-2.0-flash-exp to gemini-3-flash-preview (Pro-level intelligence at Flash pricing)
- All model references now configurable via GEMINI_MODEL env var for easy switching
- Web search tool rewritten to use Gemini Google Search grounding (@google/genai SDK) — no external API keys needed
- Search model uses gemini-2.5-flash (stable, confirmed grounding support)

### Files Changed
- `apps/ai/agents/react/react-agent-service.ts` — Default model → gemini-3-flash-preview
- `apps/ai/services/providers/gemini-service.ts` — Default model → gemini-3-flash-preview
- `apps/ai/services/enhanced/enhanced-ai-service.ts` — Default model → gemini-3-flash-preview
- `apps/web/app/api/ai/cosmetic-enhanced/route.ts` — Model → gemini-3-flash-preview
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — Model → gemini-3-flash-preview
- `apps/web/app/api/ai/enhanced-chat/route.ts` — Model → gemini-3-flash-preview
- `apps/ai/agents/react/tool-handlers/web-search-handler.ts` — Full rewrite: Gemini Google Search grounding

---

## [2026-03-27] Fix: Remove all OpenAI/Pinecone dependencies — Gemini + Qdrant everywhere

### Summary
- All 3 AI API routes now use Gemini + Qdrant exclusively (zero OpenAI/Pinecone dependency)
- cosmetic-enhanced: ReAct agent as primary path, GeminiService fallback (was OpenAI GPT-4 + Pinecone)
- raw-materials-agent: Removed PINECONE_API_KEY guard, search uses Qdrant directly
- enhanced-chat: Same Pinecone removal, Qdrant-based search
- EnhancedAIService: Default model changed from gpt-4 to gemini-2.0-flash-exp
- ReAct system prompt: Routes all qdrant_search to raw_materials_myskin (only indexed collection)
- All health checks pass: toolService, searchService, mlService, geminiAI, knowledgeService, etc.

### Verification
- POST /api/ai/raw-materials-agent → success=true, type=react-agent
- POST /api/ai/enhanced-chat → success=true, type=react-agent
- POST /api/ai/cosmetic-enhanced → success=true, type=react-agent
- All GET ?action=health → all services true
- Container: healthy

### Files Changed
- `apps/web/app/api/ai/cosmetic-enhanced/route.ts` — Gemini+Qdrant, ReAct primary path
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — Remove Pinecone guard
- `apps/web/app/api/ai/enhanced-chat/route.ts` — Remove Pinecone guard
- `apps/ai/services/enhanced/enhanced-ai-service.ts` — Default model → gemini-2.0-flash-exp
- `apps/ai/agents/react/react-system-prompt.ts` — Route all search to myskin collection

---

## [2026-03-27] Fix: UI consistency — all light mode, black text, no CSS variable issues

### Summary
- Fixed CSS variable color references that Tailwind couldn't resolve (broke opacity modifiers)
- Converted ALL components from CSS variable references to direct Tailwind gray-scale colors
- Switched sidebar from dark (#1b1b1b) to light white with gray-200 borders
- All text now uses explicit gray-900 (black) for primary, gray-500 for secondary
- Removed all custom CSS color tokens from tailwind.config.ts (sidebar, primary, etc.)
- globals.css simplified to just --background/#ffffff and --foreground/#111111
- Body background: #f8f9fa (light gray), all cards: bg-white

### Root Cause
- Tailwind CSS variables (e.g., `bg-primary/90`) require colors in RGB/HSL format without wrappers
- Hex values in CSS variables break Tailwind's opacity modifier, causing invisible/wrong colors
- Fix: replaced all `text-foreground`, `bg-muted`, `border-border` etc. with `text-gray-900`, `bg-gray-50`, `border-gray-200`

### Files Changed (37 files — all re-touched)
- All `components/ui/*.tsx` — direct gray colors, white bg, gray borders
- `navigation.tsx`, `admin-navigation.tsx` — white sidebar, gray-200 border
- `globals.css` — simplified, no custom tokens
- `tailwind.config.ts` — removed sidebar/primary/secondary/etc. color tokens
- All AI components — gray-900 text, gray-50 backgrounds
- All pages — gray-900 headings, gray-500 descriptions

---

## [2026-03-27] Deploy: Full stack deployment — MySkin + UI redesign live on production

### Summary
- Rebuilt and deployed web container with all MySkin search tools + Cloudflare UI redesign
- Qdrant collection `raw_materials_myskin`: 4,652 vectors (3072-dim, gemini-embedding-001), status green
- E2E verified: login API, AI chat with MySkin semantic search (hyaluronic acid query returned 5 results)
- All 35 UI component files committed and deployed (Cloudflare-inspired dark sidebar, compact spacing)

### Verification Results
- Login: 200 OK, returns admin user
- AI Chat (ReAct agent): qdrant_search → raw_materials_myskin → 5 HA variants (scores 70.7-71.6%)
- Qdrant: green status, 4652 points, optimizer OK, HNSW indexing active

---

## [2026-03-27] Feature: MySkin Search Tools — 4 AI chatbot tools for 4,652 cosmetic ingredients

### Summary
- Added 4 MySkin search tools to the raw materials AI agent:
  1. `search_myskin_materials` — Hybrid text+semantic search across MySkin database
  2. `get_myskin_material_detail` — Full material profile lookup with related materials
  3. `browse_myskin_categories` — Category/supplier/cost/usage filtering with aggregation
  4. `compare_myskin_materials` — Side-by-side comparison of 2-5 materials
- Tools registered in all 3 agent entry points (agent.ts, langgraph-agent.ts, enhanced-raw-materials-agent.ts)
- ReAct agent updated: `raw_materials_myskin` added to Qdrant collection enum + system prompt
- Qdrant config: new `raw_materials_myskin` collection schema (768-dim Cosine, MySkin-specific payload indexes)
- RAG service: `rawMaterialsMySkinAI` service name → `raw_materials_myskin` collection mapping
- Indexing script: MySkin target added to INDEX_TARGETS for Qdrant vector indexing

### Chain of Thought
- User query → POST /api/ai/raw-materials-agent
- ReAct agent (primary): Gemini decides tools → executes up to 5 iterations → final response
- Fallback: GeminiToolService with function calling via tool registry
- MySkin tools accessible from both paths:
  - ReAct: via qdrant_search (collection=raw_materials_myskin) + mongo_query (collection=raw_materials_myskin)
  - GeminiToolService: via registered tool definitions (search_myskin_materials, etc.)
- Human-in-the-loop: Feedback recording only (PreferenceLearningService) — no approval gates

### Files Changed
- `apps/ai/agents/raw-materials-ai/tools/myskin-search-tools.ts` — CREATE: 4 tools + exports
- `apps/ai/config/qdrant-config.ts` — MODIFY: Add raw_materials_myskin collection + search defaults
- `apps/ai/scripts/index-qdrant.ts` — MODIFY: Add MySkin index target + RagServiceName
- `apps/ai/agents/raw-materials-ai/agent.ts` — MODIFY: Import + register MySkin tools + system prompt
- `apps/ai/agents/raw-materials-ai/langgraph-agent.ts` — MODIFY: Import + register + state schema
- `apps/ai/agents/raw-materials-ai/enhanced-raw-materials-agent.ts` — MODIFY: Import MySkin tools
- `apps/ai/agents/react/tool-definitions.ts` — MODIFY: Add raw_materials_myskin to qdrant_search enum
- `apps/ai/agents/react/react-system-prompt.ts` — MODIFY: Add MySkin routing in phrase table
- `apps/ai/services/rag/qdrant-rag-service.ts` — MODIFY: Add rawMaterialsMySkinAI service mapping

---

## [2026-03-27] Redesign: Cloudflare-inspired UI overhaul across entire frontend

### Summary
- Complete UI redesign to match Cloudflare dashboard aesthetic: dark sidebar, compact spacing, small text, flat design
- Switched font from Noto Sans Thai to Inter (Google Fonts) for clean, professional appearance
- Added comprehensive CSS design tokens (CSS variables) for colors, spacing, sidebar theme
- Reduced all text sizes: body 13px, headers proportionally smaller, badges 10-11px
- Dark charcoal sidebar (#1b1b1b) with orange brand accent, replacing white/green sidebar
- Flat card design with subtle 1px borders, no gradients on metric cards
- ChatGPT-style AI chat interface: full-width messages, no bubbles, clean avatar layout
- Cloudflare-style data tables: compact rows, uppercase headers, subtle borders
- Compact form inputs (h-8), buttons (h-8/h-7), and badges (rounded-md, tiny padding)
- Consistent design language across all 40+ component files

### Design Tokens Added (globals.css)
- --sidebar-bg, --sidebar-fg, --sidebar-muted, --sidebar-accent, --sidebar-border
- --primary (#2563eb), --muted (#f4f5f6), --border (#e5e7eb)
- Custom scrollbar styling (6px, gray-300 thumb)
- Font smoothing (antialiased)

### Tailwind Config Changes
- Added custom fontSize scale: 2xs (10px), xs (11px), sm (13px), base (14px)
- Added sidebar color palette with CSS variable references
- Added semantic color tokens: primary, secondary, destructive, muted, accent, card, popover
- Reduced border-radius: lg=0.5rem, md=0.375rem, sm=0.25rem
- Subtler box-shadow presets

### Files Changed (37 files)
- `apps/web/app/globals.css` — Complete CSS variables overhaul + scrollbar + font smoothing
- `apps/web/tailwind.config.ts` — New color palette, fontSize scale, border-radius, shadows
- `apps/web/app/layout.tsx` — Noto Sans Thai → Inter font
- `apps/web/components/ui/button.tsx` — Compact sizing (h-8/h-7), gap-1.5, rounded-md
- `apps/web/components/ui/card.tsx` — Flat design, px-4 py-3, text-sm titles
- `apps/web/components/ui/input.tsx` — h-8, px-2.5, rounded-md
- `apps/web/components/ui/badge.tsx` — px-1.5 py-0.5, text-2xs, rounded-md, pastel variants
- `apps/web/components/ui/table.tsx` — Compact h-8 headers, uppercase, tracking-wider
- `apps/web/components/ui/textarea.tsx` — min-h-[72px], rounded-md
- `apps/web/components/ui/label.tsx` — text-xs, text-muted-foreground
- `apps/web/components/ui/progress.tsx` — h-1.5 (thinner)
- `apps/web/components/ui/tabs.tsx` — Cloudflare underline tabs (border-b-2 on active)
- `apps/web/components/ui/alert.tsx` — Compact padding, text-xs description
- `apps/web/components/ui/separator.tsx` — h-px (thinner)
- `apps/web/components/ui/error-display.tsx` — Compact, text-xs
- `apps/web/components/ui/status-badge.tsx` — Pastel colors, outline variant
- `apps/web/components/navigation.tsx` — Dark sidebar, orange brand mark, compact nav items
- `apps/web/components/admin-navigation.tsx` — Dark sidebar, red admin accent
- `apps/web/app/page.tsx` — Clean dashboard with icon-in-box metric cards
- `apps/web/app/login/page.tsx` — Minimal centered card, dark logo header
- `apps/web/app/ingredients/page.tsx` — Compact table, smaller headers, clean pagination
- `apps/web/app/formulas/page.tsx` — Compact table, clean status badges
- `apps/web/components/ai/ai_chat_message.tsx` — ChatGPT-style full-width, no bubbles
- `apps/web/components/ai/ai_chat_input.tsx` — ArrowUp send button, compact textarea
- `apps/web/components/ai/ai_chat_header.tsx` — Compact py-2.5, text-sm
- `apps/web/components/ai/ai_page_header.tsx` — text-sm title, text-2xs description
- `apps/web/components/ai/ai_empty_state.tsx` — Minimal, muted colors
- `apps/web/components/ai/ai_loading_indicator.tsx` — w-1.5 dots, subtle animation
- `apps/web/components/ai/ai_chat_container.tsx` — Clean border, border-t on input
- `apps/web/components/ai/ai_chat_messages_area.tsx` — divide-y message separation
- `apps/web/components/ai/ai_chat_input_area.tsx` — Clean composition
- `apps/web/components/ai/ai_feedback_buttons.tsx` — text-2xs, h-5 buttons
- `apps/web/components/ai/ai_features_grid.tsx` — p-3, text-xs titles
- `apps/web/components/ai/ai_auth_guard.tsx` — Minimal centered layout

### No New TypeScript Errors
- All 43 pre-existing errors remain unchanged (cosmetic services, langgraph, calculations)
- Zero new errors introduced by this redesign

---

## [2026-03-27] Task 1: Add MySkin Qdrant collection config

### Summary
- Added `raw_materials_myskin` collection schema to `QDRANT_COLLECTIONS` with MySkin-specific payload indexes (category, cas_no, usage_min_pct, usage_max_pct)
- Added `raw_materials_myskin` search defaults to `QDRANT_SEARCH_DEFAULTS` (top_k=5, score_threshold=0.7, ef=128)
- Updated file header comment in qdrant-config.ts to document the new collection
- Extended `RagServiceName` type in index-qdrant.ts with `'rawMaterialsMySkinAI'`
- Added `MySkin Raw Materials` index target to `INDEX_TARGETS` array (rnd_ai.raw_materials_myskin → Qdrant raw_materials_myskin)

### Files Changed
- `apps/ai/config/qdrant-config.ts` — new collection + search defaults + header comment
- `apps/ai/scripts/index-qdrant.ts` — RagServiceName type + INDEX_TARGETS entry

---

## [2026-03-27] Feature: Add Prisma ORM v6.19 with MongoDB schema (20 models, 30+ indexes)

### Summary
- Added Prisma v6.19 with MongoDB provider — Prisma v7 does NOT support MongoDB yet
- Schema covers all 20 collections with relations, enums, embedded types, indexes
- Models: Account, Session, User, Organization, RawMaterial, Product, StockEntry,
  Formula, Order, CreditTransaction, ProductLog, UserLog, Conversation, Feedback,
  AiResponse, PriceCalculation
- Pushed schema to DO MongoDB — all collections and indexes created
- Prisma client singleton in shared-database package (imports from @prisma/client)
- Docker build verified — copies .prisma + @prisma to runner stage

### Issues Resolved
- Prisma 7 `prisma-client` generator outputs .ts files — Next.js 14 can't transpile node_modules .ts
- Prisma 7 engine type "client" requires adapter/accelerateUrl — no MongoDB adapter exists yet
- Solution: Downgraded to Prisma v6.19 (latest v6, full MongoDB support, prisma-client-js generator)
- Fixed import path: `@prisma/client` instead of relative `../../../../generated/prisma`
- Fixed Dockerfile: copy `node_modules/.prisma` + `node_modules/@prisma` instead of `generated/`

### Files Changed
- `prisma/schema.prisma` — Full MongoDB schema with `url = env("DATABASE_URL")` in datasource
- `prisma.config.ts` — Prisma config (v6 compatible)
- `packages/shared-database/src/prisma/client.ts` — Singleton client, imports from @prisma/client
- `packages/shared-database/src/index.ts` — Export prisma client
- `apps/web/Dockerfile` — prisma generate + copy .prisma/@prisma to runner stage
- `docker-compose.yml` — Added DATABASE_URL env var
- `.env.production` — Added DATABASE_URL template

---

## [2026-03-27] Deploy: R&D AI Management live on DigitalOcean Droplet

### Summary
- Created droplet `rnd-ai-droplet` (2vCPU/4GB, sgp1, Ubuntu 24.04) — IP: 165.245.181.97
- Created managed MongoDB `rnd-ai-mongodb` (MongoDB 8, sgp1, 1 node)
- Firewall configured: SSH(22), HTTP(80), HTTPS(443), App(3000)
- Fixed Dockerfile: removed non-existent `apps/web/node_modules` COPY (npm workspaces hoist to root)
- Fixed Qdrant healthcheck: replaced wget with bash /dev/tcp probe (Qdrant image has no wget/curl)
- App is live at http://165.245.181.97:3000
- Qdrant collections empty — ready for data indexing

### Infrastructure
- Droplet ID: 561184147 | DB ID: 28d32669-76af-4d48-aff8-063d6f9902f6
- Both assigned to `organicsai` project
- DB trusted sources: droplet + local dev IP

---

## [2026-03-27] Fix: Final Pinecone→Qdrant migration cleanup — zero migration TS errors

### Summary
- Fixed `enhanced-chat/route.ts` and `raw-materials-agent/route.ts`: snake_case alignment with ReactAgent interfaces
  - `toolCalls` → `tool_calls`, `processingTime` → `processing_time`
  - `userId` → `user_id`, `sessionId` → `session_id`, `conversationHistory` → `conversation_history`
- Fixed `ai-chat.tsx` and `raw-materials-chat.tsx`: redirected deleted `pinecone-client` import → `qdrant-rag-service`
- All migration-related TypeScript errors now resolved. Remaining 43 errors (web app) are pre-existing (langgraph API, cosmetic services types, calculations router).

### Files Changed
- `apps/web/app/api/ai/enhanced-chat/route.ts` — `reactResult.toolCalls` → `reactResult.tool_calls`, `reactResult.processingTime` → `reactResult.processing_time`
- `apps/ai/components/chat/ai-chat.tsx` — `PineconeClientService` import → `QdrantRAGService as PineconeClientService`
- `apps/ai/components/chat/raw-materials-chat.tsx` — same import redirect

---

## [2026-03-27] Refactor: Rename pineconeIndex → qdrant_collection across agent configs

### Summary
- Eliminated all remaining Pinecone field-name references in the agent layer.
- Four files updated: index-config.ts, agent-manager.ts, collection-router.ts, agent-system.ts.

### Planning / Approach
- Read CHANGELOG.md to understand full migration history (Tasks 1-19 + cleanup).
- Read qdrant-rag-service.ts to confirm QdrantRAGService constructor signature:
  `(service_name?, config_override?, custom_embedding_service?)`.
- Read qdrant-config.ts to confirm four valid Qdrant collection names:
  `raw_materials_console`, `raw_materials_fda`, `raw_materials_stock`, `sales_rnd`.
- Applied minimal targeted edits; no file rewritten from scratch.

### Files Changed

#### apps/ai/rag/indices/index-config.ts — MODIFIED
- Interface `RAGIndexConfig`: `pineconeIndex: string` → `qdrant_collection: string` with JSDoc.
- 8 config objects updated with correct Qdrant collection targets:
  - `raw-materials-db` → `raw_materials_stock` (source: raw_materials_real_stock)
  - `formulations-db`  → `raw_materials_console`
  - `regulations-db`   → `raw_materials_fda`
  - `market-research-db` → `sales_rnd`
  - `research-db`      → `raw_materials_fda`
  - `product-docs-db`  → `raw_materials_console`
  - `suppliers-db`     → `raw_materials_console`
  - `safety-db`        → `raw_materials_fda`

#### apps/ai/agents/agent-manager.ts — MODIFIED
- Import: `PineconeRAGService` → `QdrantRAGService` from `qdrant-rag-service`.
- `ragServices` Map type: `Map<string, PineconeRAGService>` → `Map<string, QdrantRAGService>`.
- `getRAGService()`: `indexConfig.pineconeIndex` → `indexConfig.qdrant_collection`; replaced
  `new PineconeRAGService({index, namespace, ...})` stub with correct
  `new QdrantRAGService(serviceName, { collectionName, topK, ... })` call.
- Added `salesRndAI` routing for `market-data` category.
- `ragService.searchSimilar()` → `ragService.search_similar()` (snake_case).
- Added entry/exit console.log in `getRAGService()`.

#### apps/ai/utils/collection-router.ts — MODIFIED
- All `qdrant_collections` values updated from old namespace strings (`'in_stock'`, `'all_fda'`)
  to actual Qdrant collection names (`'raw_materials_stock'`, `'raw_materials_fda'`).
- Header comment updated to reference correct collection names.

#### apps/ai/agents/core/agent-system.ts — MODIFIED
- Header comment: Removed stale "TODO: Implement full agent system without Pinecone".
- `searchVectorDatabase()` stub: updated comment to reference `QdrantRAGService.search_similar()`.
- `getVectorIndex()` stub: updated return shape to Qdrant API (`get_index_stats` / `pointsCount`).

### Root Cause
After the ChromaDB → Qdrant migration (Tasks 1-19), agent-layer files still used `pineconeIndex`
as a field name and old Pinecone namespace strings as values. This caused a semantic mismatch:
the field held Qdrant collection names but was named after the old system, making the code
misleading and prone to breaking if anyone followed the field name literally.

---

## [2026-03-27] cleanup: Remove legacy Pinecone scripts and update source types to Qdrant

### Summary
- Deleted 6 legacy Pinecone migration/indexing scripts that used `@pinecone-database/pinecone` directly
- Deleted `apps/ai/lib/services/embedding.ts` (Pinecone-backed EmbeddingService, no active importers)
- Updated `source` type literal from `'pinecone'` to `'qdrant'` in `HybridSearchResult` and `UnifiedSearchResult` interfaces in the client wrappers
- Renamed `pinecone_namespaces` field to `qdrant_collections` throughout `collection-router.ts` (interface + all return sites); values updated to real Qdrant collection names (`raw_materials_stock`, `raw_materials_fda`)
- Updated consumer `unified-search-service.ts` to use `routing.qdrant_collections`; local var `namespace` -> `qdrant_collection`
- Updated JSDoc comment in `dynamic-chunking-service.ts` (`chunks_to_documents`) from "Pinecone" to "Qdrant"

### Root Cause / Context
After the Qdrant migration (Tasks 1-4, 18-19), several script files and type literals still referenced Pinecone. This was dead code and misleading naming that would confuse future contributors and cause TypeScript type errors if a Qdrant-sourced result is passed to a consumer expecting `source: 'mongodb' | 'pinecone'`.

### Files Deleted (git rm)
- `apps/ai/scripts/migrate-unified-collections.ts`
- `apps/ai/scripts/migrate-unified-collections-ultra-fast.ts`
- `apps/ai/scripts/verify-migration.ts`
- `apps/ai/scripts/create-sales-ai-index.js`
- `apps/ai/scripts/migrate-to-dynamic-chunking.ts`
- `apps/ai/scripts/index-sample-data.ts`
- `apps/ai/lib/services/embedding.ts`

### Files Modified
- `apps/ai/services/rag/hybrid-search-client.ts` — `source: 'mongodb' | 'pinecone'` -> `'qdrant'`
- `apps/ai/services/rag/unified-search-client.ts` — Same
- `apps/ai/utils/collection-router.ts` — Interface + all return sites renamed `pinecone_namespaces` -> `qdrant_collections`; values mapped to real Qdrant collection names
- `apps/ai/services/rag/unified-search-service.ts` — Updated to use `routing.qdrant_collections`; local var renamed `namespace` -> `qdrant_collection`
- `apps/ai/services/rag/dynamic-chunking-service.ts` — JSDoc updated at `chunks_to_documents`

### Not Deleted
- `apps/web/lib/services/embedding.ts` — Still imported by `apps/web/app/api/ai-chat/route.ts` and `apps/web/app/api/index-data/route.ts`; left in place

---

## [2026-03-27] fix: Update web RAG routes from Pinecone to Qdrant env checks

### Summary
- Replaced all `PINECONE_API_KEY` env guards in web RAG API routes with `QDRANT_URL` checks.
- Fixed `searchRawMaterials/route.ts` calling `ragService.searchSimilar` (camelCase) to `ragService.search_similar` (snake_case) to match the actual `QdrantRAGService` method signature.
- Added `QDRANT_URL` / `QDRANT_API_KEY` entries to `apps/web/lib/env.ts` type union and `env` object.
- Kept `pinecone_api_key` in `env.ts` as `@deprecated` for backward compat.
- Added clear 503 guards in `index-data/route.ts` since its underlying `EmbeddingService` still uses Pinecone SDK directly — prevents a runtime crash on Qdrant deployments and surfaces a migration note.

### Root Cause
Routes in `apps/web/app/api/rag/` and `apps/web/app/api/index-data/` still checked `PINECONE_API_KEY` which was removed from the Qdrant-based deployment environment (Task 15). This meant hybrid-search and searchRawMaterials would silently return empty results on every call to the new droplet even though Qdrant was running.

Additionally `searchRawMaterials/route.ts` called `ragService.searchSimilar` (camelCase) which does not exist on `QdrantRAGService` — it would throw a `TypeError: ragService.searchSimilar is not a function` at runtime.

### Planning / Approach
1. Read CHANGELOG.md for migration context.
2. Read all 4 target files before any edits.
3. Read `qdrant-rag-service.ts` to confirm `PineconeRAGService` alias exists and method is `search_similar`.
4. Made minimal targeted edits — no full-file rewrites.
5. `index-data/route.ts` is NOT wired to Qdrant yet (its `EmbeddingService` uses Pinecone SDK); added 503 guard + TODO comment instead of silently crashing.

### Files Changed
- `apps/web/app/api/rag/hybrid-search/route.ts` — MODIFIED: `PINECONE_API_KEY` check -> `QDRANT_URL`, updated log messages
- `apps/web/app/api/rag/searchRawMaterials/route.ts` — MODIFIED: `PINECONE_API_KEY` check -> `QDRANT_URL`, `searchSimilar` -> `search_similar`, updated comments
- `apps/web/app/api/index-data/route.ts` — MODIFIED: Updated JSDoc, added 503 guard for POST/GET with migration note to `index:qdrant` script
- `apps/web/lib/env.ts` — MODIFIED: Added `QDRANT_URL`/`QDRANT_API_KEY` to `OptionalEnvVar` type, added `qdrant_url()` and `qdrant_api_key()` getters, marked `pinecone_api_key()` as `@deprecated`, updated `get_env_status()`

---

## [2026-03-27] Add ReAct Agent Tool Handlers (qdrant, mongo, formula, web, memory)

### Summary
- Created `apps/ai/agents/react/tool-handlers/` directory with 5 handler files that
  implement the ReAct agent tools declared in `tool-definitions.ts`.

### Planning / Approach
- Read `tool-definitions.ts` to understand the 5 tool contracts (ReactToolName union).
- Read `qdrant-service.ts` to confirm `get_qdrant_service()` singleton + `search()` API.
- Read `qdrant-config.ts` to confirm `get_search_defaults()` signature.
- Read `universal-embedding-service.ts` to confirm `createEmbeddingService()` factory.
- Reused `MongoClient` caching pattern (module-level Map keyed by URI) in both
  `mongo-query-handler` and `context-memory-handler` to avoid connection churn.
- All files: snake_case names, JSDoc on every function, console.log entry/exit.

### Files Created
- `apps/ai/agents/react/tool-handlers/qdrant-search-handler.ts` — NEW
  - Generates query embedding via `createEmbeddingService()`
  - Builds Qdrant `must` filter from `params.filters`
  - Calls `QdrantService.search()` with resolved top_k / score_threshold
  - Returns formatted string: score%, code, trade_name, INCI, supplier, cost, benefits, stock_status
- `apps/ai/agents/react/tool-handlers/mongo-query-handler.ts` — NEW
  - Dispatches find / findOne / aggregate / count operations
  - URI routing: database==='raw_materials' → RAW_MATERIALS_REAL_STOCK_MONGODB_URI, else MONGODB_URI
  - MongoClient cached per URI in module-level Map; max 20 results cap
  - Returns JSON stringified results with context header
- `apps/ai/agents/react/tool-handlers/formula-calc-handler.ts` — NEW
  - Pure math; no external deps
  - Operations: batch_cost, scale_formula, unit_convert, ingredient_percentage
  - Unit-to-grams map: g=1, kg=1000, lb=453.592, ton=1_000_000, oz=28.3495, ml=1, l=1000
  - Handles unit aliases (litre, gram, kilogram, ounce, etc.)
- `apps/ai/agents/react/tool-handlers/web-search-handler.ts` — NEW
  - Calls Google Custom Search API when GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CSE_ID set
  - Gracefully degrades to training-data fallback when credentials absent
  - Uses native fetch with AbortSignal.timeout(15s)
- `apps/ai/agents/react/tool-handlers/context-memory-handler.ts` — NEW
  - Queries rnd_ai.conversations + rnd_ai.raw_materials_conversations in parallel
  - Normalises 3 document shapes (messages[], conversation[], flat role+content)
  - Merges and sorts by timestamp; trims to lookback (default: 10, max: 50)
  - Returns [ROLE]: content formatted turns

---

## [2026-03-27] Tasks 18 & 19: Delete ChromaDB files + update RAG config for Qdrant

### Summary
- Removed 7 legacy ChromaDB/Pinecone source files via `git rm`
- Updated `apps/ai/config/rag-config.ts`: renamed `pineconeIndex` -> `collectionName`, updated values to Qdrant collection names, replaced Pinecone API config block with Qdrant equivalent

### Task 18 — Delete old ChromaDB files
Files removed with `git rm`:
- `apps/ai/services/vector/chroma-service.ts` — Low-level ChromaDB client (replaced by qdrant-service.ts)
- `apps/ai/services/rag/chroma-rag-service.ts` — High-level ChromaDB RAG service (replaced by qdrant-rag-service.ts)
- `apps/ai/services/rag/pinecone-service-stub.ts` — Pinecone stub (Qdrant now primary)
- `apps/ai/scripts/index-chromadb-simple.ts` — ChromaDB indexing script (replaced by index-qdrant.ts)
- `apps/ai/scripts/index-chromadb-resume.ts` — ChromaDB resume indexing script
- `apps/ai/scripts/index-chromadb-resume-fast.ts` — ChromaDB fast resume script
- `apps/ai/scripts/check-chromadb-count.ts` — ChromaDB count check script

### Task 19 — Update RAG config for Qdrant
- **Interface change**: `RAGServiceConfig.pineconeIndex: string` -> `collectionName: string`
- **Comment update**: JSDoc updated to reference Qdrant collection
- **Value updates**:
  - `rawMaterialsAllAI`: `'raw-materials-stock'` -> `'raw_materials_fda'`
  - `rawMaterialsAI`: `'raw-materials-stock'` -> `'raw_materials_console'`
  - `salesRndAI`: `'003-sales-ai'` -> `'sales_rnd'`
- **validateRAGConfig**: `config.pineconeIndex` -> `config.collectionName`
- **PINECONE_API_CONFIG** replaced with `QDRANT_API_CONFIG` reading `QDRANT_URL` / `QDRANT_API_KEY`
- **validateEnvironment**: checks `QDRANT_URL` instead of `PINECONE_API_KEY`
- **Descriptions**: All descriptions updated to reference Qdrant collections

### Root Cause / Context
ChromaDB was the original vector store; Tasks 1-4 migrated the codebase to Qdrant. These tasks complete the cleanup by removing dead code and aligning the central config with Qdrant collection names.

### Files Changed
- `apps/ai/services/vector/chroma-service.ts` — DELETED
- `apps/ai/services/rag/chroma-rag-service.ts` — DELETED
- `apps/ai/services/rag/pinecone-service-stub.ts` — DELETED
- `apps/ai/scripts/index-chromadb-simple.ts` — DELETED
- `apps/ai/scripts/index-chromadb-resume.ts` — DELETED
- `apps/ai/scripts/index-chromadb-resume-fast.ts` — DELETED
- `apps/ai/scripts/check-chromadb-count.ts` — DELETED
- `apps/ai/config/rag-config.ts` — MODIFIED: pineconeIndex -> collectionName, Qdrant collection names, Qdrant API config

---

## [2026-03-27] Task 13 (Update): Refactor index-qdrant.ts — Typed IndexTarget + URI Fallback + MONGODB_URI Guard

### Summary
- Refactored `apps/ai/scripts/index-qdrant.ts` to align with spec requirements.

### Details
- **Added `RagServiceName` type**: Explicit union `'rawMaterialsAllAI' | 'rawMaterialsAI' | 'salesRndAI'` for type safety.
- **Renamed `IndexTarget` fields**: `database`/`collection`/`mongodb_uri_env` → `mongo_db`/`mongo_collection`/`mongo_uri_env` for consistent snake_case and clarity.
- **MONGODB_URI validation**: Added upfront guard in `main()` — exits with code 1 if `MONGODB_URI` is unset.
- **URI fallback**: `index_target()` now resolves `process.env[target.mongo_uri_env] || process.env.MONGODB_URI` so target 2 (`raw_materials_real_stock`) uses `RAW_MATERIALS_REAL_STOCK_MONGODB_URI` when set, falling back to `MONGODB_URI`.
- **Updated log lines**: Progress logs reference `mongo_db.mongo_collection` with new field names.

### Files Changed
- `apps/ai/scripts/index-qdrant.ts` — UPDATED: Typed interface, MONGODB_URI guard, URI fallback

---

## [2026-03-27] Task 16: Update RAG Router to Use QdrantRAGService

### Summary
- Migrated `apps/ai/server/routers/rag.ts` from stub `PineconeRAGService` to `QdrantRAGService`.
- All tRPC procedure definitions remain unchanged; only service instantiation and method calls updated.

### Root Cause
`rag.ts` still imported `PineconeRAGService` from `@/ai/services/rag/pinecone-service-stub` and called
camelCase methods (`searchSimilar`, `upsertDocuments`, `getIndexStats`, `prepareRawMaterialDocument`).
QdrantRAGService exposes all these as snake_case methods per project convention.

### Changes Made
- **Import swap**: `PineconeRAGService` from `pinecone-service-stub` → `QdrantRAGService` from `../../services/rag/qdrant-rag-service`
- **Instantiation**: `new PineconeRAGService(...)` → `new QdrantRAGService(...)`
- **Method renames**: `searchSimilar` → `search_similar`, `upsertDocuments` → `upsert_documents`, `getIndexStats` → `get_index_stats`, `prepareRawMaterialDocument` → `prepare_raw_material_document`
- **Response shape fix**: `getIndexStats` procedure now reads `qdrantStats.pointsCount` (was `pineconeStats.totalRecordCount`) and returns renamed key `qdrantStats`
- **Logging**: Added `console.log` entry/exit/error calls to all procedure handlers per function-logging rule
- **Typing**: `keywordMatches` properly typed as `typeof vectorMatches` to avoid implicit `any[]`

### Files Changed
- `apps/ai/server/routers/rag.ts` — MODIFIED: PineconeRAGService stub → QdrantRAGService migration

---

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
