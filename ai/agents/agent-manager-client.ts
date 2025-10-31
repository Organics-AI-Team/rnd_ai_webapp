/**
 * Client-side Agent Manager
 * Handles agent execution and RAG without importing server-side dependencies
 */

import { AgentConfig, getAgentConfig } from './configs/agent-configs';
import { AIRequest, AIResponse } from '../types/ai-types';

export interface AgentExecutionContext {
  agentId: string;
  userId: string;
  request: string;
  context?: any;
  options?: {
    forceRAG?: boolean;
    ragOptions?: any;
    temperature?: number;
    maxTokens?: number;
  };
}

export interface AgentExecutionResult {
  response: AIResponse;
  agentConfig: AgentConfig;
  ragResults?: any;
  executionTime: number;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Client-side Agent Manager
 * Handles agent execution via API calls to avoid server-side imports
 */
export class ClientAgentManager {
  private apiBase: string;

  constructor(apiBase: string = '/api/agents') {
    this.apiBase = apiBase;
  }

  /**
   * Execute an AI agent via API
   */
  async executeAgent(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.apiBase}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(context),
      });

      if (!response.ok) {
        throw new Error(`Agent execution failed: ${response.statusText}`);
      }

      const result = await response.json();
      const executionTime = Date.now() - startTime;

      return {
        ...result,
        executionTime,
      };
    } catch (error) {
      console.error('Error executing agent:', error);
      throw new Error(`Failed to execute agent: ${error}`);
    }
  }

  /**
   * Get available agents
   */
  async getAvailableAgents(): Promise<AgentConfig[]> {
    try {
      const response = await fetch(`${this.apiBase}/list`);
      if (!response.ok) {
        throw new Error('Failed to fetch agents');
      }
      const data = await response.json();
      return data.agents || [];
    } catch (error) {
      console.error('Error fetching agents:', error);
      return [];
    }
  }

  /**
   * Get agent configuration by ID
   */
  getAgentConfig(agentId: string): AgentConfig | undefined {
    return getAgentConfig(agentId);
  }

  /**
   * Search agents by name, description, or capabilities
   */
  async searchAgents(query: string): Promise<AgentConfig[]> {
    const searchTerms = query.toLowerCase().split(' ');
    const agents = await this.getAvailableAgents();

    return agents.filter(agent =>
      searchTerms.every(term =>
        agent.name.toLowerCase().includes(term) ||
        agent.description.toLowerCase().includes(term) ||
        agent.capabilities.some(cap => cap.toLowerCase().includes(term))
      )
    );
  }

  /**
   * Get performance metrics for an agent
   */
  getAgentMetrics(agentId: string): {
    usageCount: number;
    averageExecutionTime: number;
    averageRating: number;
    lastUsed?: Date;
  } {
    const agentConfig = getAgentConfig(agentId);
    if (!agentConfig) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return {
      usageCount: agentConfig.metadata?.usageCount || 0,
      averageExecutionTime: 0, // Would come from API
      averageRating: agentConfig.metadata?.avgRating || 0,
      lastUsed: agentConfig.metadata?.updatedAt
    };
  }
}

/**
 * Create a new client-side agent manager
 */
export function createClientAgentManager(apiBase?: string): ClientAgentManager {
  return new ClientAgentManager(apiBase);
}