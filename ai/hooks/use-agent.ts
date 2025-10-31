'use client';

import { useState, useCallback, useEffect } from 'react';
import { AgentManager, AgentExecutionContext, AgentExecutionResult } from '../agents/agent-manager';
import { AgentConfig, getAgentConfig, getEnabledAgentConfigs } from '../agents/configs/agent-configs';
import { IAIService } from '../services/core/ai-service-interface';
import { useAIService } from './use-ai-service';

export interface UseAgentOptions {
  agentId?: string;
  userId: string;
  aiService?: IAIService;
  onAgentChange?: (agent: AgentConfig | null) => void;
  onError?: (error: Error) => void;
}

export interface UseAgentReturn {
  agentManager: AgentManager | null;
  currentAgent: AgentConfig | null;
  availableAgents: AgentConfig[];
  isLoading: boolean;
  error: Error | null;
  lastResult: AgentExecutionResult | null;
  executeAgent: (request: string, options?: any) => Promise<AgentExecutionResult>;
  switchAgent: (agentId: string) => boolean;
  searchAgents: (query: string) => AgentConfig[];
  getAgentsByCategory: (category: string) => AgentConfig[];
  clearError: () => void;
}

/**
 * Hook for managing AI agents with their system prompts and RAG capabilities
 */
export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const {
    agentId: initialAgentId,
    userId,
    aiService: externalAiService,
    onAgentChange,
    onError
  } = options;

  const [agentManager, setAgentManager] = useState<AgentManager | null>(null);
  const [currentAgent, setCurrentAgent] = useState<AgentConfig | null>(null);
  const [availableAgents, setAvailableAgents] = useState<AgentConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastResult, setLastResult] = useState<AgentExecutionResult | null>(null);

  const aiService = useAIService({
    defaultProvider: 'openai',
    onError: (err) => {
      setError(err);
      onError?.(err);
    }
  });

  // Initialize agent manager when AI service is available
  useEffect(() => {
    const service = externalAiService || aiService.service;
    if (service && !agentManager) {
      const manager = new AgentManager(service);
      setAgentManager(manager);
      setAvailableAgents(manager.getAvailableAgents());

      // Set initial agent if specified
      if (initialAgentId) {
        const agent = manager.getAgentConfig(initialAgentId);
        if (agent) {
          setCurrentAgent(agent);
          onAgentChange?.(agent);
        }
      }
    }
  }, [externalAiService, aiService.service, agentManager, initialAgentId, onAgentChange]);

  const executeAgent = useCallback(async (
    request: string,
    options?: any
  ): Promise<AgentExecutionResult> => {
    if (!agentManager || !currentAgent) {
      throw new Error('Agent manager or current agent not available');
    }

    setIsLoading(true);
    setError(null);

    try {
      const context: AgentExecutionContext = {
        agentId: currentAgent.id,
        userId,
        request,
        context: options?.context,
        options: {
          forceRAG: options?.forceRAG,
          ragOptions: options?.ragOptions,
          temperature: options?.temperature,
          maxTokens: options?.maxTokens
        }
      };

      const result = await agentManager.executeAgent(context);
      setLastResult(result);

      // Update agent metrics
      agentManager.updateAgentMetrics(currentAgent.id, {
        usageCount: 1,
        lastUsed: new Date()
      });

      return result;
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [agentManager, currentAgent, userId, onError]);

  const switchAgent = useCallback((agentId: string): boolean => {
    if (!agentManager) return false;

    const agent = agentManager.getAgentConfig(agentId);
    if (agent) {
      setCurrentAgent(agent);
      onAgentChange?.(agent);
      return true;
    }
    return false;
  }, [agentManager, onAgentChange]);

  const searchAgents = useCallback((query: string): AgentConfig[] => {
    if (!agentManager) return [];
    return agentManager.searchAgents(query);
  }, [agentManager]);

  const getAgentsByCategory = useCallback((category: string): AgentConfig[] => {
    if (!agentManager) return [];
    return agentManager.getAgentsByCategory(category);
  }, [agentManager]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    agentManager,
    currentAgent,
    availableAgents,
    isLoading,
    error,
    lastResult,
    executeAgent,
    switchAgent,
    searchAgents,
    getAgentsByCategory,
    clearError
  };
}