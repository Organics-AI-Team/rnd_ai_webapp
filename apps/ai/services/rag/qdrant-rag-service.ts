/**
 * Qdrant RAG (Retrieval-Augmented Generation) Service
 * High-level RAG service — drop-in replacement for ChromaRAGService.
 *
 * Orchestrates:
 *   - Embedding generation via UniversalEmbeddingService
 *   - Vector storage / search via QdrantService (low-level client)
 *   - Document preparation, batch indexing, and result formatting
 *
 * Service name → Qdrant collection mapping:
 *   rawMaterialsAllAI  → raw_materials_fda
 *   rawMaterialsAI     → raw_materials_console
 *   salesRndAI         → sales_rnd
 *
 * @author AI Management System
 * @date 2026-03-27
 */

import { get_qdrant_service, QdrantService, type QdrantPoint } from '../vector/qdrant-service';
import {
  createEmbeddingService,
  UniversalEmbeddingService,
} from '../embeddings/universal-embedding-service';
import { Logger } from '@rnd-ai/shared-utils';
import { ErrorHandler, ErrorType } from '@/ai/utils/error-handler';
import { EMBEDDING_BATCH_DELAY_MS } from '../../config/qdrant-config';

const logger = Logger.scope('QdrantRAGService');

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

/**
 * Document interface for RAG operations.
 *
 * @param id       - Unique document identifier (e.g. MongoDB _id or rm_code)
 * @param text     - Combined text for embedding generation
 * @param metadata - Structured metadata stored alongside the vector
 */
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
  };
}

/**
 * Search configuration controlling retrieval behaviour.
 *
 * @param topK                - Maximum number of results to return
 * @param similarityThreshold - Minimum cosine similarity score (0-1)
 * @param includeMetadata     - Whether to return payload metadata
 * @param filter              - Qdrant filter object for pre-filtered search
 * @param collectionName      - Override the default collection for this query
 */
export interface RAGSearchConfig {
  topK: number;
  similarityThreshold: number;
  includeMetadata: boolean;
  filter?: Record<string, unknown>;
  collectionName?: string;
}

/**
 * A single search result returned by the RAG layer.
 *
 * @param id       - Point / document identifier
 * @param score    - Cosine similarity score (0-1)
 * @param metadata - Payload fields from the vector store
 * @param document - Original text stored alongside the vector (if available)
 */
export interface RAGSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
  document?: string;
}

/**
 * Known service names that map to Qdrant collections.
 */
export type RAGServicesConfig = {
  rawMaterialsAllAI: unknown;
  rawMaterialsAI: unknown;
  salesRndAI: unknown;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Service Name → Collection Mapping
// ---------------------------------------------------------------------------

/**
 * Maps high-level service names to Qdrant collection identifiers.
 * Kept as a plain object so it can be extended without touching config files.
 */
const SERVICE_COLLECTION_MAP: Record<string, string> = {
  rawMaterialsAllAI: 'raw_materials_fda',
  rawMaterialsAI: 'raw_materials_console',
  salesRndAI: 'sales_rnd',
};

/**
 * Default search parameters per service, aligned with rag-config.ts values.
 */
const SERVICE_DEFAULTS: Record<string, Omit<RAGSearchConfig, 'filter' | 'collectionName'>> = {
  rawMaterialsAllAI: { topK: 5, similarityThreshold: 0.7, includeMetadata: true },
  rawMaterialsAI: { topK: 5, similarityThreshold: 0.7, includeMetadata: true },
  salesRndAI: { topK: 8, similarityThreshold: 0.65, includeMetadata: true },
};

/**
 * Resolve search defaults for a given service name.
 *
 * @param service_name - Key from RAGServicesConfig
 * @returns Default RAGSearchConfig (without filter/collectionName)
 */
function get_service_defaults(
  service_name: string,
): Omit<RAGSearchConfig, 'filter' | 'collectionName'> {
  console.log('[QdrantRAGService] get_service_defaults — start', { service_name });

  const defaults = SERVICE_DEFAULTS[service_name] || SERVICE_DEFAULTS.rawMaterialsAllAI;

  console.log('[QdrantRAGService] get_service_defaults — done', { service_name, defaults });
  return defaults;
}

// ---------------------------------------------------------------------------
// Module-level embedding service (lazy singleton)
// ---------------------------------------------------------------------------

let _embedding_service: UniversalEmbeddingService | null = null;

/**
 * Return the module-level embedding service, creating it on first call.
 *
 * @returns UniversalEmbeddingService singleton
 */
function get_default_embedding_service(): UniversalEmbeddingService {
  console.log('[QdrantRAGService] get_default_embedding_service — start');

  if (!_embedding_service) {
    _embedding_service = createEmbeddingService();
  }

  console.log('[QdrantRAGService] get_default_embedding_service — done');
  return _embedding_service;
}

// ---------------------------------------------------------------------------
// QdrantRAGService Class
// ---------------------------------------------------------------------------

/**
 * High-level RAG service backed by Qdrant.
 * Provides document indexing, semantic search, formatting, and stats
 * through the QdrantService low-level client and UniversalEmbeddingService.
 */
export class QdrantRAGService {
  private qdrant_service: QdrantService;
  private config: RAGSearchConfig;
  private embedding_service: UniversalEmbeddingService;
  private collection_name: string;

  private initialized = false;
  private init_promise: Promise<void> | null = null;

  /**
   * Create a new QdrantRAGService instance.
   *
   * @param service_name            - Key from RAGServicesConfig (determines collection + defaults)
   * @param config                  - Optional partial config to override defaults
   * @param custom_embedding_service - Optional pre-configured embedding service
   */
  constructor(
    service_name?: keyof RAGServicesConfig,
    config?: Partial<RAGSearchConfig>,
    custom_embedding_service?: UniversalEmbeddingService,
  ) {
    console.log('[QdrantRAGService] constructor — start', { service_name });

    const resolved_name = (service_name || 'rawMaterialsAllAI') as string;
    const defaults = get_service_defaults(resolved_name);

    this.config = {
      topK: defaults.topK,
      similarityThreshold: defaults.similarityThreshold,
      includeMetadata: defaults.includeMetadata,
      ...config,
    };

    this.collection_name =
      config?.collectionName || SERVICE_COLLECTION_MAP[resolved_name] || 'raw_materials_fda';

    this.embedding_service = custom_embedding_service || get_default_embedding_service();
    this.qdrant_service = get_qdrant_service();

    // Lazy initialisation — the promise is awaited before any operation
    this.init_promise = this.initialize_qdrant();

    logger.info('Initializing QdrantRAGService', {
      service_name: resolved_name,
      collection: this.collection_name,
      config: this.config,
    });
    console.log('[QdrantRAGService] constructor — done', {
      collection: this.collection_name,
    });
  }

  // -----------------------------------------------------------------------
  // Initialisation
  // -----------------------------------------------------------------------

  /**
   * Initialize the underlying Qdrant connection.
   * Safe to call multiple times; only the first invocation connects.
   */
  private async initialize_qdrant(): Promise<void> {
    if (this.initialized) return;

    console.log('[QdrantRAGService] initialize_qdrant — start');

    try {
      await this.qdrant_service.ensure_initialised();
      this.initialized = true;
      logger.info('QdrantRAGService initialized', { collection: this.collection_name });
      console.log('[QdrantRAGService] initialize_qdrant — done', {
        collection: this.collection_name,
      });
    } catch (error) {
      logger.error('Failed to initialize QdrantRAGService', error);
      console.log('[QdrantRAGService] initialize_qdrant — error', error);
      throw ErrorHandler.wrap(
        error,
        'Failed to initialize QdrantRAGService',
        ErrorType.DATABASE_ERROR,
      );
    }
  }

  /**
   * Guard that ensures the service is fully initialized before any operation.
   *
   * @throws Error if initialisation has not completed
   */
  private async ensure_initialized(): Promise<void> {
    if (this.init_promise) {
      await this.init_promise;
    }
    if (!this.initialized) {
      throw new Error('QdrantRAGService not initialized');
    }
  }

  // -----------------------------------------------------------------------
  // Embedding
  // -----------------------------------------------------------------------

  /**
   * Generate embeddings for an array of text strings.
   *
   * @param texts - Array of text strings to embed
   * @returns 2D array of embedding vectors
   */
  async create_embeddings(texts: string[]): Promise<number[][]> {
    await this.ensure_initialized();
    console.log('[QdrantRAGService] create_embeddings — start', { text_count: texts.length });

    try {
      const embeddings = await this.embedding_service.createEmbeddings(texts);
      logger.info('Embeddings created', { count: embeddings.length });
      console.log('[QdrantRAGService] create_embeddings — done', { count: embeddings.length });
      return embeddings;
    } catch (error) {
      logger.error('Failed to create embeddings', error);
      console.log('[QdrantRAGService] create_embeddings — error', error);
      throw ErrorHandler.wrap(error, 'Failed to create embeddings', ErrorType.MODEL_ERROR);
    }
  }

  // -----------------------------------------------------------------------
  // Index / Upsert
  // -----------------------------------------------------------------------

  /**
   * Upsert documents into the Qdrant collection.
   * Generates embeddings, converts to QdrantPoint format,
   * and delegates batched upsert to the low-level service.
   *
   * @param documents - Array of RawMaterialDocument to store
   */
  async upsert_documents(documents: RawMaterialDocument[]): Promise<void> {
    await this.ensure_initialized();
    console.log('[QdrantRAGService] upsert_documents — start', {
      document_count: documents.length,
      collection: this.collection_name,
    });

    try {
      const texts = documents.map((doc) => doc.text);
      const embeddings = await this.create_embeddings(texts);

      const points: QdrantPoint[] = documents.map((doc, index) => ({
        id: doc.id,
        vector: embeddings[index],
        payload: {
          ...doc.metadata,
          text: doc.text,
          indexed_at: new Date().toISOString(),
        },
      }));

      await this.qdrant_service.upsert(this.collection_name, points);

      logger.info('Documents upserted', {
        count: points.length,
        collection: this.collection_name,
      });
      console.log('[QdrantRAGService] upsert_documents — done', {
        count: points.length,
        collection: this.collection_name,
      });
    } catch (error) {
      logger.error('Failed to upsert documents', error, {
        collection: this.collection_name,
        document_count: documents.length,
      });
      console.log('[QdrantRAGService] upsert_documents — error', {
        collection: this.collection_name,
      });
      throw ErrorHandler.wrap(
        error,
        'Failed to upsert documents to Qdrant',
        ErrorType.DATABASE_ERROR,
      );
    }
  }

  /**
   * Batch-process raw material objects for vectorization.
   * Converts each material via prepare_raw_material_document,
   * then upserts in configurable batch sizes with an inter-batch delay
   * to avoid embedding API rate limits.
   *
   * @param materials  - Array of raw material objects (from MongoDB or similar)
   * @param batch_size - Number of documents per batch (default 50)
   */
  async batch_process_documents(
    materials: Record<string, unknown>[],
    batch_size = 50,
  ): Promise<void> {
    console.log('[QdrantRAGService] batch_process_documents — start', {
      material_count: materials.length,
      batch_size,
    });

    const documents = materials.map((material) =>
      QdrantRAGService.prepare_raw_material_document(material),
    );

    const total_batches = Math.ceil(documents.length / batch_size);

    logger.info('Processing documents in batches', {
      total_documents: documents.length,
      batch_size,
      total_batches,
    });

    for (let i = 0; i < documents.length; i += batch_size) {
      const batch = documents.slice(i, i + batch_size);
      const batch_number = Math.floor(i / batch_size) + 1;

      await this.upsert_documents(batch);

      logger.info('Batch processed', { batch_number, total_batches });
      console.log('[QdrantRAGService] batch_process_documents — batch', {
        batch_number,
        total_batches,
      });

      // Delay between batches to respect embedding API rate limits
      if (i + batch_size < documents.length) {
        await new Promise((resolve) => setTimeout(resolve, EMBEDDING_BATCH_DELAY_MS));
      }
    }

    logger.info('All batches processed', { total_documents: documents.length });
    console.log('[QdrantRAGService] batch_process_documents — done', {
      total_documents: documents.length,
    });
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  /**
   * Search for similar documents by embedding the query and
   * performing a vector similarity search in Qdrant.
   *
   * @param query   - Natural language search query
   * @param options - Optional search config overrides
   * @returns Array of RAGSearchResult sorted by descending score
   */
  async search_similar(
    query: string,
    options?: Partial<RAGSearchConfig>,
  ): Promise<RAGSearchResult[]> {
    await this.ensure_initialized();
    console.log('[QdrantRAGService] search_similar — start', {
      query,
      collection: this.collection_name,
    });

    try {
      const search_config = { ...this.config, ...options };
      const collection = search_config.collectionName || this.collection_name;

      // Embed the query
      const query_embedding = await this.create_embeddings([query]);

      logger.info('Searching Qdrant', {
        collection,
        topK: search_config.topK,
        threshold: search_config.similarityThreshold,
      });

      // Search via low-level client
      const raw_results = await this.qdrant_service.search(collection, query_embedding[0], {
        topK: search_config.topK,
        scoreThreshold: search_config.similarityThreshold,
        filter: search_config.filter as Record<string, unknown> | undefined,
        withPayload: search_config.includeMetadata,
      });

      // Map to RAGSearchResult
      const results: RAGSearchResult[] = raw_results.map((hit) => ({
        id: hit.id,
        score: hit.score,
        metadata: hit.payload,
        document: (hit.payload.text as string) || undefined,
      }));

      logger.info('Search completed', {
        collection,
        result_count: results.length,
        threshold: search_config.similarityThreshold,
      });
      console.log('[QdrantRAGService] search_similar — done', {
        collection,
        result_count: results.length,
      });

      return results;
    } catch (error) {
      logger.error('Search failed', error, { query, collection: this.collection_name });
      console.log('[QdrantRAGService] search_similar — error', {
        collection: this.collection_name,
      });
      throw ErrorHandler.wrap(error, 'Failed to search Qdrant', ErrorType.DATABASE_ERROR);
    }
  }

  /**
   * Search for similar documents and format results as markdown.
   * Convenience wrapper around search_similar + format_search_results.
   *
   * @param query   - Natural language search query
   * @param options - Optional search config overrides
   * @returns Markdown-formatted string of search results
   */
  async search_and_format(
    query: string,
    options?: Partial<RAGSearchConfig>,
  ): Promise<string> {
    console.log('[QdrantRAGService] search_and_format — start', { query });

    const results = await this.search_similar(query, options);
    const formatted = QdrantRAGService.format_search_results(results);

    console.log('[QdrantRAGService] search_and_format — done', {
      result_count: results.length,
    });
    return formatted;
  }

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  /**
   * Delete documents from the Qdrant collection by their IDs.
   *
   * @param ids - Array of document / point IDs to delete
   */
  async delete_documents(ids: string[]): Promise<void> {
    await this.ensure_initialized();
    console.log('[QdrantRAGService] delete_documents — start', {
      id_count: ids.length,
      collection: this.collection_name,
    });

    try {
      await this.qdrant_service.delete(this.collection_name, ids);

      logger.info('Documents deleted', {
        count: ids.length,
        collection: this.collection_name,
      });
      console.log('[QdrantRAGService] delete_documents — done', {
        count: ids.length,
        collection: this.collection_name,
      });
    } catch (error) {
      logger.error('Failed to delete documents', error, {
        collection: this.collection_name,
      });
      console.log('[QdrantRAGService] delete_documents — error', {
        collection: this.collection_name,
      });
      throw ErrorHandler.wrap(
        error,
        'Failed to delete documents from Qdrant',
        ErrorType.DATABASE_ERROR,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  /**
   * Retrieve index/collection statistics from Qdrant.
   *
   * @returns Object with pointsCount, status, and config
   */
  async get_index_stats(): Promise<{
    pointsCount: number;
    status: string;
    config: Record<string, unknown>;
  }> {
    await this.ensure_initialized();
    console.log('[QdrantRAGService] get_index_stats — start', {
      collection: this.collection_name,
    });

    try {
      const stats = await this.qdrant_service.get_collection_info(this.collection_name);

      logger.info('Index stats retrieved', {
        collection: this.collection_name,
        points_count: stats.pointsCount,
        status: stats.status,
      });
      console.log('[QdrantRAGService] get_index_stats — done', {
        collection: this.collection_name,
        points_count: stats.pointsCount,
      });

      return stats;
    } catch (error) {
      logger.error('Failed to get index stats', error);
      console.log('[QdrantRAGService] get_index_stats — error', {
        collection: this.collection_name,
      });
      throw ErrorHandler.wrap(
        error,
        'Failed to get collection statistics',
        ErrorType.DATABASE_ERROR,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Config
  // -----------------------------------------------------------------------

  /**
   * Update the service configuration at runtime.
   * If collectionName is provided, the target collection is also switched.
   *
   * @param new_config - Partial RAGSearchConfig to merge
   */
  update_config(new_config: Partial<RAGSearchConfig>): void {
    console.log('[QdrantRAGService] update_config — start', { new_config });

    this.config = { ...this.config, ...new_config };

    if (new_config.collectionName) {
      this.collection_name = new_config.collectionName;
    }

    logger.info('Configuration updated', { config: this.config });
    console.log('[QdrantRAGService] update_config — done', { config: this.config });
  }

  /**
   * Return a copy of the current search configuration.
   *
   * @returns RAGSearchConfig snapshot
   */
  get_config(): RAGSearchConfig {
    console.log('[QdrantRAGService] get_config');
    return { ...this.config };
  }

  // -----------------------------------------------------------------------
  // Static Helpers
  // -----------------------------------------------------------------------

  /**
   * Convert a raw material object (e.g. from MongoDB) into a RawMaterialDocument
   * suitable for embedding and upserting.
   *
   * Combines all meaningful text fields into a single searchable string
   * and extracts structured metadata for filtered retrieval.
   *
   * @param material - Raw material record with arbitrary shape
   * @returns RawMaterialDocument ready for upsert_documents
   */
  static prepare_raw_material_document(
    material: Record<string, unknown>,
  ): RawMaterialDocument {
    const id =
      (material._id as { toString(): string })?.toString?.() ||
      (material.rm_code as string) ||
      Math.random().toString(36).slice(2);

    // Combine all text fields for comprehensive semantic search
    const text_parts: string[] = [];
    if (material.rm_code) text_parts.push(`Material Code: ${material.rm_code}`);
    if (material.trade_name) text_parts.push(`Trade Name: ${material.trade_name}`);
    if (material.inci_name) text_parts.push(`INCI Name: ${material.inci_name}`);
    if (material.supplier) text_parts.push(`Supplier: ${material.supplier}`);
    if (material.company_name) text_parts.push(`Company: ${material.company_name}`);
    if (material.rm_cost) text_parts.push(`Cost: ${material.rm_cost}`);
    if (material.benefits) text_parts.push(`Benefits: ${material.benefits}`);
    if (material.details) text_parts.push(`Details: ${material.details}`);

    return {
      id,
      text: text_parts.join('. '),
      metadata: {
        rm_code: material.rm_code as string | undefined,
        trade_name: material.trade_name as string | undefined,
        inci_name: material.inci_name as string | undefined,
        supplier: material.supplier as string | undefined,
        company_name: material.company_name as string | undefined,
        rm_cost: material.rm_cost as string | undefined,
        benefits: material.benefits as string | undefined,
        details: material.details as string | undefined,
        source: (material.source as string) || 'raw_materials_console',
        stock_status: material.stock_status as string | undefined,
      },
    };
  }

  /**
   * Format an array of search results into a markdown string
   * suitable for injection into an LLM context window.
   *
   * @param results - Array of RAGSearchResult (or compatible objects with metadata/score)
   * @returns Markdown-formatted search results string
   */
  static format_search_results(results: RAGSearchResult[]): string {
    if (!results || results.length === 0) {
      return '\n\nNo relevant raw materials found in the vector database.';
    }

    const formatted = results.map((result, index) => {
      const metadata = result.metadata || {};
      let entry = `${index + 1}. **${(metadata.trade_name as string) || 'Unknown Material'}**\n`;

      if (metadata.rm_code) entry += `   **Material Code:** ${metadata.rm_code}\n`;
      if (metadata.inci_name) entry += `   **INCI Name:** ${metadata.inci_name}\n`;
      if (metadata.supplier) entry += `   **Supplier:** ${metadata.supplier}\n`;
      if (metadata.company_name) entry += `   **Company:** ${metadata.company_name}\n`;
      if (metadata.rm_cost) entry += `   **Cost:** ${metadata.rm_cost}\n`;
      if (metadata.benefits) entry += `   **Benefits:** ${metadata.benefits}\n`;
      if (metadata.details) entry += `   **Details:** ${metadata.details}\n`;
      if (metadata.stock_status) entry += `   **Stock Status:** ${metadata.stock_status}\n`;
      entry += `   **Similarity Score:** ${(result.score || 0).toFixed(3)}\n`;

      return entry;
    });

    return '\n\nVector Database Search Results (Qdrant):\n' + formatted.join('\n\n');
  }
}

// ---------------------------------------------------------------------------
// Backward-Compatible Aliases
// ---------------------------------------------------------------------------

/**
 * Aliases for backward compatibility with consumers that reference PineconeRAGService / RAGConfig.
 */
export { QdrantRAGService as PineconeRAGService };
export type { RAGSearchConfig as RAGConfig };
