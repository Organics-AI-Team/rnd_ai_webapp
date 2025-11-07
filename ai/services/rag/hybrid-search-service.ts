/**
 * Hybrid Search Service
 * Combines multiple search strategies for maximum accuracy and flexibility
 *
 * Search Strategies:
 * 1. Exact Match (MongoDB) - for codes and exact names
 * 2. Metadata Filter (Pinecone) - for structured field searches
 * 3. Semantic Vector Search (Pinecone) - for natural language queries
 * 4. Fuzzy Match - for typos and variations
 * 5. BM25 Text Search - for keyword-based ranking
 *
 * Features:
 * - Multi-strategy fusion
 * - Dynamic score weighting
 * - Result re-ranking
 * - Query expansion
 */

import { PineconeRAGService, RAGConfig, RawMaterialDocument } from './pinecone-service-stub';
import { classify_query, QueryClassification, fuzzy_match_score } from '../../utils/query-classifier';
import mongoClientPromise from '@/lib/mongodb';

export interface HybridSearchResult {
  document: any;
  score: number;
  match_type: 'exact' | 'fuzzy' | 'semantic' | 'metadata' | 'hybrid';
  confidence: number;
  matched_fields: string[];
  source: 'mongodb' | 'pinecone';
}

export interface HybridSearchOptions extends Partial<RAGConfig> {
  enable_exact_match?: boolean;
  enable_fuzzy_match?: boolean;
  enable_semantic_search?: boolean;
  enable_metadata_filter?: boolean;
  min_score?: number;
  max_results?: number;
  boost_weights?: {
    exact: number;
    fuzzy: number;
    semantic: number;
    metadata: number;
  };
  pinecone_namespace?: string; // Support for Pinecone namespaces
  mongodb_collection?: string; // Support for MongoDB collection selection
  metadata_filters?: any; // Additional metadata filters
}

/**
 * Hybrid Search Service
 * Intelligently combines multiple search strategies for optimal results
 */
export class HybridSearchService extends PineconeRAGService {
  private mongodb_client: any = null;

  constructor(serviceName?: any, config?: Partial<RAGConfig>) {
    super(serviceName, config);
    this.init_mongodb();
  }

  /**
   * Initialize MongoDB connection for exact match searches
   */
  private async init_mongodb(): Promise<void> {
    try {
      this.mongodb_client = await mongoClientPromise;
      console.log('✅ [hybrid-search] MongoDB initialized for exact match searches');
    } catch (error) {
      console.warn('⚠️ [hybrid-search] MongoDB initialization failed:', error.message);
      this.mongodb_client = null;
    }
  }

  /**
   * Main hybrid search method
   * Automatically selects best strategy based on query classification
   */
  async hybrid_search(
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<HybridSearchResult[]> {
    console.log('🔍 [hybrid-search] Starting hybrid search for:', query);

    const start_time = Date.now();

    // Step 1: Classify query
    const classification = classify_query(query);
    console.log('📊 [hybrid-search] Query classification:', classification);

    // Step 2: Execute appropriate search strategies
    const results = await this.execute_search_strategies(query, classification, options);

    // Step 3: Merge and re-rank results
    const merged_results = this.merge_and_rerank(results, classification, options);

    // Step 4: Apply filters and limits
    const final_results = this.apply_filters(merged_results, options);

    const elapsed = Date.now() - start_time;
    console.log(`✅ [hybrid-search] Search completed in ${elapsed}ms, found ${final_results.length} results`);

    return final_results;
  }

  /**
   * Execute search strategies based on classification
   */
  private async execute_search_strategies(
    query: string,
    classification: QueryClassification,
    options: HybridSearchOptions
  ): Promise<HybridSearchResult[]> {
    const all_results: HybridSearchResult[] = [];

    // Determine MongoDB collection to search (default to raw_materials_real_stock)
    const mongodb_collection = options.mongodb_collection || 'raw_materials_real_stock';

    // Strategy 1: Exact Match (highest priority for codes)
    if (
      (options.enable_exact_match !== false) &&
      (classification.query_type === 'exact_code' || classification.extracted_entities.codes)
    ) {
      console.log('🎯 [hybrid-search] Executing exact match strategy');
      const exact_results = await this.exact_match_search(query, classification, mongodb_collection);
      all_results.push(...exact_results);

      // If we found exact matches with high confidence, we can skip other strategies
      if (exact_results.length > 0 && exact_results[0].score >= 0.95) {
        console.log('✅ [hybrid-search] High-confidence exact match found, skipping other strategies');
        return exact_results;
      }
    }

    // Strategy 2: Metadata Filter Search
    if (options.enable_metadata_filter !== false) {
      console.log('🏷️ [hybrid-search] Executing metadata filter strategy');
      const metadata_results = await this.metadata_filter_search(query, classification, options);
      all_results.push(...metadata_results);
    }

    // Strategy 3: Fuzzy Match (for typos and variations)
    if (
      (options.enable_fuzzy_match !== false) &&
      classification.search_strategy === 'fuzzy_match'
    ) {
      console.log('🔤 [hybrid-search] Executing fuzzy match strategy');
      const fuzzy_results = await this.fuzzy_match_search(query, classification, mongodb_collection);
      all_results.push(...fuzzy_results);
    }

    // Strategy 4: Semantic Vector Search
    if (options.enable_semantic_search !== false) {
      console.log('🧠 [hybrid-search] Executing semantic search strategy');
      const semantic_results = await this.semantic_vector_search(query, classification, options);
      all_results.push(...semantic_results);
    }

    return all_results;
  }

  /**
   * Strategy 1: Exact Match Search (MongoDB)
   * Search for exact code or name matches in MongoDB
   */
  private async exact_match_search(
    query: string,
    classification: QueryClassification,
    collection_name: string = 'raw_materials_real_stock'
  ): Promise<HybridSearchResult[]> {
    if (!this.mongodb_client) {
      console.warn('⚠️ [hybrid-search] MongoDB not available for exact match');
      return [];
    }

    try {
      const db = this.mongodb_client.db();
      const collection = db.collection(collection_name);

      console.log(`🎯 [exact-match] Searching in MongoDB collection: ${collection_name}`);

      const codes = classification.extracted_entities.codes || [];
      const names = classification.extracted_entities.names || [];

      // Build query with OR conditions
      const or_conditions = [];

      // Add code searches (case-insensitive, multiple formats)
      codes.forEach(code => {
        or_conditions.push(
          { rm_code: { $regex: new RegExp(code, 'i') } },
          { trade_name: { $regex: new RegExp(code, 'i') } }
        );
      });

      // Add name searches
      names.forEach(name => {
        or_conditions.push(
          { trade_name: { $regex: new RegExp(name, 'i') } },
          { inci_name: { $regex: new RegExp(name, 'i') } }
        );
      });

      if (or_conditions.length === 0) {
        // Fallback: search in all text fields
        const query_regex = new RegExp(query, 'i');
        or_conditions.push(
          { rm_code: query_regex },
          { trade_name: query_regex },
          { inci_name: query_regex }
        );
      }

      const documents = await collection
        .find({ $or: or_conditions })
        .limit(10)
        .toArray();

      console.log(`✅ [exact-match] Found ${documents.length} exact matches`);

      return documents.map(doc => {
        // Calculate match score based on field matches
        let score = 0.8; // Base score for exact match
        const matched_fields: string[] = [];

        codes.forEach(code => {
          const code_regex = new RegExp(code, 'i');
          if (code_regex.test(doc.rm_code)) {
            score = 1.0;
            matched_fields.push('rm_code');
          }
        });

        names.forEach(name => {
          if (doc.trade_name?.toLowerCase().includes(name.toLowerCase())) {
            score = Math.max(score, 0.95);
            matched_fields.push('trade_name');
          }
          if (doc.inci_name?.toLowerCase().includes(name.toLowerCase())) {
            score = Math.max(score, 0.9);
            matched_fields.push('inci_name');
          }
        });

        return {
          document: doc,
          score,
          match_type: 'exact' as const,
          confidence: 0.95,
          matched_fields,
          source: 'mongodb' as const
        };
      });
    } catch (error) {
      console.error('❌ [exact-match] Error:', error);
      return [];
    }
  }

  /**
   * Strategy 2: Metadata Filter Search (Pinecone)
   * Use Pinecone metadata filters for structured searches
   */
  private async metadata_filter_search(
    query: string,
    classification: QueryClassification,
    options: HybridSearchOptions
  ): Promise<HybridSearchResult[]> {
    try {
      // Build dynamic metadata filters
      const filters: any = options.metadata_filters || {};

      // Add default source filter if not provided
      if (!filters.source && !options.pinecone_namespace) {
        filters.source = 'raw_materials_real_stock';
      }

      // Add filters based on extracted entities
      const codes = classification.extracted_entities.codes || [];
      if (codes.length > 0) {
        // Search for any of the extracted codes using $in operator (Pinecone compatible)
        // Pinecone doesn't support $regex, so we use exact matching with $in
        filters.rm_code = { $in: codes };
      }

      const results = await this.searchSimilar(query, {
        ...options,
        filter: filters,
        namespace: options.pinecone_namespace,
        topK: options.topK || 10,
        similarityThreshold: 0.6 // Lower threshold for metadata search
      });

      console.log(`✅ [metadata-filter] Found ${results.length} metadata matches`);

      return results.map(match => ({
        document: match.metadata,
        score: (match.score || 0.7) * 0.9, // Slight penalty for metadata-only match
        match_type: 'metadata' as const,
        confidence: 0.8,
        matched_fields: ['metadata'],
        source: 'pinecone' as const
      }));
    } catch (error) {
      console.error('❌ [metadata-filter] Error:', error);
      return [];
    }
  }

  /**
   * Strategy 3: Fuzzy Match Search
   * Find similar matches using fuzzy string matching
   */
  private async fuzzy_match_search(
    query: string,
    classification: QueryClassification,
    collection_name: string = 'raw_materials_real_stock'
  ): Promise<HybridSearchResult[]> {
    if (!this.mongodb_client) return [];

    try {
      const db = this.mongodb_client.db();
      const collection = db.collection(collection_name);

      console.log(`🔤 [fuzzy-match] Searching in MongoDB collection: ${collection_name}`);

      // Get all documents (with limit for performance)
      const all_docs = await collection.find({}).limit(100).toArray();

      const fuzzy_results: HybridSearchResult[] = [];

      all_docs.forEach(doc => {
        let best_score = 0;
        const matched_fields: string[] = [];

        // Check fuzzy match against multiple fields
        const fields_to_check = [
          { field: 'rm_code', weight: 1.0 },
          { field: 'trade_name', weight: 0.9 },
          { field: 'inci_name', weight: 0.85 }
        ];

        fields_to_check.forEach(({ field, weight }) => {
          const field_value = doc[field];
          if (field_value) {
            const fuzzy_score = fuzzy_match_score(query, field_value) * weight;
            if (fuzzy_score > best_score) {
              best_score = fuzzy_score;
              matched_fields.push(field);
            }
          }
        });

        // Only include if fuzzy score is above threshold
        if (best_score > 0.6) {
          fuzzy_results.push({
            document: doc,
            score: best_score,
            match_type: 'fuzzy' as const,
            confidence: 0.75,
            matched_fields,
            source: 'mongodb' as const
          });
        }
      });

      console.log(`✅ [fuzzy-match] Found ${fuzzy_results.length} fuzzy matches`);

      return fuzzy_results.sort((a, b) => b.score - a.score).slice(0, 10);
    } catch (error) {
      console.error('❌ [fuzzy-match] Error:', error);
      return [];
    }
  }

  /**
   * Strategy 4: Semantic Vector Search (Pinecone)
   * Use embeddings for natural language understanding
   */
  private async semantic_vector_search(
    query: string,
    classification: QueryClassification,
    options: HybridSearchOptions
  ): Promise<HybridSearchResult[]> {
    try {
      // Use expanded queries for better coverage
      const queries_to_search = classification.expanded_queries || [query];

      const all_results: any[] = [];

      for (const expanded_query of queries_to_search.slice(0, 3)) {
        // Limit to top 3 expansions
        const results = await this.searchSimilar(expanded_query, {
          ...options,
          namespace: options.pinecone_namespace,
          filter: options.metadata_filters,
          topK: options.topK || 5,
          similarityThreshold: options.similarityThreshold || 0.5
        });

        all_results.push(...results);
      }

      // Remove duplicates by ID
      const unique_results = all_results.filter(
        (result, index, self) =>
          index === self.findIndex(r => r.id === result.id)
      );

      console.log(`✅ [semantic-search] Found ${unique_results.length} semantic matches`);

      return unique_results.map(match => ({
        document: match.metadata,
        score: match.score || 0.6,
        match_type: 'semantic' as const,
        confidence: 0.7,
        matched_fields: ['semantic'],
        source: 'pinecone' as const
      }));
    } catch (error) {
      console.error('❌ [semantic-search] Error:', error);
      return [];
    }
  }

  /**
   * Merge and re-rank results from multiple strategies
   */
  private merge_and_rerank(
    results: HybridSearchResult[],
    classification: QueryClassification,
    options: HybridSearchOptions
  ): HybridSearchResult[] {
    console.log(`🔄 [merge-rerank] Merging ${results.length} results from all strategies`);

    // Remove duplicates (same document from different strategies)
    const unique_map = new Map<string, HybridSearchResult>();

    results.forEach(result => {
      const doc_id = result.document._id?.toString() || result.document.rm_code || JSON.stringify(result.document);

      if (unique_map.has(doc_id)) {
        const existing = unique_map.get(doc_id)!;

        // Keep the result with higher score, or merge if from different strategies
        if (result.score > existing.score) {
          unique_map.set(doc_id, {
            ...result,
            match_type: 'hybrid' as const,
            matched_fields: [...new Set([...existing.matched_fields, ...result.matched_fields])]
          });
        }
      } else {
        unique_map.set(doc_id, result);
      }
    });

    // Apply boost weights
    const boost_weights = options.boost_weights || {
      exact: 1.0,
      fuzzy: 0.85,
      semantic: 0.75,
      metadata: 0.8
    };

    const reranked = Array.from(unique_map.values()).map(result => ({
      ...result,
      score: result.score * (boost_weights[result.match_type === 'hybrid' ? 'exact' : result.match_type] || 1.0)
    }));

    // Sort by score
    reranked.sort((a, b) => b.score - a.score);

    console.log(`✅ [merge-rerank] Reranked to ${reranked.length} unique results`);

    return reranked;
  }

  /**
   * Apply final filters and limits
   */
  private apply_filters(
    results: HybridSearchResult[],
    options: HybridSearchOptions
  ): HybridSearchResult[] {
    let filtered = results;

    // Apply minimum score threshold
    if (options.min_score !== undefined) {
      filtered = filtered.filter(r => r.score >= options.min_score!);
    }

    // Apply max results limit
    const max_results = options.max_results || 10;
    filtered = filtered.slice(0, max_results);

    return filtered;
  }

  /**
   * Format hybrid search results for AI context
   */
  format_hybrid_results(results: HybridSearchResult[]): string {
    if (results.length === 0) {
      return '\n\n❌ No relevant raw materials found in the database.';
    }

    const formatted = results.map((result, index) => {
      const doc = result.document;
      let output = `${index + 1}. **${doc.trade_name || 'Unknown Material'}**`;
      output += ` (Match: ${result.match_type}, Score: ${result.score.toFixed(3)})\n`;

      if (doc.rm_code) output += `   **Material Code:** ${doc.rm_code}\n`;
      if (doc.inci_name) output += `   **INCI Name:** ${doc.inci_name}\n`;
      if (doc.supplier) output += `   **Supplier:** ${doc.supplier}\n`;
      if (doc.company_name) output += `   **Company:** ${doc.company_name}\n`;
      if (doc.rm_cost) output += `   **Cost:** ${doc.rm_cost}\n`;
      if (doc.benefits) output += `   **Benefits:** ${doc.benefits}\n`;
      if (doc.details) output += `   **Details:** ${doc.details}\n`;
      output += `   **Matched Fields:** ${result.matched_fields.join(', ')}\n`;

      return output;
    });

    return '\n\n✅ **Database Search Results (Hybrid Search)**:\n' + formatted.join('\n\n');
  }
}
