/**
 * Agent Factory - Scalable Plug and Play System
 * Create agents instantly from simple configurations
 */

import { UniversalAgentSystem } from './agent-system';
import { SimpleAgentConfig } from './agent-system';

export class AgentFactory {
  private static agents = new Map<string, UniversalAgentSystem>();

  /**
   * Create or get an agent instance
   */
  static getAgent(config: SimpleAgentConfig): UniversalAgentSystem {
    const agentId = config.id;

    if (!this.agents.has(agentId)) {
      const agent = new UniversalAgentSystem(config);
      this.agents.set(agentId, agent);
    }

    return this.agents.get(agentId)!;
  }

  /**
   * Get all active agents
   */
  static getAllAgents(): UniversalAgentSystem[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by ID
   */
  static getAgentById(agentId: string): UniversalAgentSystem | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Cleanup all agents
   */
  static async cleanupAll(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.cleanup();
    }
    this.agents.clear();
  }

  /**
   * Get agent configuration
   */
  static getAgentConfig(agentId: string): SimpleAgentConfig | undefined {
    const agent = this.agents.get(agentId);
    return agent?.getConfig();
  }

  /**
   * Validate agent configuration
   */
  static validateConfig(config: SimpleAgentConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.id) errors.push('Agent ID is required');
    if (!config.name) errors.push('Agent name is required');
    if (!config.displayName) errors.push('Agent display name is required');

    if (!config.aiModel) errors.push('AI model configuration is required');
    if (!config.prompts) errors.push('Prompts configuration is required');
    if (!config.database) errors.push('Database configuration is required');
    if (!config.vectorDb) errors.push('Vector database configuration is required');
    if (!config.embedding) errors.push('Embedding configuration is required');
    if (!config.rag) errors.push('RAG configuration is required');

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Quick agent creation with default values
   */
  static createQuickAgent(config: Partial<SimpleAgentConfig> & { id: string; displayName: string }): SimpleAgentConfig {
    const defaults: SimpleAgentConfig = {
      id: config.id,
      name: config.id,
      displayName: config.displayName,
      description: config.description || `${config.displayName} AI Assistant`,

      aiModel: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        maxTokens: 9000,
        ...config.aiModel
      },

      prompts: {
        systemPromptPath: undefined,
        welcomeMessagePath: undefined,
        userInstructionsPath: undefined,
        ragInstructionsPath: undefined,
        ...config.prompts
      },

      database: {
        name: `${config.id}_db`,
        collections: {
          conversations: 'conversations',
          feedback: 'feedback',
          ragData: 'knowledge_base'
        },
        ...config.database
      },

      vectorDb: {
        indexName: `${config.id}-vectors`,
        dimensions: 768,
        metric: 'cosine',
        ...config.vectorDb
      },

      embedding: {
        provider: 'gemini',
        model: 'gemini-embedding-001',
        dimensions: 768,
        ...config.embedding
      },

      rag: {
        enabled: true,
        topK: 5,
        similarityThreshold: 0.7,
        includeMetadata: true,
        filters: {},
        ...config.rag
      }
    };

    return defaults;
  }
}