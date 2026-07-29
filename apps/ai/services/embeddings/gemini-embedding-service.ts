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

/**
 * Fit a raw embedding to the configured dimensionality.
 *
 * gemini-embedding-001 returns 3072-dim vectors and the installed
 * @google/generative-ai SDK (0.24.x) cannot request `outputDimensionality`.
 * The model is Matryoshka-trained, so Google's documented downscaling is
 * truncate-then-L2-normalize — which this applies client-side. Without it,
 * 3072-dim vectors violate the 768-dim governed knowledge collections.
 *
 * @param values - Raw embedding values from the API.
 * @param dimensions - Target dimensionality (undefined/0 = keep as-is).
 * @returns Vector of exactly `dimensions` length, L2-normalized when truncated.
 * @throws Error when the API returned fewer values than requested.
 */
export function fit_embedding_dimensions(values: number[], dimensions?: number): number[] {
  if (!dimensions || values.length === dimensions) return values;
  if (values.length < dimensions) {
    throw new Error(`Embedding has ${values.length} dims; ${dimensions} requested`);
  }
  const truncated = values.slice(0, dimensions);
  const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? truncated.map((v) => v / norm) : truncated;
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

      // Extract embedding values, fitted to the configured dimensionality
      return result.embeddings.map(embedding =>
        fit_embedding_dimensions(embedding.values, this.config.dimensions)
      );
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

      return fit_embedding_dimensions(result.embedding.values, this.config.dimensions);
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