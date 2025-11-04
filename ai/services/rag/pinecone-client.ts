/**
 * Client-side Pinecone RAG service interface
 * This is a client-safe version that imports the actual Pinecone service only when needed
 */
import { RAGServicesConfig } from '../../config/rag-config';

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

export interface SearchResult {
  id: string;
  score: number;
  metadata: any;
}

/**
 * Client-side Pinecone service wrapper
 * Handles client-side RAG operations without importing server-side Pinecone library
 */
export class PineconeClientService {
  private config: RAGConfig;
  private serviceName: keyof RAGServicesConfig;

  constructor(serviceName: keyof RAGServicesConfig = 'rawMaterialsAllAI', config?: Partial<RAGConfig>) {
    this.serviceName = serviceName;
    this.config = {
      topK: 5,
      similarityThreshold: 0.7,
      includeMetadata: true,
      ...config
    };
  }

  /**
   * Search for similar materials via API
   */
  async searchSimilar(
    query: string,
    options?: Partial<RAGConfig>
  ): Promise<SearchResult[]> {
    try {
      const searchConfig = { ...this.config, ...options };

      const response = await fetch('/api/rag/searchRawMaterials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          topK: searchConfig.topK,
          similarityThreshold: searchConfig.similarityThreshold,
          serviceName: this.serviceName,
        }),
      });

      if (!response.ok) {
        throw new Error('Search request failed');
      }

      const data = await response.json();
      return data.matches || [];
    } catch (error) {
      console.error('Error searching Pinecone:', error);
      throw new Error('Failed to search Pinecone');
    }
  }

  /**
   * Get formatted search results
   */
  async searchAndFormat(
    query: string,
    options?: Partial<RAGConfig>
  ): Promise<string> {
    const matches = await this.searchSimilar(query, options);
    return PineconeClientService.formatSearchResults(matches);
  }

  /**
   * Format search results for display
   */
  static formatSearchResults(matches: SearchResult[]): string {
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

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<RAGConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): RAGConfig {
    return { ...this.config };
  }
}

/**
 * Create a new client-side Pinecone service
 */
export function createPineconeClientService(serviceName?: keyof RAGServicesConfig, config?: Partial<RAGConfig>): PineconeClientService {
  return new PineconeClientService(serviceName, config);
}