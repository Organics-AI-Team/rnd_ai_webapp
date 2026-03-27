/**
 * Centralized RAG (Retrieval-Augmented Generation) Configuration
 * Manages Qdrant vector database collection settings for different AI chatbots
 */

export interface RAGServiceConfig {
  /** Qdrant collection name for this service */
  collectionName: string;
  /** Maximum number of results to retrieve */
  topK: number;
  /** Minimum similarity score threshold */
  similarityThreshold: number;
  /** Whether to include metadata in results */
  includeMetadata: boolean;
  /** Description of what this collection contains */
  description: string;
  /** Default search filters for this service */
  defaultFilters?: Record<string, any>;
}

export interface RAGServicesConfig {
  /** Raw Materials All AI - for general raw materials knowledge and conversations */
  rawMaterialsAllAI: RAGServiceConfig;
  /** Raw Materials AI Chat - for specific chemical and stock database queries */
  rawMaterialsAI: RAGServiceConfig;
  /** Sales RND AI - for sales strategy, market intelligence, and business development */
  salesRndAI: RAGServiceConfig;
}

/**
 * Centralized RAG configuration for all AI services (Qdrant collections)
 *
 * Collection → Service mapping:
 * - raw_materials_fda   → rawMaterialsAllAI  (31,179 FDA-registered ingredients)
 * - raw_materials_console → rawMaterialsAI   (in-stock + FDA unified routing)
 * - sales_rnd           → salesRndAI         (sales strategy & market intelligence)
 */
export const RAG_CONFIG: RAGServicesConfig = {
  /** Raw Materials All AI Configuration - Uses all 31,179 FDA materials */
  rawMaterialsAllAI: {
    collectionName: 'raw_materials_fda',
    topK: 5,
    similarityThreshold: 0.7,
    includeMetadata: true,
    description: 'All FDA-registered raw materials (31,179 items) - Complete ingredient database with benefits, use cases, INCI. Qdrant collection: raw_materials_fda',
    defaultFilters: {
      source: 'raw_materials_console'
    }
  },

  /** Raw Materials AI Chat Configuration - Unified search with collection routing */
  rawMaterialsAI: {
    collectionName: 'raw_materials_console',
    topK: 5,
    similarityThreshold: 0.7,
    includeMetadata: true,
    description: 'Unified RAG with intelligent routing: in-stock materials + FDA ingredients. Auto-detects user intent for stock vs FDA queries. Qdrant collection: raw_materials_console',
    defaultFilters: {
      // No default filters - routing handled by collection-router
    }
  },

  /** Sales RND AI Configuration - Sales and market intelligence */
  salesRndAI: {
    collectionName: 'sales_rnd',
    topK: 8, // More results for comprehensive sales insights
    similarityThreshold: 0.65, // Slightly lower threshold for broader matching
    includeMetadata: true,
    description: 'Sales strategy, market intelligence, business development, and R&D collaboration data. All 31,179 materials available for sales conversations. Qdrant collection: sales_rnd',
    defaultFilters: {
      source: 'raw_materials_console'
    }
  }
};

/**
 * Get RAG configuration by service name
 *
 * @param serviceName - Key of the service in RAGServicesConfig
 * @returns RAGServiceConfig for the requested service
 * @throws Error if service name is not found in RAG_CONFIG
 */
export function getRAGConfig(serviceName: keyof RAGServicesConfig): RAGServiceConfig {
  console.log('[getRAGConfig] start', { serviceName });
  const config = RAG_CONFIG[serviceName];
  if (!config) {
    throw new Error(`RAG service configuration not found for: ${serviceName}`);
  }
  console.log('[getRAGConfig] done', { serviceName, collectionName: config.collectionName });
  return config;
}

/**
 * Get all available RAG service names
 *
 * @returns Array of valid service name keys
 */
export function getRAGServiceNames(): (keyof RAGServicesConfig)[] {
  return Object.keys(RAG_CONFIG) as (keyof RAGServicesConfig)[];
}

/**
 * Validate RAG configuration has all required fields with valid values
 *
 * @param config - RAGServiceConfig object to validate
 * @returns true if config is valid; false otherwise
 */
export function validateRAGConfig(config: RAGServiceConfig): boolean {
  return !!(
    config.collectionName &&
    config.topK > 0 &&
    config.similarityThreshold >= 0 &&
    config.similarityThreshold <= 1
  );
}

/**
 * Default configuration values applied when service-specific values are absent
 */
export const DEFAULT_RAG_CONFIG: Partial<RAGServiceConfig> = {
  topK: 5,
  similarityThreshold: 0.7,
  includeMetadata: true
};

/**
 * Qdrant connection configuration (read from environment for security)
 */
export const QDRANT_API_CONFIG = {
  url: process.env.QDRANT_URL || 'http://localhost:6333',
  apiKey: process.env.QDRANT_API_KEY || ''
};

/**
 * Validate that required Qdrant environment variables are set
 *
 * @returns Object with isValid flag and array of missing variable names
 */
export function validateEnvironment(): { isValid: boolean; missing: string[] } {
  console.log('[validateEnvironment] start');
  const missing: string[] = [];

  if (!QDRANT_API_CONFIG.url) {
    missing.push('QDRANT_URL');
  }

  const result = { isValid: missing.length === 0, missing };
  console.log('[validateEnvironment] done', result);
  return result;
}
