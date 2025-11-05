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

/**
 * Universal Embedding Service
 * Supports multiple embedding providers (OpenAI, Gemini)
 */
export class UniversalEmbeddingService {
  private config: UniversalEmbeddingConfig;
  private geminiService?: GeminiEmbeddingService;
  private openaiService?: OpenAI;

  constructor(config: UniversalEmbeddingConfig) {
    this.config = config;
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

  async createEmbeddings(texts: string[]): Promise<number[][]> {
    try {
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
    } catch (error) {
      console.error(`Error creating embeddings with ${this.config.provider}:`, error);
      throw error;
    }
  }

  private async createOpenAIEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await this.openaiService!.embeddings.create({
      model: this.config.model,
      input: texts
    });

    return response.data.map(embedding => embedding.embedding);
  }

  async createEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.createEmbeddings([text]);
    return embeddings[0];
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

/**
 * Create embedding service with fallback logic
 */
export function createEmbeddingService(): UniversalEmbeddingService {
  // Try Gemini first (since we know the API key works)
  try {
    const geminiService = new UniversalEmbeddingService({
      provider: 'gemini',
      model: 'gemini-embedding-001',
      dimensions: 768,
      batchSize: 100
    });

    console.log('🤖 Initialized embedding service with Google Gemini');
    return geminiService;
  } catch (error) {
    console.warn('⚠️  Gemini embedding service failed, trying OpenAI...', error);
  }

  // Fallback to OpenAI
  try {
    const openaiService = new UniversalEmbeddingService({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      batchSize: 100
    });

    console.log('🤖 Initialized embedding service with OpenAI');
    return openaiService;
  } catch (error) {
    console.warn('⚠️  OpenAI embedding service failed', error);
  }

  throw new Error('Failed to initialize any embedding service. Please check API keys.');
}