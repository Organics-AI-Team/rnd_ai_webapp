/**
 * Pinecone Service Stub
 * Placeholder to prevent build errors while migrating to ChromaDB
 *
 * TODO: Replace with actual ChromaDB implementation or remove entirely
 */

export interface RAGConfig {
  index: string;
  namespace?: string;
  topK: number;
  similarityThreshold: number;
  includeMetadata: boolean;
}

export interface RawMaterialDocument {
  id: string;
  text: string;
  metadata: Record<string, any>;
  score: number;
}

export class PineconeRAGService {
  constructor(config: RAGConfig) {
    // Stub implementation
    console.warn('PineconeRAGService is disabled - using ChromaDB instead');
  }

  async searchSimilar(query: string, options?: any): Promise<RawMaterialDocument[]> {
    // Return empty results for now
    console.warn('PineconeRAGService.searchSimilar() called but service is disabled');
    return [];
  }

  async addDocuments(documents: RawMaterialDocument[]): Promise<void> {
    console.warn('PineconeRAGService.addDocuments() called but service is disabled');
  }

  async deleteDocument(id: string): Promise<void> {
    console.warn('PineconeRAGService.deleteDocument() called but service is disabled');
  }
}

// Export empty RAG config to prevent errors
export const DEFAULT_RAG_CONFIG: RAGConfig = {
  index: 'disabled',
  topK: 5,
  similarityThreshold: 0.7,
  includeMetadata: true
};