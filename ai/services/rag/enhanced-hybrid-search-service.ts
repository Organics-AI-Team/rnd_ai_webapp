/**
 * Enhanced Hybrid Search Service with Semantic Reranking
 * Implements advanced search with multiple strategies using ChromaDB
 *
 * Updated: 2025-11-07 - Migrated from Pinecone to ChromaDB
 */

import { getChromaService, ChromaService } from '../vector/chroma-service';
import { MongoClient, Db, Collection } from 'mongodb';
import { HybridSearchResult } from './hybrid-search-service';
import { createEmbeddingService } from '../embeddings/universal-embedding-service';
import { Logger } from '@/ai/utils/logger';
import { ErrorHandler, ErrorType } from '@/ai/utils/error-handler';

const logger = Logger.scope('EnhancedHybridSearch');

// Define SearchStrategy locally
type SearchStrategy = 'semantic' | 'keyword' | 'fuzzy' | 'metadata' | 'hybrid';

interface EnhancedSearchOptions {
  query: string;
  topK?: number;
  category?: string;
  includeMetadata?: boolean;
  threshold?: number;
  rerank?: boolean;
  semanticWeight?: number;
  keywordWeight?: number;
  fuzzyThreshold?: number;
  userId?: string;
  userPreferences?: any;
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
 * Enhanced Hybrid Search with ChromaDB Integration
 */
export class EnhancedHybridSearchService {
  private chromaService: ChromaService;
  private embeddingService: any;
  private mongoClient: MongoClient;
  private db: Db;
  private collection: Collection;
  private isInitialized = false;
  private collectionName: string;
  private chromaCollectionName: string;

  // Performance metrics
  private searchMetrics = {
    totalSearches: 0,
    averageLatency: 0,
    cacheHitRate: 0,
    rerankUsage: 0,
    strategyDistribution: {} as Record<SearchStrategy, number>,
  };

  constructor(
    chromaApiKey: string, // Kept for backward compatibility, not used
    mongoUri: string,
    dbName: string,
    collectionName: string,
    chromaCollectionName: string
  ) {
    logger.debug('constructor', {
      dbName,
      collectionName,
      chromaCollectionName
    });

    this.chromaService = getChromaService();
    this.embeddingService = createEmbeddingService({
      provider: 'gemini',
      model: 'gemini-embedding-001',
      dimensions: 3072,
      batchSize: 96,
      apiKey: process.env.GEMINI_API_KEY || ''
    });
    this.mongoClient = new MongoClient(mongoUri);
    this.collectionName = collectionName;
    this.chromaCollectionName = chromaCollectionName;

    logger.info('Enhanced hybrid search service created');
  }

  /**
   * Initialize connections and indexes
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('Already initialized');
      return;
    }

    logger.debug('initialize');

    try {
      logger.info('Initializing enhanced search service...');

      // Initialize MongoDB connection
      await this.mongoClient.connect();
      this.db = this.mongoClient.db();
      this.collection = this.db.collection(this.collectionName);
      logger.info('MongoDB connected', { collection: this.collectionName });

      // Initialize ChromaDB
      await this.chromaService.initialize();

      // Verify ChromaDB collection exists
      const stats = await this.chromaService.getCollectionStats(this.chromaCollectionName);
      logger.info('ChromaDB collection ready', {
        collection: this.chromaCollectionName,
        vectorCount: stats.count
      });

      this.isInitialized = true;
      logger.info('✅ Enhanced search service initialized successfully');
    } catch (error) {
      logger.error('Initialization failed', error);
      throw ErrorHandler.wrap(
        error,
        'Failed to initialize enhanced search service',
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Enhanced search with semantic reranking
   */
  async enhancedSearch(options: EnhancedSearchOptions): Promise<HybridSearchResult[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    logger.debug('enhancedSearch', {
      query: options.query,
      topK: options.topK,
      category: options.category
    });

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
        finalResults = await this.applySimpleReranking(
          mergedResults,
          options.query
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

      logger.info('Search completed', {
        latency: `${latency}ms`,
        resultsCount: filteredResults.length,
        threshold: options.threshold || 0.3
      });

      return this.formatResults(filteredResults);

    } catch (error) {
      logger.error('Search failed', error, { query: options.query });
      throw ErrorHandler.wrap(
        error,
        'Enhanced search failed',
        ErrorType.DATABASE_ERROR
      );
    }
  }

  /**
   * Hybrid search wrapper for backwards compatibility
   * Matches the API calling signature: hybridSearch(query, options)
   */
  async hybridSearch(
    query: string,
    options?: {
      userId?: string;
      category?: string;
      limit?: number;
      includeMetadata?: boolean;
      threshold?: number;
      rerank?: boolean;
    }
  ): Promise<HybridSearchResult[]> {
    logger.debug('hybridSearch (wrapper)', { query, options });

    return this.enhancedSearch({
      query,
      topK: options?.limit || 10,
      category: options?.category,
      includeMetadata: options?.includeMetadata ?? true,
      threshold: options?.threshold || 0.3,
      rerank: options?.rerank ?? true,
      userId: options?.userId,
    });
  }

  /**
   * Execute multiple search strategies in parallel
   */
  private async executeMultipleStrategies(
    options: EnhancedSearchOptions
  ): Promise<Map<SearchStrategy, SearchResultWithScore[]>> {
    logger.debug('executeMultipleStrategies');

    const strategies: SearchStrategy[] = ['semantic', 'keyword', 'metadata', 'fuzzy'];
    const results = new Map<SearchStrategy, SearchResultWithScore[]>();

    const strategyPromises = strategies.map(async (strategy) => {
      try {
        const strategyResults = await this.executeStrategy(strategy, options);
        results.set(strategy, strategyResults);
        this.searchMetrics.strategyDistribution[strategy] =
          (this.searchMetrics.strategyDistribution[strategy] || 0) + 1;
        logger.debug('Strategy completed', {
          strategy,
          resultsCount: strategyResults.length
        });
      } catch (error) {
        logger.warn(`Strategy ${strategy} failed`, error);
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
    switch (strategy) {
      case 'semantic':
        return await this.semanticSearch(options);
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
   * Semantic search using ChromaDB with enhanced filtering
   */
  private async semanticSearch(
    options: EnhancedSearchOptions
  ): Promise<SearchResultWithScore[]> {
    logger.debug('semanticSearch', { query: options.query });

    try {
      // Generate query embedding
      const queryEmbedding = await this.embeddingService.createEmbeddings([options.query]);

      // Build metadata filter
      const where: any = {};
      if (options.category) {
        where.category = options.category;
      }
      if (options.userId) {
        where.userId = { $ne: options.userId }; // Exclude own content
      }

      // Search ChromaDB
      const matches = await this.chromaService.query(
        this.chromaCollectionName,
        queryEmbedding[0],
        {
          topK: options.topK || 20,
          where: Object.keys(where).length > 0 ? where : undefined,
          includeMetadata: true,
          includeDocuments: true,
          includeDistances: true
        }
      );

      logger.info('Semantic search completed', {
        matchesCount: matches.length
      });

      return matches.map((match: any) => ({
        id: match.id,
        score: match.score || 0,
        content: match.document || match.metadata?.content || '',
        metadata: match.metadata || {},
        strategy: 'semantic' as SearchStrategy,
      }));

    } catch (error) {
      logger.error('Semantic search failed', error);
      return [];
    }
  }

  /**
   * Keyword search using MongoDB text search
   */
  private async keywordSearch(options: EnhancedSearchOptions): Promise<SearchResultWithScore[]> {
    logger.debug('keywordSearch', { query: options.query });

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

      logger.info('Keyword search completed', { resultsCount: results.length });

      return results.map((doc: any) => ({
        id: doc._id.toString(),
        score: doc.score || 0.5,
        content: doc.content || '',
        metadata: doc,
        strategy: 'keyword' as SearchStrategy,
      }));

    } catch (error) {
      logger.error('Keyword search failed', error);
      return [];
    }
  }

  /**
   * Metadata search using exact field matching
   */
  private async metadataSearch(options: EnhancedSearchOptions): Promise<SearchResultWithScore[]> {
    logger.debug('metadataSearch', { query: options.query });

    try {
      const searchQuery: any = {};
      const searchTerms = options.query.toLowerCase().split(' ');

      searchQuery.$or = [
        { name: { $regex: options.query, $options: 'i' } },
        { rm_code: { $regex: options.query, $options: 'i' } },
        { trade_name: { $regex: options.query, $options: 'i' } },
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

      logger.info('Metadata search completed', { resultsCount: results.length });

      return results.map((doc: any) => ({
        id: doc._id.toString(),
        score: 0.8, // High score for exact metadata matches
        content: doc.content || doc.trade_name || '',
        metadata: doc,
        strategy: 'metadata' as SearchStrategy,
      }));

    } catch (error) {
      logger.error('Metadata search failed', error);
      return [];
    }
  }

  /**
   * Fuzzy search using regex patterns
   */
  private async fuzzySearch(options: EnhancedSearchOptions): Promise<SearchResultWithScore[]> {
    logger.debug('fuzzySearch', { query: options.query });

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
            { trade_name: { $regex: fuzzyPattern, $options: 'i' } },
            { description: { $regex: fuzzyPattern, $options: 'i' } }
          );
        }
      });

      if (searchQuery.$or.length === 0) return [];

      const results = await this.collection
        .find(searchQuery)
        .limit(options.topK || 20)
        .toArray();

      logger.info('Fuzzy search completed', { resultsCount: results.length });

      return results.map((doc: any) => ({
        id: doc._id.toString(),
        score: 0.6, // Moderate score for fuzzy matches
        content: doc.content || doc.trade_name || '',
        metadata: doc,
        strategy: 'fuzzy' as SearchStrategy,
      }));

    } catch (error) {
      logger.error('Fuzzy search failed', error);
      return [];
    }
  }

  /**
   * Merge results from multiple strategies
   */
  private mergeResults(
    strategyResults: Map<SearchStrategy, SearchResultWithScore[]>
  ): SearchResultWithScore[] {
    logger.debug('mergeResults');

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

    logger.info('Results merged', { totalUnique: mergedResults.size });
    return Array.from(mergedResults.values());
  }

  /**
   * Apply simple reranking based on content relevance
   * Note: This is a simplified version as ChromaDB doesn't have built-in reranking like Pinecone
   */
  private async applySimpleReranking(
    results: SearchResultWithScore[],
    query: string
  ): Promise<SearchResultWithScore[]> {
    logger.debug('applySimpleReranking', { resultsCount: results.length });

    try {
      const queryTerms = query.toLowerCase().split(' ');

      // Calculate content relevance score
      const rerankedResults = results.map(result => {
        const content = result.content.toLowerCase();

        // Count query term occurrences in content
        let relevanceScore = 0;
        queryTerms.forEach(term => {
          const occurrences = (content.match(new RegExp(term, 'g')) || []).length;
          relevanceScore += occurrences * 0.1;
        });

        // Calculate combined score
        const rerankScore = Math.min(relevanceScore, 1.0);
        const combinedScore = (result.score * 0.3) + (rerankScore * 0.7);

        return {
          ...result,
          rerankScore,
          combinedScore,
        };
      });

      // Sort by combined score
      const sorted = rerankedResults.sort((a, b) => (b.combinedScore || 0) - (a.combinedScore || 0));

      logger.info('Reranking completed', { resultsCount: sorted.length });
      return sorted;

    } catch (error) {
      logger.error('Reranking failed', error);
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
    logger.debug('applyPersonalizedScoring');

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
    logger.debug('getSearchSuggestions', { query, limit });

    try {
      // Use MongoDB aggregation to find popular related terms
      const pipeline = [
        {
          $match: {
            $or: [
              { name: { $regex: query, $options: 'i' } },
              { trade_name: { $regex: query, $options: 'i' } },
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
      const suggestions = results.map((result: any) => result._id);

      logger.info('Suggestions retrieved', { count: suggestions.length });
      return suggestions;

    } catch (error) {
      logger.error('Failed to get suggestions', error);
      return [];
    }
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    logger.debug('dispose');

    if (this.mongoClient) {
      await this.mongoClient.close();
    }

    logger.info('Enhanced search service disposed');
  }
}
