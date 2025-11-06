/**
 * Unified Search Service
 * Extends HybridSearchService with multi-collection routing
 *
 * Automatically routes queries to:
 * - In-stock materials (3,111 items from raw_materials_real_stock)
 * - All FDA ingredients (31,179 items from raw_materials_console)
 * - Both (unified search with smart prioritization)
 */

import { HybridSearchService, HybridSearchOptions, HybridSearchResult } from './hybrid-search-service';
import { route_query_to_collections, merge_collection_results, format_response_with_source_context, CollectionType } from '@/ai/utils/collection-router';

export interface UnifiedSearchOptions extends HybridSearchOptions {
  /** Explicitly specify collection(s) to search */
  collection?: CollectionType;
  /** Whether to include availability context in results */
  include_availability_context?: boolean;
}

export interface UnifiedSearchResult extends HybridSearchResult {
  /** Which collection this result came from */
  source_collection: 'in_stock' | 'all_fda';
  /** Availability status */
  availability: 'in_stock' | 'fda_only';
  /** Whether this material is prioritized (in stock) */
  is_prioritized?: boolean;
}

/**
 * Unified Search Service with Collection Routing
 * Intelligently searches across multiple collections based on query intent
 */
export class UnifiedSearchService extends HybridSearchService {
  /**
   * Search with automatic collection routing
   *
   * @param query - User query
   * @param options - Search options with optional collection specification
   * @returns Unified search results with availability info
   */
  async unified_search(
    query: string,
    options: UnifiedSearchOptions = {}
  ): Promise<UnifiedSearchResult[]> {
    console.log('🔍 [unified-search] Starting unified search:', query);

    // Route query to appropriate collections
    const routing = route_query_to_collections(query, options.collection);
    console.log('🔀 [unified-search] Routing decision:', {
      collections: routing.collections,
      search_mode: routing.search_mode,
      confidence: routing.confidence,
      reasoning: routing.reasoning
    });

    const results_by_collection: { [key: string]: HybridSearchResult[] } = {};

    // Search each routed collection
    for (const collection of routing.collections) {
      const namespace = routing.pinecone_namespaces[routing.collections.indexOf(collection)];

      console.log(`🔍 [unified-search] Searching ${collection} (namespace: ${namespace})...`);

      try {
        // Perform hybrid search with namespace filter
        const collection_results = await this.hybrid_search(query, {
          ...options,
          pinecone_namespace: namespace,
          metadata_filters: {
            ...options.metadata_filters,
            namespace: namespace,
            source: collection === 'in_stock' ? 'raw_materials_real_stock' : 'raw_materials_console'
          }
        });

        results_by_collection[collection] = collection_results;
        console.log(`✅ [unified-search] Found ${collection_results.length} results in ${collection}`);
      } catch (error: any) {
        console.error(`❌ [unified-search] Error searching ${collection}:`, error.message);
        results_by_collection[collection] = [];
      }
    }

    // Merge and deduplicate results
    const in_stock_results = results_by_collection['in_stock'] || [];
    const fda_results = results_by_collection['all_fda'] || [];

    const merged = merge_collection_results(
      in_stock_results,
      fda_results,
      routing.search_mode
    );

    console.log(`✅ [unified-search] Merged to ${merged.length} unique results`);

    // Convert to UnifiedSearchResult with enhanced metadata
    const unified_results: UnifiedSearchResult[] = merged.map(result => ({
      ...result,
      source_collection: result.source as 'in_stock' | 'all_fda',
      availability: result.availability as 'in_stock' | 'fda_only',
      is_prioritized: result.source === 'in_stock'
    }));

    // Add availability context if requested
    if (options.include_availability_context) {
      const context = format_response_with_source_context(unified_results, routing.search_mode);
      console.log('[unified-search] Availability context:', context);
    }

    return unified_results;
  }

  /**
   * Search only in-stock materials
   * Convenience method for stock-only queries
   */
  async search_in_stock(
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<UnifiedSearchResult[]> {
    return this.unified_search(query, {
      ...options,
      collection: 'in_stock'
    });
  }

  /**
   * Search all FDA ingredients
   * Convenience method for comprehensive ingredient searches
   */
  async search_all_fda(
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<UnifiedSearchResult[]> {
    return this.unified_search(query, {
      ...options,
      collection: 'all_fda'
    });
  }

  /**
   * Check if a specific ingredient is in stock
   * Returns boolean + details if found
   */
  async check_availability(
    ingredient_code_or_name: string
  ): Promise<{
    in_stock: boolean;
    details?: UnifiedSearchResult;
    alternatives?: UnifiedSearchResult[];
  }> {
    console.log('🔍 [unified-search] Checking availability:', ingredient_code_or_name);

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
  }

  /**
   * Get statistics about search results by collection
   */
  get_collection_stats(results: UnifiedSearchResult[]): {
    total: number;
    in_stock: number;
    fda_only: number;
    in_stock_percentage: number;
  } {
    const in_stock_count = results.filter(r => r.availability === 'in_stock').length;
    const fda_only_count = results.filter(r => r.availability === 'fda_only').length;

    return {
      total: results.length,
      in_stock: in_stock_count,
      fda_only: fda_only_count,
      in_stock_percentage: results.length > 0 ? (in_stock_count / results.length) * 100 : 0
    };
  }
}

/**
 * Create a singleton instance of UnifiedSearchService
 */
let unified_search_service_instance: UnifiedSearchService | null = null;

export function getUnifiedSearchService(): UnifiedSearchService {
  if (!unified_search_service_instance) {
    unified_search_service_instance = new UnifiedSearchService();
  }
  return unified_search_service_instance;
}
