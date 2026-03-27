/**
 * AI Agent Manager
 * Manages the creation, configuration, and execution of AI agents with their system prompts and RAG capabilities
 */

import { IAIService } from '../services/core/ai-service-interface';
import { QdrantRAGService } from '../services/rag/qdrant-rag-service';
import { AgentConfig, getAgentConfig, getEnabledAgentConfigs } from './configs/agent-configs';
import { getSystemPrompt } from './prompts/system-prompts';
import { getRAGIndexConfig } from '../rag/indices/index-config';
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
 * Manages AI agents with their system prompts and RAG capabilities
 */
export class AgentManager {
  private aiService: IAIService;
  private ragServices: Map<string, QdrantRAGService> = new Map();

  constructor(aiService: IAIService) {
    this.aiService = aiService;
  }

  /**
   * Execute an AI agent with its full configuration (system prompt + RAG)
   */
  async executeAgent(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    // Get agent configuration
    const agentConfig = getAgentConfig(context.agentId);
    if (!agentConfig) {
      throw new Error(`Agent configuration not found: ${context.agentId}`);
    }

    // Get system prompt
    const systemPrompt = getSystemPrompt(agentConfig.systemPromptId);
    if (!systemPrompt) {
      throw new Error(`System prompt not found: ${agentConfig.systemPromptId}`);
    }

    // Gather RAG results if configured
    let ragResults: any = null;
    let enhancedPrompt = context.request;

    if (agentConfig.ragIndexIds.length > 0 && (context.options?.forceRAG !== false)) {
      ragResults = await this.executeRAGSearch(context.request, agentConfig.ragIndexIds, context.options?.ragOptions);
      if (ragResults.formattedResults) {
        enhancedPrompt = `${context.request}\n\n${ragResults.formattedResults}`;
      }
    }

    // Create AI request with enhanced prompt and system prompt
    const aiRequest: AIRequest = {
      prompt: enhancedPrompt,
      userId: context.userId,
      context: {
        ...context.context,
        category: agentConfig.category,
        agentId: context.agentId,
        systemPrompt: systemPrompt.prompt,
        ragEnabled: ragResults !== null,
        ragSources: ragResults?.sources || []
      }
    };

    // Override model config if provided in options
    if (context.options?.temperature !== undefined || context.options?.maxTokens !== undefined) {
      // This would require modifying the AI service to accept runtime config changes
      // For now, we use the agent's default configuration
    }

    // Generate response
    const response = await this.aiService.generateResponse(aiRequest);

    const executionTime = Date.now() - startTime;

    return {
      response,
      agentConfig,
      ragResults,
      executionTime,
      tokensUsed: {
        prompt: response.metadata?.promptTokens || 0,
        completion: response.metadata?.completionTokens || 0,
        total: response.metadata?.totalTokens || 0
      }
    };
  }

  /**
   * Execute RAG search across multiple indices
   */
  private async executeRAGSearch(
    query: string,
    ragIndexIds: string[],
    ragOptions?: any
  ): Promise<{
    results: any[];
    formattedResults: string;
    sources: string[];
  }> {
    const allResults = [];
    const allSources = [];

    for (const indexId of ragIndexIds) {
      const indexConfig = getRAGIndexConfig(indexId);
      if (!indexConfig || indexConfig.status !== 'active') {
        continue;
      }

      const ragService = this.getRAGService(indexConfig);
      try {
        const results = await ragService.search_similar(query, {
          topK: ragOptions?.topK || indexConfig.topK,
          similarityThreshold: ragOptions?.similarityThreshold || indexConfig.similarityThreshold,
          includeMetadata: true,
        });

        allResults.push(...results);
        allSources.push(indexConfig.name);
      } catch (error) {
        console.warn(`RAG search failed for index ${indexId}:`, error);
      }
    }

    // Sort by similarity score and limit results
    const sortedResults = allResults
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, ragOptions?.maxResults || 10);

    // Format results for AI context
    const formattedResults = this.formatRAGResults(sortedResults, allSources);

    return {
      results: sortedResults,
      formattedResults,
      sources: allSources
    };
  }

  /**
   * Format RAG results for inclusion in AI prompt
   */
  private formatRAGResults(results: any[], sources: string[]): string {
    if (results.length === 0) {
      return '';
    }

    let formatted = '\n\nRelevant Information from Knowledge Base:\n';
    formatted += `Sources: ${sources.join(', ')}\n\n`;

    results.forEach((result, index) => {
      const metadata = result.metadata || {};
      formatted += `${index + 1}. **${metadata.title || 'Document'}**\n`;

      if (metadata.source) {
        formatted += `   **Source:** ${metadata.source}\n`;
      }

      if (metadata.category) {
        formatted += `   **Category:** ${metadata.category}\n`;
      }

      formatted += `   **Content:** ${result.text || 'No content available'}\n`;
      formatted += `   **Relevance:** ${(result.score || 0).toFixed(3)}\n\n`;
    });

    return formatted;
  }

  /**
   * Get or create RAG service for an index configuration.
   * Uses QdrantRAGService with the collection name from the index config.
   *
   * @param indexConfig - RAGIndexConfig entry from RAG_INDICES
   * @returns Cached or newly created QdrantRAGService instance
   */
  private getRAGService(indexConfig: any): QdrantRAGService {
    const collection = indexConfig.qdrant_collection as string;
    const serviceKey = `${collection}-${indexConfig.namespace || 'default'}`;

    if (!this.ragServices.has(serviceKey)) {
      console.log('[AgentManager] getRAGService: creating QdrantRAGService', { collection, serviceKey });

      // Map index category to the corresponding service name so SERVICE_DEFAULTS apply correctly.
      // Default to rawMaterialsAllAI for general queries.
      let serviceName: 'rawMaterialsAllAI' | 'rawMaterialsAI' | 'salesRndAI' = 'rawMaterialsAllAI';

      if (indexConfig.category === 'raw-materials' && indexConfig.namespace === 'raw-materials') {
        // Specifically the in-stock raw materials collection
        serviceName = 'rawMaterialsAI';
      } else if (indexConfig.category === 'market-data') {
        serviceName = 'salesRndAI';
      }

      // QdrantRAGService constructor: (service_name, config_override, custom_embedding_service)
      const ragService = new QdrantRAGService(serviceName, {
        collectionName: collection,
        topK: indexConfig.topK,
        similarityThreshold: indexConfig.similarityThreshold,
        includeMetadata: true,
      });

      console.log('[AgentManager] getRAGService: QdrantRAGService created', { serviceName, collection });
      this.ragServices.set(serviceKey, ragService);
    }

    return this.ragServices.get(serviceKey)!;
  }

  /**
   * Get list of available agents
   */
  getAvailableAgents(): AgentConfig[] {
    return getEnabledAgentConfigs();
  }

  /**
   * Get agent configuration by ID
   */
  getAgentConfig(agentId: string): AgentConfig | undefined {
    return getAgentConfig(agentId);
  }

  /**
   * Get agents by category
   */
  getAgentsByCategory(category: string): AgentConfig[] {
    return getEnabledAgentConfigs().filter(agent => agent.category === category);
  }

  /**
   * Search agents by name, description, or capabilities
   */
  searchAgents(query: string): AgentConfig[] {
    const searchTerms = query.toLowerCase().split(' ');
    return getEnabledAgentConfigs().filter(agent =>
      searchTerms.every(term =>
        agent.name.toLowerCase().includes(term) ||
        agent.description.toLowerCase().includes(term) ||
        agent.capabilities.some(cap => cap.toLowerCase().includes(term))
      )
    );
  }

  /**
   * Execute multiple agents in parallel for comparison
   */
  async executeMultipleAgents(
    contexts: AgentExecutionContext[]
  ): Promise<AgentExecutionResult[]> {
    const promises = contexts.map(context => this.executeAgent(context));
    return Promise.all(promises);
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
      averageExecutionTime: 0, // Would need to track this separately
      averageRating: agentConfig.metadata?.avgRating || 0,
      lastUsed: agentConfig.metadata?.updatedAt
    };
  }

  /**
   * Update agent metadata (usage count, ratings, etc.)
   */
  updateAgentMetrics(
    agentId: string,
    updates: {
      usageCount?: number;
      rating?: number;
      lastUsed?: Date;
    }
  ): void {
    const agentConfig = getAgentConfig(agentId);
    if (!agentConfig) return;

    if (updates.usageCount) {
      agentConfig.metadata!.usageCount = (agentConfig.metadata?.usageCount || 0) + updates.usageCount;
    }

    if (updates.rating) {
      const currentRating = agentConfig.metadata?.avgRating || 0;
      const currentCount = agentConfig.metadata?.usageCount || 1;
      agentConfig.metadata!.avgRating = (currentRating * currentCount + updates.rating) / (currentCount + 1);
    }

    if (updates.lastUsed) {
      agentConfig.metadata!.updatedAt = updates.lastUsed;
    }
  }

  /**
   * Clear RAG service cache
   */
  clearRAGCache(): void {
    this.ragServices.clear();
  }
}