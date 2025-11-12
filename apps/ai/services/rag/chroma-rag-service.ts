/**
 * ChromaDB RAG (Retrieval-Augmented Generation) Service
 * Replaces PineconeRAGService with ChromaDB implementation
 *
 * Features:
 * - Local vector database (no external API)
 * - Free unlimited storage and operations
 * - Document storage and retrieval
 * - Semantic search with metadata filtering
 * - Batch processing support
 *
 * @author AI Management System
 * @date 2025-11-07
 */

import { getChromaService, ChromaService } from '../vector/chroma-service';
import { createEmbeddingService, UniversalEmbeddingService } from '../embeddings/universal-embedding-service';
import { Logger } from '@/ai/utils/logger';
import { ErrorHandler, ErrorType } from '@/ai/utils/error-handler';

const logger = Logger.scope('ChromaRAGService');

/**
 * Document interface for RAG operations
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
  };
}

/**
 * RAG Configuration
 */
export interface RAGConfig {
  topK: number;
  similarityThreshold: number;
  includeMetadata: boolean;
  filter?: any;
  collectionName?: string; // ChromaDB collection name (replaces Pinecone namespace)
}

/**
 * RAG Services Configuration Type
 */
export type RAGServicesConfig = {
  rawMaterialsAllAI: any;
  rawMaterialsAI: any;
  salesRndAI: any;
  [key: string]: any;
};

/**
 * Get RAG configuration for a service
 * Simplified version - can be expanded based on needs
 */
function getRAGConfig(serviceName: keyof RAGServicesConfig = 'rawMaterialsAllAI'): any {
  logger.debug('getRAGConfig', { serviceName });

  const configs = {
    rawMaterialsAllAI: {
      collectionName: 'all_fda',
      topK: 10,
      similarityThreshold: 0.6,
      includeMetadata: true
    },
    rawMaterialsAI: {
      collectionName: 'raw_materials_console',
      topK: 10,
      similarityThreshold: 0.6,
      includeMetadata: true
    },
    salesRndAI: {
      collectionName: 'sales_rnd',
      topK: 10,
      similarityThreshold: 0.6,
      includeMetadata: true
    }
  };

  return configs[serviceName] || configs.rawMaterialsAllAI;
}

// Initialize universal embedding service
const embeddingService = createEmbeddingService();

/**
 * ChromaDB RAG Service
 * Handles document storage, retrieval, and formatting for AI context
 */
export class ChromaRAGService {
  private chromaService: ChromaService;
  private config: RAGConfig;
  private embeddingService: UniversalEmbeddingService;
  private collectionName: string;

  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    serviceName?: keyof RAGServicesConfig,
    config?: Partial<RAGConfig>,
    customEmbeddingService?: UniversalEmbeddingService
  ) {
    logger.debug('ChromaRAGService.constructor', { serviceName });

    // Get service configuration
    const serviceConfig = serviceName ? getRAGConfig(serviceName) : getRAGConfig('rawMaterialsAllAI');

    this.config = {
      topK: serviceConfig.topK,
      similarityThreshold: serviceConfig.similarityThreshold,
      includeMetadata: serviceConfig.includeMetadata,
      ...config
    };

    this.collectionName = config?.collectionName || serviceConfig.collectionName || 'all_fda';
    this.embeddingService = customEmbeddingService || embeddingService;
    this.chromaService = getChromaService();

    // Lazy initialization
    this.initPromise = this.initializeChroma();

    logger.info('Initializing ChromaDB RAG service', {
      serviceName,
      collection: this.collectionName,
      config: this.config
    });
  }

  /**
   * Initialize ChromaDB connection
   */
  private async initializeChroma(): Promise<void> {
    if (this.initialized) return;

    logger.debug('initializeChroma');

    try {
      await this.chromaService.initialize();
      this.initialized = true;
      logger.info('✅ ChromaDB RAG service initialized', {
        collection: this.collectionName
      });
    } catch (error) {
      logger.error('Failed to initialize ChromaDB RAG service', error);
      throw ErrorHandler.wrap(
        error,
        'Failed to initialize ChromaDB RAG service',
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
    if (!this.initialized) {
      throw new Error('ChromaRAGService not initialized');
    }
  }

  /**
   * Create embeddings using the configured embedding service
   */
  async createEmbeddings(texts: string[]): Promise<number[][]> {
    await this.ensureInitialized();
    logger.debug('createEmbeddings', { textCount: texts.length });

    try {
      const embeddings = await this.embeddingService.createEmbeddings(texts);
      logger.info('✅ Embeddings created', { count: embeddings.length });
      return embeddings;
    } catch (error) {
      logger.error('Failed to create embeddings', error);
      throw ErrorHandler.wrap(
        error,
        'Failed to create embeddings',
        ErrorType.MODEL_ERROR
      );
    }
  }

  /**
   * Upsert documents into ChromaDB
   */
  async upsertDocuments(documents: RawMaterialDocument[]): Promise<void> {
    await this.ensureInitialized();
    logger.debug('upsertDocuments', {
      documentCount: documents.length,
      collection: this.collectionName
    });

    try {
      const texts = documents.map(doc => doc.text);
      const embeddings = await this.createEmbeddings(texts);

      const vectors = documents.map((doc, index) => ({
        id: doc.id,
        text: doc.text,
        values: embeddings[index],
        metadata: doc.metadata
      }));

      // Batch upsert
      await this.chromaService.upsert(this.collectionName, vectors);

      logger.info('✅ Documents upserted successfully', {
        count: vectors.length,
        collection: this.collectionName
      });
    } catch (error) {
      logger.error('Failed to upsert documents', error, {
        collection: this.collectionName,
        documentCount: documents.length
      });
      throw ErrorHandler.wrap(
        error,
        'Failed to upsert documents to ChromaDB',
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Search for similar documents
   */
  async searchSimilar(
    query: string,
    options?: Partial<RAGConfig>
  ): Promise<any[]> {
    await this.ensureInitialized();
    logger.debug('searchSimilar', { query, collection: this.collectionName });

    try {
      const searchConfig = { ...this.config, ...options };
      const collectionName = searchConfig.collectionName || this.collectionName;

      // Create embedding for the query
      const queryEmbedding = await this.createEmbeddings([query]);

      logger.info('Searching ChromaDB', {
        collection: collectionName,
        topK: searchConfig.topK,
        threshold: searchConfig.similarityThreshold
      });

      // Search ChromaDB
      const matches = await this.chromaService.query(
        collectionName,
        queryEmbedding[0],
        {
          topK: searchConfig.topK,
          where: searchConfig.filter,
          includeMetadata: searchConfig.includeMetadata,
          includeDocuments: true,
          includeDistances: true
        }
      );

      // Filter by similarity threshold
      const filteredMatches = searchConfig.similarityThreshold > 0
        ? matches.filter(match => (match.score || 0) >= searchConfig.similarityThreshold)
        : matches;

      logger.info('✅ Search completed', {
        collection: collectionName,
        totalMatches: matches.length,
        filteredMatches: filteredMatches.length,
        threshold: searchConfig.similarityThreshold
      });

      return filteredMatches;
    } catch (error) {
      logger.error('Search failed', error, {
        query,
        collection: this.collectionName
      });
      throw ErrorHandler.wrap(
        error,
        'Failed to search ChromaDB',
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Enhanced search with context formatting
   */
  async searchAndFormat(
    query: string,
    options?: Partial<RAGConfig>
  ): Promise<string> {
    const matches = await this.searchSimilar(query, options);
    return ChromaRAGService.formatSearchResults(matches);
  }

  /**
   * Delete documents by IDs
   */
  async deleteDocuments(ids: string[]): Promise<void> {
    await this.ensureInitialized();
    logger.debug('deleteDocuments', {
      idCount: ids.length,
      collection: this.collectionName
    });

    try {
      await this.chromaService.delete(this.collectionName, ids);
      logger.info('✅ Documents deleted', {
        count: ids.length,
        collection: this.collectionName
      });
    } catch (error) {
      logger.error('Failed to delete documents', error, {
        collection: this.collectionName
      });
      throw ErrorHandler.wrap(
        error,
        'Failed to delete documents from ChromaDB',
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Get collection statistics
   */
  async getIndexStats(): Promise<any> {
    await this.ensureInitialized();
    logger.debug('getIndexStats', { collection: this.collectionName });

    try {
      const stats = await this.chromaService.getCollectionStats(this.collectionName);
      logger.info('Collection stats retrieved', {
        collection: this.collectionName,
        stats
      });
      return stats;
    } catch (error) {
      logger.error('Failed to get collection stats', error);
      throw ErrorHandler.wrap(
        error,
        'Failed to get collection statistics',
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Batch process documents for vectorization
   */
  async batchProcessDocuments(
    materials: any[],
    batchSize: number = 50
  ): Promise<void> {
    logger.debug('batchProcessDocuments', {
      materialCount: materials.length,
      batchSize
    });

    const documents = materials.map(material =>
      ChromaRAGService.prepareRawMaterialDocument(material)
    );

    logger.info('Processing documents in batches', {
      totalDocuments: documents.length,
      batchSize
    });

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      await this.upsertDocuments(batch);
      logger.info('Batch processed', {
        batchNumber: Math.floor(i / batchSize) + 1,
        totalBatches: Math.ceil(documents.length / batchSize)
      });
    }

    logger.info('✅ All batches processed', {
      totalDocuments: documents.length
    });
  }

  /**
   * Prepare raw material data for vectorization
   */
  static prepareRawMaterialDocument(material: any): RawMaterialDocument {
    const id = material._id?.toString() || material.rm_code || Math.random().toString();

    // Combine all text fields for comprehensive search
    const textParts = [];
    if (material.rm_code) textParts.push(`Material Code: ${material.rm_code}`);
    if (material.trade_name) textParts.push(`Trade Name: ${material.trade_name}`);
    if (material.inci_name) textParts.push(`INCI Name: ${material.inci_name}`);
    if (material.supplier) textParts.push(`Supplier: ${material.supplier}`);
    if (material.company_name) textParts.push(`Company: ${material.company_name}`);
    if (material.rm_cost) textParts.push(`Cost: ${material.rm_cost}`);
    if (material.benefits) textParts.push(`Benefits: ${material.benefits}`);
    if (material.details) textParts.push(`Details: ${material.details}`);

    return {
      id,
      text: textParts.join('. '),
      metadata: {
        rm_code: material.rm_code,
        trade_name: material.trade_name,
        inci_name: material.inci_name,
        supplier: material.supplier,
        company_name: material.company_name,
        rm_cost: material.rm_cost,
        benefits: material.benefits,
        details: material.details,
        source: material.source || 'raw_materials_console'
      }
    };
  }

  /**
   * Format search results for AI context
   */
  static formatSearchResults(matches: any[]): string {
    if (!matches || matches.length === 0) {
      return '\n\nNo relevant raw materials found in the vector database.';
    }

    const results = matches.map((match, index) => {
      const metadata = match.metadata || {};
      let result = `${index + 1}. **${metadata.trade_name || 'Unknown Material'}**\n`;

      if (metadata.rm_code) result += `   **Material Code:** ${metadata.rm_code}\n`;
      if (metadata.inci_name) result += `   **INCI Name:** ${metadata.inci_name}\n`;
      if (metadata.supplier) result += `   **Supplier:** ${metadata.supplier}\n`;
      if (metadata.company_name) result += `   **Company:** ${metadata.company_name}\n`;
      if (metadata.rm_cost) result += `   **Cost:** ${metadata.rm_cost}\n`;
      if (metadata.benefits) result += `   **Benefits:** ${metadata.benefits}\n`;
      if (metadata.details) result += `   **Details:** ${metadata.details}\n`;
      result += `   **Similarity Score:** ${(match.score || 0).toFixed(3)}\n`;

      return result;
    });

    return '\n\nVector Database Search Results (ChromaDB):\n' + results.join('\n\n');
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<RAGConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.collectionName) {
      this.collectionName = newConfig.collectionName;
    }
    logger.info('Configuration updated', { config: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig(): RAGConfig {
    return { ...this.config };
  }
}

/**
 * Export alias for backward compatibility
 */
export { ChromaRAGService as PineconeRAGService };
