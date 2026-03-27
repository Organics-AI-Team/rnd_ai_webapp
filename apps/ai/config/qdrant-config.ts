/**
 * Qdrant Vector Database Configuration
 * Manages collection schemas, HNSW tuning, connection settings,
 * and search defaults for the Qdrant vector store.
 *
 * Collections mirror the existing RAG data sources:
 *   - raw_materials_console (all FDA sources merged)
 *   - raw_materials_fda (FDA materials ~31K)
 *   - raw_materials_stock (in-stock ~3K)
 *   - sales_rnd (sales data)
 *   - raw_materials_myskin (MySkin cosmetic ingredients ~4.6K)
 *
 * @author AI Management System
 * @date 2026-03-27
 */

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

/** Qdrant distance metric options */
export type QdrantDistance = 'Cosine' | 'Euclid' | 'Dot';

/** Supported payload field types for Qdrant index creation */
export type PayloadFieldType =
  | 'keyword'
  | 'text'
  | 'integer'
  | 'float'
  | 'bool'
  | 'datetime'
  | 'geo';

/**
 * HNSW index parameters that control recall/speed trade-off.
 *
 * @param m - Number of bi-directional links per node (higher = better recall, more RAM)
 * @param ef_construct - Size of dynamic candidate list during index build
 * @param full_scan_threshold - Point count below which brute-force is preferred
 */
export interface HnswConfig {
  m: number;
  ef_construct: number;
  full_scan_threshold: number;
}

/**
 * Definition for a single payload field index.
 *
 * @param field_name - Name of the payload key to index
 * @param field_type - Qdrant schema type for the index
 */
export interface PayloadIndexDefinition {
  field_name: string;
  field_type: PayloadFieldType;
}

/**
 * Full schema definition for a Qdrant collection.
 *
 * @param name - Collection identifier
 * @param vector_size - Dimensionality of stored vectors (must match embedding model)
 * @param distance - Distance metric used for similarity search
 * @param hnsw_config - HNSW algorithm tuning parameters
 * @param on_disk_payload - When true, payloads are stored on disk to save RAM
 * @param payload_indexes - Array of payload field indexes for filtered search
 * @param description - Human-readable purpose of this collection
 */
export interface QdrantCollectionSchema {
  name: string;
  vector_size: number;
  distance: QdrantDistance;
  hnsw_config: HnswConfig;
  on_disk_payload: boolean;
  payload_indexes: PayloadIndexDefinition[];
  description: string;
}

/**
 * Per-collection search defaults applied when callers omit overrides.
 *
 * @param top_k - Maximum number of results to return
 * @param score_threshold - Minimum cosine similarity score (0-1)
 * @param ef - HNSW ef parameter at query time (higher = better recall, slower)
 * @param with_payload - Whether to include payload in results
 */
export interface QdrantSearchDefaults {
  top_k: number;
  score_threshold: number;
  ef: number;
  with_payload: boolean;
}

/**
 * Connection configuration for the Qdrant instance.
 *
 * @param url - Full HTTP(S) URL of the Qdrant server
 * @param api_key - Optional API key for authenticated clusters
 */
export interface QdrantConnectionConfig {
  url: string;
  api_key?: string;
}

// ---------------------------------------------------------------------------
// Constants — Batch Operations
// ---------------------------------------------------------------------------

/** Number of vectors to upsert in a single batch request */
export const UPSERT_BATCH_SIZE = 100;

/** Delay in ms between embedding generation batches to avoid rate limits */
export const EMBEDDING_BATCH_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Shared Payload Indexes
// ---------------------------------------------------------------------------

/**
 * Common payload field indexes shared across raw-material collections.
 * Centralised here to satisfy DRY; individual collections can extend.
 */
const RAW_MATERIAL_PAYLOAD_INDEXES: PayloadIndexDefinition[] = [
  { field_name: 'rm_code', field_type: 'keyword' },
  { field_name: 'trade_name', field_type: 'keyword' },
  { field_name: 'inci_name', field_type: 'text' },
  { field_name: 'supplier', field_type: 'keyword' },
  { field_name: 'source', field_type: 'keyword' },
  { field_name: 'stock_status', field_type: 'keyword' },
  { field_name: 'cost', field_type: 'float' },
  { field_name: 'indexed_at', field_type: 'datetime' },
];

// ---------------------------------------------------------------------------
// Default HNSW Tuning
// ---------------------------------------------------------------------------

/**
 * Default HNSW parameters tuned for the ~31K raw-material dataset.
 * m=16 / efConstruct=128 balances recall and build time well for
 * medium-sized collections on a single-node droplet.
 */
const DEFAULT_HNSW_CONFIG: HnswConfig = {
  m: 16,
  ef_construct: 128,
  full_scan_threshold: 10_000,
};

// ---------------------------------------------------------------------------
// Collection Schemas
// ---------------------------------------------------------------------------

/**
 * All Qdrant collection schemas keyed by logical name.
 * Vector size 768 matches the Gemini text-embedding-004 output.
 */
export const QDRANT_COLLECTIONS: Record<string, QdrantCollectionSchema> = {
  raw_materials_console: {
    name: 'raw_materials_console',
    vector_size: 768,
    distance: 'Cosine',
    hnsw_config: { ...DEFAULT_HNSW_CONFIG },
    on_disk_payload: true,
    payload_indexes: [...RAW_MATERIAL_PAYLOAD_INDEXES],
    description:
      'Primary collection — all FDA sources merged (~31K). Used for general raw-material knowledge.',
  },

  raw_materials_fda: {
    name: 'raw_materials_fda',
    vector_size: 768,
    distance: 'Cosine',
    hnsw_config: { ...DEFAULT_HNSW_CONFIG },
    on_disk_payload: true,
    payload_indexes: [...RAW_MATERIAL_PAYLOAD_INDEXES],
    description:
      'FDA-registered ingredients (~31K). Dedicated collection for regulatory lookups.',
  },

  raw_materials_stock: {
    name: 'raw_materials_stock',
    vector_size: 768,
    distance: 'Cosine',
    hnsw_config: { ...DEFAULT_HNSW_CONFIG },
    on_disk_payload: true,
    payload_indexes: [...RAW_MATERIAL_PAYLOAD_INDEXES],
    description:
      'In-stock materials (~3K). Fast path for availability and cost queries.',
  },

  sales_rnd: {
    name: 'sales_rnd',
    vector_size: 768,
    distance: 'Cosine',
    hnsw_config: { ...DEFAULT_HNSW_CONFIG },
    on_disk_payload: true,
    payload_indexes: [...RAW_MATERIAL_PAYLOAD_INDEXES],
    description:
      'Sales strategy, market intelligence, and R&D collaboration data.',
  },

  raw_materials_myskin: {
    name: 'raw_materials_myskin',
    vector_size: 768,
    distance: 'Cosine',
    hnsw_config: { ...DEFAULT_HNSW_CONFIG },
    on_disk_payload: true,
    payload_indexes: [
      ...RAW_MATERIAL_PAYLOAD_INDEXES,
      { field_name: 'category', field_type: 'keyword' },
      { field_name: 'cas_no', field_type: 'keyword' },
      { field_name: 'usage_min_pct', field_type: 'float' },
      { field_name: 'usage_max_pct', field_type: 'float' },
    ],
    description:
      'MySkin cosmetic ingredients (~4.6K). Detailed benefits, usage guidelines, CAS/EC numbers.',
  },
};

// ---------------------------------------------------------------------------
// Search Defaults (per collection)
// ---------------------------------------------------------------------------

/**
 * Per-collection search defaults. Mirrors topK / similarityThreshold
 * from rag-config.ts but adds Qdrant-specific `ef` and `with_payload`.
 */
export const QDRANT_SEARCH_DEFAULTS: Record<string, QdrantSearchDefaults> = {
  raw_materials_console: {
    top_k: 5,
    score_threshold: 0.7,
    ef: 128,
    with_payload: true,
  },
  raw_materials_fda: {
    top_k: 5,
    score_threshold: 0.7,
    ef: 128,
    with_payload: true,
  },
  raw_materials_stock: {
    top_k: 5,
    score_threshold: 0.7,
    ef: 128,
    with_payload: true,
  },
  sales_rnd: {
    top_k: 8,
    score_threshold: 0.65,
    ef: 128,
    with_payload: true,
  },
  raw_materials_myskin: {
    top_k: 5,
    score_threshold: 0.7,
    ef: 128,
    with_payload: true,
  },
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Build Qdrant connection config from environment variables.
 *
 * Reads:
 *   - QDRANT_URL     (default: http://localhost:6333)
 *   - QDRANT_API_KEY  (optional, omitted when empty)
 *
 * @returns QdrantConnectionConfig with url and optional api_key
 */
export function get_qdrant_connection_config(): QdrantConnectionConfig {
  console.log('[qdrant-config] get_qdrant_connection_config — start');

  const url = process.env.QDRANT_URL || 'http://localhost:6333';
  const api_key = process.env.QDRANT_API_KEY || undefined;

  const config: QdrantConnectionConfig = { url, ...(api_key ? { api_key } : {}) };

  console.log('[qdrant-config] get_qdrant_connection_config — done', {
    url,
    has_api_key: !!api_key,
  });

  return config;
}

/**
 * Retrieve the schema definition for a specific collection.
 *
 * @param collection_name - Key in QDRANT_COLLECTIONS (e.g. "raw_materials_stock")
 * @returns The matching QdrantCollectionSchema
 * @throws Error if the collection name is not recognised
 */
export function get_collection_schema(
  collection_name: string,
): QdrantCollectionSchema {
  console.log('[qdrant-config] get_collection_schema — start', { collection_name });

  const schema = QDRANT_COLLECTIONS[collection_name];
  if (!schema) {
    const available = Object.keys(QDRANT_COLLECTIONS).join(', ');
    throw new Error(
      `Unknown Qdrant collection "${collection_name}". Available: ${available}`,
    );
  }

  console.log('[qdrant-config] get_collection_schema — done', {
    collection_name,
    vector_size: schema.vector_size,
  });

  return schema;
}

/**
 * Retrieve the search defaults for a specific collection.
 *
 * @param collection_name - Key in QDRANT_SEARCH_DEFAULTS
 * @returns The matching QdrantSearchDefaults
 * @throws Error if the collection name is not recognised
 */
export function get_search_defaults(
  collection_name: string,
): QdrantSearchDefaults {
  console.log('[qdrant-config] get_search_defaults — start', { collection_name });

  const defaults = QDRANT_SEARCH_DEFAULTS[collection_name];
  if (!defaults) {
    const available = Object.keys(QDRANT_SEARCH_DEFAULTS).join(', ');
    throw new Error(
      `No search defaults for collection "${collection_name}". Available: ${available}`,
    );
  }

  console.log('[qdrant-config] get_search_defaults — done', {
    collection_name,
    top_k: defaults.top_k,
  });

  return defaults;
}

/**
 * Return all registered collection names.
 *
 * @returns Array of collection name strings
 */
export function get_collection_names(): string[] {
  console.log('[qdrant-config] get_collection_names — start');

  const names = Object.keys(QDRANT_COLLECTIONS);

  console.log('[qdrant-config] get_collection_names — done', { count: names.length });

  return names;
}

/**
 * Validate that the Qdrant environment is properly configured.
 * Checks for QDRANT_URL presence (api key is optional).
 *
 * @returns Object with isValid flag and list of missing env vars
 */
export function validate_qdrant_environment(): {
  is_valid: boolean;
  missing: string[];
} {
  console.log('[qdrant-config] validate_qdrant_environment — start');

  const missing: string[] = [];

  if (!process.env.QDRANT_URL) {
    // Not strictly required (has default), but warn when unset in production
    if (process.env.NODE_ENV === 'production') {
      missing.push('QDRANT_URL');
    }
  }

  const result = { is_valid: missing.length === 0, missing };

  console.log('[qdrant-config] validate_qdrant_environment — done', result);

  return result;
}
