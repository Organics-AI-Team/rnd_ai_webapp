import { Pinecone } from '@pinecone-database/pinecone';
import { createEmbeddingService, UniversalEmbeddingService } from '../embeddings/universal-embedding-service';

// Initialize Pinecone client
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || ''
});

// Initialize universal embedding service
const embeddingService = createEmbeddingService();

const PINECONE_INDEX = process.env.PINECONE_INDEX || '002-rnd-ai';

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
    source: 'raw_materials_real_stock';
  };
}

export interface RAGConfig {
  topK: number;
  similarityThreshold: number;
  includeMetadata: boolean;
  filter?: any;
}

/**
 * RAG (Retrieval-Augmented Generation) service for vector database operations
 * Handles document storage, retrieval, and formatting for AI context
 */
export class PineconeRAGService {
  private index: any;
  private config: RAGConfig;
  private embeddingService: UniversalEmbeddingService;

  constructor(config?: Partial<RAGConfig>, customEmbeddingService?: UniversalEmbeddingService) {
    this.index = pinecone.Index(PINECONE_INDEX);
    this.config = {
      topK: 5,
      similarityThreshold: 0.7,
      includeMetadata: true,
      ...config
    };
    this.embeddingService = customEmbeddingService || embeddingService;
  }

  // Create embeddings using the configured embedding service
  async createEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      return await this.embeddingService.createEmbeddings(texts);
    } catch (error) {
      console.error('Error creating embeddings:', error);
      throw new Error('Failed to create embeddings');
    }
  }

  // Upsert documents into Pinecone
  async upsertDocuments(documents: RawMaterialDocument[]): Promise<void> {
    try {
      const texts = documents.map(doc => doc.text);
      const embeddings = await this.createEmbeddings(texts);

      const vectors = documents.map((doc, index) => ({
        id: doc.id,
        values: embeddings[index],
        metadata: doc.metadata
      }));

      // Batch upsert (max 100 vectors per request)
      const batchSize = 100;
      for (let i = 0; i < vectors.length; i += batchSize) {
        const batch = vectors.slice(i, i + batchSize);
        await this.index.upsert(batch);
      }

      console.log(`Successfully upserted ${vectors.length} documents to Pinecone`);
    } catch (error) {
      console.error('Error upserting documents:', error);
      throw new Error('Failed to upsert documents to Pinecone');
    }
  }

  // Search for similar documents
  async searchSimilar(
    query: string,
    options?: Partial<RAGConfig>
  ): Promise<any[]> {
    try {
      const searchConfig = { ...this.config, ...options };

      // Create embedding for the query
      const queryEmbedding = await this.createEmbeddings([query]);

      // Search Pinecone
      const response = await this.index.query({
        vector: queryEmbedding[0],
        topK: searchConfig.topK,
        includeMetadata: searchConfig.includeMetadata,
        filter: searchConfig.filter || {
          source: 'raw_materials_real_stock'
        }
      });

      // Filter by similarity threshold if specified
      let matches = response.matches || [];
      if (searchConfig.similarityThreshold > 0) {
        matches = matches.filter(match =>
          (match.score || 0) >= searchConfig.similarityThreshold
        );
      }

      return matches;
    } catch (error) {
      console.error('Error searching Pinecone:', error);
      throw new Error('Failed to search Pinecone');
    }
  }

  // Enhanced search with context formatting
  async searchAndFormat(
    query: string,
    options?: Partial<RAGConfig>
  ): Promise<string> {
    const matches = await this.searchSimilar(query, options);
    return PineconeRAGService.formatSearchResults(matches);
  }

  // Delete documents by IDs
  async deleteDocuments(ids: string[]): Promise<void> {
    try {
      await this.index.deleteMany(ids);
      console.log(`Successfully deleted ${ids.length} documents from Pinecone`);
    } catch (error) {
      console.error('Error deleting documents:', error);
      throw new Error('Failed to delete documents from Pinecone');
    }
  }

  // Get index statistics
  async getIndexStats(): Promise<any> {
    try {
      return await this.index.describeIndexStats();
    } catch (error) {
      console.error('Error getting index stats:', error);
      throw new Error('Failed to get index statistics');
    }
  }

  // Batch process documents for vectorization
  async batchProcessDocuments(
    materials: any[],
    batchSize: number = 50
  ): Promise<void> {
    const documents = materials.map(material =>
      PineconeRAGService.prepareRawMaterialDocument(material)
    );

    console.log(`Processing ${documents.length} documents in batches of ${batchSize}`);

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      await this.upsertDocuments(batch);
      console.log(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)}`);
    }
  }

  // Prepare raw material data for vectorization
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
        source: 'raw_materials_real_stock'
      }
    };
  }

  // Format search results for AI context
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

    return '\n\nVector Database Search Results (Pinecone):\n' + results.join('\n\n');
  }

  // Update configuration
  updateConfig(newConfig: Partial<RAGConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  // Get current configuration
  getConfig(): RAGConfig {
    return { ...this.config };
  }
}