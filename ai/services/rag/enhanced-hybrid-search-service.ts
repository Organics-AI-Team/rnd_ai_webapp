/**
 * Enhanced Hybrid Search Service with Semantic Reranking
 * Implements advanced search with multiple strategies and Pinecone integration
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { MongoClient, Db, Collection } from 'mongodb';
import { HybridSearchResult } from './hybrid-search-service';

// Define SearchStrategy locally
type SearchStrategy = 'semantic' | 'keyword' | 'fuzzy' | 'metadata' | 'hybrid';

interface EnhancedSearchOptions {
  query: string;
  topK?: number;
  category?: string;
  includeMetadata?: boolean;
  threshold?: number;
  rerank?: boolean;
  rerankModel?: string;
  semanticWeight?: number;
  keywordWeight?: number;
  fuzzyThreshold?: number;
  userId?: string;
  userPreferences?: any;
}

interface RerankOptions {
  model: string;
  topN: number;
  returnDocuments?: boolean;
  rankFields?: string[];
  parameters?: {
    inputType?: 'passage' | 'query';
    truncate?: 'END' | 'NONE';
  };
}

interface SearchResultWithScore {
  id: string;
  score: number;
  content: string;
  metadata: any;
  strategy: SearchStrategy;
  rerankScore?: number;
  combinedScore?: number;
}

/**
 * Enhanced Hybrid Search with Semantic Reranking
 */
export class EnhancedHybridSearchService {
  private pinecone: Pinecone;
  private mongoClient: MongoClient;
  private db: Db;
  private collection: Collection;
  private isInitialized = false;

  // Performance metrics
  private searchMetrics = {
    totalSearches: 0,
    averageLatency: 0,
    cacheHitRate: 0,
    rerankUsage: 0,
    strategyDistribution: {} as Record<SearchStrategy, number>,
  };

  constructor(
    private pineconeApiKey: string,
    private mongoUri: string,
    private dbName: string,
    private collectionName: string,
    private indexName: string
  ) {
    this.pinecone = new Pinecone({ apiKey: pineconeApiKey });
    this.mongoClient = new MongoClient(mongoUri);
  }

  /**
   * Initialize connections and indexes
   */
  async initialize(): Promise<void> {
    try {
      console.log('🔍 [EnhancedHybridSearch] Initializing enhanced search service...');

      // Initialize MongoDB connection
      await this.mongoClient.connect();
      this.db = this.mongoClient.db(this.dbName);
      this.collection = this.db.collection(this.collectionName);

      // Initialize Pinecone index
      const index = this.pinecone.Index(this.indexName);
      await index.describeIndexStats();

      this.isInitialized = true;
      console.log('✅ [EnhancedHybridSearch] Enhanced search service initialized successfully');
    } catch (error) {
      console.error('❌ [EnhancedHybridSearch] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Enhanced search with semantic reranking
   */
  async enhancedSearch(options: EnhancedSearchOptions): Promise<HybridSearchResult[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    this.searchMetrics.totalSearches++;

    try {
      // Step 1: Execute multiple search strategies
      const strategyResults = await this.executeMultipleStrategies(options);

      // Step 2: Merge and deduplicate results
      const mergedResults = this.mergeResults(strategyResults);

      // Step 3: Apply semantic reranking if requested
      let finalResults = mergedResults;
      if (options.rerank && mergedResults.length > 1) {
        finalResults = await this.applySemanticReranking(
          mergedResults,
          options.query,
          options.rerankModel || 'bge-reranker-v2-m3',
          {
            topN: options.topK || 10,
            returnDocuments: true,
            rankFields: options.rankFields || ['content'],
            parameters: {
              inputType: 'passage',
              truncate: 'END',
            },
          }
        );
        this.searchMetrics.rerankUsage++;
      }

      // Step 4: Apply personalized scoring if user preferences provided
      if (options.userId && options.userPreferences) {
        finalResults = this.applyPersonalizedScoring(
          finalResults,
          options.userPreferences
        );
      }

      // Step 5: Apply final ranking and filtering
      const rankedResults = this.applyFinalRanking(
        finalResults,
        options.semanticWeight || 0.6,
        options.keywordWeight || 0.4
      );

      // Step 6: Filter by threshold and limit
      const filteredResults = rankedResults
        .filter(result => result.score >= (options.threshold || 0.3))
        .slice(0, options.topK || 10);

      // Update metrics
      const latency = Date.now() - startTime;
      this.updateMetrics(latency);

      console.log(`🎯 [EnhancedHybridSearch] Search completed in ${latency}ms, found ${filteredResults.length} results`);

      return this.formatResults(filteredResults);

    } catch (error) {
      console.error('❌ [EnhancedHybridSearch] Search failed:', error);
      throw error;
    }
  }

  /**
   * Execute multiple search strategies in parallel
   */
  private async executeMultipleStrategies(
    options: EnhancedSearchOptions
  ): Promise<Map<SearchStrategy, SearchResultWithScore[]>> {
    const strategies: SearchStrategy[] = ['semantic', 'keyword', 'metadata', 'fuzzy'];
    const results = new Map<SearchStrategy, SearchResultWithScore[]>();

    const strategyPromises = strategies.map(async (strategy) => {
      try {
        const strategyResults = await this.executeStrategy(strategy, options);
        results.set(strategy, strategyResults);
        this.searchMetrics.strategyDistribution[strategy] =
          (this.searchMetrics.strategyDistribution[strategy] || 0) + 1;
      } catch (error) {
        console.warn(`⚠️ [EnhancedHybridSearch] Strategy ${strategy} failed:`, error);
        results.set(strategy, []);
      }
    });

    await Promise.all(strategyPromises);
    return results;
  }

  /**
   * Execute individual search strategy
   */
  private async executeStrategy(
    strategy: SearchStrategy,
    options: EnhancedSearchOptions
  ): Promise<SearchResultWithScore[]> {
    const index = this.pinecone.Index(this.indexName);

    switch (strategy) {
      case 'semantic':
        return await this.semanticSearch(index, options);
      case 'keyword':
        return await this.keywordSearch(options);
      case 'metadata':
        return await this.metadataSearch(options);
      case 'fuzzy':
        return await this.fuzzySearch(options);
      default:
        return [];
    }
  }

  /**
   * Semantic search using Pinecone with enhanced filtering
   */
  private async semanticSearch(
    index: any,
    options: EnhancedSearchOptions
  ): Promise<SearchResultWithScore[]> {
    try {
      // Generate query embedding (you would integrate with your embedding service)
      const queryEmbedding = await this.generateQueryEmbedding(options.query);

      const searchRequest: any = {
        vector: queryEmbedding,
        topK: options.topK || 20,
        includeMetadata: true,
        filter: {},
      };

      // Add category filter if specified
      if (options.category) {
        searchRequest.filter.category = options.category;
      }

      // Add user-specific filters if userId provided
      if (options.userId) {
        searchRequest.filter.userId = { $ne: options.userId }; // Exclude own content
      }

      const response = await index.query(searchRequest);

      return response.matches?.map((match: any) => ({
        id: match.id,
        score: match.score || 0,
        content: match.metadata?.content || '',
        metadata: match.metadata || {},
        strategy: 'semantic' as SearchStrategy,
      })) || [];

    } catch (error) {
      console.error('❌ [EnhancedHybridSearch] Semantic search failed:', error);
      return [];
    }
  }

  /**
   * Keyword search using MongoDB text search
   */
  private async keywordSearch(options: EnhancedSearchOptions): Promise<SearchResultWithScore[]> {
    try {
      const searchQuery: any = {
        $text: { $search: options.query },
      };

      // Add category filter
      if (options.category) {
        searchQuery.category = options.category;
      }

      const results = await this.collection
        .find(searchQuery, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(options.topK || 20)
        .toArray();

      return results.map((doc: any) => ({
        id: doc._id.toString(),
        score: doc.score || 0.5,
        content: doc.content || '',
        metadata: doc,
        strategy: 'keyword' as SearchStrategy,
      }));

    } catch (error) {
      console.error('❌ [EnhancedHybridSearch] Keyword search failed:', error);
      return [];
    }
  }

  /**
   * Metadata search using exact field matching
   */
  private async metadataSearch(options: EnhancedSearchOptions): Promise<SearchResultWithScore[]> {
    try {
      const searchQuery: any = {};

      // Search in various metadata fields
      const searchTerms = options.query.toLowerCase().split(' ');

      searchQuery.$or = [
        { name: { $regex: options.query, $options: 'i' } },
        { code: { $regex: options.query, $options: 'i' } },
        { description: { $regex: options.query, $options: 'i' } },
        { tags: { $in: searchTerms } },
        { benefits: { $regex: options.query, $options: 'i' } },
      ];

      // Add category filter
      if (options.category) {
        searchQuery.category = options.category;
      }

      const results = await this.collection
        .find(searchQuery)
        .limit(options.topK || 20)
        .toArray();

      return results.map((doc: any) => ({
        id: doc._id.toString(),
        score: 0.8, // High score for exact metadata matches
        content: doc.content || '',
        metadata: doc,
        strategy: 'metadata' as SearchStrategy,
      }));

    } catch (error) {
      console.error('❌ [EnhancedHybridSearch] Metadata search failed:', error);
      return [];
    }
  }

  /**
   * Fuzzy search using regex patterns
   */
  private async fuzzySearch(options: EnhancedSearchOptions): Promise<SearchResultWithScore[]> {
    try {
      const fuzzyThreshold = options.fuzzyThreshold || 0.7;
      const searchTerms = options.query.toLowerCase().split(' ');

      const searchQuery: any = {
        $or: [],
      };

      // Create fuzzy search patterns
      searchTerms.forEach(term => {
        if (term.length > 2) {
          // Allow for 1-2 character differences
          const fuzzyPattern = term.split('').join('.{0,2}');
          searchQuery.$or.push(
            { name: { $regex: fuzzyPattern, $options: 'i' } },
            { content: { $regex: fuzzyPattern, $options: 'i' } },
            { description: { $regex: fuzzyPattern, $options: 'i' } }
          );
        }
      });

      if (searchQuery.$or.length === 0) return [];

      const results = await this.collection
        .find(searchQuery)
        .limit(options.topK || 20)
        .toArray();

      return results.map((doc: any) => ({
        id: doc._id.toString(),
        score: 0.6, // Moderate score for fuzzy matches
        content: doc.content || '',
        metadata: doc,
        strategy: 'fuzzy' as SearchStrategy,
      }));

    } catch (error) {
      console.error('❌ [EnhancedHybridSearch] Fuzzy search failed:', error);
      return [];
    }
  }

  /**
   * Merge results from multiple strategies
   */
  private mergeResults(
    strategyResults: Map<SearchStrategy, SearchResultWithScore[]>
  ): SearchResultWithScore[] {
    const mergedResults = new Map<string, SearchResultWithScore>();

    // Merge results, keeping the highest score for each document
    for (const [strategy, results] of strategyResults) {
      results.forEach(result => {
        const existing = mergedResults.get(result.id);
        if (!existing || result.score > existing.score) {
          mergedResults.set(result.id, result);
        } else if (existing && existing.strategy !== strategy) {
          // Combine scores from different strategies
          existing.score = Math.max(existing.score, result.score);
        }
      });
    }

    return Array.from(mergedResults.values());
  }

  /**
   * Apply semantic reranking using Pinecone's rerank API
   */
  private async applySemanticReranking(
    results: SearchResultWithScore[],
    query: string,
    model: string,
    options: RerankOptions
  ): Promise<SearchResultWithScore[]> {
    try {
      // Prepare documents for reranking
      const documents = results.map(result => ({
        id: result.id,
        text: result.content,
        metadata: result.metadata,
      }));

      // Use Pinecone's rerank API
      const rerankResponse = await this.pinecone.inference.rerank(
        model,
        query,
        documents,
        options
      );

      // Apply rerank scores to results
      const rerankedResults = results.map(result => {
        const rerankResult = rerankResponse.data?.find(
          (r: any) => r.index.toString() === result.id
        );

        if (rerankResult) {
          return {
            ...result,
            rerankScore: rerankResult.score,
            combinedScore: (result.score * 0.3) + (rerankResult.score * 0.7),
          };
        }

        return result;
      });

      // Sort by combined score
      return rerankedResults.sort((a, b) => (b.combinedScore || 0) - (a.combinedScore || 0));

    } catch (error) {
      console.error('❌ [EnhancedHybridSearch] Semantic reranking failed:', error);
      return results; // Return original results if reranking fails
    }
  }

  /**
   * Apply personalized scoring based on user preferences
   */
  private applyPersonalizedScoring(
    results: SearchResultWithScore[],
    userPreferences: any
  ): SearchResultWithScore[] {
    return results.map(result => {
      let personalizedScore = result.score;

      // Boost score based on user's preferred categories
      if (userPreferences.preferredCategories?.includes(result.metadata.category)) {
        personalizedScore *= 1.2;
      }

      // Boost score based on user's interests
      if (userPreferences.interests?.some((interest: string) =>
        result.content.toLowerCase().includes(interest.toLowerCase())
      )) {
        personalizedScore *= 1.1;
      }

      // Adjust based on preferred complexity
      const contentComplexity = this.assessContentComplexity(result.content);
      if (userPreferences.preferredComplexity === contentComplexity) {
        personalizedScore *= 1.15;
      }

      return {
        ...result,
        score: personalizedScore,
      };
    });
  }

  /**
   * Apply final ranking with weighted scoring
   */
  private applyFinalRanking(
    results: SearchResultWithScore[],
    semanticWeight: number,
    keywordWeight: number
  ): SearchResultWithScore[] {
    return results.map(result => {
      let finalScore = result.score;

      // Apply strategy-specific weights
      if (result.strategy === 'semantic') {
        finalScore *= semanticWeight;
      } else if (result.strategy === 'keyword') {
        finalScore *= keywordWeight;
      }

      // Apply rerank boost if available
      if (result.rerankScore) {
        finalScore = (finalScore * 0.4) + (result.rerankScore * 0.6);
      }

      return {
        ...result,
        score: Math.min(finalScore, 1.0), // Cap at 1.0
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Generate query embedding (simplified implementation)
   */
  private async generateQueryEmbedding(query: string): Promise<number[]> {
    // This would integrate with your embedding service (OpenAI, Gemini, etc.)
    // For now, return a mock embedding
    const mockEmbedding = new Array(1536).fill(0).map(() => Math.random() - 0.5);
    return mockEmbedding;
  }

  /**
   * Assess content complexity
   */
  private assessContentComplexity(content: string): 'basic' | 'intermediate' | 'advanced' {
    const technicalTerms = [
      'mechanism', 'synthesis', 'molecular', 'chemical', 'biological',
      'formulation', 'compound', 'extraction', 'toxicity', 'efficacy'
    ];

    const technicalCount = technicalTerms.filter(term =>
      content.toLowerCase().includes(term)
    ).length;

    if (technicalCount === 0) return 'basic';
    if (technicalCount <= 2) return 'intermediate';
    return 'advanced';
  }

  /**
   * Format results for output
   */
  private formatResults(results: SearchResultWithScore[]): HybridSearchResult[] {
    return results.map(result => ({
      id: result.id,
      content: result.content,
      score: result.score,
      metadata: result.metadata,
      strategy: result.strategy,
      distance: 1 - result.score, // Convert to distance metric
    }));
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(latency: number): void {
    const prevAvg = this.searchMetrics.averageLatency;
    const total = this.searchMetrics.totalSearches;

    this.searchMetrics.averageLatency = (prevAvg * (total - 1) + latency) / total;
  }

  /**
   * Get search performance metrics
   */
  getMetrics() {
    return { ...this.searchMetrics };
  }

  /**
   * Get search suggestions based on query
   */
  async getSearchSuggestions(query: string, limit: number = 5): Promise<string[]> {
    try {
      // Use MongoDB aggregation to find popular related terms
      const pipeline = [
        {
          $match: {
            $or: [
              { name: { $regex: query, $options: 'i' } },
              { tags: { $regex: query, $options: 'i' } },
            ],
          },
        },
        {
          $unwind: '$tags',
        },
        {
          $match: {
            tags: { $regex: query, $options: 'i' },
          },
        },
        {
          $group: {
            _id: '$tags',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: limit },
      ];

      const results = await this.collection.aggregate(pipeline).toArray();
      return results.map((result: any) => result._id);

    } catch (error) {
      console.error('❌ [EnhancedHybridSearch] Failed to get suggestions:', error);
      return [];
    }
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.mongoClient) {
      await this.mongoClient.close();
    }
    console.log('🧹 [EnhancedHybridSearch] Enhanced search service disposed');
  }
}