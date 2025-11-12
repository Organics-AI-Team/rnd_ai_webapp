/**
 * Embedding Service with Pinecone Integration
 * Processes raw materials and formulas for RAG using Gemini embeddings
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { RawMaterial, Formula } from '@/lib/types';

interface EmbeddingConfig {
  pineconeApiKey: string;
  pineconeIndex: string;
  geminiApiKey: string;
}

interface ChemicalSearchResult {
  id: string;
  type: 'raw_material' | 'formula';
  data: RawMaterial | Formula;
  score: number;
  metadata: Record<string, any>;
}

export class EmbeddingService {
  private pinecone: Pinecone;
  private genAI: GoogleGenerativeAI;
  private index: any;
  private config: EmbeddingConfig;

  constructor(config: EmbeddingConfig) {
    this.config = config;
    this.pinecone = new Pinecone({
      apiKey: config.pineconeApiKey
    });
    this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
    this.index = this.pinecone.index(config.pineconeIndex);
  }

  /**
   * Helper function to retry operations with exponential backoff
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3,
    baseDelay: number = 2000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        const isNetworkError = error instanceof Error &&
          (error.message.includes('fetch failed') ||
           error.message.includes('timeout') ||
           error.message.includes('ECONNRESET') ||
           error.message.includes('ENOTFOUND'));

        console.warn(`${operationName} - Attempt ${attempt}/${maxRetries} failed:`, error instanceof Error ? error.message : 'Unknown error');

        if (attempt === maxRetries) {
          break; // No more retries
        }

        if (isNetworkError) {
          // Exponential backoff for network errors
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`Retrying ${operationName} in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Don't retry non-network errors
          break;
        }
      }
    }

    throw lastError!;
  }

  /**
   * Generate embeddings for text using Gemini
   */
  async generateEmbedding(text: string): Promise<number[]> {
    return this.retryOperation(
      async () => {
        const model = this.genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

        const result = await model.embedContent(text.replace(/\n/g, ' '));
        const embedding = result.embedding;

        return embedding.values;
      },
      'Gemini embedding generation',
      3, // max retries
      2000 // base delay
    );
  }

  /**
   * Generate embeddings for multiple texts in batch using Gemini
   * Much faster than calling generateEmbedding() multiple times
   * @param texts Array of text strings to embed (max 100 per batch)
   * @returns Array of embedding vectors in same order as input texts
   */
  async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length > 100) {
      throw new Error('Batch size cannot exceed 100 texts');
    }

    return this.retryOperation(
      async () => {
        const model = this.genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

        // Clean texts (replace newlines)
        const cleanTexts = texts.map(text => text.replace(/\n/g, ' '));

        // Use batchEmbedContents for batch processing
        const result = await model.batchEmbedContents({
          requests: cleanTexts.map(text => ({ content: { role: 'user', parts: [{ text }] } }))
        });

        // Extract embedding values from each result
        return result.embeddings.map(embedding => embedding.values);
      },
      'Gemini batch embedding generation',
      3, // max retries
      2000 // base delay
    );
  }

  /**
   * Process raw material data for embedding
   */
  private prepareRawMaterialText(material: RawMaterial): string {
    const texts = [
      `รหัสสาร: ${material.rm_code}`,
      `ชื่อการค้า: ${material.trade_name}`,
      material.inci_name ? `ชื่อ INCI: ${material.inci_name}` : '',
      material.supplier ? `ผู้ผลิต: ${material.supplier}` : '',
      material.company_name ? `บริษัท: ${material.company_name}` : '',
      material.benefits ? `คุณสมบัติ: ${material.benefits}` : '',
      material.details ? `รายละเอียด: ${material.details}` : '',
      material.usecase ? `การใช้งาน: ${material.usecase}` : '',
      material.rm_cost ? `ราคา: ${material.rm_cost} บาท` : ''
    ].filter(Boolean);

    return texts.join('. ');
  }

  /**
   * Process formula data for embedding
   */
  private prepareFormulaText(formula: Formula): string {
    const ingredientTexts = formula.ingredients.map(ing =>
      `${ing.productName} (${ing.rm_code}) ${ing.amount}${ing.percentage ? ` (${ing.percentage}%)` : ''}`
    );

    const texts = [
      `รหัสสูตร: ${formula.formulaCode}`,
      `ชื่อสูตร: ${formula.formulaName}`,
      `เวอร์ชัน: ${formula.version}`,
      formula.client ? `ลูกค้า: ${formula.client}` : '',
      formula.targetBenefits ? `คุณสมบัติที่ต้องการ: ${formula.targetBenefits.join(', ')}` : '',
      `ส่วนผสมหลัก: ${ingredientTexts.slice(0, 5).join(', ')}`,
      formula.remarks ? `หมายเหตุ: ${formula.remarks}` : '',
      `สถานะ: ${formula.status}`
    ].filter(Boolean);

    return texts.join('. ');
  }

  /**
   * Index raw materials into Pinecone
   */
  async indexRawMaterials(materials: RawMaterial[]): Promise<void> {
    console.log(`Starting to index ${materials.length} raw materials...`);

    for (let i = 0; i < materials.length; i += 100) {
      const batch = materials.slice(i, i + 100);
      const vectors: any[] = [];

      for (const material of batch) {
        try {
          const text = this.prepareRawMaterialText(material);
          const embedding = await this.generateEmbedding(text);

          vectors.push({
            id: `raw_material_${material._id || material.id}`,
            values: embedding,
            metadata: {
              type: 'raw_material',
              rm_code: material.rm_code,
              trade_name: material.trade_name,
              inci_name: material.inci_name,
              supplier: material.supplier,
              benefits: material.benefits,
              details: material.details,
              usecase: material.usecase,
              company_name: material.company_name,
              text: text
            }
          });
        } catch (error) {
          console.warn(`⚠️ Skipping material ${material._id || material.id} due to embedding error:`, error instanceof Error ? error.message : 'Unknown error');
          // Continue with next material instead of failing the entire batch
        }
      }

      if (vectors.length === 0) {
        console.warn(`⚠️ No vectors generated for batch ${Math.floor(i/100) + 1}. Skipping batch.`);
        continue;
      }

      try {
        await this.retryOperation(
          () => this.index.upsert(vectors),
          `Indexing batch ${Math.floor(i/100) + 1}/${Math.ceil(materials.length/100)}`,
          3, // max retries
          3000 // base delay
        );
        console.log(`✅ Indexed batch ${Math.floor(i/100) + 1}/${Math.ceil(materials.length/100)}`);
      } catch (error) {
        console.error(`❌ Failed to index batch ${Math.floor(i/100) + 1}/${Math.ceil(materials.length/100)}:`, error);
        // Continue with next batch even if current batch fails
        console.log('⏭️  Skipping to next batch...');
      }

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('Finished indexing raw materials');
  }

  /**
   * Index formulas into Pinecone
   */
  async indexFormulas(formulas: Formula[]): Promise<void> {
    console.log(`Starting to index ${formulas.length} formulas...`);

    for (let i = 0; i < formulas.length; i += 100) {
      const batch = formulas.slice(i, i + 100);
      const vectors: any[] = [];

      for (const formula of batch) {
        try {
          const text = this.prepareFormulaText(formula);
          const embedding = await this.generateEmbedding(text);

          vectors.push({
            id: `formula_${formula._id}`,
            values: embedding,
            metadata: {
              type: 'formula',
              formulaCode: formula.formulaCode,
              formulaName: formula.formulaName,
              version: formula.version,
              client: formula.client,
              targetBenefits: formula.targetBenefits,
              status: formula.status,
              ingredientsCount: formula.ingredients.length,
              text: text
            }
          });
        } catch (error) {
          console.warn(`⚠️ Skipping formula ${formula._id} due to embedding error:`, error instanceof Error ? error.message : 'Unknown error');
          // Continue with next formula instead of failing entire batch
        }
      }

      if (vectors.length === 0) {
        console.warn(`⚠️ No vectors generated for formula batch ${Math.floor(i/100) + 1}. Skipping batch.`);
        continue;
      }

      try {
        await this.retryOperation(
          () => this.index.upsert(vectors),
          `Indexing formula batch ${Math.floor(i/100) + 1}/${Math.ceil(formulas.length/100)}`,
          3, // max retries
          3000 // base delay
        );
        console.log(`✅ Indexed formula batch ${Math.floor(i/100) + 1}/${Math.ceil(formulas.length/100)}`);
      } catch (error) {
        console.error(`❌ Failed to index formula batch ${Math.floor(i/100) + 1}/${Math.ceil(formulas.length/100)}:`, error);
        // Continue with next batch even if current batch fails
        console.log('⏭️  Skipping to next batch...');
      }

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('Finished indexing formulas');
  }

  /**
   * Search for similar chemical compounds and formulas
   */
  async searchChemicals(query: string, topK: number = 5): Promise<ChemicalSearchResult[]> {
    try {
      const queryEmbedding = await this.generateEmbedding(query);

      const response = await this.retryOperation(
        () => this.index.query({
          vector: queryEmbedding,
          topK: topK,
          includeMetadata: true
        }),
        'Pinecone vector search',
        2, // fewer retries for search
        1000 // shorter delay
      );

      const results: ChemicalSearchResult[] = (response as any).matches.map((match: any) => ({
        id: match.id,
        type: match.metadata.type as 'raw_material' | 'formula',
        score: match.score,
        data: {} as RawMaterial | Formula, // We'll populate this from database if needed
        metadata: match.metadata
      }));

      return results;
    } catch (error) {
      console.error('Error searching chemicals:', error);
      throw new Error('Failed to search chemicals');
    }
  }

  /**
   * Get context for AI response based on query
   */
  async getRAGContext(query: string, agentType: string): Promise<string> {
    try {
      let searchQuery = query;

      // Modify search query based on agent type for better results
      if (agentType === 'chemical_compound') {
        searchQuery = `สารเคมี ส่วนผสม ${query} คุณสมบัติ ประโยชน์`;
      } else if (agentType === 'formula_consultant') {
        searchQuery = `สูตรผลิตภัณฑ์ ${query} ส่วนผสม การผลิต`;
      } else if (agentType === 'safety_advisor') {
        searchQuery = `ความปลอดภัย ${query} ข้อควรระวัง กฎระเบียบ`;
      }

      const results = await this.searchChemicals(searchQuery, 5);

      if (results.length === 0) {
        return '';
      }

      const contextTexts = results.map((result, index) => {
        const metadata = result.metadata;
        let contextText = '';

        if (result.type === 'raw_material') {
          contextText = `[${index + 1}] สารเคมี: ${metadata.trade_name} (${metadata.rm_code})\n`;
          if (metadata.inci_name) contextText += `ชื่อ INCI: ${metadata.inci_name}\n`;
          if (metadata.supplier) contextText += `ผู้ผลิต: ${metadata.supplier}\n`;
          if (metadata.benefits) contextText += `คุณสมบัติ: ${metadata.benefits}\n`;
          if (metadata.details) contextText += `รายละเอียด: ${metadata.details}\n`;
          if (metadata.usecase) contextText += `การใช้งาน: ${metadata.usecase}\n`;
        } else if (result.type === 'formula') {
          contextText = `[${index + 1}] สูตร: ${metadata.formulaName} (${metadata.formulaCode})\n`;
          if (metadata.targetBenefits) contextText += `คุณสมบัติ: ${metadata.targetBenefits.join(', ')}\n`;
          if (metadata.ingredientsCount) contextText += `จำนวนส่วนผสม: ${metadata.ingredientsCount} ชนิด\n`;
          if (metadata.status) contextText += `สถานะ: ${metadata.status}\n`;
        }

        contextText += `ความเกี่ยวข้อง: ${(result.score * 100).toFixed(1)}%\n`;
        return contextText;
      });

      return `ข้อมูลที่เกี่ยวข้องจากฐานข้อมูล:\n\n${contextTexts.join('\n')}`;
    } catch (error) {
      console.error('Error getting RAG context:', error);
      return '';
    }
  }

  /**
   * Delete vectors from Pinecone
   */
  async deleteVectors(ids: string[]): Promise<void> {
    try {
      await this.index.deleteOne(ids);
    } catch (error) {
      console.error('Error deleting vectors:', error);
      throw new Error('Failed to delete vectors');
    }
  }

  /**
   * Get Pinecone index statistics
   */
  async getIndexStats(): Promise<any> {
    try {
      const stats = await this.index.describeIndexStats();
      return stats;
    } catch (error) {
      console.error('Error getting index stats:', error);
      throw new Error('Failed to get index stats');
    }
  }
}

// Singleton instance for the application
let embeddingService: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    const config: EmbeddingConfig = {
      pineconeApiKey: process.env.PINECONE_API_KEY || '',
      pineconeIndex: 'raw-materials-stock',
      geminiApiKey: process.env.GEMINI_API_KEY || ''
    };

    if (!config.pineconeApiKey || !config.geminiApiKey) {
      throw new Error('Missing required API keys for embedding service');
    }

    embeddingService = new EmbeddingService(config);
  }

  return embeddingService;
}