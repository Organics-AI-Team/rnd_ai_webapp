/**
 * Enhanced Chat Hook with Intelligent Caching using @tanstack/react-query
 * Implements advanced caching, deduplication, and optimistic updates
 */

import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { useState, useCallback, useEffect } from 'react';
import { EnhancedAIService, StructuredResponse, UserPreferences } from '../../services/enhanced/enhanced-ai-service';
import { AIRequest, AIResponse } from '../../types/ai-types';

// Cache keys for TanStack Query
const CACHE_KEYS = {
  chatResponse: (prompt: string, userId: string) => ['chat', 'response', prompt, userId] as const,
  userPreferences: (userId: string) => ['user', 'preferences', userId] as const,
  relatedQueries: (query: string) => ['chat', 'related', query] as const,
  searchHistory: (userId: string) => ['user', 'search-history', userId] as const,
} as const;

interface EnhancedChatOptions {
  userId: string;
  apiKey: string;
  model?: string;
  enabled?: boolean;
  cacheTime?: number;
  staleTime?: number;
  onSuccess?: (response: AIResponse & { structuredData: StructuredResponse }) => void;
  onError?: (error: Error) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  structuredData?: StructuredResponse;
}

interface UseEnhancedChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: Error | null;
  sendMessage: (prompt: string, context?: any) => Promise<void>;
  sendStreamingMessage: (prompt: string, context?: any) => Promise<AsyncIterable<string>>;
  clearMessages: () => void;
  refetchLastMessage: () => void;
  userPreferences: UserPreferences | undefined;
  updateUserPreferences: (preferences: Partial<UserPreferences>) => void;
  submitFeedback: (messageId: string, feedback: { type: string; score: number }) => void;
  getRelatedQueries: (query: string) => Promise<string[]>;
  optimisticResponse: (prompt: string) => void;
  cancelCurrentRequest: () => void;
}

/**
 * Enhanced chat hook with intelligent caching and optimization
 */
export function useEnhancedChat(options: EnhancedChatOptions): UseEnhancedChatReturn {
  const {
    userId,
    apiKey,
    model = 'gpt-4',
    enabled = true,
    cacheTime = 1000 * 60 * 10, // 10 minutes
    staleTime = 1000 * 60 * 5, // 5 minutes
    onSuccess,
    onError,
  } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const enhancedService = new EnhancedAIService(apiKey, { model });

  // Query for user preferences with caching
  const {
    data: userPreferences,
    refetch: refetchPreferences,
  } = useQuery({
    queryKey: CACHE_KEYS.userPreferences(userId),
    queryFn: () => enhancedService.getUserPreferences(userId),
    staleTime: staleTime * 2, // Preferences change less frequently
    cacheTime: cacheTime * 6, // Cache longer
    enabled,
  });

  // Mutation for sending messages with optimistic updates
  const sendMessageMutation = useMutation({
    mutationFn: async ({ prompt, context }: { prompt: string; context?: any }) => {
      const requestId = crypto.randomUUID();
      setCurrentRequestId(requestId);

      const request: AIRequest = {
        prompt,
        userId,
        context,
      };

      const response = await enhancedService.generateEnhancedResponse(request);
      return { response, requestId };
    },
    onMutate: async ({ prompt }) => {
      // Cancel any ongoing refetches
      await queryClient.cancelQueries({ queryKey: CACHE_KEYS.chatResponse(prompt, userId) });

      // Create optimistic message
      const optimisticMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Thinking...',
        timestamp: new Date(),
      };

      // Add optimistic message to state
      setMessages(prev => [...prev, optimisticMessage]);

      // Return context for rollback
      return { optimisticMessage };
    },
    onSuccess: ({ response, requestId }, variables, context) => {
      // Replace optimistic message with actual response
      setMessages(prev => prev.map(msg =>
        msg.id === context?.optimisticMessage.id
          ? {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: response.response,
              timestamp: new Date(),
              structuredData: response.structuredData,
            }
          : msg
      ));

      // Cache the response
      queryClient.setQueryData(
        CACHE_KEYS.chatResponse(variables.prompt, userId),
        response,
        { updatedAt: Date.now() }
      );

      // Invalidate related queries cache
      queryClient.invalidateQueries({ queryKey: CACHE_KEYS.relatedQueries(variables.prompt) });

      onSuccess?.(response);
    },
    onError: (error, variables, context) => {
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => msg.id !== context?.optimisticMessage.id));

      onError?.(error as Error);
    },
    onSettled: (_, __, variables) => {
      setCurrentRequestId(null);
      // Refetch related queries after a delay
      setTimeout(() => {
        queryClient.prefetchQuery({
          queryKey: CACHE_KEYS.relatedQueries(variables.prompt),
          queryFn: () => generateRelatedQueries(variables.prompt),
          staleTime: staleTime * 3,
        });
      }, 1000);
    },
  });

  // Query for getting cached responses
  const getCachedResponse = useCallback((prompt: string) => {
    return queryClient.getQueryData<AIResponse & { structuredData: StructuredResponse }>(
      CACHE_KEYS.chatResponse(prompt, userId)
    );
  }, [queryClient, userId]);

  // Query for related queries with intelligent caching
  const getRelatedQueries = useCallback(async (query: string): Promise<string[]> => {
    const cached = queryClient.getQueryData<string[]>(CACHE_KEYS.relatedQueries(query));
    if (cached) return cached;

    const related = await generateRelatedQueries(query);
    queryClient.setQueryData(CACHE_KEYS.relatedQueries(query), related);
    return related;
  }, [queryClient]);

  // Generate related queries (simplified implementation)
  const generateRelatedQueries = async (query: string): Promise<string[]> => {
    // This could be enhanced with AI-powered query expansion
    const keywords = query.toLowerCase().split(' ').filter(word => word.length > 3);
    const relatedQueries: string[] = [];

    keywords.forEach(keyword => {
      relatedQueries.push(
        `What are the benefits of ${keyword}?`,
        `How does ${keyword} work?`,
        `${keyword} side effects`,
        `Best practices for ${keyword}`,
        `${keyword} research studies`
      );
    });

    return relatedQueries.slice(0, 5);
  };

  // Send message with caching and deduplication
  const sendMessage = useCallback(async (prompt: string, context?: any) => {
    // Add user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Check cache first
    const cachedResponse = getCachedResponse(prompt);
    if (cachedResponse) {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: cachedResponse.response,
        timestamp: new Date(),
        structuredData: cachedResponse.structuredData,
      };
      setMessages(prev => [...prev, assistantMessage]);
      onSuccess?.(cachedResponse);
      return;
    }

    // Send new message
    sendMessageMutation.mutate({ prompt, context });
  }, [getCachedResponse, sendMessageMutation, onSuccess]);

  // Streaming message implementation
  const sendStreamingMessage = useCallback(async (prompt: string, context?: any): Promise<AsyncIterable<string>> => {
    // Add user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Create streaming assistant message
    let assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, assistantMessage]);

    async function* streamGenerator(): AsyncIterable<string> {
      // This would integrate with your streaming API
      const words = prompt.split(' ');
      for (let i = 0; i < words.length; i++) {
        const chunk = words[i] + ' ';
        assistantMessage.content += chunk;
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMessage.id ? { ...assistantMessage } : msg
        ));
        yield chunk;
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate streaming delay
      }
    }

    return streamGenerator();
  }, []);

  // Clear all messages
  const clearMessages = useCallback(() => {
    setMessages([]);
    queryClient.clear();
  }, [queryClient]);

  // Refetch last message
  const refetchLastMessage = useCallback(() => {
    const lastUserMessage = [...messages].reverse().find(msg => msg.role === 'user');
    if (lastUserMessage) {
      sendMessage(lastUserMessage.content);
    }
  }, [messages, sendMessage]);

  // Update user preferences
  const updateUserPreferences = useCallback((preferences: Partial<UserPreferences>) => {
    const updatedPreferences = { ...userPreferences, ...preferences };
    queryClient.setQueryData(CACHE_KEYS.userPreferences(userId), updatedPreferences);

    // Also update in the service
    enhancedService.updateUserPreferences(userId, {
      type: 'helpful',
      score: 5,
      topic: 'preference_update',
    });
  }, [userPreferences, userId, queryClient, enhancedService]);

  // Submit feedback with cache invalidation
  const submitFeedback = useCallback((messageId: string, feedback: { type: string; score: number }) => {
    const message = messages.find(msg => msg.id === messageId);
    if (message && message.structuredData) {
      enhancedService.updateUserPreferences(userId, {
        ...feedback,
        topic: message.structuredData.metadata.category,
      });

      // Invalidate caches to reflect preference changes
      queryClient.invalidateQueries({ queryKey: CACHE_KEYS.userPreferences(userId) });
    }
  }, [messages, userId, queryClient, enhancedService]);

  // Optimistic response
  const optimisticResponse = useCallback((prompt: string) => {
    const optimisticMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'This is an optimistic response that will be updated...',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, optimisticMessage]);
  }, []);

  // Cancel current request
  const cancelCurrentRequest = useCallback(() => {
    if (currentRequestId) {
      sendMessageMutation.reset();
      setCurrentRequestId(null);
    }
  }, [currentRequestId, sendMessageMutation]);

  // Prefetch common queries on mount
  useEffect(() => {
    if (enabled) {
      const commonQueries = [
        'What are the latest ingredients in cosmetics?',
        'How do I formulate a new product?',
        'What are the safety regulations?',
      ];

      commonQueries.forEach(query => {
        queryClient.prefetchQuery({
          queryKey: CACHE_KEYS.chatResponse(query, userId),
          queryFn: () => enhancedService.generateEnhancedResponse({
            prompt: query,
            userId,
          }),
          staleTime,
        });
      });
    }
  }, [enabled, userId, queryClient, enhancedService, staleTime]);

  return {
    messages,
    isLoading: sendMessageMutation.isPending,
    error: sendMessageMutation.error as Error | null,
    sendMessage,
    sendStreamingMessage,
    clearMessages,
    refetchLastMessage,
    userPreferences,
    updateUserPreferences,
    submitFeedback,
    getRelatedQueries,
    optimisticResponse,
    cancelCurrentRequest,
  };
}