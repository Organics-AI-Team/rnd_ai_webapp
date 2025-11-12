/**
 * Core Agent System - Plug and Play Architecture
 * Provides reusable logic for all AI agents
 *
 * TEMPORARY VERSION - Stubs for Pinecone dependencies
 * TODO: Implement full agent system without Pinecone
 */

import { UniversalEmbeddingService, createEmbeddingService } from "../../services/embeddings/universal-embedding-service";
import { GeminiService } from "../../services/providers/gemini-service";
import { OpenAIService } from "../../services/providers/openai-service";
import { AIRequest as SharedAIRequest } from "../../types/ai-types";

// Re-export the shared AIRequest for backward compatibility
export type AIRequest = SharedAIRequest;

export interface AIModelConfig {
  provider: 'gemini' | 'openai';
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface PromptsConfig {
  systemPromptPath?: string;
  welcomeMessage?: string;
  welcomeMessagePath?: string;
  userInstructionsPath?: string;
  ragInstructionsPath?: string;
}

export interface DatabaseConfig {
  name: string;
  collections: {
    conversations: string;
    feedback: string;
    ragData: string;
  };
}

export interface VectorDbConfig {
  indexName: string;
  dimensions: number;
  metric: string;
}

export interface EmbeddingConfig {
  provider: string;
  model: string;
  dimensions: number;
}

export interface RAGConfig {
  enabled: boolean;
  topK: number;
  similarityThreshold: number;
  includeMetadata: boolean;
  filters?: Record<string, any>;
}

export interface SimpleAgentConfig {
  /** Basic Agent Info */
  id: string;
  name: string;
  displayName: string;
  description: string;
  version?: string;
  /** Agent Capabilities */
  capabilities?: string[];
  /** AI Model Configuration */
  aiModel: 'gemini' | 'openai' | AIModelConfig;
  /** Prompts Configuration */
  prompts?: PromptsConfig;
  /** Database Configuration */
  database?: DatabaseConfig;
  /** Vector Database Configuration */
  vectorDb?: VectorDbConfig;
  /** Embedding Configuration */
  embedding?: EmbeddingConfig;
  /** RAG Configuration */
  rag?: RAGConfig;
  /** Database Connections (backward compatibility) */
  mongoConnection?: string;
  /** Agent-specific Settings */
  settings?: Record<string, any>;
}

export interface AgentResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    agentId: string;
    responseTime: number;
    timestamp: string;
  };
}

/**
 * Base Agent Class with Common Functionality
 */
export class BaseAgent {
  protected config: SimpleAgentConfig;
  protected aiService: GeminiService | OpenAIService;
  protected embeddingService: UniversalEmbeddingService;

  constructor(config: SimpleAgentConfig) {
    this.config = config;
    this.aiService = this.initializeAIService();
    // createEmbeddingService expects no arguments, uses defaults
    this.embeddingService = createEmbeddingService();
  }

  private initializeAIService(): GeminiService | OpenAIService {
    const aiModelConfig = this.config.aiModel;

    if (typeof aiModelConfig === 'string') {
      // Simple string config
      switch (aiModelConfig) {
        case 'gemini':
          return new GeminiService(process.env.GEMINI_API_KEY || '');
        case 'openai':
          return new OpenAIService(process.env.OPENAI_API_KEY || '');
        default:
          throw new Error(`Unsupported AI model: ${aiModelConfig}`);
      }
    } else {
      // Full config object
      switch (aiModelConfig.provider) {
        case 'gemini':
          return new GeminiService(process.env.GEMINI_API_KEY || '');
        case 'openai':
          return new OpenAIService(process.env.OPENAI_API_KEY || '');
        default:
          throw new Error(`Unsupported AI model provider: ${aiModelConfig.provider}`);
      }
    }
  }

  /**
   * Execute agent logic
   */
  async execute(input: string, options?: any): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      console.log(`🤖 [${this.config.displayName}] Processing request...`);

      // Basic implementation - extend in subclasses
      const result = await this.processRequest(input, options);

      return {
        success: true,
        data: result,
        metadata: {
          agentId: this.config.id,
          responseTime: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error(`❌ [${this.config.displayName}] Error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          agentId: this.config.id,
          responseTime: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  /**
   * Process request - override in subclasses
   */
  protected async processRequest(input: string, options?: any): Promise<any> {
    // Basic implementation
    return {
      message: `Processed by ${this.config.displayName}`,
      input: input,
      agent: this.config.name
    };
  }

  /**
   * Get agent information
   */
  getInfo(): SimpleAgentConfig {
    return { ...this.config };
  }

  /**
   * Check if agent is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Basic health check - test AI service
      await this.aiService.generateResponse({ prompt: "Health check", userId: "system" } as AIRequest);
      return true;
    } catch (error) {
      console.error(`❌ [${this.config.displayName}] Health check failed:`, error);
      return false;
    }
  }

  /**
   * Get agent configuration
   */
  getConfig(): SimpleAgentConfig {
    return { ...this.config };
  }

  /**
   * Get AI service instance
   */
  getAIService(): GeminiService | OpenAIService {
    return this.aiService;
  }

  /**
   * Get database collections
   */
  async getCollections(): Promise<any> {
    // Stub implementation - override in subclasses
    return {
      conversations: null,
      feedback: null,
      ragData: null
    };
  }

  /**
   * Perform RAG search
   */
  async performRAGSearch(query: string): Promise<string> {
    // Stub implementation - override in subclasses
    console.log(`⚠️ [${this.config.displayName}] RAG search not implemented`);
    return '';
  }

  /**
   * Get enhanced system prompt
   */
  getEnhancedSystemPrompt(): string {
    // Stub implementation - override in subclasses
    return `You are ${this.config.displayName}, ${this.config.description}`;
  }

  /**
   * Search vector database
   */
  async searchVectorDatabase(query: string, topK?: number): Promise<any[]> {
    // Stub implementation - override in subclasses
    console.log(`⚠️ [${this.config.displayName}] Vector search not implemented`);
    return [];
  }

  /**
   * Hybrid search (vector + keyword)
   */
  async hybridSearch(query: string, options?: any): Promise<any[]> {
    // Stub implementation - override in subclasses
    console.log(`⚠️ [${this.config.displayName}] Hybrid search not implemented`);
    return [];
  }

  /**
   * Format search results
   */
  formatSearchResults(results: any[]): string {
    // Stub implementation - override in subclasses
    return results.map((r, i) => `${i + 1}. ${JSON.stringify(r)}`).join('\n');
  }

  /**
   * Get vector index (for stats)
   */
  getVectorIndex(): any {
    // Stub implementation - override in subclasses
    return {
      describeIndexStats: async () => ({
        totalRecordCount: 0,
        namespaces: {}
      })
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Stub implementation - override in subclasses
    console.log(`🧹 [${this.config.displayName}] Cleanup called`);
  }
}

/**
 * Agent Registry for managing multiple agents
 */
export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();

  register(agent: BaseAgent): void {
    this.agents.set(agent.getInfo().id, agent);
    console.log(`✅ Registered agent: ${agent.getInfo().displayName}`);
  }

  get(id: string): BaseAgent | undefined {
    return this.agents.get(id);
  }

  getAll(): Map<string, BaseAgent> {
    return new Map(this.agents);
  }

  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const [id, agent] of this.agents) {
      try {
        results[id] = await agent.healthCheck();
      } catch (error) {
        results[id] = false;
      }
    }

    return results;
  }
}

// Global agent registry
export const agentRegistry = new AgentRegistry();

/**
 * Helper function to create and register agents
 */
export function createAgent(config: SimpleAgentConfig): BaseAgent {
  const agent = new BaseAgent(config);
  agentRegistry.register(agent);
  return agent;
}

/**
 * Default agent configurations
 */
export const DEFAULT_AGENT_CONFIGS: Record<string, SimpleAgentConfig> = {
  'raw-materials-ai': {
    id: 'raw-materials-ai',
    name: 'raw-materials-ai',
    displayName: 'Raw Materials AI',
    description: 'AI assistant for raw materials database',
    version: '1.0.0',
    capabilities: ['search', 'recommendation', 'analysis'],
    aiModel: 'gemini',
    mongoConnection: process.env.MONGODB_URI || '',
    settings: {
      maxResults: 5,
      similarityThreshold: 0.7
    },
    prompts: {
      welcomeMessage: 'Welcome to Raw Materials AI'
    },
    database: {
      name: 'raw_materials_db',
      collections: {
        conversations: 'conversations',
        feedback: 'feedback',
        ragData: 'knowledge_base'
      }
    },
    vectorDb: {
      indexName: 'raw-materials-vectors',
      dimensions: 768,
      metric: 'cosine'
    },
    embedding: {
      provider: 'gemini',
      model: 'gemini-embedding-001',
      dimensions: 768
    },
    rag: {
      enabled: true,
      topK: 5,
      similarityThreshold: 0.7,
      includeMetadata: true
    }
  },
  'sales-rnd-ai': {
    id: 'sales-rnd-ai',
    name: 'sales-rnd-ai',
    displayName: 'Sales & R&D AI',
    description: 'AI assistant for sales strategy and R&D collaboration',
    version: '1.0.0',
    capabilities: ['analysis', 'recommendation', 'planning'],
    aiModel: 'gemini',
    mongoConnection: process.env.MONGODB_URI || '',
    settings: {
      maxResults: 8,
      similarityThreshold: 0.65
    },
    prompts: {
      welcomeMessage: 'Welcome to Sales & R&D AI'
    },
    database: {
      name: 'sales_rnd_db',
      collections: {
        conversations: 'conversations',
        feedback: 'feedback',
        ragData: 'knowledge_base'
      }
    },
    vectorDb: {
      indexName: 'sales-rnd-vectors',
      dimensions: 768,
      metric: 'cosine'
    },
    embedding: {
      provider: 'gemini',
      model: 'gemini-embedding-001',
      dimensions: 768
    },
    rag: {
      enabled: true,
      topK: 8,
      similarityThreshold: 0.65,
      includeMetadata: true
    }
  }
};

// Export BaseAgent as UniversalAgentSystem for backward compatibility
export { BaseAgent as UniversalAgentSystem };