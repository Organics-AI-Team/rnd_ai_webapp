/**
 * Configuration for different RAG (Retrieval-Augmented Generation) indices
 * Each index is specialized for different types of knowledge and use cases
 */

export interface RAGIndexConfig {
  id: string;
  name: string;
  description: string;
  pineconeIndex: string;
  namespace?: string;
  category: 'raw-materials' | 'formulations' | 'regulations' | 'market-data' | 'research' | 'documentation';
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  similarityThreshold: number;
  metadataFilters?: Record<string, any>;
  preprocessing?: {
    removeDuplicates?: boolean;
    normalizeText?: boolean;
    extractEntities?: boolean;
  };
  refreshSchedule?: string; // cron expression
  lastUpdated?: Date;
  documentCount?: number;
  status: 'active' | 'building' | 'error' | 'maintenance';
}

export const RAG_INDICES: Record<string, RAGIndexConfig> = {
  // Raw Materials Database
  'raw-materials-db': {
    id: 'raw-materials-db',
    name: 'Raw Materials Database',
    description: 'Comprehensive database of cosmetic raw materials, ingredients, and their properties',
    pineconeIndex: '002-rnd-ai',
    namespace: 'raw-materials',
    category: 'raw-materials',
    embeddingModel: 'text-embedding-3-small',
    chunkSize: 1000,
    chunkOverlap: 200,
    topK: 5,
    similarityThreshold: 0.7,
    metadataFilters: {
      source: 'raw_materials_real_stock'
    },
    preprocessing: {
      removeDuplicates: true,
      normalizeText: true,
      extractEntities: true
    },
    refreshSchedule: '0 2 * * *', // Daily at 2 AM
    lastUpdated: new Date(),
    documentCount: 0,
    status: 'active'
  },

  // Formulation Database
  'formulations-db': {
    id: 'formulations-db',
    name: 'Cosmetic Formulations Database',
    description: 'Database of cosmetic formulations, recipes, and formulation guidelines',
    pineconeIndex: '002-rnd-ai',
    namespace: 'formulations',
    category: 'formulations',
    embeddingModel: 'text-embedding-3-small',
    chunkSize: 800,
    chunkOverlap: 150,
    topK: 3,
    similarityThreshold: 0.75,
    metadataFilters: {
      source: 'formulation_library'
    },
    preprocessing: {
      removeDuplicates: true,
      normalizeText: true,
      extractEntities: true
    },
    refreshSchedule: '0 3 * * 0', // Weekly on Sunday at 3 AM
    lastUpdated: new Date(),
    documentCount: 0,
    status: 'building'
  },

  // Regulatory Database
  'regulations-db': {
    id: 'regulations-db',
    name: 'Regulatory Compliance Database',
    description: 'Database of global cosmetic regulations, compliance requirements, and legal guidelines',
    pineconeIndex: '002-rnd-ai',
    namespace: 'regulations',
    category: 'regulations',
    embeddingModel: 'text-embedding-3-small',
    chunkSize: 1200,
    chunkOverlap: 250,
    topK: 4,
    similarityThreshold: 0.8,
    metadataFilters: {
      source: 'regulatory_documents'
    },
    preprocessing: {
      removeDuplicates: true,
      normalizeText: true,
      extractEntities: false // Legal documents need exact phrasing
    },
    refreshSchedule: '0 4 1 * *', // Monthly on 1st at 4 AM
    lastUpdated: new Date(),
    documentCount: 0,
    status: 'active'
  },

  // Market Research Database
  'market-research-db': {
    id: 'market-research-db',
    name: 'Market Research Database',
    description: 'Database of market trends, consumer insights, and competitive analysis',
    pineconeIndex: '002-rnd-ai',
    namespace: 'market-research',
    category: 'market-data',
    embeddingModel: 'text-embedding-3-small',
    chunkSize: 900,
    chunkOverlap: 180,
    topK: 6,
    similarityThreshold: 0.65,
    metadataFilters: {
      source: 'market_research'
    },
    preprocessing: {
      removeDuplicates: true,
      normalizeText: true,
      extractEntities: true
    },
    refreshSchedule: '0 1 * * 1,3,5', // Mon, Wed, Fri at 1 AM
    lastUpdated: new Date(),
    documentCount: 0,
    status: 'active'
  },

  // Scientific Research Database
  'research-db': {
    id: 'research-db',
    name: 'Scientific Research Database',
    description: 'Database of scientific research papers, studies, and technical documentation',
    pineconeIndex: '002-rnd-ai',
    namespace: 'research',
    category: 'research',
    embeddingModel: 'text-embedding-3-small',
    chunkSize: 1500,
    chunkOverlap: 300,
    topK: 5,
    similarityThreshold: 0.7,
    metadataFilters: {
      source: 'scientific_papers'
    },
    preprocessing: {
      removeDuplicates: true,
      normalizeText: true,
      extractEntities: true
    },
    refreshSchedule: '0 5 * * 0', // Weekly on Sunday at 5 AM
    lastUpdated: new Date(),
    documentCount: 0,
    status: 'active'
  },

  // Product Documentation
  'product-docs-db': {
    id: 'product-docs-db',
    name: 'Product Documentation Database',
    description: 'Internal product documentation, technical sheets, and development records',
    pineconeIndex: '002-rnd-ai',
    namespace: 'product-docs',
    category: 'documentation',
    embeddingModel: 'text-embedding-3-small',
    chunkSize: 700,
    chunkOverlap: 140,
    topK: 4,
    similarityThreshold: 0.72,
    metadataFilters: {
      source: 'internal_docs'
    },
    preprocessing: {
      removeDuplicates: true,
      normalizeText: true,
      extractEntities: true
    },
    refreshSchedule: '0 6 * * *', // Daily at 6 AM
    lastUpdated: new Date(),
    documentCount: 0,
    status: 'active'
  },

  // Supplier Database
  'suppliers-db': {
    id: 'suppliers-db',
    name: 'Supplier Information Database',
    description: 'Database of supplier information, capabilities, and performance data',
    pineconeIndex: '002-rnd-ai',
    namespace: 'suppliers',
    category: 'raw-materials',
    embeddingModel: 'text-embedding-3-small',
    chunkSize: 600,
    chunkOverlap: 120,
    topK: 8,
    similarityThreshold: 0.68,
    metadataFilters: {
      source: 'supplier_data'
    },
    preprocessing: {
      removeDuplicates: true,
      normalizeText: true,
      extractEntities: true
    },
    refreshSchedule: '0 0 * * 1', // Weekly on Monday at midnight
    lastUpdated: new Date(),
    documentCount: 0,
    status: 'active'
  },

  // Safety and Toxicology Database
  'safety-db': {
    id: 'safety-db',
    name: 'Safety and Toxicology Database',
    description: 'Database of ingredient safety data, toxicology studies, and safety assessments',
    pineconeIndex: '002-rnd-ai',
    namespace: 'safety',
    category: 'research',
    embeddingModel: 'text-embedding-3-small',
    chunkSize: 1000,
    chunkOverlap: 200,
    topK: 5,
    similarityThreshold: 0.75,
    metadataFilters: {
      source: 'safety_data'
    },
    preprocessing: {
      removeDuplicates: true,
      normalizeText: true,
      extractEntities: false
    },
    refreshSchedule: '0 3 1 * *', // Monthly on 1st at 3 AM
    lastUpdated: new Date(),
    documentCount: 0,
    status: 'active'
  }
};

/**
 * Get RAG index configuration by ID
 */
export function getRAGIndexConfig(id: string): RAGIndexConfig | undefined {
  return RAG_INDICES[id];
}

/**
 * Get RAG indices by category
 */
export function getRAGIndicesByCategory(category: string): RAGIndexConfig[] {
  return Object.values(RAG_INDICES).filter(index => index.category === category);
}

/**
 * Get active RAG indices
 */
export function getActiveRAGIndices(): RAGIndexConfig[] {
  return Object.values(RAG_INDICES).filter(index => index.status === 'active');
}

/**
 * Search RAG indices by name or description
 */
export function searchRAGIndices(query: string): RAGIndexConfig[] {
  const searchTerms = query.toLowerCase().split(' ');
  return Object.values(RAG_INDICES).filter(index =>
    searchTerms.every(term =>
      index.name.toLowerCase().includes(term) ||
      index.description.toLowerCase().includes(term)
    )
  );
}