/**
 * Qdrant Vector Database Service
 * Low-level CRUD operations for the Qdrant vector store.
 * Drop-in replacement for chroma-service.ts with typed payloads,
 * batched upserts, pre-filtered search, and collection lifecycle management.
 *
 * Features:
 * - Singleton pattern with lazy initialisation
 * - Typed point / search / result interfaces
 * - Batched upsert (UPSERT_BATCH_SIZE per request)
 * - Pre-filter search with scoreThreshold and HNSW ef override
 * - Collection schema-driven creation (indexes + HNSW config)
 * - Health check and scroll support
 *
 * @author AI Management System
 * @date 2026-03-27
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { Logger } from '@rnd-ai/shared-utils';
import { ErrorHandler, ErrorType } from '@/ai/utils/error-handler';

import {
  get_qdrant_connection_config,
  get_collection_names,
  QDRANT_COLLECTIONS,
  QDRANT_SEARCH_DEFAULTS,
  UPSERT_BATCH_SIZE,
  type QdrantCollectionSchema,
} from '../../config/qdrant-config';

const logger = Logger.scope('QdrantService');

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

/**
 * A single point to store in Qdrant.
 *
 * @param id      - Unique point identifier (UUID or string)
 * @param vector  - Dense embedding vector (must match collection vector_size)
 * @param payload - Arbitrary key/value metadata stored alongside the vector
 */
export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

/**
 * Options controlling a vector similarity search.
 *
 * @param topK           - Maximum number of results to return
 * @param scoreThreshold - Minimum cosine similarity score (0-1); results below are discarded
 * @param filter         - Qdrant filter object for pre-filtering before ANN search
 * @param ef             - HNSW ef parameter at query time (higher = better recall, slower)
 * @param withPayload    - true to return all payload fields, or string[] to select specific fields
 */
export interface QdrantSearchOptions {
  topK: number;
  scoreThreshold?: number;
  filter?: Record<string, unknown>;
  ef?: number;
  withPayload?: boolean | string[];
}

/**
 * A single search result returned by Qdrant.
 *
 * @param id      - Point identifier
 * @param score   - Cosine similarity score (0-1)
 * @param payload - Payload fields matching the withPayload selection
 */
export interface QdrantSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

/**
 * Summary information about a Qdrant collection.
 *
 * @param pointsCount - Total number of stored points
 * @param status      - Collection status string (e.g. "green")
 * @param config      - Raw collection configuration from Qdrant
 */
export interface QdrantCollectionInfo {
  pointsCount: number;
  status: string;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// QdrantService Class
// ---------------------------------------------------------------------------

/**
 * Low-level Qdrant vector database client.
 * Provides collection management, batched upsert, filtered search,
 * delete, scroll, and health-check operations.
 */
export class QdrantService {
  private client: QdrantClient | null = null;
  private initialized = false;
  private init_promise: Promise<void> | null = null;

  constructor() {
    logger.debug('QdrantService constructor called');
    this.init_promise = this.ensure_initialised();
  }

  // -----------------------------------------------------------------------
  // Initialisation
  // -----------------------------------------------------------------------

  /**
   * Lazily initialise the QdrantClient using environment-driven config.
   * Safe to call multiple times; only the first invocation connects.
   */
  async ensure_initialised(): Promise<void> {
    if (this.initialized) {
      logger.debug('QdrantService already initialised');
      return;
    }

    console.log('[QdrantService] ensure_initialised — start');

    try {
      const connection = get_qdrant_connection_config();

      this.client = new QdrantClient({
        url: connection.url,
        ...(connection.api_key ? { apiKey: connection.api_key } : {}),
      });

      // Verify connectivity
      await this.client.getCollections();

      this.initialized = true;
      logger.info('QdrantService initialised successfully', { url: connection.url });
      console.log('[QdrantService] ensure_initialised — done', { url: connection.url });
    } catch (error) {
      logger.error('Failed to initialise QdrantService', error);
      console.log('[QdrantService] ensure_initialised — error', error);
      throw ErrorHandler.wrap(
        error,
        'Failed to connect to Qdrant',
        ErrorType.DATABASE_ERROR,
        { qdrantUrl: process.env.QDRANT_URL },
      );
    }
  }

  /**
   * Guard that ensures the client is ready before any operation.
   *
   * @throws Error if initialisation has not completed or client is null
   */
  private async await_ready(): Promise<QdrantClient> {
    if (this.init_promise) {
      await this.init_promise;
    }
    if (!this.initialized || !this.client) {
      throw new Error('QdrantService not initialised');
    }
    return this.client;
  }

  // -----------------------------------------------------------------------
  // Collection Management
  // -----------------------------------------------------------------------

  /**
   * Create a collection from a schema definition if it does not already exist.
   * Creates the collection with HNSW config, on-disk payload, and payload indexes.
   *
   * @param schema - Full collection schema from qdrant-config
   */
  async ensure_collection(schema: QdrantCollectionSchema): Promise<void> {
    console.log('[QdrantService] ensure_collection — start', { name: schema.name });
    const client = await this.await_ready();

    try {
      // Check whether collection already exists
      const existing = await client.getCollections();
      const exists = existing.collections.some(
        (c: { name: string }) => c.name === schema.name,
      );

      if (exists) {
        logger.info('Collection already exists, skipping creation', { name: schema.name });
        console.log('[QdrantService] ensure_collection — already exists', { name: schema.name });
        return;
      }

      // Create collection with vectors config and HNSW tuning
      await client.createCollection(schema.name, {
        vectors: {
          size: schema.vector_size,
          distance: schema.distance,
        },
        hnsw_config: {
          m: schema.hnsw_config.m,
          ef_construct: schema.hnsw_config.ef_construct,
          full_scan_threshold: schema.hnsw_config.full_scan_threshold,
        },
        on_disk_payload: schema.on_disk_payload,
      });

      // Create payload indexes for filtered search
      for (const index_def of schema.payload_indexes) {
        await client.createPayloadIndex(schema.name, {
          field_name: index_def.field_name,
          field_schema: index_def.field_type,
        });
      }

      logger.info('Collection created with indexes', {
        name: schema.name,
        vector_size: schema.vector_size,
        index_count: schema.payload_indexes.length,
      });
      console.log('[QdrantService] ensure_collection — done', { name: schema.name });
    } catch (error) {
      logger.error('Failed to ensure collection', error, { name: schema.name });
      console.log('[QdrantService] ensure_collection — error', { name: schema.name });
      throw ErrorHandler.wrap(
        error,
        `Failed to ensure collection: ${schema.name}`,
        ErrorType.DATABASE_ERROR,
        { collectionName: schema.name },
      );
    }
  }

  /**
   * Ensure all collections defined in QDRANT_COLLECTIONS exist.
   * Iterates every registered schema and calls ensure_collection.
   */
  async ensure_all_collections(): Promise<void> {
    console.log('[QdrantService] ensure_all_collections — start');

    const names = get_collection_names();
    for (const name of names) {
      await this.ensure_collection(QDRANT_COLLECTIONS[name]);
    }

    logger.info('All collections ensured', { count: names.length });
    console.log('[QdrantService] ensure_all_collections — done', { count: names.length });
  }

  /**
   * Delete a collection by name.
   *
   * @param name - Collection identifier to delete
   */
  async delete_collection(name: string): Promise<void> {
    console.log('[QdrantService] delete_collection — start', { name });
    const client = await this.await_ready();

    try {
      await client.deleteCollection(name);
      logger.info('Collection deleted', { name });
      console.log('[QdrantService] delete_collection — done', { name });
    } catch (error) {
      logger.error('Failed to delete collection', error, { name });
      console.log('[QdrantService] delete_collection — error', { name });
      throw ErrorHandler.wrap(
        error,
        `Failed to delete collection: ${name}`,
        ErrorType.DATABASE_ERROR,
        { collectionName: name },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Point Operations
  // -----------------------------------------------------------------------

  /**
   * Upsert points into a collection in batches of UPSERT_BATCH_SIZE.
   * Prevents timeouts and memory spikes on large inserts.
   *
   * @param collection_name - Target collection
   * @param points          - Array of QdrantPoint objects to upsert
   */
  async upsert(collection_name: string, points: QdrantPoint[]): Promise<void> {
    console.log('[QdrantService] upsert — start', {
      collection_name,
      point_count: points.length,
    });
    const client = await this.await_ready();

    if (!points || points.length === 0) {
      logger.warn('No points to upsert, skipping');
      console.log('[QdrantService] upsert — skipped (empty)');
      return;
    }

    try {
      const total_batches = Math.ceil(points.length / UPSERT_BATCH_SIZE);

      for (let batch_index = 0; batch_index < total_batches; batch_index++) {
        const start = batch_index * UPSERT_BATCH_SIZE;
        const end = Math.min(start + UPSERT_BATCH_SIZE, points.length);
        const batch = points.slice(start, end);

        await client.upsert(collection_name, {
          wait: true,
          points: batch.map((point) => ({
            id: point.id,
            vector: point.vector,
            payload: point.payload,
          })),
        });

        logger.debug('Batch upserted', {
          collection_name,
          batch: `${batch_index + 1}/${total_batches}`,
          size: batch.length,
        });
      }

      logger.info('Upsert completed', {
        collection_name,
        total_points: points.length,
        total_batches,
      });
      console.log('[QdrantService] upsert — done', {
        collection_name,
        total_points: points.length,
      });
    } catch (error) {
      logger.error('Failed to upsert points', error, {
        collection_name,
        point_count: points.length,
      });
      console.log('[QdrantService] upsert — error', { collection_name });
      throw ErrorHandler.wrap(
        error,
        `Failed to upsert points to collection: ${collection_name}`,
        ErrorType.DATABASE_ERROR,
        { collectionName: collection_name, pointCount: points.length },
      );
    }
  }

  /**
   * Perform a vector similarity search with optional pre-filtering,
   * score threshold, and HNSW ef override.
   *
   * Falls back to per-collection search defaults from qdrant-config
   * when options fields are omitted.
   *
   * @param collection_name - Collection to search
   * @param vector          - Query embedding vector
   * @param options         - Search parameters (topK, scoreThreshold, filter, ef, withPayload)
   * @returns Array of QdrantSearchResult sorted by descending score
   */
  async search(
    collection_name: string,
    vector: number[],
    options: Partial<QdrantSearchOptions> = {},
  ): Promise<QdrantSearchResult[]> {
    console.log('[QdrantService] search — start', {
      collection_name,
      vector_dim: vector.length,
      topK: options.topK,
    });
    const client = await this.await_ready();

    try {
      // Merge caller options with per-collection defaults
      const defaults = QDRANT_SEARCH_DEFAULTS[collection_name];
      const top_k = options.topK ?? defaults?.top_k ?? 5;
      const score_threshold = options.scoreThreshold ?? defaults?.score_threshold;
      const ef = options.ef ?? defaults?.ef;
      const with_payload = options.withPayload ?? defaults?.with_payload ?? true;

      const search_params: Record<string, unknown> = {
        vector,
        limit: top_k,
        with_payload,
      };

      if (score_threshold !== undefined) {
        search_params.score_threshold = score_threshold;
      }

      if (options.filter) {
        search_params.filter = options.filter;
      }

      if (ef !== undefined) {
        search_params.params = { hnsw_ef: ef };
      }

      const raw_results = await client.search(collection_name, search_params as any);

      const results: QdrantSearchResult[] = raw_results.map((hit: any) => ({
        id: String(hit.id),
        score: hit.score,
        payload: (hit.payload as Record<string, unknown>) ?? {},
      }));

      logger.info('Search completed', {
        collection_name,
        result_count: results.length,
        top_k,
      });
      console.log('[QdrantService] search — done', {
        collection_name,
        result_count: results.length,
      });

      return results;
    } catch (error) {
      logger.error('Failed to search collection', error, { collection_name });
      console.log('[QdrantService] search — error', { collection_name });
      throw ErrorHandler.wrap(
        error,
        `Failed to search collection: ${collection_name}`,
        ErrorType.DATABASE_ERROR,
        { collectionName: collection_name },
      );
    }
  }

  /**
   * Delete points from a collection by ID array or Qdrant filter object.
   *
   * @param collection_name - Target collection
   * @param ids_or_filter   - Array of point IDs, or a Qdrant filter object
   */
  async delete(
    collection_name: string,
    ids_or_filter: string[] | Record<string, unknown>,
  ): Promise<void> {
    console.log('[QdrantService] delete — start', { collection_name });
    const client = await this.await_ready();

    try {
      if (Array.isArray(ids_or_filter)) {
        // Delete by point IDs
        await client.delete(collection_name, {
          wait: true,
          points: ids_or_filter,
        });
        logger.info('Points deleted by IDs', {
          collection_name,
          count: ids_or_filter.length,
        });
      } else {
        // Delete by filter
        await client.delete(collection_name, {
          wait: true,
          filter: ids_or_filter as any,
        });
        logger.info('Points deleted by filter', { collection_name });
      }

      console.log('[QdrantService] delete — done', { collection_name });
    } catch (error) {
      logger.error('Failed to delete points', error, { collection_name });
      console.log('[QdrantService] delete — error', { collection_name });
      throw ErrorHandler.wrap(
        error,
        `Failed to delete points from collection: ${collection_name}`,
        ErrorType.DATABASE_ERROR,
        { collectionName: collection_name },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Info & Diagnostics
  // -----------------------------------------------------------------------

  /**
   * Retrieve metadata about a collection: point count, status, and config.
   *
   * @param collection_name - Collection to inspect
   * @returns QdrantCollectionInfo summary
   */
  async get_collection_info(collection_name: string): Promise<QdrantCollectionInfo> {
    console.log('[QdrantService] get_collection_info — start', { collection_name });
    const client = await this.await_ready();

    try {
      const info = await client.getCollection(collection_name);

      const result: QdrantCollectionInfo = {
        pointsCount: info.points_count ?? 0,
        status: String(info.status),
        config: (info.config as unknown as Record<string, unknown>) ?? {},
      };

      logger.info('Collection info retrieved', {
        collection_name,
        points_count: result.pointsCount,
        status: result.status,
      });
      console.log('[QdrantService] get_collection_info — done', { collection_name });

      return result;
    } catch (error) {
      logger.error('Failed to get collection info', error, { collection_name });
      console.log('[QdrantService] get_collection_info — error', { collection_name });
      throw ErrorHandler.wrap(
        error,
        `Failed to get info for collection: ${collection_name}`,
        ErrorType.DATABASE_ERROR,
        { collectionName: collection_name },
      );
    }
  }

  /**
   * Scroll through points in a collection (paginated read).
   *
   * @param collection_name - Collection to scroll
   * @param limit           - Maximum number of points per page (default 100)
   * @param filter          - Optional Qdrant filter to narrow results
   * @param offset          - Optional point ID to start scrolling from
   * @returns Array of points with id, payload, and optional vector
   */
  async scroll(
    collection_name: string,
    limit = 100,
    filter?: Record<string, unknown>,
    offset?: string,
  ): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
    console.log('[QdrantService] scroll — start', { collection_name, limit });
    const client = await this.await_ready();

    try {
      const scroll_params: Record<string, unknown> = {
        limit,
        with_payload: true,
      };

      if (filter) {
        scroll_params.filter = filter;
      }

      if (offset) {
        scroll_params.offset = offset;
      }

      const response = await client.scroll(collection_name, scroll_params as any);

      const points = (response.points ?? []).map((point: any) => ({
        id: String(point.id),
        payload: (point.payload as Record<string, unknown>) ?? {},
      }));

      logger.info('Scroll completed', {
        collection_name,
        returned: points.length,
      });
      console.log('[QdrantService] scroll — done', {
        collection_name,
        returned: points.length,
      });

      return points;
    } catch (error) {
      logger.error('Failed to scroll collection', error, { collection_name });
      console.log('[QdrantService] scroll — error', { collection_name });
      throw ErrorHandler.wrap(
        error,
        `Failed to scroll collection: ${collection_name}`,
        ErrorType.DATABASE_ERROR,
        { collectionName: collection_name },
      );
    }
  }

  /**
   * Check whether the Qdrant server is reachable.
   *
   * @returns true if the server responds, false otherwise
   */
  async health_check(): Promise<boolean> {
    console.log('[QdrantService] health_check — start');

    try {
      const client = await this.await_ready();
      const collections = await client.getCollections();

      logger.info('Qdrant health check passed', {
        collection_count: collections.collections.length,
      });
      console.log('[QdrantService] health_check — done (healthy)');
      return true;
    } catch (error) {
      logger.error('Qdrant health check failed', error);
      console.log('[QdrantService] health_check — done (unhealthy)');
      return false;
    }
  }

  /**
   * Reset the service: drop cached state and disconnect.
   * Primarily used in testing and reconnection scenarios.
   */
  async reset(): Promise<void> {
    console.log('[QdrantService] reset — start');
    logger.info('Resetting QdrantService');

    this.client = null;
    this.initialized = false;
    this.init_promise = null;

    console.log('[QdrantService] reset — done');
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let qdrant_service_instance: QdrantService | null = null;

/**
 * Get the QdrantService singleton. Creates it on first call.
 *
 * @returns The shared QdrantService instance
 */
export function get_qdrant_service(): QdrantService {
  console.log('[QdrantService] get_qdrant_service — start');

  if (!qdrant_service_instance) {
    logger.info('Creating new QdrantService instance');
    qdrant_service_instance = new QdrantService();
  }

  console.log('[QdrantService] get_qdrant_service — done');
  return qdrant_service_instance;
}

/**
 * Reset the QdrantService singleton. Disconnects and clears cached state.
 * Primarily used for testing or forced reconnection.
 */
export function reset_qdrant_service(): void {
  console.log('[QdrantService] reset_qdrant_service — start');

  if (qdrant_service_instance) {
    qdrant_service_instance.reset();
  }
  qdrant_service_instance = null;

  logger.info('QdrantService singleton reset');
  console.log('[QdrantService] reset_qdrant_service — done');
}
