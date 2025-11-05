/**
 * Unified Search Client Service
 * Client-side wrapper for unified search API with intelligent collection routing
 *
 * Features:
 * - Automatic query routing based on keywords
 * - Explicit collection selection (in_stock, all_fda, both)
 * - Availability checking
 * - Collection statistics
 */

import { CollectionType } from '@/ai/utils/collection-router';

export interface UnifiedSearchClientOptions {
  topK?: number;
  similarityThreshold?: number;
  enable_exact_match?: boolean;
  enable_fuzzy_match?: boolean;
  enable_semantic_search?: boolean;
  enable_metadata_filter?: boolean;
  max_results?: number;
  min_score?: number;
  collection?: CollectionType; // Explicit collection selection
  include_availability_context?: boolean;
}

export interface UnifiedSearchResult {
  document: any;
  score: number;
  match_type: 'exact' | 'fuzzy' | 'semantic' | 'metadata' | 'hybrid';
  confidence: number;
  matched_fields: string[];
  source: 'mongodb' | 'pinecone';
  source_collection: 'in_stock' | 'all_fda';
  availability: 'in_stock' | 'fda_only';
  is_prioritized?: boolean;
}

export interface UnifiedSearchResponse {
  success: boolean;
  results: UnifiedSearchResult[];
  formatted: string;
  query: string;
  totalResults: number;
  routing?: {
    collections: CollectionType[];
    search_mode: string;
    reasoning: string;
    confidence: number;
  };
  stats?: {
    total: number;
    in_stock: number;
    fda_only: number;
    in_stock_percentage: number;
  };
  error?: string;
  warning?: string;
  metadata?: any;
}

/**
 * Client-side Unified Search Service
 * Makes API calls to server-side unified search endpoint
 */
export class UnifiedSearchClient {
  private serviceName: string;
  private defaultOptions: UnifiedSearchClientOptions;

  constructor(serviceName: string = 'rawMaterialsAI', options: UnifiedSearchClientOptions = {}) {
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
      include_availability_context: true,
      ...options
    };

    console.log('🔧 [UnifiedSearchClient] Initialized:', {
      serviceName: this.serviceName,
      options: this.defaultOptions
    });
  }

  /**
   * Perform unified search with automatic routing via API
   */
  async unified_search(
    query: string,
    options?: UnifiedSearchClientOptions
  ): Promise<UnifiedSearchResult[]> {
    console.log('🔍 [UnifiedSearchClient] Starting unified search for:', query);

    const searchOptions = { ...this.defaultOptions, ...options };

    try {
      const response = await fetch('/api/rag/unified-search', {
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

      const data: UnifiedSearchResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Search failed');
      }

      console.log(`✅ [UnifiedSearchClient] Found ${data.totalResults} results`);
      if (data.routing) {
        console.log('🔀 [UnifiedSearchClient] Routing:', data.routing);
      }
      if (data.stats) {
        console.log('📊 [UnifiedSearchClient] Stats:', data.stats);
      }

      return data.results;

    } catch (error) {
      console.error('❌ [UnifiedSearchClient] Search failed:', error);
      throw error;
    }
  }

  /**
   * Perform unified search and get formatted results
   */
  async search_and_format(
    query: string,
    options?: UnifiedSearchClientOptions
  ): Promise<string> {
    console.log('🔍 [UnifiedSearchClient] Starting formatted search for:', query);

    const searchOptions = { ...this.defaultOptions, ...options };

    try {
      const response = await fetch('/api/rag/unified-search', {
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

      const data: UnifiedSearchResponse = await response.json();

      if (!data.success) {
        console.warn('⚠️ [UnifiedSearchClient] Search unsuccessful:', data.error);
        return data.formatted || '\n\n⚠️ Database search temporarily unavailable.';
      }

      console.log(`✅ [UnifiedSearchClient] Formatted ${data.totalResults} results`);
      if (data.routing) {
        console.log(`🔀 [UnifiedSearchClient] Routing: ${data.routing.search_mode} - ${data.routing.reasoning}`);
      }

      return data.formatted;

    } catch (error) {
      console.error('❌ [UnifiedSearchClient] Formatted search failed:', error);
      return '\n\n⚠️ Database search temporarily unavailable. Providing response based on general knowledge.';
    }
  }

  /**
   * Search only in-stock materials
   */
  async search_in_stock(
    query: string,
    options?: UnifiedSearchClientOptions
  ): Promise<UnifiedSearchResult[]> {
    console.log('✅ [UnifiedSearchClient] Searching in-stock only');
    return this.unified_search(query, { ...options, collection: 'in_stock' });
  }

  /**
   * Search all FDA ingredients
   */
  async search_all_fda(
    query: string,
    options?: UnifiedSearchClientOptions
  ): Promise<UnifiedSearchResult[]> {
    console.log('📚 [UnifiedSearchClient] Searching all FDA');
    return this.unified_search(query, { ...options, collection: 'all_fda' });
  }

  /**
   * Check availability of specific ingredient
   */
  async check_availability(ingredient_code_or_name: string): Promise<{
    in_stock: boolean;
    details?: UnifiedSearchResult;
    alternatives?: UnifiedSearchResult[];
  }> {
    console.log('🔍 [UnifiedSearchClient] Checking availability:', ingredient_code_or_name);

    try {
      // First search in stock
      const stock_results = await this.search_in_stock(ingredient_code_or_name, { topK: 1 });

      if (stock_results.length > 0 && stock_results[0].score > 0.8) {
        return {
          in_stock: true,
          details: stock_results[0]
        };
      }

      // Not in stock - search FDA for alternatives
      const fda_results = await this.search_all_fda(ingredient_code_or_name, { topK: 5 });

      return {
        in_stock: false,
        alternatives: fda_results
      };

    } catch (error) {
      console.error('❌ [UnifiedSearchClient] Availability check failed:', error);
      return {
        in_stock: false,
        alternatives: []
      };
    }
  }

  /**
   * Update service configuration
   */
  updateConfig(options: UnifiedSearchClientOptions): void {
    this.defaultOptions = { ...this.defaultOptions, ...options };
    console.log('🔧 [UnifiedSearchClient] Configuration updated:', this.defaultOptions);
  }

  /**
   * Get current configuration
   */
  getConfig(): UnifiedSearchClientOptions {
    return { ...this.defaultOptions };
  }
}
