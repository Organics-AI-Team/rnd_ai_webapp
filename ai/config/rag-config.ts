/**
 * Centralized RAG (Retrieval-Augmented Generation) Configuration
 * Manages vector database settings for different AI chatbots
 */

export interface RAGServiceConfig {
  /** Pinecone index name for this service */
  pineconeIndex: string;
  /** Maximum number of results to retrieve */
  topK: number;
  /** Minimum similarity score threshold */
  similarityThreshold: number;
  /** Whether to include metadata in results */
  includeMetadata: boolean;
  /** Description of what this index contains */
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
 * Centralized RAG configuration for all AI services
 *
 * Unified Index with Namespaces (Updated 2025-11-05):
 * - Index: raw-materials-stock
 *   - Namespace 'in_stock': 3,111 materials in actual stock (raw_materials_real_stock)
 *   - Namespace 'all_fda': 31,179 FDA-registered ingredients (raw_materials_console)
 * - Index: sales-rnd-ai (003-sales-ai)
 */
export const RAG_CONFIG: RAGServicesConfig = {
  /** Raw Materials All AI Configuration - Uses all 31,179 FDA materials */
  rawMaterialsAllAI: {
    pineconeIndex: 'raw-materials-stock',
    topK: 5,
    similarityThreshold: 0.7,
    includeMetadata: true,
    description: 'All FDA-registered raw materials (31,179 items) - Complete ingredient database with benefits, use cases, INCI',
    defaultFilters: {
      source: 'raw_materials_console',
      namespace: 'all_fda'
    }
  },

  /** Raw Materials AI Chat Configuration - Unified search with collection routing */
  rawMaterialsAI: {
    pineconeIndex: 'raw-materials-stock',
    topK: 5,
    similarityThreshold: 0.7,
    includeMetadata: true,
    description: 'Unified RAG with intelligent routing: 3,111 in-stock materials + 31,179 FDA ingredients. Auto-detects user intent for stock vs FDA queries.',
    defaultFilters: {
      // No default filters - routing handled by collection-router
    }
  },

  /** Sales RND AI Configuration - Sales and market intelligence */
  salesRndAI: {
    pineconeIndex: '003-sales-ai',
    topK: 8, // More results for comprehensive sales insights
    similarityThreshold: 0.65, // Slightly lower threshold for broader matching
    includeMetadata: true,
    description: 'Sales strategy, market intelligence, business development, and R&D collaboration data. All 31,179 materials available for sales conversations.',
    defaultFilters: {
      source: 'raw_materials_console'
    }
  }
};

/**
 * Get RAG configuration by service name
 */
export function getRAGConfig(serviceName: keyof RAGServicesConfig): RAGServiceConfig {
  const config = RAG_CONFIG[serviceName];
  if (!config) {
    throw new Error(`RAG service configuration not found for: ${serviceName}`);
  }
  return config;
}

/**
 * Get all available RAG service names
 */
export function getRAGServiceNames(): (keyof RAGServicesConfig)[] {
  return Object.keys(RAG_CONFIG) as (keyof RAGServicesConfig)[];
}

/**
 * Validate RAG configuration
 */
export function validateRAGConfig(config: RAGServiceConfig): boolean {
  return !!(
    config.pineconeIndex &&
    config.topK > 0 &&
    config.similarityThreshold >= 0 &&
    config.similarityThreshold <= 1
  );
}

/**
 * Default configuration values
 */
export const DEFAULT_RAG_CONFIG: Partial<RAGServiceConfig> = {
  topK: 5,
  similarityThreshold: 0.7,
  includeMetadata: true
};

/**
 * Pinecone API configuration (still from environment for security)
 */
export const PINECONE_API_CONFIG = {
  apiKey: process.env.PINECONE_API_KEY || '',
  environment: process.env.PINECONE_ENVIRONMENT || 'us-west1-gcp'
};

/**
 * Validate that required environment variables are set
 */
export function validateEnvironment(): { isValid: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!PINECONE_API_CONFIG.apiKey) {
    missing.push('PINECONE_API_KEY');
  }

  return {
    isValid: missing.length === 0,
    missing
  };
}