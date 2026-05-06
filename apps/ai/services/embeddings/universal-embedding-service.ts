import { GeminiEmbeddingService } from './gemini-embedding-service';
import { OpenAI } from 'openai';

export type EmbeddingProvider = 'openai' | 'gemini';

export interface UniversalEmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  dimensions?: number;
  batchSize?: number;
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// LRU Embedding Cache — avoids redundant API calls for repeated queries
// ---------------------------------------------------------------------------

/** Max entries before oldest are evicted */
const EMBEDDING_CACHE_MAX_SIZE = parseInt(process.env.EMBEDDING_CACHE_MAX_SIZE || '500', 10);

/**
 * Simple LRU cache for embedding vectors.
 * Key = normalised text, Value = embedding vector.
 * Uses Map insertion-order to implement LRU eviction.
 *
 * @param max_size - Maximum entries before oldest are evicted (default 500)
 */
class EmbeddingLRUCache {
  private cache = new Map<string, number[]>();
  private max_size: number;
  private hits = 0;
  private misses = 0;

  constructor(max_size: number = EMBEDDING_CACHE_MAX_SIZE) {
    this.max_size = max_size;
  }

  /**
   * Normalise text for cache key — lowercase + trim whitespace.
   *
   * @param text - Raw input text
   * @returns Normalised cache key string
   */
  private normalise_key(text: string): string {
    return text.trim().toLowerCase();
  }

  /**
   * Retrieve a cached embedding, promoting it to most-recently-used.
   *
   * @param text - The text whose embedding is requested
   * @returns The cached embedding vector, or undefined on miss
   */
  get(text: string): number[] | undefined {
    const key = this.normalise_key(text);
    const value = this.cache.get(key);
    if (value) {
      this.hits++;
      // Promote to most-recently-used by re-inserting
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    this.misses++;
    return undefined;
  }

  /**
   * Store an embedding in the cache, evicting oldest entry if at capacity.
   *
   * @param text      - The source text
   * @param embedding - The embedding vector to cache
   */
  set(text: string, embedding: number[]): void {
    const key = this.normalise_key(text);
    // Delete first so re-insert moves to end (most recent)
    this.cache.delete(key);
    if (this.cache.size >= this.max_size) {
      // Evict oldest (first entry in Map)
      const oldest_key = this.cache.keys().next().value;
      if (oldest_key !== undefined) {
        this.cache.delete(oldest_key);
      }
    }
    this.cache.set(key, embedding);
  }

  /**
   * Return cache performance stats for observability.
   *
   * @returns Object with size, hits, misses, and hit_rate
   */
  get_stats(): { size: number; hits: number; misses: number; hit_rate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hit_rate: total > 0 ? this.hits / total : 0,
    };
  }

  /** Clear all cached entries and reset stats. */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * Universal Embedding Service
 * Supports multiple embedding providers (OpenAI, Gemini)
 */
export class UniversalEmbeddingService {
  private config: UniversalEmbeddingConfig;
  private geminiService?: GeminiEmbeddingService;
  private openaiService?: OpenAI;
  private embedding_cache: EmbeddingLRUCache;

  /**
   * @param config - Provider configuration (gemini or openai)
   */
  constructor(config: UniversalEmbeddingConfig) {
    this.config = config;
    this.embedding_cache = new EmbeddingLRUCache();
    this.initializeProvider();
  }

  private initializeProvider(): void {
    switch (this.config.provider) {
      case 'gemini':
        this.geminiService = new GeminiEmbeddingService(
          this.config.apiKey || process.env.GEMINI_API_KEY!,
          {
            model: this.config.model,
            dimensions: this.config.dimensions,
            batchSize: this.config.batchSize || 100
          }
        );
        break;

      case 'openai':
        this.openaiService = new OpenAI({
          apiKey: this.config.apiKey || process.env.OPENAI_API_KEY!
        });
        break;

      default:
        throw new Error(`Unsupported embedding provider: ${this.config.provider}`);
    }
  }

  /**
   * Generate embeddings for multiple texts, using cache where available.
   * Only uncached texts hit the provider API; results are merged back in order.
   *
   * @param texts - Array of input strings to embed
   * @returns Array of embedding vectors in same order as input
   */
  async createEmbeddings(texts: string[]): Promise<number[][]> {
    console.log(`[UniversalEmbeddingService] createEmbeddings() - start, count=${texts.length}`);

    // Separate cached vs uncached
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const uncached_indices: number[] = [];
    const uncached_texts: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = this.embedding_cache.get(texts[i]);
      if (cached) {
        results[i] = cached;
      } else {
        uncached_indices.push(i);
        uncached_texts.push(texts[i]);
      }
    }

    const cache_stats = this.embedding_cache.get_stats();
    console.log(`[UniversalEmbeddingService] createEmbeddings() - cache: ${texts.length - uncached_texts.length} hits, ${uncached_texts.length} misses (hit_rate=${(cache_stats.hit_rate * 100).toFixed(1)}%)`);

    // Fetch uncached embeddings from provider
    if (uncached_texts.length > 0) {
      try {
        const new_embeddings = await this._fetch_from_provider(uncached_texts);

        // Store in cache and merge into results
        for (let j = 0; j < uncached_indices.length; j++) {
          const idx = uncached_indices[j];
          results[idx] = new_embeddings[j];
          this.embedding_cache.set(texts[idx], new_embeddings[j]);
        }
      } catch (error) {
        console.error(`[UniversalEmbeddingService] createEmbeddings() - error from ${this.config.provider}:`, error);
        throw error;
      }
    }

    console.log(`[UniversalEmbeddingService] createEmbeddings() - done`);
    return results as number[][];
  }

  /**
   * Fetch embeddings directly from the configured provider (no cache).
   *
   * @param texts - Array of texts to embed
   * @returns Raw embedding vectors from provider
   */
  private async _fetch_from_provider(texts: string[]): Promise<number[][]> {
    switch (this.config.provider) {
      case 'gemini':
        if (!this.geminiService) throw new Error('Gemini service not initialized');
        return await this.geminiService.createEmbeddings(texts);

      case 'openai':
        if (!this.openaiService) throw new Error('OpenAI service not initialized');
        return await this.createOpenAIEmbeddings(texts);

      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }

  private async createOpenAIEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await this.openaiService!.embeddings.create({
      model: this.config.model,
      input: texts
    });

    return response.data.map(embedding => embedding.embedding);
  }

  /**
   * Generate a single embedding, leveraging the LRU cache.
   *
   * @param text - Input text to embed
   * @returns Embedding vector
   */
  async createEmbedding(text: string): Promise<number[]> {
    // Fast path: check cache directly for single text
    const cached = this.embedding_cache.get(text);
    if (cached) {
      console.log('[UniversalEmbeddingService] createEmbedding() - cache hit');
      return cached;
    }

    const embeddings = await this.createEmbeddings([text]);
    return embeddings[0];
  }

  /**
   * Get embedding cache performance statistics.
   *
   * @returns Cache stats: size, hits, misses, hit_rate
   */
  get_cache_stats(): { size: number; hits: number; misses: number; hit_rate: number } {
    return this.embedding_cache.get_stats();
  }

  /** Clear the embedding cache. */
  clear_cache(): void {
    this.embedding_cache.clear();
    console.log('[UniversalEmbeddingService] Embedding cache cleared');
  }

  /**
   * Alias for createEmbeddings for consistency
   * Batch generate embeddings (6x faster than calling createEmbedding multiple times)
   */
  async createEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    return await this.createEmbeddings(texts);
  }

  getDimensions(): number {
    switch (this.config.provider) {
      case 'gemini':
        return this.config.dimensions || 768;
      case 'openai':
        if (this.config.model.includes('3-small')) return 1536;
        if (this.config.model.includes('3-large')) return 3072;
        if (this.config.model.includes('ada-002')) return 1536;
        return this.config.dimensions || 1536;
      default:
        return this.config.dimensions || 1536;
    }
  }

  updateConfig(newConfig: Partial<UniversalEmbeddingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.provider || newConfig.apiKey) {
      this.initializeProvider();
    }
  }

  getConfig(): UniversalEmbeddingConfig {
    return { ...this.config };
  }

  async test(): Promise<boolean> {
    try {
      const testText = "This is a test for the universal embedding service.";
      const embedding = await this.createEmbedding(testText);

      console.log(`✅ ${this.config.provider} embedding test successful`);
      console.log(`📏 Embedding dimensions: ${embedding.length}`);
      console.log(`🎯 Sample values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

      return true;
    } catch (error) {
      console.error(`❌ ${this.config.provider} embedding test failed:`, error);
      return false;
    }
  }

  getProvider(): EmbeddingProvider {
    return this.config.provider;
  }
}

// ---------------------------------------------------------------------------
// Singleton Factory — avoids re-instantiation on every call
// ---------------------------------------------------------------------------

/** Module-level singleton instance, created on first call */
let _singleton_embedding_service: UniversalEmbeddingService | null = null;

/**
 * Create or return the singleton embedding service with provider fallback.
 * Tries Gemini first, falls back to OpenAI.
 * Reuses the same instance (and its cache) across all callers.
 *
 * @returns Singleton UniversalEmbeddingService instance
 * @throws Error if no provider can be initialised
 */
export function createEmbeddingService(): UniversalEmbeddingService {
  if (_singleton_embedding_service) {
    return _singleton_embedding_service;
  }

  console.log('[createEmbeddingService] Initialising singleton embedding service...');

  // Try Gemini first (since we know the API key works)
  try {
    _singleton_embedding_service = new UniversalEmbeddingService({
      provider: 'gemini',
      model: 'gemini-embedding-001',
      dimensions: 768,
      batchSize: 100
    });

    console.log('[createEmbeddingService] Initialised with Google Gemini (singleton)');
    return _singleton_embedding_service;
  } catch (error) {
    console.warn('[createEmbeddingService] Gemini failed, trying OpenAI...', error);
  }

  // Fallback to OpenAI
  try {
    _singleton_embedding_service = new UniversalEmbeddingService({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      batchSize: 100
    });

    console.log('[createEmbeddingService] Initialised with OpenAI (singleton)');
    return _singleton_embedding_service;
  } catch (error) {
    console.warn('[createEmbeddingService] OpenAI also failed', error);
  }

  throw new Error('Failed to initialize any embedding service. Please check API keys.');
}

/**
 * Reset the singleton (useful for testing or config changes).
 * Next call to createEmbeddingService() will create a fresh instance.
 */
export function resetEmbeddingServiceSingleton(): void {
  _singleton_embedding_service = null;
  console.log('[createEmbeddingService] Singleton reset');
}