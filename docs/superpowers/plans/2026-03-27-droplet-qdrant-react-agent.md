# DO Droplet + Qdrant + ReAct Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the R&D AI Management stack to a DigitalOcean droplet with Qdrant replacing ChromaDB, DO Managed MongoDB replacing Atlas, and a ReAct agent with chain-of-thought tool routing.

**Architecture:** Single 4GB droplet running web (Next.js), AI backend (Node.js), and Qdrant (vector DB) in Docker containers, connected to DO Managed MongoDB via private VPC. The AI layer uses a ReAct pattern where Gemini function calling drives tool selection (qdrant_search, mongo_query, formula_calculate, web_search, context_memory) instead of routing everything through RAG.

**Tech Stack:** TypeScript, Next.js 14, Qdrant (Docker), DO Managed MongoDB, Gemini 2.0 Flash (function calling), Docker Compose, DigitalOcean API

**Spec:** `docs/superpowers/specs/2026-03-27-droplet-qdrant-react-agent-design.md`

---

## File Structure

### New Files
```
apps/ai/services/vector/qdrant-service.ts          — Low-level Qdrant client (upsert, search, delete, health)
apps/ai/services/rag/qdrant-rag-service.ts          — High-level RAG operations (embed → search → format)
apps/ai/config/qdrant-config.ts                     — Collection schemas, HNSW tuning, connection config
apps/ai/agents/react/react-agent-service.ts         — ReAct reasoning loop with streaming
apps/ai/agents/react/react-system-prompt.ts         — System instructions + tool routing guide
apps/ai/agents/react/tool-definitions.ts            — Gemini function declarations for all tools
apps/ai/agents/react/tool-handlers/qdrant-search-handler.ts   — Vector search tool handler
apps/ai/agents/react/tool-handlers/mongo-query-handler.ts     — Direct DB query tool handler
apps/ai/agents/react/tool-handlers/formula-calc-handler.ts    — Math/cost calculation tool handler
apps/ai/agents/react/tool-handlers/web-search-handler.ts      — External web search tool handler
apps/ai/agents/react/tool-handlers/context-memory-handler.ts  — Conversation history tool handler
apps/ai/scripts/index-qdrant.ts                     — Re-indexing script (MongoDB → Qdrant)
scripts/provision-droplet.sh                        — DO API droplet + MongoDB provisioning
```

### Modified Files
```
apps/ai/package.json                                — Add @qdrant/js-client-rest, remove chromadb
apps/ai/services/rag/enhanced-hybrid-search-service.ts — Swap ChromaService → QdrantService
apps/ai/server/routers/rag.ts                       — Update imports, add react-agent endpoint
apps/ai/server/services/auto-index-service.ts       — Target Qdrant instead of ChromaDB
apps/ai/server/index.ts                             — Register new router
apps/ai/config/rag-config.ts                        — Update provider references
apps/web/app/api/ai/raw-materials-agent/route.ts    — Wire ReactAgentService
apps/web/app/api/ai/enhanced-chat/route.ts          — Wire ReactAgentService
docker-compose.yml                                  — Replace chromadb with qdrant, add mem_limit
.env.production                                     — QDRANT_URL, DO MongoDB URI
scripts/deploy-droplet.sh                           — Updated health checks, qdrant references
package.json                                        — Update scripts (index:qdrant replaces index:chromadb)
CHANGELOG.md                                        — Document all changes
```

### Deleted Files
```
apps/ai/services/vector/chroma-service.ts           — Replaced by qdrant-service.ts
apps/ai/services/rag/chroma-rag-service.ts          — Replaced by qdrant-rag-service.ts
apps/ai/services/rag/pinecone-service-stub.ts       — Dead compatibility layer
apps/ai/scripts/index-chromadb-simple.ts            — Replaced by index-qdrant.ts
```

---

## Task 1: Install Qdrant Client and Remove ChromaDB

**Files:**
- Modify: `apps/ai/package.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Add @qdrant/js-client-rest dependency**

```bash
cd /Users/naruebet.orgl/Workspace/Labs/rnd_webapp/rnd_ai_management
npm install @qdrant/js-client-rest --workspace=apps/ai --legacy-peer-deps
```

- [ ] **Step 2: Remove chromadb dependency**

```bash
npm uninstall chromadb --workspace=apps/ai --legacy-peer-deps
```

- [ ] **Step 3: Update root package.json scripts — replace chromadb references with qdrant**

In `package.json` (root), replace:
```json
"index:chromadb": "npm run index:chromadb --workspace=apps/ai",
"index:chromadb:resume": "npm run index:chromadb:resume --workspace=apps/ai",
"index:chromadb:fast": "npm run index:chromadb:fast --workspace=apps/ai",
"check:chromadb": "npm run check:chromadb --workspace=apps/ai"
```

With:
```json
"index:qdrant": "npm run index:qdrant --workspace=apps/ai",
"check:qdrant": "npm run check:qdrant --workspace=apps/ai"
```

- [ ] **Step 4: Update apps/ai/package.json scripts**

In `apps/ai/package.json`, replace:
```json
"index:chromadb": "tsx scripts/index-chromadb-simple.ts",
"index:chromadb:resume": "tsx scripts/index-chromadb-resume.ts",
"index:chromadb:fast": "tsx scripts/index-chromadb-resume-fast.ts",
"check:chromadb": "tsx scripts/check-chromadb-count.ts"
```

With:
```json
"index:qdrant": "tsx scripts/index-qdrant.ts",
"check:qdrant": "tsx scripts/check-qdrant.ts"
```

- [ ] **Step 5: Commit**

```bash
git add apps/ai/package.json package.json package-lock.json
git commit -m "deps: Replace chromadb with @qdrant/js-client-rest"
```

---

## Task 2: Create Qdrant Configuration

**Files:**
- Create: `apps/ai/config/qdrant-config.ts`

- [ ] **Step 1: Create the Qdrant configuration file**

```typescript
/**
 * Qdrant vector database configuration.
 * Defines collection schemas, HNSW tuning, and connection settings.
 *
 * @module qdrant-config
 */

import { SchemaFor } from '@qdrant/js-client-rest';

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export interface QdrantConnectionConfig {
  /** Qdrant REST API URL — sourced from QDRANT_URL env var */
  url: string;
  /** Optional API key for Qdrant Cloud (empty for local Docker) */
  apiKey?: string;
}

/**
 * Build connection config from environment variables.
 * @returns QdrantConnectionConfig with url and optional apiKey
 */
export function get_qdrant_connection_config(): QdrantConnectionConfig {
  console.log('[qdrant-config] get_qdrant_connection_config: start');
  const config: QdrantConnectionConfig = {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY || undefined,
  };
  console.log(`[qdrant-config] get_qdrant_connection_config: url=${config.url}, hasApiKey=${!!config.apiKey}`);
  return config;
}

// ---------------------------------------------------------------------------
// Collection schemas
// ---------------------------------------------------------------------------

/** Vector dimension from Gemini text-embedding-004 */
export const VECTOR_DIMENSION = 768;

/** Distance metric — cosine for normalised Gemini embeddings */
export const DISTANCE_METRIC = 'Cosine' as const;

export interface CollectionSchema {
  name: string;
  description: string;
  vectorSize: number;
  distance: 'Cosine' | 'Euclid' | 'Dot';
  hnswConfig: {
    m: number;
    efConstruct: number;
    fullScanThreshold: number;
  };
  onDiskPayload: boolean;
  payloadIndexes: Array<{
    fieldName: string;
    fieldSchema: 'keyword' | 'integer' | 'float' | 'text' | 'bool' | 'datetime';
  }>;
}

/**
 * All Qdrant collection schemas used by the application.
 * Each collection stores embeddings + typed payloads for a specific domain.
 */
export const QDRANT_COLLECTIONS: Record<string, CollectionSchema> = {
  raw_materials_console: {
    name: 'raw_materials_console',
    description: 'Primary raw materials database (all sources merged)',
    vectorSize: VECTOR_DIMENSION,
    distance: DISTANCE_METRIC,
    hnswConfig: { m: 16, efConstruct: 128, fullScanThreshold: 10000 },
    onDiskPayload: true,
    payloadIndexes: [
      { fieldName: 'rm_code', fieldSchema: 'keyword' },
      { fieldName: 'trade_name', fieldSchema: 'keyword' },
      { fieldName: 'inci_name', fieldSchema: 'text' },
      { fieldName: 'supplier', fieldSchema: 'keyword' },
      { fieldName: 'source', fieldSchema: 'keyword' },
      { fieldName: 'stock_status', fieldSchema: 'keyword' },
      { fieldName: 'cost', fieldSchema: 'float' },
      { fieldName: 'indexed_at', fieldSchema: 'datetime' },
    ],
  },

  raw_materials_fda: {
    name: 'raw_materials_fda',
    description: 'FDA-registered raw materials (~31,179 items)',
    vectorSize: VECTOR_DIMENSION,
    distance: DISTANCE_METRIC,
    hnswConfig: { m: 16, efConstruct: 128, fullScanThreshold: 10000 },
    onDiskPayload: true,
    payloadIndexes: [
      { fieldName: 'rm_code', fieldSchema: 'keyword' },
      { fieldName: 'trade_name', fieldSchema: 'keyword' },
      { fieldName: 'inci_name', fieldSchema: 'text' },
      { fieldName: 'supplier', fieldSchema: 'keyword' },
      { fieldName: 'source', fieldSchema: 'keyword' },
      { fieldName: 'cost', fieldSchema: 'float' },
      { fieldName: 'indexed_at', fieldSchema: 'datetime' },
    ],
  },

  raw_materials_stock: {
    name: 'raw_materials_stock',
    description: 'In-stock materials (~3,111 items)',
    vectorSize: VECTOR_DIMENSION,
    distance: DISTANCE_METRIC,
    hnswConfig: { m: 16, efConstruct: 128, fullScanThreshold: 10000 },
    onDiskPayload: true,
    payloadIndexes: [
      { fieldName: 'rm_code', fieldSchema: 'keyword' },
      { fieldName: 'trade_name', fieldSchema: 'keyword' },
      { fieldName: 'inci_name', fieldSchema: 'text' },
      { fieldName: 'supplier', fieldSchema: 'keyword' },
      { fieldName: 'stock_status', fieldSchema: 'keyword' },
      { fieldName: 'cost', fieldSchema: 'float' },
      { fieldName: 'indexed_at', fieldSchema: 'datetime' },
    ],
  },

  sales_rnd: {
    name: 'sales_rnd',
    description: 'Sales strategy and market intelligence data',
    vectorSize: VECTOR_DIMENSION,
    distance: DISTANCE_METRIC,
    hnswConfig: { m: 16, efConstruct: 128, fullScanThreshold: 10000 },
    onDiskPayload: true,
    payloadIndexes: [
      { fieldName: 'product_name', fieldSchema: 'keyword' },
      { fieldName: 'category', fieldSchema: 'keyword' },
      { fieldName: 'region', fieldSchema: 'keyword' },
      { fieldName: 'indexed_at', fieldSchema: 'datetime' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Search defaults
// ---------------------------------------------------------------------------

export interface QdrantSearchDefaults {
  topK: number;
  scoreThreshold: number;
  ef: number;
  withPayload: boolean;
}

export const SEARCH_DEFAULTS: Record<string, QdrantSearchDefaults> = {
  raw_materials_console: { topK: 5, scoreThreshold: 0.7, ef: 128, withPayload: true },
  raw_materials_fda: { topK: 5, scoreThreshold: 0.7, ef: 128, withPayload: true },
  raw_materials_stock: { topK: 5, scoreThreshold: 0.7, ef: 128, withPayload: true },
  sales_rnd: { topK: 8, scoreThreshold: 0.65, ef: 128, withPayload: true },
};

/**
 * Get search defaults for a collection.
 * @param collectionName - Name of the Qdrant collection
 * @returns QdrantSearchDefaults for the given collection
 */
export function get_search_defaults(collectionName: string): QdrantSearchDefaults {
  console.log(`[qdrant-config] get_search_defaults: collection=${collectionName}`);
  return SEARCH_DEFAULTS[collectionName] || SEARCH_DEFAULTS.raw_materials_console;
}

// ---------------------------------------------------------------------------
// Batch processing
// ---------------------------------------------------------------------------

/** Max points per upsert batch — balances speed vs memory on 4GB droplet */
export const UPSERT_BATCH_SIZE = 100;

/** Delay between embedding API batches (ms) — respect Gemini rate limits */
export const EMBEDDING_BATCH_DELAY_MS = 1000;
```

- [ ] **Step 2: Commit**

```bash
git add apps/ai/config/qdrant-config.ts
git commit -m "feat: Add Qdrant collection schemas and config"
```

---

## Task 3: Create QdrantService (Low-Level Vector Client)

**Files:**
- Create: `apps/ai/services/vector/qdrant-service.ts`

- [ ] **Step 1: Create the Qdrant service**

```typescript
/**
 * Low-level Qdrant vector database service.
 * Provides CRUD operations for points (vectors + payloads) and collection management.
 * Uses singleton pattern with lazy initialisation to avoid Next.js bundling issues.
 *
 * @module qdrant-service
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import {
  get_qdrant_connection_config,
  CollectionSchema,
  QDRANT_COLLECTIONS,
} from '../../config/qdrant-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QdrantPoint {
  /** Unique point identifier */
  id: string;
  /** Embedding vector */
  vector: number[];
  /** Typed payload (metadata) */
  payload: Record<string, unknown>;
}

export interface QdrantSearchOptions {
  /** Maximum results to return */
  topK: number;
  /** Minimum cosine similarity score (0–1) */
  scoreThreshold?: number;
  /** Qdrant filter object for pre-filtering */
  filter?: Record<string, unknown>;
  /** HNSW search-time ef parameter — higher = better recall, slower */
  ef?: number;
  /** Which payload fields to return (true = all, array = specific fields) */
  withPayload?: boolean | string[];
}

export interface QdrantSearchResult {
  /** Point identifier */
  id: string;
  /** Cosine similarity score (0–1) */
  score: number;
  /** Payload fields */
  payload: Record<string, unknown>;
  /** Original vector (only if requested) */
  vector?: number[];
}

export interface QdrantCollectionInfo {
  /** Total point count */
  pointsCount: number;
  /** Collection status */
  status: string;
  /** Vector configuration */
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: QdrantService | null = null;

/**
 * Get or create the singleton QdrantService instance.
 * @returns QdrantService singleton
 */
export function get_qdrant_service(): QdrantService {
  console.log('[qdrant-service] get_qdrant_service: start');
  if (!_instance) {
    console.log('[qdrant-service] get_qdrant_service: creating new instance');
    _instance = new QdrantService();
  }
  console.log('[qdrant-service] get_qdrant_service: done');
  return _instance;
}

/**
 * Reset the singleton (for testing).
 */
export function reset_qdrant_service(): void {
  console.log('[qdrant-service] reset_qdrant_service: clearing singleton');
  _instance = null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class QdrantService {
  private client: QdrantClient | null = null;
  private initialised = false;
  private initialisationPromise: Promise<void> | null = null;

  /**
   * Lazy-initialise the Qdrant client.
   * Safe to call multiple times — only the first call creates the client.
   */
  async ensure_initialised(): Promise<void> {
    if (this.initialised) return;
    if (this.initialisationPromise) return this.initialisationPromise;

    this.initialisationPromise = this._initialise();
    await this.initialisationPromise;
  }

  private async _initialise(): Promise<void> {
    console.log('[qdrant-service] _initialise: start');
    const config = get_qdrant_connection_config();

    this.client = new QdrantClient({
      url: config.url,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    });

    this.initialised = true;
    console.log(`[qdrant-service] _initialise: connected to ${config.url}`);
  }

  /**
   * Get the underlying Qdrant client (throws if not initialised).
   * @returns QdrantClient instance
   */
  private get_client(): QdrantClient {
    if (!this.client) {
      throw new Error('QdrantService not initialised. Call ensure_initialised() first.');
    }
    return this.client;
  }

  // -------------------------------------------------------------------------
  // Collection management
  // -------------------------------------------------------------------------

  /**
   * Ensure a collection exists with the correct schema and payload indexes.
   * Idempotent — skips creation if the collection already exists.
   *
   * @param schema - CollectionSchema from qdrant-config
   */
  async ensure_collection(schema: CollectionSchema): Promise<void> {
    console.log(`[qdrant-service] ensure_collection: name=${schema.name}, start`);
    await this.ensure_initialised();
    const client = this.get_client();

    const collections = await client.getCollections();
    const exists = collections.collections.some((c) => c.name === schema.name);

    if (!exists) {
      console.log(`[qdrant-service] ensure_collection: creating ${schema.name}`);
      await client.createCollection(schema.name, {
        vectors: {
          size: schema.vectorSize,
          distance: schema.distance,
        },
        hnsw_config: {
          m: schema.hnswConfig.m,
          ef_construct: schema.hnswConfig.efConstruct,
          full_scan_threshold: schema.hnswConfig.fullScanThreshold,
        },
        on_disk_payload: schema.onDiskPayload,
      });

      // Create payload indexes
      for (const idx of schema.payloadIndexes) {
        console.log(`[qdrant-service] ensure_collection: creating index ${schema.name}.${idx.fieldName}`);
        await client.createPayloadIndex(schema.name, {
          field_name: idx.fieldName,
          field_schema: idx.fieldSchema,
        });
      }
    }

    console.log(`[qdrant-service] ensure_collection: name=${schema.name}, done`);
  }

  /**
   * Ensure all application collections exist.
   */
  async ensure_all_collections(): Promise<void> {
    console.log('[qdrant-service] ensure_all_collections: start');
    for (const schema of Object.values(QDRANT_COLLECTIONS)) {
      await this.ensure_collection(schema);
    }
    console.log('[qdrant-service] ensure_all_collections: done');
  }

  /**
   * Delete a collection by name.
   * @param name - Collection name
   */
  async delete_collection(name: string): Promise<void> {
    console.log(`[qdrant-service] delete_collection: name=${name}`);
    await this.ensure_initialised();
    await this.get_client().deleteCollection(name);
    console.log(`[qdrant-service] delete_collection: name=${name}, done`);
  }

  // -------------------------------------------------------------------------
  // Point operations
  // -------------------------------------------------------------------------

  /**
   * Batch upsert points into a collection.
   * Automatically chunks into batches of 100 for memory efficiency.
   *
   * @param collectionName - Target collection
   * @param points - Array of QdrantPoint (id, vector, payload)
   */
  async upsert(collectionName: string, points: QdrantPoint[]): Promise<void> {
    console.log(`[qdrant-service] upsert: collection=${collectionName}, points=${points.length}, start`);
    await this.ensure_initialised();
    const client = this.get_client();
    const batchSize = 100;

    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await client.upsert(collectionName, {
        wait: true,
        points: batch.map((p) => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload,
        })),
      });
      console.log(`[qdrant-service] upsert: collection=${collectionName}, batch ${Math.floor(i / batchSize) + 1}, ${batch.length} points`);
    }

    console.log(`[qdrant-service] upsert: collection=${collectionName}, done`);
  }

  /**
   * Semantic search with pre-filtering and score threshold.
   *
   * @param collectionName - Collection to search
   * @param vector - Query embedding vector
   * @param options - Search parameters (topK, scoreThreshold, filter, ef)
   * @returns Array of QdrantSearchResult sorted by score descending
   */
  async search(
    collectionName: string,
    vector: number[],
    options: QdrantSearchOptions,
  ): Promise<QdrantSearchResult[]> {
    console.log(`[qdrant-service] search: collection=${collectionName}, topK=${options.topK}, start`);
    await this.ensure_initialised();
    const client = this.get_client();

    const results = await client.search(collectionName, {
      vector,
      limit: options.topK,
      score_threshold: options.scoreThreshold,
      filter: options.filter as any,
      params: options.ef ? { hnsw_ef: options.ef } : undefined,
      with_payload: options.withPayload ?? true,
    });

    const mapped: QdrantSearchResult[] = results.map((r) => ({
      id: typeof r.id === 'string' ? r.id : String(r.id),
      score: r.score,
      payload: (r.payload as Record<string, unknown>) || {},
    }));

    console.log(`[qdrant-service] search: collection=${collectionName}, results=${mapped.length}, done`);
    return mapped;
  }

  /**
   * Delete points by ID array or filter.
   *
   * @param collectionName - Collection name
   * @param idsOrFilter - Array of point IDs or a Qdrant filter object
   */
  async delete(
    collectionName: string,
    idsOrFilter: string[] | Record<string, unknown>,
  ): Promise<void> {
    console.log(`[qdrant-service] delete: collection=${collectionName}, start`);
    await this.ensure_initialised();
    const client = this.get_client();

    if (Array.isArray(idsOrFilter)) {
      await client.delete(collectionName, { wait: true, points: idsOrFilter });
    } else {
      await client.delete(collectionName, { wait: true, filter: idsOrFilter as any });
    }

    console.log(`[qdrant-service] delete: collection=${collectionName}, done`);
  }

  // -------------------------------------------------------------------------
  // Info & health
  // -------------------------------------------------------------------------

  /**
   * Get collection info (point count, status, config).
   * @param collectionName - Collection name
   * @returns QdrantCollectionInfo
   */
  async get_collection_info(collectionName: string): Promise<QdrantCollectionInfo> {
    console.log(`[qdrant-service] get_collection_info: collection=${collectionName}`);
    await this.ensure_initialised();
    const info = await this.get_client().getCollection(collectionName);

    return {
      pointsCount: info.points_count || 0,
      status: info.status,
      config: info.config as unknown as Record<string, unknown>,
    };
  }

  /**
   * Health check — returns true if Qdrant is reachable and responsive.
   * @returns boolean
   */
  async health_check(): Promise<boolean> {
    console.log('[qdrant-service] health_check: start');
    try {
      await this.ensure_initialised();
      await this.get_client().getCollections();
      console.log('[qdrant-service] health_check: healthy');
      return true;
    } catch (err) {
      console.error('[qdrant-service] health_check: unhealthy', err);
      return false;
    }
  }

  /**
   * Scroll through all points in a collection (for verification/export).
   *
   * @param collectionName - Collection name
   * @param limit - Max points to return (default 10)
   * @param filter - Optional Qdrant filter
   * @returns Array of points with id and payload
   */
  async scroll(
    collectionName: string,
    limit = 10,
    filter?: Record<string, unknown>,
  ): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
    console.log(`[qdrant-service] scroll: collection=${collectionName}, limit=${limit}`);
    await this.ensure_initialised();

    const result = await this.get_client().scroll(collectionName, {
      limit,
      filter: filter as any,
      with_payload: true,
    });

    return result.points.map((p) => ({
      id: typeof p.id === 'string' ? p.id : String(p.id),
      payload: (p.payload as Record<string, unknown>) || {},
    }));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ai/services/vector/qdrant-service.ts
git commit -m "feat: Add QdrantService — low-level vector client with typed payloads"
```

---

## Task 4: Create QdrantRAGService (High-Level RAG)

**Files:**
- Create: `apps/ai/services/rag/qdrant-rag-service.ts`

- [ ] **Step 1: Create the Qdrant RAG service**

```typescript
/**
 * High-level RAG (Retrieval-Augmented Generation) service backed by Qdrant.
 * Handles: embedding generation → vector search → result formatting.
 * Drop-in replacement for ChromaRAGService.
 *
 * @module qdrant-rag-service
 */

import { get_qdrant_service, QdrantService, QdrantPoint, QdrantSearchResult, QdrantSearchOptions } from '../vector/qdrant-service';
import { createEmbeddingService, UniversalEmbeddingService } from '../embeddings/universal-embedding-service';
import {
  QDRANT_COLLECTIONS,
  get_search_defaults,
  UPSERT_BATCH_SIZE,
  EMBEDDING_BATCH_DELAY_MS,
} from '../../config/qdrant-config';
import { getRAGConfig, RAGServicesConfig } from '../../config/rag-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawMaterialDocument {
  id: string;
  text: string;
  metadata: {
    rm_code?: string;
    trade_name?: string;
    inci_name?: string;
    supplier?: string;
    company_name?: string;
    rm_cost?: string;
    benefits?: string;
    details?: string;
    source?: string;
    stock_status?: string;
    [key: string]: unknown;
  };
}

export interface RAGSearchConfig {
  /** Max results */
  topK: number;
  /** Min similarity score (0–1) */
  similarityThreshold: number;
  /** Include payload in results */
  includeMetadata: boolean;
  /** Qdrant filter for pre-filtering */
  filter?: Record<string, unknown>;
  /** Override collection name */
  collectionName?: string;
}

export interface RAGSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
  document: string;
}

// ---------------------------------------------------------------------------
// Collection mapping (service name → Qdrant collection)
// ---------------------------------------------------------------------------

const SERVICE_COLLECTION_MAP: Record<string, string> = {
  rawMaterialsAllAI: 'raw_materials_fda',
  rawMaterialsAI: 'raw_materials_console',
  salesRndAI: 'sales_rnd',
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class QdrantRAGService {
  private qdrantService: QdrantService;
  private embeddingService: UniversalEmbeddingService;
  private collectionName: string;
  private config: RAGSearchConfig;

  /**
   * @param serviceName - Key from RAGServicesConfig to resolve collection + defaults
   * @param configOverride - Override default search config
   * @param customEmbeddingService - Optional custom embedding service
   */
  constructor(
    serviceName?: keyof RAGServicesConfig,
    configOverride?: Partial<RAGSearchConfig>,
    customEmbeddingService?: UniversalEmbeddingService,
  ) {
    console.log(`[qdrant-rag] constructor: serviceName=${serviceName || 'default'}, start`);

    this.qdrantService = get_qdrant_service();
    this.embeddingService = customEmbeddingService || createEmbeddingService();

    // Resolve collection name
    const svcKey = serviceName || 'rawMaterialsAI';
    this.collectionName = SERVICE_COLLECTION_MAP[svcKey] || 'raw_materials_console';

    // Build config from RAG defaults + Qdrant search defaults + overrides
    const ragDefaults = getRAGConfig(svcKey);
    const searchDefaults = get_search_defaults(this.collectionName);

    this.config = {
      topK: configOverride?.topK ?? ragDefaults.topK ?? searchDefaults.topK,
      similarityThreshold: configOverride?.similarityThreshold ?? ragDefaults.similarityThreshold ?? searchDefaults.scoreThreshold,
      includeMetadata: configOverride?.includeMetadata ?? true,
      filter: configOverride?.filter,
      collectionName: configOverride?.collectionName ?? this.collectionName,
    };

    console.log(`[qdrant-rag] constructor: collection=${this.collectionName}, topK=${this.config.topK}, done`);
  }

  // -------------------------------------------------------------------------
  // Embedding
  // -------------------------------------------------------------------------

  /**
   * Generate embeddings for an array of texts.
   * @param texts - Array of strings to embed
   * @returns 2D array of embedding vectors
   */
  async create_embeddings(texts: string[]): Promise<number[][]> {
    console.log(`[qdrant-rag] create_embeddings: count=${texts.length}, start`);
    const embeddings = await this.embeddingService.createEmbeddings(texts);
    console.log(`[qdrant-rag] create_embeddings: count=${texts.length}, done`);
    return embeddings;
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  /**
   * Search for similar documents using vector similarity.
   *
   * @param query - Natural language query
   * @param options - Override search config for this query
   * @returns Array of RAGSearchResult sorted by score descending
   */
  async search_similar(
    query: string,
    options?: Partial<RAGSearchConfig>,
  ): Promise<RAGSearchResult[]> {
    const mergedConfig = { ...this.config, ...options };
    const collection = mergedConfig.collectionName || this.collectionName;
    console.log(`[qdrant-rag] search_similar: query="${query.slice(0, 50)}...", collection=${collection}, start`);

    // Generate query embedding
    const [queryVector] = await this.create_embeddings([query]);

    // Search Qdrant
    const searchOptions: QdrantSearchOptions = {
      topK: mergedConfig.topK,
      scoreThreshold: mergedConfig.similarityThreshold,
      filter: mergedConfig.filter,
      ef: 128,
      withPayload: mergedConfig.includeMetadata,
    };

    const results = await this.qdrantService.search(collection, queryVector, searchOptions);

    const mapped: RAGSearchResult[] = results.map((r) => ({
      id: r.id,
      score: r.score,
      metadata: r.payload,
      document: (r.payload.details as string) || (r.payload.text as string) || '',
    }));

    console.log(`[qdrant-rag] search_similar: results=${mapped.length}, done`);
    return mapped;
  }

  /**
   * Search and format results as a markdown string for AI context injection.
   *
   * @param query - Natural language query
   * @param options - Override search config
   * @returns Formatted markdown string of results
   */
  async search_and_format(
    query: string,
    options?: Partial<RAGSearchConfig>,
  ): Promise<string> {
    console.log(`[qdrant-rag] search_and_format: query="${query.slice(0, 50)}...", start`);
    const results = await this.search_similar(query, options);
    const formatted = QdrantRAGService.format_search_results(results);
    console.log(`[qdrant-rag] search_and_format: done, length=${formatted.length}`);
    return formatted;
  }

  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------

  /**
   * Upsert documents into Qdrant with auto-generated embeddings.
   *
   * @param documents - Array of RawMaterialDocument to index
   */
  async upsert_documents(documents: RawMaterialDocument[]): Promise<void> {
    console.log(`[qdrant-rag] upsert_documents: count=${documents.length}, collection=${this.collectionName}, start`);

    // Ensure collection exists
    const schema = QDRANT_COLLECTIONS[this.collectionName];
    if (schema) {
      await this.qdrantService.ensure_collection(schema);
    }

    // Process in batches
    for (let i = 0; i < documents.length; i += UPSERT_BATCH_SIZE) {
      const batch = documents.slice(i, i + UPSERT_BATCH_SIZE);
      const texts = batch.map((d) => d.text);
      const embeddings = await this.create_embeddings(texts);

      const points: QdrantPoint[] = batch.map((doc, idx) => ({
        id: doc.id,
        vector: embeddings[idx],
        payload: {
          ...doc.metadata,
          details: doc.text,
          indexed_at: new Date().toISOString(),
        },
      }));

      await this.qdrantService.upsert(this.collectionName, points);
      console.log(`[qdrant-rag] upsert_documents: batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}, ${batch.length} docs`);

      // Rate limit delay between batches
      if (i + UPSERT_BATCH_SIZE < documents.length) {
        await new Promise((r) => setTimeout(r, EMBEDDING_BATCH_DELAY_MS));
      }
    }

    console.log(`[qdrant-rag] upsert_documents: done`);
  }

  /**
   * Batch process raw material records from MongoDB into Qdrant.
   *
   * @param materials - Array of MongoDB raw material documents
   * @param batchSize - Override batch size (default from config)
   */
  async batch_process_documents(
    materials: any[],
    batchSize?: number,
  ): Promise<void> {
    console.log(`[qdrant-rag] batch_process_documents: count=${materials.length}, start`);
    const docs = materials.map((m) => QdrantRAGService.prepare_raw_material_document(m));
    await this.upsert_documents(docs);
    console.log(`[qdrant-rag] batch_process_documents: done`);
  }

  /**
   * Delete documents by ID.
   * @param ids - Array of point IDs to delete
   */
  async delete_documents(ids: string[]): Promise<void> {
    console.log(`[qdrant-rag] delete_documents: count=${ids.length}, start`);
    await this.qdrantService.delete(this.collectionName, ids);
    console.log(`[qdrant-rag] delete_documents: done`);
  }

  /**
   * Get index stats (point count, status).
   * @returns Collection info
   */
  async get_index_stats(): Promise<{ pointsCount: number; status: string }> {
    console.log(`[qdrant-rag] get_index_stats: collection=${this.collectionName}`);
    const info = await this.qdrantService.get_collection_info(this.collectionName);
    return { pointsCount: info.pointsCount, status: info.status };
  }

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------

  /**
   * Update search config at runtime.
   * @param newConfig - Partial config to merge
   */
  update_config(newConfig: Partial<RAGSearchConfig>): void {
    console.log('[qdrant-rag] update_config:', newConfig);
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current search config.
   * @returns RAGSearchConfig
   */
  get_config(): RAGSearchConfig {
    return { ...this.config };
  }

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  /**
   * Convert a MongoDB raw material document into a RawMaterialDocument for indexing.
   *
   * @param material - MongoDB document with rm_code, trade_name, inci_name, etc.
   * @returns RawMaterialDocument ready for upsert
   */
  static prepare_raw_material_document(material: any): RawMaterialDocument {
    const rm_code = material.rm_code || material._id?.toString() || '';
    const trade_name = material.trade_name || '';
    const inci_name = material.inci_name || material.INCI_name || '';
    const supplier = material.supplier || '';
    const rm_cost = material.rm_cost != null ? String(material.rm_cost) : '';
    const func = material.Function || '';
    const benefits = Array.isArray(material.benefits)
      ? material.benefits.join(', ')
      : material.benefits_cached || material.benefits || '';
    const usecase = Array.isArray(material.usecase)
      ? material.usecase.join(', ')
      : material.usecase_cached || material.usecase || '';
    const description = material.Chem_IUPAC_Name_Description || '';

    const text = [
      `Code: ${rm_code}`,
      `INCI: ${inci_name}`,
      `Trade Name: ${trade_name}`,
      `Function: ${func}`,
      `Benefits: ${benefits}`,
      `Use Cases: ${usecase}`,
      `Description: ${description}`,
      `Supplier: ${supplier}`,
      `Cost: ${rm_cost}`,
    ]
      .filter((line) => !line.endsWith(': '))
      .join('\n');

    return {
      id: rm_code || material._id?.toString() || `mat_${Date.now()}`,
      text,
      metadata: {
        rm_code,
        trade_name,
        inci_name,
        supplier,
        rm_cost,
        benefits,
        details: text,
        source: material.source || 'console',
        stock_status: material.stock_status || 'unknown',
      },
    };
  }

  /**
   * Format search results as markdown for AI context injection.
   *
   * @param results - Array of RAGSearchResult
   * @returns Markdown-formatted string
   */
  static format_search_results(results: RAGSearchResult[]): string {
    if (!results.length) return 'No relevant materials found.';

    return results
      .map((r, i) => {
        const meta = r.metadata;
        return [
          `### Result ${i + 1} (Score: ${(r.score * 100).toFixed(1)}%)`,
          meta.rm_code ? `- **Code:** ${meta.rm_code}` : '',
          meta.trade_name ? `- **Trade Name:** ${meta.trade_name}` : '',
          meta.inci_name ? `- **INCI:** ${meta.inci_name}` : '',
          meta.supplier ? `- **Supplier:** ${meta.supplier}` : '',
          meta.rm_cost ? `- **Cost:** ${meta.rm_cost}` : '',
          meta.benefits ? `- **Benefits:** ${meta.benefits}` : '',
          meta.stock_status ? `- **Stock:** ${meta.stock_status}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');
  }
}

/** Backward-compatible alias */
export { QdrantRAGService as PineconeRAGService };
```

- [ ] **Step 2: Commit**

```bash
git add apps/ai/services/rag/qdrant-rag-service.ts
git commit -m "feat: Add QdrantRAGService — high-level RAG with embed/search/format"
```

---

## Task 5: Create ReAct Agent Tool Definitions

**Files:**
- Create: `apps/ai/agents/react/tool-definitions.ts`

- [ ] **Step 1: Create the tool definitions for Gemini function calling**

```typescript
/**
 * ReAct agent tool definitions for Gemini function calling.
 * Each tool declaration maps to a handler that executes the actual operation.
 *
 * @module tool-definitions
 */

/**
 * Gemini-compatible function declarations for all ReAct agent tools.
 * These are passed to the Gemini API as the `tools` parameter.
 *
 * @returns Array of tool declarations in Gemini function calling format
 */
export function get_react_tool_declarations(): any[] {
  console.log('[tool-definitions] get_react_tool_declarations: start');

  const declarations = [
    {
      name: 'qdrant_search',
      description:
        'Semantic similarity search across raw materials, FDA ingredients, or sales data. Use for fuzzy/conceptual queries like "find anti-aging ingredients" or "natural preservatives similar to X". Returns ranked results with similarity scores.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language search query describing what to find',
          },
          collection: {
            type: 'string',
            enum: ['raw_materials_console', 'raw_materials_fda', 'raw_materials_stock', 'sales_rnd'],
            description: 'Which collection to search. Use raw_materials_stock for in-stock items, raw_materials_fda for all FDA materials, sales_rnd for market data.',
          },
          top_k: {
            type: 'number',
            description: 'Maximum number of results to return. Default 5.',
          },
          score_threshold: {
            type: 'number',
            description: 'Minimum similarity score (0-1). Default 0.7. Lower for broader results.',
          },
          filters: {
            type: 'object',
            description: 'Payload filters for pre-filtering. Example: {"supplier": "BASF"} or {"stock_status": "in_stock"}',
          },
        },
        required: ['query', 'collection'],
      },
    },

    {
      name: 'mongo_query',
      description:
        'Direct MongoDB query for exact lookups, aggregations, and structured data retrieval. Use when you need specific records by code/name/ID, counts, filtered lists, or aggregated results. Much faster than vector search for exact matches.',
      parameters: {
        type: 'object',
        properties: {
          collection: {
            type: 'string',
            description: 'MongoDB collection name (e.g., "raw_materials_console", "raw_materials_real_stock", "formulas")',
          },
          database: {
            type: 'string',
            enum: ['rnd_ai', 'raw_materials'],
            description: 'Database name. "rnd_ai" for main data, "raw_materials" for stock data.',
          },
          operation: {
            type: 'string',
            enum: ['find', 'findOne', 'aggregate', 'count'],
            description: 'MongoDB operation type',
          },
          filter: {
            type: 'object',
            description: 'MongoDB query filter. Example: {"rm_code": "RM001234"} or {"supplier": {"$regex": "BASF", "$options": "i"}}',
          },
          projection: {
            type: 'object',
            description: 'Fields to include/exclude. Example: {"rm_code": 1, "trade_name": 1, "rm_cost": 1}',
          },
          sort: {
            type: 'object',
            description: 'Sort order. Example: {"rm_cost": 1} for ascending cost',
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return. Default 10.',
          },
        },
        required: ['collection', 'database', 'operation', 'filter'],
      },
    },

    {
      name: 'formula_calculate',
      description:
        'Calculate batch costs, scale formulations, convert units, or compute ingredient percentages. Use for any math-related query about formulas, costs, or quantities.',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['batch_cost', 'scale_formula', 'unit_convert', 'ingredient_percentage'],
            description: 'Type of calculation to perform',
          },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                quantity: { type: 'number' },
                unit: { type: 'string' },
                cost_per_unit: { type: 'number' },
              },
            },
            description: 'List of ingredients with quantities and costs',
          },
          batch_size: {
            type: 'number',
            description: 'Target batch size in the target unit',
          },
          target_unit: {
            type: 'string',
            enum: ['g', 'kg', 'lb', 'ton', 'oz', 'ml', 'l'],
            description: 'Target unit for output',
          },
          formula_id: {
            type: 'string',
            description: 'Formula ID for lookup-based calculations',
          },
        },
        required: ['operation'],
      },
    },

    {
      name: 'web_search',
      description:
        'Search the web for current information not in our database. Use for trends, competitor analysis, regulatory updates, market research, or any query requiring fresh external data.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Web search query',
          },
          max_results: {
            type: 'number',
            description: 'Maximum results to return. Default 5.',
          },
        },
        required: ['query'],
      },
    },

    {
      name: 'context_memory',
      description:
        'Retrieve conversation history and user preferences from the current session. Use when the user references something discussed earlier or when you need to personalise recommendations based on prior interactions.',
      parameters: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Current session/conversation identifier',
          },
          lookback: {
            type: 'number',
            description: 'How many prior message turns to retrieve. Default 5.',
          },
        },
        required: ['session_id'],
      },
    },
  ];

  console.log(`[tool-definitions] get_react_tool_declarations: ${declarations.length} tools defined`);
  return declarations;
}

/**
 * Tool name union type for type-safe handler routing.
 */
export type ReactToolName =
  | 'qdrant_search'
  | 'mongo_query'
  | 'formula_calculate'
  | 'web_search'
  | 'context_memory';
```

- [ ] **Step 2: Commit**

```bash
git add apps/ai/agents/react/tool-definitions.ts
git commit -m "feat: Add ReAct agent tool definitions for Gemini function calling"
```

---

## Task 6: Create ReAct Agent Tool Handlers

**Files:**
- Create: `apps/ai/agents/react/tool-handlers/qdrant-search-handler.ts`
- Create: `apps/ai/agents/react/tool-handlers/mongo-query-handler.ts`
- Create: `apps/ai/agents/react/tool-handlers/formula-calc-handler.ts`
- Create: `apps/ai/agents/react/tool-handlers/web-search-handler.ts`
- Create: `apps/ai/agents/react/tool-handlers/context-memory-handler.ts`

- [ ] **Step 1: Create qdrant-search-handler.ts**

```typescript
/**
 * Qdrant vector search tool handler.
 * Executes semantic similarity search and returns formatted results.
 *
 * @module qdrant-search-handler
 */

import { get_qdrant_service } from '../../../services/vector/qdrant-service';
import { createEmbeddingService } from '../../../services/embeddings/universal-embedding-service';
import { get_search_defaults } from '../../../config/qdrant-config';

interface QdrantSearchParams {
  query: string;
  collection: string;
  top_k?: number;
  score_threshold?: number;
  filters?: Record<string, unknown>;
}

/**
 * Handle a qdrant_search tool call from the ReAct agent.
 *
 * @param params - Search parameters from Gemini function call
 * @returns Formatted search results as a string for the agent
 */
export async function handle_qdrant_search(params: QdrantSearchParams): Promise<string> {
  console.log(`[qdrant-search-handler] handle_qdrant_search: query="${params.query.slice(0, 50)}...", collection=${params.collection}, start`);

  const qdrant = get_qdrant_service();
  await qdrant.ensure_initialised();

  const embeddingService = createEmbeddingService();
  const defaults = get_search_defaults(params.collection);

  // Generate query embedding
  const [queryVector] = await embeddingService.createEmbeddings([params.query]);

  // Build Qdrant filter from params.filters
  let qdrantFilter: Record<string, unknown> | undefined;
  if (params.filters && Object.keys(params.filters).length > 0) {
    const must: any[] = [];
    for (const [key, value] of Object.entries(params.filters)) {
      must.push({ key, match: { value } });
    }
    qdrantFilter = { must };
  }

  // Execute search
  const results = await qdrant.search(params.collection, queryVector, {
    topK: params.top_k || defaults.topK,
    scoreThreshold: params.score_threshold || defaults.scoreThreshold,
    filter: qdrantFilter,
    ef: defaults.ef,
    withPayload: true,
  });

  if (!results.length) {
    console.log('[qdrant-search-handler] handle_qdrant_search: no results');
    return `No results found for "${params.query}" in ${params.collection}.`;
  }

  // Format results for the agent
  const formatted = results.map((r, i) => {
    const p = r.payload;
    const lines = [`[${i + 1}] Score: ${(r.score * 100).toFixed(1)}%`];
    if (p.rm_code) lines.push(`  Code: ${p.rm_code}`);
    if (p.trade_name) lines.push(`  Trade Name: ${p.trade_name}`);
    if (p.inci_name) lines.push(`  INCI: ${p.inci_name}`);
    if (p.supplier) lines.push(`  Supplier: ${p.supplier}`);
    if (p.cost || p.rm_cost) lines.push(`  Cost: ${p.cost || p.rm_cost}`);
    if (p.benefits) lines.push(`  Benefits: ${String(p.benefits).slice(0, 200)}`);
    if (p.stock_status) lines.push(`  Stock: ${p.stock_status}`);
    return lines.join('\n');
  });

  const output = `Found ${results.length} results in ${params.collection}:\n\n${formatted.join('\n\n')}`;
  console.log(`[qdrant-search-handler] handle_qdrant_search: ${results.length} results, done`);
  return output;
}
```

- [ ] **Step 2: Create mongo-query-handler.ts**

```typescript
/**
 * MongoDB direct query tool handler.
 * Executes exact lookups, aggregations, and structured queries.
 *
 * @module mongo-query-handler
 */

import { MongoClient } from 'mongodb';

interface MongoQueryParams {
  collection: string;
  database: string;
  operation: 'find' | 'findOne' | 'aggregate' | 'count';
  filter: Record<string, unknown>;
  projection?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit?: number;
}

/** Cached MongoDB clients by connection URI */
const _clients: Map<string, MongoClient> = new Map();

/**
 * Get or create a MongoDB client for the given database.
 *
 * @param database - "rnd_ai" or "raw_materials"
 * @returns MongoClient connected to the appropriate URI
 */
async function get_mongo_client(database: string): Promise<{ client: MongoClient; dbName: string }> {
  const uri = database === 'raw_materials'
    ? process.env.RAW_MATERIALS_REAL_STOCK_MONGODB_URI || process.env.MONGODB_URI || ''
    : process.env.MONGODB_URI || '';

  if (!uri) throw new Error(`MongoDB URI not configured for database: ${database}`);

  let client = _clients.get(uri);
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
    _clients.set(uri, client);
  }

  // Extract DB name from URI or use the parameter
  const dbName = database === 'raw_materials' ? 'raw_materials' : 'rnd_ai';
  return { client, dbName };
}

/**
 * Handle a mongo_query tool call from the ReAct agent.
 * Executes the query with safety limits (max 20 results, read-only).
 *
 * @param params - Query parameters from Gemini function call
 * @returns Formatted query results as a string for the agent
 */
export async function handle_mongo_query(params: MongoQueryParams): Promise<string> {
  console.log(`[mongo-query-handler] handle_mongo_query: db=${params.database}, collection=${params.collection}, op=${params.operation}, start`);

  const { client, dbName } = await get_mongo_client(params.database);
  const db = client.db(dbName);
  const collection = db.collection(params.collection);
  const limit = Math.min(params.limit || 10, 20); // Safety cap

  let result: any;

  switch (params.operation) {
    case 'findOne': {
      result = await collection.findOne(params.filter, { projection: params.projection });
      if (!result) return `No document found matching filter: ${JSON.stringify(params.filter)}`;
      return `Found 1 document:\n${JSON.stringify(result, null, 2)}`;
    }

    case 'find': {
      let cursor = collection.find(params.filter, { projection: params.projection });
      if (params.sort) cursor = cursor.sort(params.sort as any);
      const docs = await cursor.limit(limit).toArray();
      if (!docs.length) return `No documents found matching filter: ${JSON.stringify(params.filter)}`;
      return `Found ${docs.length} documents:\n${JSON.stringify(docs, null, 2)}`;
    }

    case 'aggregate': {
      const pipeline = Array.isArray(params.filter) ? params.filter : [{ $match: params.filter }];
      // Safety: add $limit if not present
      if (!pipeline.some((s: any) => '$limit' in s)) {
        pipeline.push({ $limit: limit });
      }
      const docs = await collection.aggregate(pipeline).toArray();
      if (!docs.length) return 'Aggregation returned no results.';
      return `Aggregation returned ${docs.length} results:\n${JSON.stringify(docs, null, 2)}`;
    }

    case 'count': {
      const count = await collection.countDocuments(params.filter);
      return `Count: ${count} documents match the filter.`;
    }

    default:
      return `Unsupported operation: ${params.operation}`;
  }
}
```

- [ ] **Step 3: Create formula-calc-handler.ts**

```typescript
/**
 * Formula calculation tool handler.
 * Performs batch costing, scaling, unit conversion, and percentage calculations.
 *
 * @module formula-calc-handler
 */

interface FormulaCalcParams {
  operation: 'batch_cost' | 'scale_formula' | 'unit_convert' | 'ingredient_percentage';
  ingredients?: Array<{
    name: string;
    quantity: number;
    unit: string;
    cost_per_unit?: number;
  }>;
  batch_size?: number;
  target_unit?: string;
  formula_id?: string;
}

/** Unit conversion factors to grams */
const UNIT_TO_GRAMS: Record<string, number> = {
  g: 1,
  kg: 1000,
  lb: 453.592,
  ton: 1_000_000,
  oz: 28.3495,
  ml: 1, // approximate for water-density liquids
  l: 1000,
};

/**
 * Handle a formula_calculate tool call from the ReAct agent.
 *
 * @param params - Calculation parameters from Gemini function call
 * @returns Formatted calculation results as a string
 */
export async function handle_formula_calculate(params: FormulaCalcParams): Promise<string> {
  console.log(`[formula-calc-handler] handle_formula_calculate: operation=${params.operation}, start`);

  switch (params.operation) {
    case 'batch_cost': {
      if (!params.ingredients?.length) return 'Error: No ingredients provided for batch cost calculation.';

      const results = params.ingredients.map((ing) => {
        const cost = (ing.quantity || 0) * (ing.cost_per_unit || 0);
        return { ...ing, totalCost: cost };
      });

      const totalCost = results.reduce((sum, r) => sum + r.totalCost, 0);
      const totalQuantity = results.reduce((sum, r) => sum + (r.quantity || 0), 0);

      const lines = results.map(
        (r) => `  ${r.name}: ${r.quantity}${r.unit} x $${r.cost_per_unit}/unit = $${r.totalCost.toFixed(2)}`,
      );

      const output = [
        'Batch Cost Calculation:',
        ...lines,
        `\nTotal: $${totalCost.toFixed(2)} for ${totalQuantity}${params.target_unit || results[0]?.unit || 'units'}`,
        `Cost per unit: $${totalQuantity > 0 ? (totalCost / totalQuantity).toFixed(4) : '0'}`,
      ].join('\n');

      console.log(`[formula-calc-handler] handle_formula_calculate: batch_cost=$${totalCost.toFixed(2)}, done`);
      return output;
    }

    case 'scale_formula': {
      if (!params.ingredients?.length || !params.batch_size) {
        return 'Error: Need ingredients and batch_size for scaling.';
      }

      const currentTotal = params.ingredients.reduce((s, i) => s + (i.quantity || 0), 0);
      if (currentTotal === 0) return 'Error: Current total quantity is zero, cannot scale.';

      const scaleFactor = params.batch_size / currentTotal;
      const scaled = params.ingredients.map((ing) => ({
        name: ing.name,
        original: `${ing.quantity}${ing.unit}`,
        scaled: `${(ing.quantity * scaleFactor).toFixed(2)}${params.target_unit || ing.unit}`,
        percentage: `${((ing.quantity / currentTotal) * 100).toFixed(1)}%`,
      }));

      const output = [
        `Scaled Formula (factor: ${scaleFactor.toFixed(3)}x):`,
        `Target batch: ${params.batch_size}${params.target_unit || 'units'}`,
        '',
        ...scaled.map((s) => `  ${s.name}: ${s.original} → ${s.scaled} (${s.percentage})`),
      ].join('\n');

      console.log(`[formula-calc-handler] handle_formula_calculate: scaled by ${scaleFactor.toFixed(3)}x, done`);
      return output;
    }

    case 'unit_convert': {
      if (!params.ingredients?.length || !params.target_unit) {
        return 'Error: Need ingredients and target_unit for conversion.';
      }

      const targetFactor = UNIT_TO_GRAMS[params.target_unit];
      if (!targetFactor) return `Error: Unknown target unit "${params.target_unit}". Supported: ${Object.keys(UNIT_TO_GRAMS).join(', ')}`;

      const converted = params.ingredients.map((ing) => {
        const sourceFactor = UNIT_TO_GRAMS[ing.unit] || 1;
        const grams = ing.quantity * sourceFactor;
        const result = grams / targetFactor;
        return `  ${ing.name}: ${ing.quantity}${ing.unit} = ${result.toFixed(4)}${params.target_unit}`;
      });

      console.log('[formula-calc-handler] handle_formula_calculate: unit_convert done');
      return `Unit Conversion to ${params.target_unit}:\n${converted.join('\n')}`;
    }

    case 'ingredient_percentage': {
      if (!params.ingredients?.length) return 'Error: No ingredients provided.';

      const total = params.ingredients.reduce((s, i) => s + (i.quantity || 0), 0);
      if (total === 0) return 'Error: Total quantity is zero.';

      const percentages = params.ingredients.map(
        (ing) => `  ${ing.name}: ${ing.quantity}${ing.unit} = ${((ing.quantity / total) * 100).toFixed(2)}%`,
      );

      console.log('[formula-calc-handler] handle_formula_calculate: ingredient_percentage done');
      return `Ingredient Percentages (total: ${total}):\n${percentages.join('\n')}`;
    }

    default:
      return `Unknown operation: ${params.operation}`;
  }
}
```

- [ ] **Step 4: Create web-search-handler.ts**

```typescript
/**
 * Web search tool handler.
 * Uses a simple fetch-based search for external information retrieval.
 *
 * @module web-search-handler
 */

interface WebSearchParams {
  query: string;
  max_results?: number;
}

/**
 * Handle a web_search tool call from the ReAct agent.
 * Uses Google Custom Search API if configured, falls back to a formatted message.
 *
 * @param params - Search parameters from Gemini function call
 * @returns Formatted search results or guidance message
 */
export async function handle_web_search(params: WebSearchParams): Promise<string> {
  console.log(`[web-search-handler] handle_web_search: query="${params.query}", start`);

  const maxResults = params.max_results || 5;

  // If Google Custom Search is configured, use it
  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCseId = process.env.GOOGLE_SEARCH_CSE_ID;

  if (googleApiKey && googleCseId) {
    try {
      const url = new URL('https://www.googleapis.com/customsearch/v1');
      url.searchParams.set('key', googleApiKey);
      url.searchParams.set('cx', googleCseId);
      url.searchParams.set('q', params.query);
      url.searchParams.set('num', String(Math.min(maxResults, 10)));

      const response = await fetch(url.toString());
      const data = await response.json();

      if (data.items?.length) {
        const results = data.items.map((item: any, i: number) =>
          `[${i + 1}] ${item.title}\n  URL: ${item.link}\n  ${item.snippet || ''}`,
        );
        console.log(`[web-search-handler] handle_web_search: ${data.items.length} results, done`);
        return `Web search results for "${params.query}":\n\n${results.join('\n\n')}`;
      }
    } catch (err) {
      console.error('[web-search-handler] Google search failed:', err);
    }
  }

  // Fallback: inform the agent that web search is not configured
  console.log('[web-search-handler] handle_web_search: no search API configured, returning guidance');
  return `Web search for "${params.query}" is not available (GOOGLE_SEARCH_API_KEY not configured). Based on my training data, I'll provide what I know about this topic. For real-time data, the user should check industry sources directly.`;
}
```

- [ ] **Step 5: Create context-memory-handler.ts**

```typescript
/**
 * Conversation context/memory tool handler.
 * Retrieves recent conversation history for context-aware responses.
 *
 * @module context-memory-handler
 */

import { MongoClient } from 'mongodb';

interface ContextMemoryParams {
  session_id: string;
  lookback?: number;
}

/**
 * Handle a context_memory tool call from the ReAct agent.
 * Retrieves recent conversation turns from MongoDB.
 *
 * @param params - Memory retrieval parameters
 * @returns Formatted conversation history
 */
export async function handle_context_memory(params: ContextMemoryParams): Promise<string> {
  console.log(`[context-memory-handler] handle_context_memory: session=${params.session_id}, lookback=${params.lookback || 5}, start`);

  const lookback = params.lookback || 5;
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    return 'No conversation history available (database not configured).';
  }

  try {
    const client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db('rnd_ai');

    // Try multiple conversation collections
    const collections = ['conversations', 'raw_materials_conversations'];
    let messages: any[] = [];

    for (const collName of collections) {
      const coll = db.collection(collName);
      const conversation = await coll.findOne(
        { sessionId: params.session_id },
        { sort: { updatedAt: -1 } },
      );

      if (conversation?.messages?.length) {
        messages = conversation.messages.slice(-lookback);
        break;
      }
    }

    await client.close();

    if (!messages.length) {
      console.log('[context-memory-handler] handle_context_memory: no history found');
      return 'No prior conversation history found for this session.';
    }

    const formatted = messages.map(
      (m: any) => `[${m.role || 'unknown'}]: ${String(m.content || '').slice(0, 300)}`,
    );

    console.log(`[context-memory-handler] handle_context_memory: ${messages.length} turns retrieved, done`);
    return `Recent conversation history (last ${messages.length} turns):\n\n${formatted.join('\n\n')}`;
  } catch (err) {
    console.error('[context-memory-handler] handle_context_memory: error', err);
    return 'Could not retrieve conversation history due to a database error.';
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/ai/agents/react/tool-handlers/
git commit -m "feat: Add ReAct agent tool handlers (qdrant, mongo, formula, web, memory)"
```

---

## Task 7: Create ReAct System Prompt

**Files:**
- Create: `apps/ai/agents/react/react-system-prompt.ts`

- [ ] **Step 1: Create the system prompt**

```typescript
/**
 * ReAct agent system prompt with chain-of-thought reasoning instructions.
 * Guides Gemini on when and how to use each tool.
 *
 * @module react-system-prompt
 */

/**
 * Build the ReAct system prompt.
 * Includes: role definition, reasoning process, tool selection guide, output formatting.
 *
 * @returns System prompt string for Gemini
 */
export function get_react_system_prompt(): string {
  console.log('[react-system-prompt] get_react_system_prompt: building prompt');

  return `You are an expert AI assistant for R&D cosmetic ingredient management.
You help scientists, formulators, and product managers find ingredients, analyse formulations, check regulations, and make data-driven decisions.

## REASONING PROCESS

Before answering any question, think step-by-step:

### Step 1: CLASSIFY the query
Determine which category the user's question falls into:
- **EXACT_LOOKUP** — specific code, name, or ID (e.g., "What is RM001234?") → use \`mongo_query\`
- **SEMANTIC_SEARCH** — fuzzy, conceptual, "find similar" (e.g., "find anti-aging ingredients") → use \`qdrant_search\`
- **CALCULATION** — math, costs, scaling, percentages (e.g., "cost of 500kg batch") → use \`formula_calculate\`
- **EXTERNAL_INFO** — trends, news, competitor data (e.g., "K-beauty trends 2026") → use \`web_search\`
- **CONTEXTUAL** — references prior conversation (e.g., "what about the one I asked before?") → use \`context_memory\`
- **MULTI_STEP** — needs multiple tools in sequence (e.g., "find cheap preservatives in stock and compare with market trends")

### Step 2: PLAN your tool calls
- Decide which tools to use, in what order
- For MULTI_STEP queries, plan the full sequence before starting
- Use the minimum number of tool calls needed

### Step 3: EXECUTE and OBSERVE
- Call tools one at a time
- Evaluate each result before deciding the next action
- If a tool returns no results, try a different approach (broader query, different collection, relaxed filters)

### Step 4: SYNTHESIZE
- Combine all observations into a clear, structured answer
- Use tables for comparisons (Thai or English based on user language)
- Cite which source provided each fact
- Flag uncertainty when data is incomplete

## TOOL SELECTION GUIDE

| User says... | Use this tool | Why |
|---|---|---|
| "What is RM001234?" or any specific code | \`mongo_query\` (findOne) | Exact lookup, instant |
| "Find anti-aging ingredients" | \`qdrant_search\` | Semantic similarity |
| "List all BASF materials" | \`mongo_query\` (find, filter by supplier) | Exact filter, not fuzzy |
| "Natural preservatives under $50/kg in stock" | \`qdrant_search\` with filters | Semantic + payload filter |
| "How much for 500kg of formula F-201?" | \`formula_calculate\` (batch_cost) | Math operation |
| "What's trending in skincare?" | \`web_search\` | External, fresh data |
| "Compare retinol suppliers by price" | \`mongo_query\` (find, sort by cost) | Structured comparison |
| "Scale this formula to 1 ton" | \`formula_calculate\` (scale_formula) | Unit math |
| "What did I ask earlier about hyaluronic acid?" | \`context_memory\` | Prior conversation |
| "Find me a substitute for Phenoxyethanol" | \`qdrant_search\` then \`mongo_query\` | Semantic search + verify stock |

## RESPONSE FORMATTING

- Use **tables** for ingredient lists and comparisons
- Include **RM codes** when available
- Show **cost per kg** when relevant
- Format currency as **$XX.XX/kg**
- Support both Thai and English — detect from user's language
- When showing ingredient profiles, include: Code, INCI Name, Trade Name, Supplier, Cost, Benefits, Stock Status
- Always end with a brief helpful suggestion or follow-up question

## SAFETY RULES

- NEVER modify, delete, or update any database records — read-only operations only
- For \`mongo_query\`: only use find, findOne, aggregate, count — never update/delete
- Limit all queries to max 20 results for performance
- Do not expose raw MongoDB connection strings or API keys in responses
- If unsure about data accuracy, say so — don't hallucinate ingredient properties`;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ai/agents/react/react-system-prompt.ts
git commit -m "feat: Add ReAct system prompt with CoT reasoning + tool routing"
```

---

## Task 8: Create ReAct Agent Service (Main Reasoning Loop)

**Files:**
- Create: `apps/ai/agents/react/react-agent-service.ts`

- [ ] **Step 1: Create the ReAct agent service**

```typescript
/**
 * ReAct (Reason + Act) agent service.
 * Implements the main reasoning loop: Thought → Action → Observation → Answer.
 * Uses Gemini function calling for tool selection and execution.
 *
 * @module react-agent-service
 */

import { GoogleGenerativeAI, GenerativeModel, Content, Part } from '@google/generative-ai';
import { get_react_tool_declarations, ReactToolName } from './tool-definitions';
import { get_react_system_prompt } from './react-system-prompt';
import { handle_qdrant_search } from './tool-handlers/qdrant-search-handler';
import { handle_mongo_query } from './tool-handlers/mongo-query-handler';
import { handle_formula_calculate } from './tool-handlers/formula-calc-handler';
import { handle_web_search } from './tool-handlers/web-search-handler';
import { handle_context_memory } from './tool-handlers/context-memory-handler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReactAgentConfig {
  /** Gemini model name */
  model: string;
  /** LLM temperature (0–2) */
  temperature: number;
  /** Max output tokens */
  maxTokens: number;
  /** Max tool call iterations before forcing a final answer */
  maxIterations: number;
}

export interface ReactAgentRequest {
  /** User query */
  prompt: string;
  /** User identifier */
  userId: string;
  /** Session ID for context memory */
  sessionId?: string;
  /** Prior conversation turns */
  conversationHistory?: Array<{ role: string; content: string }>;
}

export interface ReactAgentResponse {
  /** Final synthesised answer */
  response: string;
  /** Whether the agent successfully completed */
  success: boolean;
  /** Tools that were called during reasoning */
  toolCalls: Array<{ name: string; args: any; result: string }>;
  /** Total iterations used */
  iterations: number;
  /** Processing time in ms */
  processingTime: number;
  /** Model used */
  model: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ReactAgentConfig = {
  model: 'gemini-2.0-flash',
  temperature: 0.7,
  maxTokens: 9000,
  maxIterations: 5,
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReactAgentService {
  private genAI: GoogleGenerativeAI;
  private config: ReactAgentConfig;

  /**
   * @param apiKey - Gemini API key (falls back to GEMINI_API_KEY env var)
   * @param configOverride - Override default agent config
   */
  constructor(apiKey?: string, configOverride?: Partial<ReactAgentConfig>) {
    console.log('[react-agent] constructor: start');
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
    if (!key) throw new Error('GEMINI_API_KEY is required for ReactAgentService');

    this.genAI = new GoogleGenerativeAI(key);
    this.config = { ...DEFAULT_CONFIG, ...configOverride };
    console.log(`[react-agent] constructor: model=${this.config.model}, maxIter=${this.config.maxIterations}, done`);
  }

  /**
   * Execute the full ReAct reasoning loop for a user query.
   *
   * @param request - ReactAgentRequest with prompt, userId, optional history
   * @returns ReactAgentResponse with final answer, tool calls, and metadata
   */
  async execute(request: ReactAgentRequest): Promise<ReactAgentResponse> {
    const startTime = Date.now();
    console.log(`[react-agent] execute: prompt="${request.prompt.slice(0, 80)}...", userId=${request.userId}, start`);

    const toolDeclarations = get_react_tool_declarations();
    const systemPrompt = get_react_system_prompt();
    const toolCallLog: ReactAgentResponse['toolCalls'] = [];

    // Build Gemini model with tools
    const model = this.genAI.getGenerativeModel({
      model: this.config.model,
      generationConfig: {
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxTokens,
      },
      tools: [{ functionDeclarations: toolDeclarations }],
      systemInstruction: systemPrompt,
    });

    // Build conversation contents
    const contents: Content[] = [];

    // Add conversation history
    if (request.conversationHistory?.length) {
      for (const turn of request.conversationHistory) {
        contents.push({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }],
        });
      }
    }

    // Add current user message
    contents.push({
      role: 'user',
      parts: [{ text: request.prompt }],
    });

    // ReAct loop
    let iterations = 0;
    let finalResponse = '';

    while (iterations < this.config.maxIterations) {
      iterations++;
      console.log(`[react-agent] execute: iteration ${iterations}/${this.config.maxIterations}`);

      const result = await model.generateContent({ contents });
      const response = result.response;
      const candidate = response.candidates?.[0];

      if (!candidate?.content?.parts?.length) {
        console.warn('[react-agent] execute: empty response from model');
        finalResponse = 'I was unable to generate a response. Please try rephrasing your question.';
        break;
      }

      // Check for function calls
      const functionCalls = candidate.content.parts.filter((p: Part) => 'functionCall' in p);

      if (functionCalls.length === 0) {
        // No more tool calls — model has produced the final answer
        const textParts = candidate.content.parts.filter((p: Part) => 'text' in p);
        finalResponse = textParts.map((p: any) => p.text).join('');
        console.log(`[react-agent] execute: final answer at iteration ${iterations}`);
        break;
      }

      // Add model's response (with function calls) to conversation
      contents.push({
        role: 'model',
        parts: candidate.content.parts,
      });

      // Execute each function call
      const functionResponses: Part[] = [];

      for (const part of functionCalls) {
        const fc = (part as any).functionCall;
        const toolName = fc.name as ReactToolName;
        const toolArgs = fc.args || {};

        console.log(`[react-agent] execute: calling tool=${toolName}, args=${JSON.stringify(toolArgs).slice(0, 200)}`);

        let toolResult: string;
        try {
          toolResult = await this._execute_tool(toolName, toolArgs, request.sessionId);
        } catch (err: any) {
          console.error(`[react-agent] execute: tool ${toolName} failed:`, err.message);
          toolResult = `Tool error: ${err.message}`;
        }

        toolCallLog.push({ name: toolName, args: toolArgs, result: toolResult.slice(0, 500) });

        functionResponses.push({
          functionResponse: {
            name: toolName,
            response: { result: toolResult },
          },
        } as any);
      }

      // Add function results to conversation
      contents.push({
        role: 'user',
        parts: functionResponses,
      });
    }

    // If we exhausted iterations without a final answer
    if (!finalResponse && iterations >= this.config.maxIterations) {
      console.warn('[react-agent] execute: max iterations reached');
      finalResponse = 'I gathered some information but reached the reasoning limit. Here is what I found so far:\n\n'
        + toolCallLog.map((tc) => `**${tc.name}:** ${tc.result}`).join('\n\n');
    }

    const processingTime = Date.now() - startTime;
    console.log(`[react-agent] execute: done, iterations=${iterations}, tools=${toolCallLog.length}, time=${processingTime}ms`);

    return {
      response: finalResponse,
      success: true,
      toolCalls: toolCallLog,
      iterations,
      processingTime,
      model: this.config.model,
    };
  }

  /**
   * Route a tool call to its handler.
   *
   * @param toolName - Name of the tool to execute
   * @param args - Tool arguments from Gemini
   * @param sessionId - Session ID for context memory
   * @returns Tool result as a string
   */
  private async _execute_tool(
    toolName: ReactToolName,
    args: any,
    sessionId?: string,
  ): Promise<string> {
    switch (toolName) {
      case 'qdrant_search':
        return handle_qdrant_search(args);
      case 'mongo_query':
        return handle_mongo_query(args);
      case 'formula_calculate':
        return handle_formula_calculate(args);
      case 'web_search':
        return handle_web_search(args);
      case 'context_memory':
        return handle_context_memory({ ...args, session_id: args.session_id || sessionId });
      default:
        return `Unknown tool: ${toolName}`;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ai/agents/react/react-agent-service.ts
git commit -m "feat: Add ReactAgentService — ReAct reasoning loop with Gemini function calling"
```

---

## Task 9: Update EnhancedHybridSearchService to Use Qdrant

**Files:**
- Modify: `apps/ai/services/rag/enhanced-hybrid-search-service.ts`

- [ ] **Step 1: Replace ChromaDB imports with Qdrant imports**

In `apps/ai/services/rag/enhanced-hybrid-search-service.ts`, find and replace:
```typescript
import { getChromaService, ChromaService } from '../vector/chroma-service';
```
With:
```typescript
import { get_qdrant_service, QdrantService } from '../vector/qdrant-service';
```

- [ ] **Step 2: Replace ChromaService property and initialisation**

Find the class property `chromaService` (or similar) and the `initialize()` method. Replace all references from `getChromaService()` / `this.chromaService` to `get_qdrant_service()` / `this.qdrantService`.

The semantic search method should change from:
```typescript
// Old ChromaDB call
const results = await this.chromaService.query(collectionName, queryEmbedding, topK, whereFilter);
```
To:
```typescript
// New Qdrant call
const results = await this.qdrantService.search(collectionName, queryEmbedding, {
  topK,
  scoreThreshold: threshold || 0.7,
  filter: whereFilter ? { must: Object.entries(whereFilter).map(([key, value]) => ({ key, match: { value } })) } : undefined,
  ef: 128,
  withPayload: true,
});
```

- [ ] **Step 3: Update result mapping**

ChromaDB returns `{ id, distance, metadata, document }`. Qdrant returns `{ id, score, payload }`.

Replace result mapping from:
```typescript
results.map(r => ({
  id: r.id,
  score: 1 - (r.distance || 0),  // ChromaDB distance → similarity
  content: r.document || '',
  metadata: r.metadata || {},
}))
```
To:
```typescript
results.map(r => ({
  id: r.id,
  score: r.score,  // Qdrant already returns similarity score
  content: (r.payload?.details as string) || '',
  metadata: r.payload || {},
}))
```

- [ ] **Step 4: Commit**

```bash
git add apps/ai/services/rag/enhanced-hybrid-search-service.ts
git commit -m "refactor: Swap EnhancedHybridSearchService from ChromaDB to Qdrant"
```

---

## Task 10: Update Auto-Index Service for Qdrant

**Files:**
- Modify: `apps/ai/server/services/auto-index-service.ts`

- [ ] **Step 1: Replace ChromaDB imports with Qdrant**

Replace:
```typescript
import { getChromaService } from '../../services/vector/chroma-service';
import { ChromaRAGService } from '../../services/rag/chroma-rag-service';
```
With:
```typescript
import { get_qdrant_service } from '../../services/vector/qdrant-service';
import { QdrantRAGService } from '../../services/rag/qdrant-rag-service';
```

- [ ] **Step 2: Update auto_index_material function to use QdrantRAGService**

Replace the ChromaRAGService instantiation and upsert call with QdrantRAGService equivalents. The `auto_index_material` function should:

```typescript
export async function auto_index_material(material: MaterialDocument): Promise<boolean> {
  console.log(`[auto-index] auto_index_material: rm_code=${material.rm_code}, start`);
  try {
    const ragService = new QdrantRAGService('rawMaterialsAI');
    const doc = QdrantRAGService.prepare_raw_material_document(material);
    await ragService.upsert_documents([doc]);
    console.log(`[auto-index] auto_index_material: rm_code=${material.rm_code}, success`);
    return true;
  } catch (err) {
    console.error(`[auto-index] auto_index_material: rm_code=${material.rm_code}, error`, err);
    return false;
  }
}
```

- [ ] **Step 3: Update auto_delete_material to use QdrantService**

```typescript
export async function auto_delete_material(rm_code: string): Promise<boolean> {
  console.log(`[auto-index] auto_delete_material: rm_code=${rm_code}, start`);
  try {
    const qdrant = get_qdrant_service();
    await qdrant.ensure_initialised();
    await qdrant.delete('raw_materials_console', [rm_code]);
    console.log(`[auto-index] auto_delete_material: rm_code=${rm_code}, success`);
    return true;
  } catch (err) {
    console.error(`[auto-index] auto_delete_material: rm_code=${rm_code}, error`, err);
    return false;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/ai/server/services/auto-index-service.ts
git commit -m "refactor: Update auto-index service to target Qdrant"
```

---

## Task 11: Update RAG Router

**Files:**
- Modify: `apps/ai/server/routers/rag.ts`

- [ ] **Step 1: Replace ChromaRAGService with QdrantRAGService**

Replace:
```typescript
import { ChromaRAGService } from '../../services/rag/chroma-rag-service';
```
With:
```typescript
import { QdrantRAGService } from '../../services/rag/qdrant-rag-service';
```

- [ ] **Step 2: Update all `new ChromaRAGService(...)` to `new QdrantRAGService(...)`**

The constructor signature is the same: `new QdrantRAGService(serviceName, configOverride)`.

Replace all instances of:
```typescript
const ragService = new ChromaRAGService(input.serviceName);
```
With:
```typescript
const ragService = new QdrantRAGService(input.serviceName);
```

Update method calls:
- `ragService.searchSimilar(...)` → `ragService.search_similar(...)`
- `ragService.searchAndFormat(...)` → `ragService.search_and_format(...)`
- `ragService.getIndexStats()` → `ragService.get_index_stats()`
- `ragService.batchProcessDocuments(...)` → `ragService.batch_process_documents(...)`

- [ ] **Step 3: Commit**

```bash
git add apps/ai/server/routers/rag.ts
git commit -m "refactor: Update RAG router to use QdrantRAGService"
```

---

## Task 12: Wire ReactAgentService into API Routes

**Files:**
- Modify: `apps/web/app/api/ai/raw-materials-agent/route.ts`
- Modify: `apps/web/app/api/ai/enhanced-chat/route.ts`

- [ ] **Step 1: Add ReactAgentService import to raw-materials-agent/route.ts**

Add at the top of the imports:
```typescript
import { ReactAgentService } from '@/ai/agents/react/react-agent-service';
```

- [ ] **Step 2: Add a react-agent code path in the POST handler**

In the POST handler, before the existing enhanced/original flow, add a new branch that uses the ReAct agent when enabled. The existing `initialize_services()` and tool-calling flow remains as a fallback.

After the request body parsing, add:

```typescript
// Try ReAct agent first (new intelligent routing)
try {
  console.log('[raw-materials-agent] POST: attempting ReAct agent path');
  const reactAgent = new ReactAgentService();
  const reactResult = await reactAgent.execute({
    prompt: body.prompt,
    userId: body.userId,
    sessionId: body.conversationHistory?.[0]?.sessionId,
    conversationHistory: body.conversationHistory?.map((m: any) => ({
      role: m.role || 'user',
      content: m.content || '',
    })),
  });

  if (reactResult.success) {
    console.log(`[raw-materials-agent] POST: ReAct agent success, iterations=${reactResult.iterations}, tools=${reactResult.toolCalls.length}`);
    return NextResponse.json({
      success: true,
      response: reactResult.response,
      model: reactResult.model,
      id: `react-${Date.now()}`,
      type: 'react-agent',
      features: {
        searchEnabled: reactResult.toolCalls.some((t) => t.name === 'qdrant_search'),
        mlEnabled: false,
        searchResultsCount: reactResult.toolCalls.filter((t) => t.name === 'qdrant_search').length,
        optimizationsApplied: reactResult.toolCalls.map((t) => t.name),
      },
      toolCalls: reactResult.toolCalls,
      metadata: {
        iterations: reactResult.iterations,
        processingTime: reactResult.processingTime,
        agent: 'react',
      },
    });
  }
} catch (err: any) {
  console.error('[raw-materials-agent] POST: ReAct agent failed, falling back:', err.message);
  // Fall through to existing flow
}
```

- [ ] **Step 3: Apply same pattern to enhanced-chat/route.ts**

Add the same ReactAgentService import and early-return pattern in the POST handler of `enhanced-chat/route.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/ai/raw-materials-agent/route.ts apps/web/app/api/ai/enhanced-chat/route.ts
git commit -m "feat: Wire ReactAgentService into AI API routes with fallback"
```

---

## Task 13: Create Qdrant Re-Indexing Script

**Files:**
- Create: `apps/ai/scripts/index-qdrant.ts`

- [ ] **Step 1: Create the re-indexing script**

```typescript
/**
 * Re-index all raw materials from MongoDB into Qdrant.
 * Reads from MongoDB, generates Gemini embeddings, upserts into Qdrant collections.
 *
 * Usage: npx tsx apps/ai/scripts/index-qdrant.ts [--collection <name>] [--batch-size <n>]
 *
 * @module index-qdrant
 */

import { MongoClient } from 'mongodb';
import { QdrantRAGService } from '../services/rag/qdrant-rag-service';
import { get_qdrant_service } from '../services/vector/qdrant-service';
import { QDRANT_COLLECTIONS } from '../config/qdrant-config';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MONGODB_URI = process.env.MONGODB_URI || '';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);

interface IndexTarget {
  mongoDb: string;
  mongoCollection: string;
  qdrantCollection: string;
  ragServiceName: 'rawMaterialsAllAI' | 'rawMaterialsAI' | 'salesRndAI';
}

const INDEX_TARGETS: IndexTarget[] = [
  {
    mongoDb: 'rnd_ai',
    mongoCollection: 'raw_materials_console',
    qdrantCollection: 'raw_materials_fda',
    ragServiceName: 'rawMaterialsAllAI',
  },
  {
    mongoDb: 'raw_materials',
    mongoCollection: 'raw_materials_real_stock',
    qdrantCollection: 'raw_materials_stock',
    ragServiceName: 'rawMaterialsAI',
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[index-qdrant] main: start');
  console.log(`[index-qdrant] MONGODB_URI configured: ${!!MONGODB_URI}`);
  console.log(`[index-qdrant] BATCH_SIZE: ${BATCH_SIZE}`);

  if (!MONGODB_URI) {
    console.error('[index-qdrant] MONGODB_URI is required');
    process.exit(1);
  }

  // Ensure all Qdrant collections exist
  const qdrant = get_qdrant_service();
  await qdrant.ensure_all_collections();
  console.log('[index-qdrant] All collections ensured');

  // Parse CLI args
  const args = process.argv.slice(2);
  const collectionArg = args.indexOf('--collection') >= 0 ? args[args.indexOf('--collection') + 1] : null;

  const targets = collectionArg
    ? INDEX_TARGETS.filter((t) => t.qdrantCollection === collectionArg)
    : INDEX_TARGETS;

  if (!targets.length) {
    console.error(`[index-qdrant] Unknown collection: ${collectionArg}`);
    console.error(`[index-qdrant] Available: ${INDEX_TARGETS.map((t) => t.qdrantCollection).join(', ')}`);
    process.exit(1);
  }

  for (const target of targets) {
    await index_collection(target);
  }

  console.log('[index-qdrant] main: all done');
  process.exit(0);
}

async function index_collection(target: IndexTarget): Promise<void> {
  console.log(`[index-qdrant] index_collection: ${target.mongoCollection} → ${target.qdrantCollection}, start`);

  const mongoUri = target.mongoDb === 'raw_materials'
    ? (process.env.RAW_MATERIALS_REAL_STOCK_MONGODB_URI || MONGODB_URI)
    : MONGODB_URI;

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(target.mongoDb);
  const collection = db.collection(target.mongoCollection);

  const totalCount = await collection.countDocuments();
  console.log(`[index-qdrant] index_collection: ${totalCount} documents in ${target.mongoCollection}`);

  const ragService = new QdrantRAGService(target.ragServiceName, {
    collectionName: target.qdrantCollection,
  });

  let processed = 0;
  const startTime = Date.now();

  const cursor = collection.find({}).batchSize(BATCH_SIZE);

  let batch: any[] = [];

  for await (const doc of cursor) {
    batch.push(doc);

    if (batch.length >= BATCH_SIZE) {
      await ragService.batch_process_documents(batch);
      processed += batch.length;

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const eta = ((totalCount - processed) / rate).toFixed(0);

      console.log(`[index-qdrant] Progress: ${processed}/${totalCount} (${((processed / totalCount) * 100).toFixed(1)}%) | ${rate.toFixed(1)} docs/s | ETA: ${eta}s`);
      batch = [];
    }
  }

  // Process remaining
  if (batch.length > 0) {
    await ragService.batch_process_documents(batch);
    processed += batch.length;
  }

  await client.close();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[index-qdrant] index_collection: ${target.qdrantCollection} done — ${processed} docs in ${elapsed}s`);

  // Verify
  const info = await get_qdrant_service().get_collection_info(target.qdrantCollection);
  console.log(`[index-qdrant] Verification: ${target.qdrantCollection} has ${info.pointsCount} points (expected ~${totalCount})`);
}

main().catch((err) => {
  console.error('[index-qdrant] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/ai/scripts/index-qdrant.ts
git commit -m "feat: Add Qdrant re-indexing script (MongoDB → embeddings → Qdrant)"
```

---

## Task 14: Update Docker Compose (ChromaDB → Qdrant)

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Replace the chromadb service with qdrant**

Replace the entire `chromadb` service block and update related references:

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
      - NEXT_PUBLIC_GEMINI_API_KEY=${NEXT_PUBLIC_GEMINI_API_KEY}
      - NEXT_PUBLIC_OPENAI_API_KEY=${NEXT_PUBLIC_OPENAI_API_KEY}
      - NEXT_PUBLIC_API_URL=http://localhost:3000/api
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

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "infra: Replace ChromaDB with Qdrant in docker-compose, add mem_limit"
```

---

## Task 15: Update .env.production

**Files:**
- Modify: `.env.production`

- [ ] **Step 1: Replace ChromaDB vars with Qdrant + DO MongoDB**

```bash
# ============================================================================
# R&D AI Management - Production Environment (DigitalOcean Droplet)
# ============================================================================
# Copy this file to .env on the droplet and fill in real values
# NEVER commit this file with real credentials to git
# ============================================================================

# ============================================================================
# DATABASE (DigitalOcean Managed MongoDB)
# ============================================================================
MONGODB_URI=mongodb+srv://doadmin:password@db-mongodb-sgp1-xxxxx.mongo.ondigitalocean.com/rnd_ai?tls=true&authSource=admin
RAW_MATERIALS_REAL_STOCK_MONGODB_URI=mongodb+srv://doadmin:password@db-mongodb-sgp1-xxxxx.mongo.ondigitalocean.com/raw_materials?tls=true&authSource=admin

# ============================================================================
# AI API KEYS (server-side only — injected at runtime, NOT baked into image)
# ============================================================================
GEMINI_API_KEY=your-gemini-api-key
OPENAI_API_KEY=your-openai-api-key

# Client-side keys (these are embedded during docker build via --build-arg)
NEXT_PUBLIC_GEMINI_API_KEY=your-gemini-api-key
NEXT_PUBLIC_OPENAI_API_KEY=your-openai-api-key
NEXT_PUBLIC_API_URL=https://your-domain.com/api

# ============================================================================
# VECTOR DATABASE (Qdrant — runs in Docker on same droplet)
# ============================================================================
QDRANT_URL=http://qdrant:6333
QDRANT_API_KEY=

# ============================================================================
# WEB SEARCH (optional — Google Custom Search for ReAct agent)
# ============================================================================
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_CSE_ID=

# ============================================================================
# ADMIN CREDENTIALS
# ============================================================================
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=change_this_to_a_strong_password

# ============================================================================
# APPLICATION
# ============================================================================
NODE_ENV=production
PORT=3000
AI_SERVICE_PORT=3001
AI_SERVICE_URL=http://ai:3001
WEB_APP_URL=http://web:3000
NEXT_TELEMETRY_DISABLED=1
HOSTNAME=0.0.0.0
```

- [ ] **Step 2: Commit**

```bash
git add .env.production
git commit -m "config: Update .env.production for Qdrant + DO Managed MongoDB"
```

---

## Task 16: Update Deploy Script

**Files:**
- Modify: `scripts/deploy-droplet.sh`

- [ ] **Step 1: Update health check references from chromadb to qdrant**

Replace the `health()` function services array:

```bash
local services=("web:3000" "ai:3001" "qdrant:6333")
```

- [ ] **Step 2: Update setup_droplet to create qdrant data directory**

Replace:
```bash
mkdir -p /opt/rnd-ai/data/chromadb
```
With:
```bash
mkdir -p /opt/rnd-ai/data/qdrant
```

- [ ] **Step 3: Add swap creation to setup_droplet**

After the `mkdir` line, add:
```bash
# Create 2GB swap file for memory safety
if [ ! -f /swapfile ]; then
  log_info "Creating 2GB swap file..."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log_info "Swap enabled"
fi
```

- [ ] **Step 4: Add index command**

Add a new case in the main switch:
```bash
--index)    index_qdrant ;;
```

And add the function:
```bash
# Re-index MongoDB data into Qdrant
index_qdrant() {
    check_prerequisites
    local compose_cmd=$(get_compose_cmd)
    log_info "Re-indexing data into Qdrant..."
    $compose_cmd --env-file "$ENV_FILE" exec ai npx tsx apps/ai/scripts/index-qdrant.ts
    log_info "Re-indexing complete"
}
```

- [ ] **Step 5: Update usage message**

Add `--index` to the usage output.

- [ ] **Step 6: Commit**

```bash
git add scripts/deploy-droplet.sh
git commit -m "infra: Update deploy script for Qdrant + swap + index command"
```

---

## Task 17: Create Droplet Provisioning Script

**Files:**
- Create: `scripts/provision-droplet.sh`

- [ ] **Step 1: Create the provisioning script using doctl CLI**

```bash
#!/bin/bash
# ============================================================================
# R&D AI Management — DigitalOcean Droplet + MongoDB Provisioning
# ============================================================================
# Prerequisites: doctl CLI authenticated (doctl auth init)
# Usage: ./scripts/provision-droplet.sh
# ============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configuration — edit these
REGION="sgp1"
DROPLET_NAME="rnd-ai-prod"
DROPLET_SIZE="s-2vcpu-4gb"
DROPLET_IMAGE="docker-20-04"
TAG="rnd-ai"
SSH_KEY_NAME=""  # Set to your SSH key name in DO, or leave empty to list

# ============================================================================
# Preflight checks
# ============================================================================

if ! command -v doctl &> /dev/null; then
    log_error "doctl CLI not found. Install: brew install doctl && doctl auth init"
    exit 1
fi

# Verify auth
if ! doctl account get &> /dev/null; then
    log_error "doctl not authenticated. Run: doctl auth init"
    exit 1
fi

log_info "Authenticated with DigitalOcean"

# ============================================================================
# SSH Key
# ============================================================================

if [ -z "$SSH_KEY_NAME" ]; then
    log_info "Available SSH keys:"
    doctl compute ssh-key list --format ID,Name,FingerPrint
    echo ""
    read -p "Enter SSH key ID to use: " SSH_KEY_ID
else
    SSH_KEY_ID=$(doctl compute ssh-key list --format ID,Name --no-header | grep "$SSH_KEY_NAME" | awk '{print $1}')
    if [ -z "$SSH_KEY_ID" ]; then
        log_error "SSH key '$SSH_KEY_NAME' not found"
        exit 1
    fi
fi

# ============================================================================
# Create Droplet
# ============================================================================

log_info "Creating droplet: $DROPLET_NAME ($DROPLET_SIZE) in $REGION..."

DROPLET_ID=$(doctl compute droplet create "$DROPLET_NAME" \
    --region "$REGION" \
    --size "$DROPLET_SIZE" \
    --image "$DROPLET_IMAGE" \
    --ssh-keys "$SSH_KEY_ID" \
    --tag-names "$TAG" \
    --enable-private-networking \
    --wait \
    --format ID \
    --no-header)

DROPLET_IP=$(doctl compute droplet get "$DROPLET_ID" --format PublicIPv4 --no-header)
log_info "Droplet created: ID=$DROPLET_ID, IP=$DROPLET_IP"

# ============================================================================
# Create Firewall
# ============================================================================

log_info "Creating firewall..."

doctl compute firewall create \
    --name "rnd-ai-firewall" \
    --droplet-ids "$DROPLET_ID" \
    --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0" \
    --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0 protocol:icmp,address:0.0.0.0/0,address:::/0"

log_info "Firewall created (SSH + HTTP + HTTPS only)"

# ============================================================================
# Summary
# ============================================================================

echo ""
log_info "=========================================="
log_info "  Provisioning Complete"
log_info "=========================================="
log_info "  Droplet IP:  $DROPLET_IP"
log_info "  Droplet ID:  $DROPLET_ID"
log_info "  Region:      $REGION"
log_info "  Size:        $DROPLET_SIZE"
log_info ""
log_info "  Next steps:"
log_info "  1. Create DO Managed MongoDB via console (Basic $15/mo, same region)"
log_info "  2. SSH in: ssh root@$DROPLET_IP"
log_info "  3. Clone repo and copy .env.production → .env"
log_info "  4. Run: ./scripts/deploy-droplet.sh --setup"
log_info "  5. Run: ./scripts/deploy-droplet.sh --up"
log_info "  6. Run: ./scripts/deploy-droplet.sh --index"
log_info "=========================================="
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/provision-droplet.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/provision-droplet.sh
git commit -m "infra: Add droplet provisioning script using doctl CLI"
```

---

## Task 18: Delete Old ChromaDB Files

**Files:**
- Delete: `apps/ai/services/vector/chroma-service.ts`
- Delete: `apps/ai/services/rag/chroma-rag-service.ts`
- Delete: `apps/ai/services/rag/pinecone-service-stub.ts`
- Delete: `apps/ai/scripts/index-chromadb-simple.ts`

- [ ] **Step 1: Remove old files**

```bash
git rm apps/ai/services/vector/chroma-service.ts
git rm apps/ai/services/rag/chroma-rag-service.ts
git rm apps/ai/services/rag/pinecone-service-stub.ts
git rm apps/ai/scripts/index-chromadb-simple.ts
```

- [ ] **Step 2: Verify no remaining ChromaDB imports**

```bash
grep -r "chroma-service\|chroma-rag-service\|pinecone-service-stub\|ChromaService\|getChromaService\|chromadb" apps/ --include="*.ts" --include="*.tsx" -l
```

Fix any remaining imports that reference deleted files.

- [ ] **Step 3: Commit**

```bash
git commit -m "cleanup: Remove ChromaDB and Pinecone stub files"
```

---

## Task 19: Update RAG Config

**Files:**
- Modify: `apps/ai/config/rag-config.ts`

- [ ] **Step 1: Remove Pinecone/ChromaDB references**

Update the `RAGServiceConfig` interface — rename `pineconeIndex` to `collectionName` (or just update the values to reference Qdrant collections):

Replace:
```typescript
pineconeIndex: string;
```
With:
```typescript
collectionName: string;
```

Update all config entries to use Qdrant collection names. The `RAG_CONFIG` object values should reference `raw_materials_fda`, `raw_materials_console`, `sales_rnd` instead of any Pinecone index names.

- [ ] **Step 2: Commit**

```bash
git add apps/ai/config/rag-config.ts
git commit -m "config: Update RAG config references from Pinecone to Qdrant collections"
```

---

## Task 20: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Append changelog entry**

Add a new section at the top (after the existing header):

```markdown
## [2026-03-27] dev/droplet — Qdrant Migration + ReAct Agent Architecture

### Architecture Changes
- **ChromaDB → Qdrant**: Replaced ChromaDB with Qdrant for production-grade vector search
  - Cosine similarity with HNSW tuning (ef=128, m=16)
  - Typed payload indexes (keyword, text, float, datetime) for pre-filtering
  - On-disk payload storage to fit 31K+ vectors in 512MB RAM
- **MongoDB Atlas → DO Managed MongoDB**: Migrated to DigitalOcean managed database ($15/mo)
- **ReAct Agent**: New chain-of-thought reasoning engine replaces RAG-only pipeline
  - 5 tools: qdrant_search, mongo_query, formula_calculate, web_search, context_memory
  - Gemini function calling drives tool selection
  - Multi-step reasoning for complex queries
  - Graceful fallback to existing enhanced/tool-calling flow

### Infrastructure
- Created DO droplet provisioning script (doctl CLI)
- Updated docker-compose.yml: Qdrant replaces ChromaDB, mem_limit on all services
- Added 2GB swap to deploy script for indexing safety
- Updated .env.production for Qdrant + DO MongoDB connection strings
- Memory budget: web 768MB + AI 768MB + Qdrant 512MB + OS 512MB + swap 2GB

### Files Changed
- `apps/ai/services/vector/qdrant-service.ts` — NEW: Low-level Qdrant client
- `apps/ai/services/rag/qdrant-rag-service.ts` — NEW: High-level RAG service
- `apps/ai/config/qdrant-config.ts` — NEW: Collection schemas + HNSW tuning
- `apps/ai/agents/react/react-agent-service.ts` — NEW: ReAct reasoning loop
- `apps/ai/agents/react/react-system-prompt.ts` — NEW: CoT system instructions
- `apps/ai/agents/react/tool-definitions.ts` — NEW: Gemini function declarations
- `apps/ai/agents/react/tool-handlers/*.ts` — NEW: 5 tool handler modules
- `apps/ai/scripts/index-qdrant.ts` — NEW: MongoDB → Qdrant re-indexing
- `scripts/provision-droplet.sh` — NEW: DO droplet provisioning
- `docker-compose.yml` — Updated: Qdrant replaces ChromaDB
- `.env.production` — Updated: Qdrant + DO MongoDB vars
- `scripts/deploy-droplet.sh` — Updated: Qdrant health checks + swap + index
- `apps/ai/services/rag/enhanced-hybrid-search-service.ts` — Refactored for Qdrant
- `apps/ai/server/services/auto-index-service.ts` — Refactored for Qdrant
- `apps/ai/server/routers/rag.ts` — Updated imports
- `apps/ai/config/rag-config.ts` — Updated collection references
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — Wired ReactAgentService
- `apps/web/app/api/ai/enhanced-chat/route.ts` — Wired ReactAgentService

### Files Deleted
- `apps/ai/services/vector/chroma-service.ts` — Replaced by qdrant-service.ts
- `apps/ai/services/rag/chroma-rag-service.ts` — Replaced by qdrant-rag-service.ts
- `apps/ai/services/rag/pinecone-service-stub.ts` — Dead compatibility layer
- `apps/ai/scripts/index-chromadb-simple.ts` — Replaced by index-qdrant.ts
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: Update CHANGELOG with Qdrant migration + ReAct agent changes"
```

---

## Deployment Runbook (Post-Implementation)

After all tasks are complete, deploy with these commands:

```bash
# 1. Provision DO infrastructure
./scripts/provision-droplet.sh

# 2. Create DO Managed MongoDB via DO console ($15/mo, same region)
#    Copy the private connection URI

# 3. SSH into droplet
ssh root@<DROPLET_IP>

# 4. Clone and configure
git clone <repo-url> /opt/rnd-ai
cd /opt/rnd-ai
cp .env.production .env
nano .env  # Fill in real credentials + DO MongoDB URI

# 5. First-time setup (swap, directories)
./scripts/deploy-droplet.sh --setup

# 6. Build and start services
./scripts/deploy-droplet.sh --up

# 7. Wait for health checks
./scripts/deploy-droplet.sh --health

# 8. Re-index data into Qdrant
./scripts/deploy-droplet.sh --index

# 9. Verify
curl http://localhost:3000/          # Web app
curl http://localhost:3001/          # AI service
curl http://localhost:6333/healthz   # Qdrant

# 10. Migrate MongoDB data from Atlas (if needed)
# mongodump --uri="<atlas-uri>" --out=/tmp/dump
# mongorestore --uri="<do-mongodb-uri>" /tmp/dump
```
