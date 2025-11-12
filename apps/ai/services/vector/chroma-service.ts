/**
 * ChromaDB Vector Database Service
 * Handles document storage, retrieval, and vector operations using ChromaDB
 *
 * Features:
 * - Local vector database (no external API dependencies)
 * - Free unlimited storage and operations
 * - Full metadata support
 * - Async lazy initialization
 * - Collection management
 * - Batch operations
 *
 * NOTE: ChromaDB is lazy-loaded to avoid bundling issues in Next.js
 *
 * @author AI Management System
 * @date 2025-11-07
 */

import { Logger } from '@rnd-ai/shared-utils';
import { ErrorHandler, ErrorType } from '@/ai/utils/error-handler';

const logger = Logger.scope('ChromaService');

// Type imports only (no runtime code)
type ChromaClient = any;
type Collection = any;
type IncludeEnum = any;
type IEmbeddingFunction = any;

/**
 * Lazy-load ChromaDB to avoid Next.js bundling issues
 */
async function loadChromaDB() {
  if (typeof window !== 'undefined') {
    throw new Error('ChromaDB can only be used server-side');
  }

  const chromadb = await import('chromadb');
  return chromadb;
}

/**
 * Custom Embedding Function for ChromaDB
 * This is a stub that tells ChromaDB we're providing embeddings externally
 */
class CustomEmbeddingFunction {
  async generate(texts: string[]): Promise<number[][]> {
    // This should never be called since we provide embeddings externally
    throw new Error('CustomEmbeddingFunction.generate() should not be called - embeddings are provided externally');
  }
}

/**
 * Singleton ChromaDB client instance
 * Prevents multiple client initializations
 */
let chromaClient: ChromaClient | null = null;

/**
 * Get or create ChromaDB client singleton
 */
async function getChromaClient(): Promise<ChromaClient> {
  logger.debug('Getting ChromaDB client');

  if (!chromaClient) {
    try {
      const chromaUrl = process.env.CHROMA_URL || 'http://localhost:8000';
      logger.info('Initializing ChromaDB client', { url: chromaUrl });

      // Lazy-load ChromaDB
      const { ChromaClient } = await loadChromaDB();
      chromaClient = new ChromaClient({ path: chromaUrl });

      // Test connection
      await chromaClient.heartbeat();
      logger.info('✅ ChromaDB client connected successfully', { url: chromaUrl });
    } catch (error) {
      logger.error('Failed to initialize ChromaDB client', error);
      throw ErrorHandler.wrap(
        error,
        'Failed to connect to ChromaDB',
        ErrorType.DATABASE_ERROR,
        { chromaUrl: process.env.CHROMA_URL }
      );
    }
  }

  logger.debug('ChromaDB client ready', { hasClient: !!chromaClient });
  return chromaClient;
}

/**
 * Document interface for ChromaDB operations
 */
export interface VectorDocument {
  id: string;
  text: string;
  values?: number[]; // Optional pre-computed embeddings
  metadata: Record<string, any>;
}

/**
 * ChromaDB collection configuration
 */
export interface CollectionConfig {
  name: string;
  metadata?: Record<string, any>;
  embeddingFunction?: any;
}

/**
 * Search options for vector queries
 */
export interface SearchOptions {
  topK?: number;
  where?: Record<string, any>; // Metadata filters
  whereDocument?: Record<string, any>; // Document filters
  includeMetadata?: boolean;
  includeDocuments?: boolean;
  includeDistances?: boolean;
}

/**
 * ChromaDB Service
 * Provides high-level vector database operations
 */
export class ChromaService {
  private client: ChromaClient | null = null;
  private collections: Map<string, Collection> = new Map();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    logger.debug('ChromaService constructor called');
    // Lazy initialization - don't connect until needed
    this.initPromise = this.initialize();
  }

  /**
   * Initialize ChromaDB connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('ChromaDB already initialized');
      return;
    }

    logger.debug('ChromaService.initialize');

    try {
      this.client = await getChromaClient();
      this.initialized = true;
      logger.info('✅ ChromaService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize ChromaService', error);
      throw error;
    }

    logger.debug('ChromaService.initialize', { initialized: this.initialized });
  }

  /**
   * Ensure service is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
    if (!this.initialized || !this.client) {
      throw new Error('ChromaService not initialized');
    }
  }

  /**
   * Get or create a collection
   */
  async getOrCreateCollection(
    name: string,
    metadata?: Record<string, any>
  ): Promise<Collection> {
    await this.ensureInitialized();
    logger.debug('getOrCreateCollection', { name });

    try {
      // Check if collection already cached
      if (this.collections.has(name)) {
        logger.debug('Using cached collection', { name });
        return this.collections.get(name)!;
      }

      // Get or create collection with custom embeddings
      // We provide our own embeddings (Gemini), so use a custom embedding function
      // ChromaDB requires metadata to have at least one field
      const defaultMetadata = {
        created_at: new Date().toISOString(),
        provider: 'custom'
      };
      const collection = await this.client!.getOrCreateCollection({
        name,
        metadata: metadata && Object.keys(metadata).length > 0 ? metadata : defaultMetadata,
        embeddingFunction: new CustomEmbeddingFunction() // Custom function (embeddings provided externally)
      });

      // Cache collection
      this.collections.set(name, collection);
      logger.info('✅ Collection ready', { name, metadata });

      return collection;
    } catch (error) {
      logger.error('Failed to get/create collection', error, { name });
      throw ErrorHandler.wrap(
        error,
        `Failed to access collection: ${name}`,
        ErrorType.DATABASE_ERROR,
        { collectionName: name }
      );
    }
  }

  /**
   * Delete a collection
   */
  async deleteCollection(name: string): Promise<void> {
    await this.ensureInitialized();
    logger.debug('deleteCollection', { name });

    try {
      await this.client!.deleteCollection({ name });
      this.collections.delete(name);
      logger.info('✅ Collection deleted', { name });
    } catch (error) {
      logger.error('Failed to delete collection', error, { name });
      throw ErrorHandler.wrap(
        error,
        `Failed to delete collection: ${name}`,
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<string[]> {
    await this.ensureInitialized();
    logger.debug('listCollections');

    try {
      const collections = await this.client!.listCollections();
      const names = collections.map(c => c.name);
      logger.info('Listed collections', { count: names.length });
      return names;
    } catch (error) {
      logger.error('Failed to list collections', error);
      throw ErrorHandler.wrap(
        error,
        'Failed to list collections',
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Get collection statistics
   */
  async getCollectionStats(collectionName: string): Promise<{ count: number; metadata: any }> {
    await this.ensureInitialized();
    logger.debug('getCollectionStats', { collectionName });

    try {
      const collection = await this.getOrCreateCollection(collectionName);
      const count = await collection.count();
      const metadata = collection.metadata || {};

      logger.info('Collection stats retrieved', { collectionName, count });
      return { count, metadata };
    } catch (error) {
      logger.error('Failed to get collection stats', error, { collectionName });
      throw ErrorHandler.wrap(
        error,
        `Failed to get stats for collection: ${collectionName}`,
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Upsert documents into a collection
   *
   * @param collectionName - Name of the collection
   * @param documents - Array of documents to upsert
   */
  async upsert(collectionName: string, documents: VectorDocument[]): Promise<void> {
    await this.ensureInitialized();
    logger.debug('upsert', { collectionName, documentCount: documents.length });

    if (!documents || documents.length === 0) {
      logger.warn('No documents to upsert');
      return;
    }

    try {
      const collection = await this.getOrCreateCollection(collectionName);

      // Prepare data for ChromaDB
      const ids = documents.map(doc => doc.id);
      const embeddings = documents.map(doc => doc.values || []);
      const metadatas = documents.map(doc => this.sanitizeMetadata(doc.metadata));
      const documentTexts = documents.map(doc => doc.text);

      // Batch upsert (ChromaDB handles batching internally)
      await collection.upsert({
        ids,
        embeddings,
        metadatas,
        documents: documentTexts
      });

      logger.info('✅ Documents upserted successfully', {
        collectionName,
        count: documents.length
      });
    } catch (error) {
      logger.error('Failed to upsert documents', error, {
        collectionName,
        documentCount: documents.length
      });
      throw ErrorHandler.wrap(
        error,
        `Failed to upsert documents to collection: ${collectionName}`,
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Query collection for similar vectors
   *
   * @param collectionName - Name of the collection
   * @param queryEmbedding - Query vector embedding
   * @param options - Search options
   */
  async query(
    collectionName: string,
    queryEmbedding: number[],
    options: SearchOptions = {}
  ): Promise<any[]> {
    await this.ensureInitialized();
    logger.debug('query', {
      collectionName,
      embeddingDim: queryEmbedding.length,
      topK: options.topK
    });

    try {
      const collection = await this.getOrCreateCollection(collectionName);

      const {
        topK = 10,
        where,
        whereDocument,
        includeMetadata = true,
        includeDocuments = true,
        includeDistances = true
      } = options;

      // Build include array
      const include: IncludeEnum[] = ['embeddings'];
      if (includeMetadata) include.push('metadatas');
      if (includeDocuments) include.push('documents');
      if (includeDistances) include.push('distances');

      // Execute query
      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
        where,
        whereDocument,
        include
      });

      // Format results
      const matches = this.formatQueryResults(results);

      logger.info('✅ Query completed', {
        collectionName,
        matchCount: matches.length,
        topK
      });

      return matches;
    } catch (error) {
      logger.error('Failed to query collection', error, { collectionName });
      throw ErrorHandler.wrap(
        error,
        `Failed to query collection: ${collectionName}`,
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Delete documents by IDs
   */
  async delete(collectionName: string, ids: string[]): Promise<void> {
    await this.ensureInitialized();
    logger.debug('delete', { collectionName, idCount: ids.length });

    try {
      const collection = await this.getOrCreateCollection(collectionName);
      await collection.delete({ ids });

      logger.info('✅ Documents deleted', { collectionName, count: ids.length });
    } catch (error) {
      logger.error('Failed to delete documents', error, { collectionName });
      throw ErrorHandler.wrap(
        error,
        `Failed to delete documents from collection: ${collectionName}`,
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Delete documents by IDs (alias for delete method)
   * Provided for backward compatibility
   */
  async deleteDocuments(collectionName: string, ids: string[]): Promise<void> {
    logger.debug('deleteDocuments (alias for delete)', { collectionName, idCount: ids.length });
    return this.delete(collectionName, ids);
  }

  /**
   * Get documents by IDs
   */
  async get(
    collectionName: string,
    ids: string[],
    options: { includeMetadata?: boolean; includeDocuments?: boolean } = {}
  ): Promise<any[]> {
    await this.ensureInitialized();
    logger.debug('get', { collectionName, idCount: ids.length });

    try {
      const collection = await this.getOrCreateCollection(collectionName);

      const include: IncludeEnum[] = ['embeddings'];
      if (options.includeMetadata) include.push('metadatas');
      if (options.includeDocuments) include.push('documents');

      const results = await collection.get({
        ids,
        include
      });

      logger.info('Retrieved documents', { collectionName, count: results.ids.length });
      return this.formatGetResults(results);
    } catch (error) {
      logger.error('Failed to get documents', error, { collectionName });
      throw ErrorHandler.wrap(
        error,
        `Failed to get documents from collection: ${collectionName}`,
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Sanitize metadata to ensure ChromaDB compatibility
   * ChromaDB requires metadata values to be strings, numbers, or booleans
   */
  private sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || value === undefined) {
        continue; // Skip null/undefined
      }

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        sanitized[key] = value;
      } else if (Array.isArray(value)) {
        sanitized[key] = value.join(', '); // Convert arrays to comma-separated strings
      } else if (typeof value === 'object') {
        sanitized[key] = JSON.stringify(value); // Stringify objects
      } else {
        sanitized[key] = String(value); // Convert to string as fallback
      }
    }

    return sanitized;
  }

  /**
   * Format query results to match expected structure
   */
  private formatQueryResults(results: any): any[] {
    const matches: any[] = [];

    if (!results.ids || !results.ids[0]) {
      return matches;
    }

    const ids = results.ids[0];
    const distances = results.distances?.[0] || [];
    const metadatas = results.metadatas?.[0] || [];
    const documents = results.documents?.[0] || [];

    for (let i = 0; i < ids.length; i++) {
      matches.push({
        id: ids[i],
        score: distances[i] !== undefined ? 1 - distances[i] : 0, // Convert distance to similarity
        metadata: metadatas[i] || {},
        document: documents[i] || '',
        distance: distances[i]
      });
    }

    return matches;
  }

  /**
   * Format get results
   */
  private formatGetResults(results: any): any[] {
    const documents: any[] = [];

    if (!results.ids) {
      return documents;
    }

    for (let i = 0; i < results.ids.length; i++) {
      documents.push({
        id: results.ids[i],
        metadata: results.metadatas?.[i] || {},
        document: results.documents?.[i] || '',
        embedding: results.embeddings?.[i] || []
      });
    }

    return documents;
  }

  /**
   * Check ChromaDB health
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      const heartbeat = await this.client!.heartbeat();
      logger.info('ChromaDB health check passed', { heartbeat });
      return true;
    } catch (error) {
      logger.error('ChromaDB health check failed', error);
      return false;
    }
  }

  /**
   * Reset client (for testing or reconnection)
   */
  async reset(): Promise<void> {
    logger.info('Resetting ChromaService');
    this.collections.clear();
    this.initialized = false;
    chromaClient = null;
    this.client = null;
    this.initPromise = null;
  }
}

/**
 * Singleton ChromaService instance
 */
let chromaServiceInstance: ChromaService | null = null;

/**
 * Get ChromaService singleton
 */
export function getChromaService(): ChromaService {
  if (!chromaServiceInstance) {
    logger.info('Creating new ChromaService instance');
    chromaServiceInstance = new ChromaService();
  }
  return chromaServiceInstance;
}

/**
 * Reset ChromaService singleton (for testing)
 */
export function resetChromaService(): void {
  if (chromaServiceInstance) {
    chromaServiceInstance.reset();
  }
  chromaServiceInstance = null;
  chromaClient = null;
}
