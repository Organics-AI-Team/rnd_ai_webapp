'use client';

import { useState, useCallback, useEffect } from 'react';
import { ClientAgentManager, AgentExecutionContext, AgentExecutionResult } from '../agents/agent-manager-client';
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
  agentManager: ClientAgentManager | null;
  currentAgent: AgentConfig | null;
  availableAgents: AgentConfig[];
  isLoading: boolean;
  error: Error | null;
  lastResult: AgentExecutionResult | null;
  executeAgent: (request: string, options?: any) => Promise<AgentExecutionResult>;
  switchAgent: (agentId: string) => boolean;
  searchAgents: (query: string) => Promise<AgentConfig[]>;
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

  const [agentManager, setAgentManager] = useState<ClientAgentManager | null>(null);
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

  // Initialize agent manager
  useEffect(() => {
    if (!agentManager) {
      const manager = new ClientAgentManager();
      setAgentManager(manager);

      // Load available agents
      manager.getAvailableAgents().then(agents => {
        setAvailableAgents(agents);

        // Set initial agent if specified
        if (initialAgentId) {
          const agent = agents.find(a => a.id === initialAgentId);
          if (agent) {
            setCurrentAgent(agent);
            onAgentChange?.(agent);
          }
        }
      }).catch(err => {
        console.error('Failed to load agents:', err);
        setError(err as Error);
      });
    }
  }, [agentManager, initialAgentId, onAgentChange]);

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
    const agent = getAgentConfig(agentId);
    if (agent) {
      setCurrentAgent(agent);
      onAgentChange?.(agent);
      return true;
    }
    return false;
  }, [onAgentChange]);

  const searchAgents = useCallback(async (query: string): Promise<AgentConfig[]> => {
    if (!agentManager) return [];
    return await agentManager.searchAgents(query);
  }, [agentManager]);

  const getAgentsByCategory = useCallback((category: string): AgentConfig[] => {
    // For now, filter the loaded agents by category
    // This could be enhanced with server-side filtering if needed
    return availableAgents.filter(agent => agent.category === category);
  }, [availableAgents]);

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