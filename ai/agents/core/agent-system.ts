/**
 * Core Agent System - Plug and Play Architecture
 * Provides reusable logic for all AI agents
 */

import { MongoClient } from "mongodb";
import { Pinecone } from "@pinecone-database/pinecone";
import { UniversalEmbeddingService, createEmbeddingService } from "../../services/embeddings/universal-embedding-service";
import { GeminiService } from "../../services/providers/gemini-service";
import { OpenAIService } from "../../services/providers/openai-service";
import * as fs from 'fs';
import * as path from 'path';

export interface SimpleAgentConfig {
  /** Basic Agent Info */
  id: string;
  name: string;
  displayName: string;
  description: string;

  /** AI Model Settings */
  aiModel: {
    provider: 'gemini' | 'openai';
    model: string;
    temperature: number;
    maxTokens: number;
  };

  /** Agent Prompts - XML Framework */
  prompts: {
    xmlTemplatePath?: string;
    systemPromptPath?: string;
    welcomeMessagePath?: string;
    userInstructionsPath?: string;
    ragInstructionsPath?: string;
  };

  /** Database Names */
  database: {
    name: string;
    collections: {
      conversations: string;
      feedback: string;
      ragData: string;
    };
  };

  /** Vector Database */
  vectorDb: {
    indexName: string;
    dimensions: number;
    metric: 'cosine' | 'euclidean' | 'dotproduct';
  };

  /** Embedding Settings */
  embedding: {
    provider: 'gemini' | 'openai';
    model: string;
    dimensions: number;
  };

  /** RAG Settings */
  rag: {
    enabled: boolean;
    topK: number;
    similarityThreshold: number;
    includeMetadata: boolean;
    filters?: Record<string, any>;
  };
}

/**
 * Universal Agent System - Plug and Play
 */
export class UniversalAgentSystem {
  private config: SimpleAgentConfig;
  private mongoClient: MongoClient | null = null;
  private pinecone: Pinecone;
  private embeddingService: UniversalEmbeddingService;
  private aiService: GeminiService | OpenAIService | null = null;
  private promptCache: Map<string, string> = new Map();

  constructor(config: SimpleAgentConfig) {
    this.config = config;
    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY || ''
    });
    this.embeddingService = createEmbeddingService();

    console.log(`🔧 Initialized Agent: ${config.displayName} (${config.id})`);
  }

  /**
   * Load prompt content from file with caching
   */
  private async loadPrompt(filePath: string): Promise<string> {
    // Check cache first
    if (this.promptCache.has(filePath)) {
      return this.promptCache.get(filePath)!;
    }

    try {
      const absolutePath = path.resolve(filePath);
      const content = fs.readFileSync(absolutePath, 'utf-8');
      const promptContent = content.replace(/^#[^\n]*\n/gm, '').trim();

      // Cache the loaded content
      this.promptCache.set(filePath, promptContent);
      return promptContent;
    } catch (error) {
      console.error(`Failed to load prompt from ${filePath}:`, error);
      return `Error loading prompt file: ${filePath}`;
    }
  }

  /**
   * Get all prompts loaded from files
   */
  async getPrompts() {
    const [systemPrompt, welcomeMessage, userInstructions, ragInstructions] = await Promise.all([
      this.loadPrompt(this.config.prompts.systemPromptPath),
      this.loadPrompt(this.config.prompts.welcomeMessagePath),
      this.loadPrompt(this.config.prompts.userInstructionsPath),
      this.loadPrompt(this.config.prompts.ragInstructionsPath)
    ]);

    return {
      systemPrompt,
      welcomeMessage,
      userInstructions,
      ragInstructions
    };
  }

  /**
   * Get MongoDB database for this agent
   */
  async getDatabase() {
    if (!this.mongoClient) {
      const uri = process.env.MONGODB_URI;
      if (!uri) {
        throw new Error('MongoDB URI not set');
      }
      this.mongoClient = new MongoClient(uri);
      await this.mongoClient.connect();
    }

    return this.mongoClient.db(this.config.database.name);
  }

  /**
   * Get collections for this agent
   */
  async getCollections() {
    const db = await this.getDatabase();
    return {
      conversations: db.collection(this.config.database.collections.conversations),
      feedback: db.collection(this.config.database.collections.feedback),
      ragData: db.collection(this.config.database.collections.ragData)
    };
  }

  /**
   * Get AI service for this agent
   */
  getAIService() {
    if (!this.aiService) {
      const apiKey = this.config.aiModel.provider === 'gemini'
        ? process.env.NEXT_PUBLIC_GEMINI_API_KEY
        : process.env.OPENAI_API_KEY;

      if (!apiKey) {
        throw new Error(`API key not found for ${this.config.aiModel.provider}`);
      }

      const serviceConfig = {
        model: this.config.aiModel.model,
        temperature: this.config.aiModel.temperature,
        maxTokens: this.config.aiModel.maxTokens
      };

      if (this.config.aiModel.provider === 'gemini') {
        this.aiService = new GeminiService(apiKey, serviceConfig);
      } else {
        // Assuming OpenAI service exists
        this.aiService = new GeminiService(apiKey, serviceConfig); // Fallback to Gemini for now
      }
    }

    return this.aiService;
  }

  /**
   * Get Pinecone index for this agent
   */
  getVectorIndex() {
    return this.pinecone.Index(this.config.vectorDb.indexName);
  }

  /**
   * Get embedding service for this agent
   */
  getEmbeddingService() {
    const agentEmbeddingService = new UniversalEmbeddingService({
      provider: this.config.embedding.provider as any,
      model: this.config.embedding.model,
      dimensions: this.config.embedding.dimensions,
      batchSize: 100,
      apiKey: this.config.embedding.provider === 'gemini'
        ? process.env.GEMINI_API_KEY
        : process.env.OPENAI_API_KEY
    });

    return agentEmbeddingService;
  }

  /**
   * Enhanced system prompt with agent context
   */
  async getEnhancedSystemPrompt() {
    const prompts = await this.getPrompts();
    return `${prompts.systemPrompt}

AGENT INFORMATION:
- ID: ${this.config.id}
- Name: ${this.config.displayName}
- Purpose: ${this.config.description}

RESPONSE GUIDELINES:
${prompts.ragInstructions}

USER INSTRUCTIONS:
${prompts.userInstructions}`;
  }

  /**
   * RAG Search - Plug and Play
   */
  async searchVectorDatabase(query: string, options?: { topK?: number; threshold?: number }) {
    if (!this.config.rag.enabled) {
      return [];
    }

    try {
      const index = this.getVectorIndex();
      const embeddingService = this.getEmbeddingService();

      const queryEmbedding = await embeddingService.createEmbeddings([query]);

      const response = await index.query({
        vector: queryEmbedding[0],
        topK: options?.topK || this.config.rag.topK,
        includeMetadata: this.config.rag.includeMetadata,
        filter: {
          agentId: this.config.id,
          ...this.config.rag.filters
        }
      });

      const matches = response.matches || [];
      const threshold = options?.threshold || this.config.rag.similarityThreshold;

      return matches.filter(match => (match.score || 0) >= threshold);
    } catch (error) {
      console.error(`RAG search failed for agent ${this.config.id}:`, error);
      return [];
    }
  }

  /**
   * Hybrid Search - Vector + MongoDB fallback
   */
  async hybridSearch(query: string, options?: { topK?: number; threshold?: number }) {
    // Vector search
    const vectorResults = await this.searchVectorDatabase(query, options);

    // Fallback to MongoDB keyword search if no vector results
    let keywordResults = [];
    if (vectorResults.length === 0) {
      try {
        const collections = await this.getCollections();
        keywordResults = await collections.ragData.find({
          $text: { $search: query }
        }).limit(options?.topK || 5).toArray();

        keywordResults = keywordResults.map(doc => ({
          id: doc._id?.toString(),
          score: 0.5,
          metadata: { ...doc, agentId: this.config.id, searchType: 'keyword' }
        }));
      } catch (error) {
        console.error(`Keyword search failed for agent ${this.config.id}:`, error);
      }
    }

    return {
      vectorResults,
      keywordResults,
      allResults: [...vectorResults, ...keywordResults]
    };
  }

  /**
   * Format search results with agent-specific context
   */
  async formatSearchResults(results: any[], originalQuery: string) {
    if (!results || results.length === 0) {
      return `\n\nNo relevant information found in the ${this.config.displayName} knowledge base.`;
    }

    const prompts = await this.getPrompts();
    const formattedResults = results.map((match, index) => {
      const metadata = match.metadata || {};
      let result = `${index + 1}. **${metadata.title || metadata.trade_name || 'Information Entry'}**\n`;

      // Agent-specific formatting based on metadata
      if (metadata.rm_code) result += `   **Material Code:** ${metadata.rm_code}\n`;
      if (metadata.trade_name) result += `   **Trade Name:** ${metadata.trade_name}\n`;
      if (metadata.inci_name) result += `   **INCI Name:** ${metadata.inci_name}\n`;
      if (metadata.supplier) result += `   **Supplier:** ${metadata.supplier}\n`;
      if (metadata.company_name) result += `   **Company:** ${metadata.company_name}\n`;
      if (metadata.rm_cost) result += `   **Cost:** ${metadata.rm_cost}\n`;
      if (metadata.benefits) result += `   **Benefits:** ${metadata.benefits}\n`;
      if (metadata.content) result += `   **Content:** ${metadata.content}\n`;
      if (metadata.category) result += `   **Category:** ${metadata.category}\n`;
      if (metadata.source) result += `   **Source:** ${metadata.source}\n`;

      result += `   **Relevance Score:** ${(match.score || 0).toFixed(3)}\n`;
      return result;
    });

    return `\n\n**${this.config.displayName} Knowledge Base Results:**\n${formattedResults.join('\n\n')}\n\n${prompts.ragInstructions}`;
  }

  /**
   * Complete RAG workflow
   */
  async performRAGSearch(query: string, options?: { topK?: number; threshold?: number }) {
    if (!this.config.rag.enabled) {
      return '';
    }

    const results = await this.searchVectorDatabase(query, options);
    return await this.formatSearchResults(results, query);
  }

  /**
   * Get agent configuration
   */
  getConfig() {
    return this.config;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.mongoClient) {
      await this.mongoClient.close();
    }
  }
}