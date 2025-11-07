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

export interface SimpleAgentConfig {
  /** Basic Agent Info */
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  /** Agent Capabilities */
  capabilities: string[];
  /** AI Model Configuration */
  aiModel: 'gemini' | 'openai';
  /** Database Connections */
  mongoConnection: string;
  /** Agent-specific Settings */
  settings: Record<string, any>;
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
    this.embeddingService = createEmbeddingService({
      provider: 'gemini',
      model: 'gemini-embedding-001',
      dimensions: 3072,
      batchSize: 96,
      apiKey: process.env.GEMINI_API_KEY || ''
    });
  }

  private initializeAIService(): GeminiService | OpenAIService {
    switch (this.config.aiModel) {
      case 'gemini':
        return new GeminiService({
          apiKey: process.env.GEMINI_API_KEY || '',
          model: 'gemini-2.0-flash-exp'
        });
      case 'openai':
        return new OpenAIService({
          apiKey: process.env.OPENAI_API_KEY || '',
          model: 'gpt-4'
        });
      default:
        throw new Error(`Unsupported AI model: ${this.config.aiModel}`);
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
      await this.aiService.generateResponse("Health check");
      return true;
    } catch (error) {
      console.error(`❌ [${this.config.displayName}] Health check failed:`, error);
      return false;
    }
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
    }
  }
};

// Export BaseAgent as UniversalAgentSystem for backward compatibility
export { BaseAgent as UniversalAgentSystem };