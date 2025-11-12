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
  score?: number; // Optional - added during search, not during document creation
}

export class PineconeRAGService {
  private config: RAGConfig;

  constructor(config: RAGConfig) {
    // Stub implementation
    this.config = config;
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

  async upsertDocuments(documents: RawMaterialDocument[]): Promise<void> {
    console.warn('PineconeRAGService.upsertDocuments() called but service is disabled');
  }

  async getIndexStats(): Promise<any> {
    console.warn('PineconeRAGService.getIndexStats() called but service is disabled');
    return {
      totalVectors: 0,
      dimension: 0,
      indexFullness: 0
    };
  }

  async batchProcessDocuments(materials: any[], batchSize?: number): Promise<void> {
    console.warn('PineconeRAGService.batchProcessDocuments() called but service is disabled');
  }

  static prepareRawMaterialDocument(material: any): RawMaterialDocument {
    console.warn('PineconeRAGService.prepareRawMaterialDocument() called but service is disabled');
    return {
      id: material._id?.toString() || material.rm_code || Math.random().toString(),
      text: JSON.stringify(material),
      metadata: material
    };
  }
}

// Export empty RAG config to prevent errors
export const DEFAULT_RAG_CONFIG: RAGConfig = {
  index: 'disabled',
  topK: 5,
  similarityThreshold: 0.7,
  includeMetadata: true
};