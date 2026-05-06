import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Google Gemini Embedding Service
 * Provides text embedding generation using Google's Gemini embedding model
 */

export interface EmbeddingConfig {
  model: string;
  batchSize: number;
  dimensions?: number;
}

export class GeminiEmbeddingService {
  private genAI: GoogleGenerativeAI;
  private config: EmbeddingConfig;

  constructor(apiKey: string, config?: Partial<EmbeddingConfig>) {
    this.genAI = new GoogleGenerativeAI(apiKey);

    this.config = {
      model: 'gemini-embedding-001',
      batchSize: 100,
      dimensions: 768, // Default for gemini-embedding-001
      ...config
    };
  }

  /**
   * Create embeddings for an array of text strings
   */
  async createEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const results: number[][] = [];

      // Process in batches to avoid rate limits
      for (let i = 0; i < texts.length; i += this.config.batchSize) {
        const batch = texts.slice(i, i + this.config.batchSize);
        const batchEmbeddings = await this.processBatch(batch);
        results.push(...batchEmbeddings);
      }

      console.log(`Successfully generated ${results.length} embeddings using ${this.config.model}`);
      return results;

    } catch (error) {
      console.error('Error creating Gemini embeddings:', error);
      throw new Error(`Failed to create embeddings: ${error}`);
    }
  }

  /**
   * Process a single batch of texts using Gemini's native batch API
   * Much faster than individual embedContent calls!
   */
  private async processBatch(texts: string[]): Promise<number[][]> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.config.model });

      // Use batchEmbedContents for true batch processing (single API call!)
      const result = await model.batchEmbedContents({
        requests: texts.map(text => ({
          content: { role: 'user', parts: [{ text: text.replace(/\n/g, ' ') }] }
        }))
      });

      // Extract embedding values from each result
      return result.embeddings.map(embedding => embedding.values);
    } catch (error) {
      console.error(`Error in batch embedding (${texts.length} texts):`, error);
      throw error;
    }
  }

  /**
   * Create embedding for a single text
   */
  private async createSingleEmbedding(text: string): Promise<number[]> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.config.model });
      const result = await model.embedContent(text);

      return result.embedding.values;
    } catch (error) {
      console.error(`Error embedding text: "${text.substring(0, 50)}..."`, error);
      throw error;
    }
  }

  /**
   * Create embedding for a single text (convenience method)
   */
  async createEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.createEmbeddings([text]);
    return embeddings[0];
  }

  /**
   * Get embedding dimension for the current model
   */
  getDimensions(): number {
    return this.config.dimensions || 768;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<EmbeddingConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): EmbeddingConfig {
    return { ...this.config };
  }

  /**
   * Test the embedding service
   */
  async test(): Promise<boolean> {
    try {
      const testText = "This is a test for embedding generation.";
      const embedding = await this.createEmbedding(testText);

      console.log(`✅ Gemini embedding test successful`);
      console.log(`📏 Embedding dimensions: ${embedding.length}`);
      console.log(`🎯 Sample values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

      return true;
    } catch (error) {
      console.error('❌ Gemini embedding test failed:', error);
      return false;
    }
  }
}

/**
 * Factory function to create and configure Gemini embedding service
 */
export function createGeminiEmbeddingService(apiKey?: string, config?: Partial<EmbeddingConfig>): GeminiEmbeddingService {
  const key = apiKey || process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error('Gemini API key is required. Set GEMINI_API_KEY environment variable or provide it as parameter.');
  }

  return new GeminiEmbeddingService(key, config);
}