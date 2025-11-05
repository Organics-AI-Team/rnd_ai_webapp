/**
 * Hybrid Search Client Service
 * Client-side wrapper for hybrid search API
 * Avoids Node.js module issues by calling server-side API
 */

export interface HybridSearchClientOptions {
  topK?: number;
  similarityThreshold?: number;
  enable_exact_match?: boolean;
  enable_fuzzy_match?: boolean;
  enable_semantic_search?: boolean;
  enable_metadata_filter?: boolean;
  max_results?: number;
  min_score?: number;
}

export interface HybridSearchResult {
  document: any;
  score: number;
  match_type: 'exact' | 'fuzzy' | 'semantic' | 'metadata' | 'hybrid';
  confidence: number;
  matched_fields: string[];
  source: 'mongodb' | 'pinecone';
}

export interface HybridSearchResponse {
  success: boolean;
  results: HybridSearchResult[];
  formatted: string;
  query: string;
  totalResults: number;
  error?: string;
  warning?: string;
  metadata?: any;
}

/**
 * Client-side Hybrid Search Service
 * Makes API calls to server-side hybrid search endpoint
 */
export class HybridSearchClient {
  private serviceName: string;
  private defaultOptions: HybridSearchClientOptions;

  constructor(serviceName: string = 'rawMaterialsAI', options: HybridSearchClientOptions = {}) {
    this.serviceName = serviceName;
    this.defaultOptions = {
      topK: 10,
      similarityThreshold: 0.5,
      enable_exact_match: true,
      enable_fuzzy_match: true,
      enable_semantic_search: true,
      enable_metadata_filter: true,
      max_results: 10,
      min_score: 0.5,
      ...options
    };

    console.log('🔧 [HybridSearchClient] Initialized:', {
      serviceName: this.serviceName,
      options: this.defaultOptions
    });
  }

  /**
   * Perform hybrid search via API
   */
  async hybrid_search(
    query: string,
    options?: HybridSearchClientOptions
  ): Promise<HybridSearchResult[]> {
    console.log('🔍 [HybridSearchClient] Starting search for:', query);

    const searchOptions = { ...this.defaultOptions, ...options };

    try {
      const response = await fetch('/api/rag/hybrid-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          serviceName: this.serviceName,
          ...searchOptions
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: HybridSearchResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Search failed');
      }

      console.log(`✅ [HybridSearchClient] Found ${data.totalResults} results`);

      return data.results;

    } catch (error) {
      console.error('❌ [HybridSearchClient] Search failed:', error);
      throw error;
    }
  }

  /**
   * Perform hybrid search and get formatted results
   */
  async search_and_format(
    query: string,
    options?: HybridSearchClientOptions
  ): Promise<string> {
    console.log('🔍 [HybridSearchClient] Starting formatted search for:', query);

    const searchOptions = { ...this.defaultOptions, ...options };

    try {
      const response = await fetch('/api/rag/hybrid-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          serviceName: this.serviceName,
          ...searchOptions
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: HybridSearchResponse = await response.json();

      if (!data.success) {
        console.warn('⚠️ [HybridSearchClient] Search unsuccessful:', data.error);
        return data.formatted || '\n\n⚠️ Database search temporarily unavailable.';
      }

      console.log(`✅ [HybridSearchClient] Formatted ${data.totalResults} results`);

      return data.formatted;

    } catch (error) {
      console.error('❌ [HybridSearchClient] Formatted search failed:', error);
      return '\n\n⚠️ Database search temporarily unavailable. Providing response based on general knowledge.';
    }
  }

  /**
   * Update service configuration
   */
  updateConfig(options: HybridSearchClientOptions): void {
    this.defaultOptions = { ...this.defaultOptions, ...options };
    console.log('🔧 [HybridSearchClient] Configuration updated:', this.defaultOptions);
  }

  /**
   * Get current configuration
   */
  getConfig(): HybridSearchClientOptions {
    return { ...this.defaultOptions };
  }
}
