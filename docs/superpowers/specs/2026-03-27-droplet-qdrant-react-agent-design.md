# Design Spec: DO Droplet Deployment + Qdrant + ReAct Agent Architecture

**Date:** 2026-03-27
**Branch:** dev/droplet
**Status:** Approved

---

## 1. Goals

1. Deploy the full R&D AI Management stack to a single DigitalOcean droplet ($24/mo, 4GB RAM / 2 vCPU)
2. Replace ChromaDB with Qdrant for higher-accuracy vector search
3. Migrate from MongoDB Atlas to DO Managed MongoDB ($15/mo) — same region, private networking
4. Upgrade the AI layer from "RAG-only" to a ReAct agent with chain-of-thought reasoning and multi-tool routing
5. Re-index all ~31K documents from MongoDB into Qdrant with typed payloads and indexed filter fields
6. Total infrastructure cost: ~$39/mo

---

## 2. Architecture Overview

```
┌───────────────────────────────────────────────────┐
│            DO Droplet (4GB / 2 vCPU)              │
│            Ubuntu 24.04, Docker                   │
│                                                   │
│  ┌───────────┐  ┌────────────┐  ┌──────────────┐ │
│  │  Web App  │  │ AI Backend │  │   Qdrant     │ │
│  │  Next.js  │──│  Node.js   │──│  Vector DB   │ │
│  │  :3000    │  │  :3001     │  │  :6333       │ │
│  │  768MB    │  │  768MB     │  │  512MB       │ │
│  └───────────┘  └─────┬──────┘  └──────────────┘ │
│                       │                           │
│  ┌────────────────────┼────────────────────────┐  │
│  │         ReAct Agent Reasoning Engine        │  │
│  │                                             │  │
│  │  Tools: qdrant_search | mongo_query |       │  │
│  │         formula_calculate | web_search |    │  │
│  │         context_memory                      │  │
│  └─────────────────────────────────────────────┘  │
└───────────────────┬───────────────────────────────┘
                    │ Private network
          ┌─────────▼──────────┐
          │  DO Managed MongoDB│
          │  $15/mo            │
          │  Same region (SGP1)│
          └────────────────────┘
```

---

## 3. Infrastructure

### 3.1 Droplet Specification

| Property | Value |
|----------|-------|
| Size | s-2vcpu-4gb ($24/mo) |
| Image | Ubuntu 24.04 LTS |
| Region | sgp1 (or nearest to team) |
| VPC | Private networking enabled |
| SSH Key | Team key |
| Tags | rnd-ai, production |
| Swap | 2GB (created post-provision) |
| Firewall | SSH(22) + HTTP(80) + HTTPS(443) only |

### 3.2 Memory Budget

| Service | RAM Limit | Notes |
|---------|-----------|-------|
| Web (Next.js) | 768MB | Standalone output, lean runtime |
| AI Backend | 768MB | API-based LLM calls, not local inference |
| Qdrant | 512MB | 31K vectors @ 768 dims = ~92MB vector RAM |
| OS + Docker | ~512MB | Kernel, systemd, Docker daemon |
| Swap | 2GB | Safety net for indexing spikes |
| Buffer | ~512MB | Headroom |

### 3.3 DO Managed MongoDB

| Property | Value |
|----------|-------|
| Plan | Basic ($15/mo) |
| Engine | MongoDB 7.0 |
| Region | Same as droplet |
| Nodes | 1 (single node) |
| Connection | Private VPC URI |
| Backups | Daily automatic |

---

## 4. Qdrant Integration

### 4.1 Why Qdrant Over ChromaDB

1. **HNSW tuning** — expose `ef_construct` and `m` params for recall optimization
2. **Pre-filtering** — filter by payload fields BEFORE vector search (ChromaDB post-filters)
3. **Score threshold at DB level** — no wasted results returned
4. **Typed payloads** — indexed keyword/text/float fields for structured queries
5. **On-disk payload storage** — keeps RAM usage low on 4GB droplet
6. **Production-grade** — designed for production workloads, not prototyping

### 4.2 Collection Schema

#### raw_materials_console (primary)

```
Distance metric: Cosine
Vector dimension: 768 (Gemini text-embedding-004)

Payload fields:
  rm_code:       keyword  [indexed] — exact match filtering
  trade_name:    keyword  [indexed] — exact match
  inci_name:     text     [indexed] — full-text search
  supplier:      keyword  [indexed] — filter by supplier
  source:        keyword  [indexed] — "fda" | "stock" | "console"
  stock_status:  keyword  [indexed] — "in_stock" | "out_of_stock"
  cost:          float    [indexed] — range queries (< $50/kg)
  benefits:      text               — stored, not indexed
  details:       text               — full document text
  indexed_at:    datetime [indexed] — freshness tracking
```

#### raw_materials_fda

Same schema as above, `source = "fda"`. ~31,179 documents.

#### raw_materials_stock

Same schema, `source = "stock"`. ~3,111 documents.

#### sales_rnd

```
Distance metric: Cosine
Vector dimension: 768

Payload fields:
  product_name:  keyword  [indexed]
  category:      keyword  [indexed]
  region:        keyword  [indexed]
  sales_data:    text
  details:       text
  indexed_at:    datetime [indexed]
```

### 4.3 Qdrant Docker Configuration

```yaml
qdrant:
  image: qdrant/qdrant:latest
  container_name: rnd-ai-qdrant
  mem_limit: 512m
  ports:
    - "127.0.0.1:6333:6333"  # REST API — localhost only
    - "127.0.0.1:6334:6334"  # gRPC — localhost only
  environment:
    - QDRANT__STORAGE__ON_DISK_PAYLOAD=true
    - QDRANT__STORAGE__OPTIMIZERS__MEMMAP_THRESHOLD_KB=20000
    - QDRANT__SERVICE__GRPC_PORT=6334
  volumes:
    - qdrant-data:/qdrant/storage
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:6333/healthz"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 10s
```

### 4.4 HNSW Tuning

```typescript
// Collection creation config
{
  vectors: {
    size: 768,
    distance: "Cosine"
  },
  hnsw_config: {
    m: 16,              // connections per node (default 16, good balance)
    ef_construct: 128,  // build-time quality (higher = better recall, slower index)
    full_scan_threshold: 10000  // below this count, skip HNSW, do brute force
  },
  optimizers_config: {
    memmap_threshold: 20000  // mmap vectors above this count
  },
  on_disk_payload: true
}
```

Search-time: `ef = 128` for high recall. Adjustable per query.

### 4.5 Service Replacement Map

```
DELETE:
  apps/ai/services/vector/chroma-service.ts
  apps/ai/services/rag/chroma-rag-service.ts
  apps/ai/services/rag/pinecone-service-stub.ts

CREATE:
  apps/ai/services/vector/qdrant-service.ts       — low-level Qdrant client
  apps/ai/services/rag/qdrant-rag-service.ts       — high-level RAG operations
  apps/ai/config/qdrant-config.ts                  — collection schemas, connection config
  apps/ai/scripts/index-qdrant.ts                  — re-indexing script

UPDATE:
  apps/ai/services/rag/enhanced-hybrid-search-service.ts  — swap ChromaService → QdrantService
  apps/ai/services/rag/unified-search-service.ts          — swap underlying calls
  apps/ai/config/rag-config.ts                            — update provider references
  apps/ai/server/routers/rag.ts                           — update service imports
  apps/ai/server/services/auto-index-service.ts           — target Qdrant
  docker-compose.yml                                      — replace chromadb with qdrant
  .env.production                                         — Qdrant + DO MongoDB vars
  scripts/deploy-droplet.sh                               — updated health checks

KEEP UNCHANGED:
  apps/ai/services/embeddings/universal-embedding-service.ts
  apps/ai/services/embeddings/gemini-embedding-service.ts
  All AI agent code (consumers of RAG service interface)
```

### 4.6 QdrantService Interface

```typescript
class QdrantService {
  /** Initialize Qdrant client connection */
  constructor(config: QdrantConfig)

  /** Create collection with typed schema and HNSW config */
  ensureCollection(name: string, schema: CollectionSchema): Promise<void>

  /** Batch upsert documents with vectors and typed payloads */
  upsert(collection: string, points: QdrantPoint[]): Promise<void>

  /** Semantic search with pre-filtering and score threshold */
  search(collection: string, vector: number[], options: SearchOptions): Promise<SearchResult[]>

  /** Delete points by ID or filter */
  delete(collection: string, filter: QdrantFilter | string[]): Promise<void>

  /** Get collection info (point count, status, config) */
  getCollectionInfo(collection: string): Promise<CollectionInfo>

  /** Health check — returns true if Qdrant is reachable */
  healthCheck(): Promise<boolean>

  /** Scroll through all points (for verification/export) */
  scroll(collection: string, filter?: QdrantFilter, limit?: number): Promise<ScrollResult>
}

interface SearchOptions {
  topK: number              // max results
  scoreThreshold?: number   // minimum cosine similarity (0-1)
  filter?: QdrantFilter     // payload-based pre-filtering
  ef?: number               // search-time HNSW parameter
  withPayload?: boolean | string[]  // which payload fields to return
}

interface QdrantPoint {
  id: string
  vector: number[]
  payload: Record<string, unknown>
}
```

---

## 5. ReAct Agent Architecture

### 5.1 Problem With Current RAG-Only Approach

The current AI routes pipe EVERY query through vector search:
- Exact lookups ("cost of RM-1234") waste a vector search when a DB query is instant
- Math queries ("cost 500kg batch of F-201") can't be answered by similarity
- Fresh data queries ("Korean skincare trends 2026") return stale indexed content
- Structured comparisons ("compare retinol suppliers") need aggregation, not similarity

### 5.2 ReAct Pattern: Reason + Act

The agent follows a loop: **Thought → Action → Observation → (repeat or Answer)**

```
┌─────────────────────────────────────────────────────┐
│                  ReAct Agent Loop                    │
│                                                      │
│  1. THOUGHT: Analyze query, decide what tools needed │
│  2. ACTION:  Call one or more tools                  │
│  3. OBSERVATION: Process tool results                │
│  4. THOUGHT: Do I have enough to answer?             │
│     ├─ NO  → back to step 2 (different tool/query)   │
│     └─ YES → step 5                                  │
│  5. ANSWER: Synthesize final response                │
└─────────────────────────────────────────────────────┘
```

### 5.3 Tool Definitions

```typescript
const AGENT_TOOLS: AgentTool[] = [
  {
    name: "qdrant_search",
    description: "Semantic similarity search across raw materials, FDA ingredients, or sales data. Use for fuzzy/conceptual queries like 'find anti-aging ingredients' or 'natural preservatives similar to X'.",
    parameters: {
      query: "string — natural language search query",
      collection: "string — 'raw_materials_console' | 'raw_materials_fda' | 'raw_materials_stock' | 'sales_rnd'",
      filters: "object? — payload filters e.g. {stock_status: 'in_stock', cost: {lt: 50}}",
      top_k: "number? — max results, default 5"
    }
  },
  {
    name: "mongo_query",
    description: "Direct database query for exact lookups, aggregations, and structured data retrieval. Use when you need specific records by code/name/ID, counts, lists, or filtered results that don't need semantic matching.",
    parameters: {
      collection: "string — MongoDB collection name",
      operation: "string — 'find' | 'findOne' | 'aggregate' | 'count'",
      filter: "object — MongoDB query filter",
      projection: "object? — fields to include/exclude",
      sort: "object? — sort order",
      limit: "number? — max results"
    }
  },
  {
    name: "formula_calculate",
    description: "Calculate batch costs, scale formulations, convert units, or compute ingredient percentages. Use for any math-related query about formulas or costs.",
    parameters: {
      operation: "string — 'batch_cost' | 'scale_formula' | 'unit_convert' | 'ingredient_percentage'",
      formula_id: "string? — formula identifier for lookups",
      batch_size: "number? — target batch size",
      unit: "string? — target unit (kg, g, lb, ton)",
      ingredients: "object[]? — manual ingredient list with quantities and costs"
    }
  },
  {
    name: "web_search",
    description: "Search the web for current information, trends, competitor analysis, regulatory updates, or any data not in our database. Use when the query requires fresh, external information.",
    parameters: {
      query: "string — search query",
      max_results: "number? — default 5"
    }
  },
  {
    name: "context_memory",
    description: "Retrieve conversation history and user preferences from the current session. Use when the user references something discussed earlier or when personalizing recommendations.",
    parameters: {
      session_id: "string — current session identifier",
      lookback: "number? — how many prior turns to retrieve, default 5"
    }
  }
]
```

### 5.4 Gemini Function Calling Integration

The ReAct loop uses Gemini's native function calling (tool use) capability:

```typescript
// System prompt instructs chain-of-thought reasoning
const REACT_SYSTEM_PROMPT = `
You are an AI assistant for R&D cosmetic ingredient management.

REASONING PROCESS:
Before answering any question, think step-by-step:

1. CLASSIFY the query type:
   - EXACT_LOOKUP: specific code, name, or ID → use mongo_query
   - SEMANTIC_SEARCH: fuzzy, conceptual, "find similar" → use qdrant_search
   - CALCULATION: math, costs, scaling, percentages → use formula_calculate
   - EXTERNAL_INFO: trends, news, competitor data → use web_search
   - MULTI_STEP: needs multiple tools in sequence

2. PLAN your tool calls:
   - Which tools, in what order?
   - What filters or parameters?
   - When to stop (enough information to answer)?

3. EXECUTE and OBSERVE:
   - Call tools one at a time
   - Evaluate each result before deciding next action
   - Stop when you have sufficient information

4. SYNTHESIZE:
   - Combine all observations into a clear, structured answer
   - Cite sources (which collection/tool provided each fact)
   - Flag uncertainty when data is incomplete

TOOL SELECTION GUIDE:
- "What is the cost of RM-1234?" → mongo_query (exact lookup)
- "Find me anti-aging ingredients" → qdrant_search (semantic)
- "Calculate cost for 500kg of formula F-201" → formula_calculate
- "What's trending in K-beauty?" → web_search
- "Compare retinol suppliers" → mongo_query (aggregate) then format
- "Find a cheap natural preservative in stock" → qdrant_search with filters
`

// Gemini API call with function calling
const response = await gemini.generateContent({
  model: "gemini-2.0-flash",
  contents: conversationHistory,
  systemInstruction: REACT_SYSTEM_PROMPT,
  tools: [{ functionDeclarations: AGENT_TOOLS }],
  toolConfig: {
    functionCallingConfig: {
      mode: "AUTO"  // Gemini decides when to call tools
    }
  }
})
```

### 5.5 ReAct Agent Service

```typescript
class ReactAgentService {
  private qdrantService: QdrantService
  private qdrantRagService: QdrantRAGService
  private embeddingService: UniversalEmbeddingService
  private mongoClient: MongoClient
  private geminiModel: GenerativeModel

  /** Execute a full ReAct loop for a user query */
  async execute(query: string, sessionId: string): AsyncGenerator<StreamChunk>

  /** Process a single tool call from Gemini */
  private async executeTool(toolCall: FunctionCall): Promise<ToolResult>

  /** Route to correct tool handler */
  private async handleQdrantSearch(params: QdrantSearchParams): Promise<SearchResult[]>
  private async handleMongoQuery(params: MongoQueryParams): Promise<Document[]>
  private async handleFormulaCalculate(params: FormulaCalcParams): Promise<CalculationResult>
  private async handleWebSearch(params: WebSearchParams): Promise<WebResult[]>
  private async handleContextMemory(params: ContextParams): Promise<ConversationTurn[]>

  /** Stream the final synthesized response */
  private async streamResponse(response: GenerateContentResponse): AsyncGenerator<StreamChunk>
}
```

### 5.6 Multi-Step Example Flow

```
User: "Find me a natural preservative under $50/kg that's in stock,
       and compare it with what competitors are using"

THOUGHT 1: This needs two steps — internal search + external research.
           First, semantic search for natural preservatives with filters.

ACTION 1: qdrant_search({
  query: "natural preservative cosmetic",
  collection: "raw_materials_console",
  filters: { stock_status: "in_stock", cost: { lt: 50 } },
  top_k: 5
})

OBSERVATION 1: Found 3 matches:
  - Leucidal Liquid SF ($38/kg, natural antimicrobial)
  - Naticide ($42/kg, plant-derived preservative)
  - Geogard ECT ($29/kg, broad-spectrum natural)

THOUGHT 2: Good internal results. Now I need competitor data.

ACTION 2: web_search({
  query: "natural preservatives cosmetic industry 2026 trends competitors"
})

OBSERVATION 2: Industry trending toward multi-hurdle preservation,
               Phenoxyethanol alternatives, fermentation-derived options...

THOUGHT 3: I have both internal inventory and market context. Ready to answer.

ANSWER: "Here are 3 natural preservatives in stock under $50/kg:
         1. Geogard ECT ($29/kg) — best value...
         2. Leucidal Liquid SF ($38/kg) — trending in clean beauty...
         3. Naticide ($42/kg) — plant-derived...

         Industry comparison: Competitors are moving toward
         fermentation-derived preservatives and multi-hurdle approaches..."
```

### 5.7 File Structure for ReAct Agent

```
apps/ai/
├── agents/
│   ├── react/
│   │   ├── react-agent-service.ts        — main ReAct loop + streaming
│   │   ├── react-system-prompt.ts        — system instructions + tool guide
│   │   ├── tool-definitions.ts           — Gemini function declarations
│   │   └── tool-handlers/
│   │       ├── qdrant-search-handler.ts  — vector search tool
│   │       ├── mongo-query-handler.ts    — direct DB query tool
│   │       ├── formula-calc-handler.ts   — math/cost calculations
│   │       ├── web-search-handler.ts     — external web search
│   │       └── context-memory-handler.ts — conversation history
│   ├── raw-materials-ai/                 — existing (will use ReactAgentService)
│   └── sales-rnd-ai/                    — existing (will use ReactAgentService)
```

---

## 6. Deployment Flow

### 6.1 Phase 1: Infrastructure Provisioning

1. Create DO Managed MongoDB ($15/mo, same region as droplet)
2. Create 4GB droplet with Docker pre-installed
3. Configure VPC for private networking between droplet and MongoDB
4. Set up firewall: SSH(22) + HTTP(80) + HTTPS(443)
5. Add 2GB swap file on droplet
6. Install Docker Compose on droplet

### 6.2 Phase 2: Data Migration (Atlas → DO MongoDB)

1. `mongodump` from Atlas (all collections)
2. `mongorestore` to DO Managed MongoDB via private network
3. Verify document counts match
4. Update connection strings in `.env`

### 6.3 Phase 3: Deploy Application Stack

1. Clone repo to droplet (or rsync build artifacts)
2. Configure `.env` with:
   - DO MongoDB private URI
   - Qdrant internal URL (`http://qdrant:6333`)
   - All API keys (Gemini, OpenAI)
3. `docker compose up -d` (web + ai + qdrant)
4. Wait for health checks to pass

### 6.4 Phase 4: Re-Index Into Qdrant

1. Run `index-qdrant.ts` script:
   - Connect to DO MongoDB
   - Read all raw materials documents
   - Generate embeddings via Gemini API (batch 100)
   - Upsert into Qdrant with typed payloads
   - ~31K docs, ~5-10 minutes
2. Verify collection counts: `GET /collections/{name}`
3. Run smoke test queries to validate search accuracy

### 6.5 Phase 5: Cutover

1. Test all AI routes (raw-materials-agent, enhanced-chat, etc.)
2. Verify ReAct agent tool routing with test queries
3. Update DNS or share droplet IP
4. Decommission Atlas cluster
5. Remove ChromaDB references from codebase

---

## 7. Environment Variables (Updated)

```bash
# DO Managed MongoDB (private network URI)
MONGODB_URI=mongodb+srv://doadmin:password@db-mongodb-sgp1-xxxxx.mongo.ondigitalocean.com/rnd_ai?tls=true&authSource=admin
RAW_MATERIALS_REAL_STOCK_MONGODB_URI=mongodb+srv://doadmin:password@db-mongodb-sgp1-xxxxx.mongo.ondigitalocean.com/raw_materials?tls=true&authSource=admin

# Qdrant (internal Docker network)
QDRANT_URL=http://qdrant:6333
QDRANT_API_KEY=  # empty for local, set if using Qdrant Cloud later

# AI API Keys
GEMINI_API_KEY=your-gemini-api-key
OPENAI_API_KEY=your-openai-api-key

# Client-side (build-time only)
NEXT_PUBLIC_GEMINI_API_KEY=your-gemini-api-key
NEXT_PUBLIC_OPENAI_API_KEY=your-openai-api-key
NEXT_PUBLIC_API_URL=https://your-domain.com/api

# Admin
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=strong_password_here

# Application
NODE_ENV=production
PORT=3000
AI_SERVICE_PORT=3001
AI_SERVICE_URL=http://ai:3001
WEB_APP_URL=http://web:3000
NEXT_TELEMETRY_DISABLED=1
HOSTNAME=0.0.0.0
```

---

## 8. Docker Compose (Updated)

```yaml
version: '3.8'

services:
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    container_name: rnd-ai-web
    mem_limit: 768m
    ports:
      - "3000:3000"
    environment:
      - MONGODB_URI=${MONGODB_URI}
      - RAW_MATERIALS_REAL_STOCK_MONGODB_URI=${RAW_MATERIALS_REAL_STOCK_MONGODB_URI}
      - AI_SERVICE_URL=http://ai:3001
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ADMIN_EMAIL=${ADMIN_EMAIL}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - NODE_ENV=production
      - NEXT_TELEMETRY_DISABLED=1
    depends_on:
      qdrant:
        condition: service_healthy
      ai:
        condition: service_started
    networks:
      - rnd-ai-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  ai:
    build:
      context: .
      dockerfile: Dockerfile.ai
    container_name: rnd-ai-service
    mem_limit: 768m
    ports:
      - "3001:3001"
    environment:
      - MONGODB_URI=${MONGODB_URI}
      - RAW_MATERIALS_REAL_STOCK_MONGODB_URI=${RAW_MATERIALS_REAL_STOCK_MONGODB_URI}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - QDRANT_URL=http://qdrant:6333
      - AI_SERVICE_PORT=3001
      - WEB_APP_URL=http://web:3000
      - NODE_ENV=production
    depends_on:
      qdrant:
        condition: service_healthy
    networks:
      - rnd-ai-network
    restart: unless-stopped

  qdrant:
    image: qdrant/qdrant:latest
    container_name: rnd-ai-qdrant
    mem_limit: 512m
    ports:
      - "127.0.0.1:6333:6333"
      - "127.0.0.1:6334:6334"
    environment:
      - QDRANT__STORAGE__ON_DISK_PAYLOAD=true
      - QDRANT__STORAGE__OPTIMIZERS__MEMMAP_THRESHOLD_KB=20000
      - QDRANT__SERVICE__GRPC_PORT=6334
    volumes:
      - qdrant-data:/qdrant/storage
    networks:
      - rnd-ai-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:6333/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

networks:
  rnd-ai-network:
    driver: bridge
    name: rnd-ai-network

volumes:
  qdrant-data:
    driver: local
    name: rnd-ai-qdrant-data
```

---

## 9. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| 4GB RAM too tight | Swap (2GB) + on-disk payloads + mem_limit per container |
| Qdrant data loss | Docker volume persistence + periodic snapshot to DO Spaces |
| Re-indexing cost | ~31K docs × Gemini embedding = ~$0.10. Negligible. |
| MongoDB migration data loss | mongodump/restore is atomic. Verify counts before cutover. |
| Gemini API rate limits during re-index | Batch 100 docs, 1s delay between batches |
| Droplet SSH access | SSH key only, no password auth, fail2ban |

---

## 10. Success Criteria

1. All services healthy on droplet (`docker compose ps` — all UP)
2. Qdrant collections have correct document counts (31K+ raw_materials_fda, 3K+ stock, sales_rnd)
3. RAG query accuracy improved vs ChromaDB (test with 10 known-good queries)
4. ReAct agent correctly routes: exact lookup → mongo, semantic → qdrant, math → calc, fresh data → web
5. Response latency < 3s for single-tool queries, < 8s for multi-tool chains
6. Total monthly cost: ~$39 (droplet $24 + MongoDB $15)
7. Zero exposed ports except 80/443/22

---

## 11. Out of Scope (Future)

- Neo4j knowledge graph (add when droplet upgraded or clear graph use cases emerge)
- SSL/TLS termination (Nginx reverse proxy or Caddy — separate task)
- CI/CD pipeline (GitHub Actions → droplet deploy)
- Monitoring/alerting (Grafana/Prometheus)
- Multi-droplet scaling
- Qdrant Cloud migration (if self-hosted becomes maintenance burden)
