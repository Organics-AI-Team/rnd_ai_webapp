'use client';

import { useState, useCallback, useEffect } from 'react';
import { ConversationMessage } from '../types/conversation-types';
import { IAIService } from '../services/core/ai-service-interface';
import { getAIServiceFactory } from '../services/core/ai-service-factory';

export interface UseChatOptions {
  userId: string;
  service?: IAIService;
  serviceName?: string;
  apiKey?: string;
  provider?: string;
  maxMessages?: number;
  enablePersistence?: boolean;
  onMessageSend?: (message: string) => void;
  onMessageReceive?: (message: string) => void;
  onError?: (error: Error) => void;
}

export interface UseChatReturn {
  messages: ConversationMessage[];
  isLoading: boolean;
  error: Error | null;
  sendMessage: (message: string) => Promise<void>;
  clearHistory: () => void;
  retryLastMessage: () => void;
  setService: (service: IAIService) => void;
  getService: () => IAIService | undefined;
}

/**
 * Hook for managing chat functionality with AI services
 * Provides a unified interface for different AI providers and handles state management
 */
export function useChat(options: UseChatOptions): UseChatReturn {
  const {
    userId,
    service: initialService,
    serviceName,
    apiKey,
    provider = 'openai',
    maxMessages = 100,
    enablePersistence = true,
    onMessageSend,
    onMessageReceive,
    onError
  } = options;

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [service, setService] = useState<IAIService | undefined>(initialService);

  // Initialize service if not provided
  useEffect(() => {
    console.log('🔧 Initializing service:', {
      hasService: !!service,
      serviceName,
      hasApiKey: !!apiKey,
      provider,
      userId
    });

    if (!service && (serviceName || (apiKey && provider))) {
      const factory = getAIServiceFactory();

      if (serviceName) {
        console.log('🔍 Looking for registered service:', serviceName);
        const registeredService = factory.getService(serviceName);
        if (registeredService) {
          console.log('✅ Found registered service');
          setService(registeredService);
        } else {
          console.error('❌ Service not found:', serviceName);
        }
      } else if (apiKey && provider) {
        console.log('🏗️ Creating new service:', { provider, hasApiKey: !!apiKey });
        try {
          const newService = factory.createService(provider, apiKey);
          console.log('✅ Service created successfully');
          setService(newService);
        } catch (err) {
          console.error('❌ Failed to create service:', err);
          setError(err as Error);
          onError?.(err as Error);
        }
      }
    }
  }, [service, serviceName, apiKey, provider, onError]);

  // Load messages from localStorage if persistence is enabled
  useEffect(() => {
    if (enablePersistence && userId) {
      try {
        const stored = localStorage.getItem(`chat_messages_${userId}`);
        if (stored) {
          const parsedMessages = JSON.parse(stored).map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
          }));
          setMessages(parsedMessages.slice(-maxMessages));
        }
      } catch (err) {
        console.warn('Failed to load messages from localStorage:', err);
      }
    }
  }, [userId, enablePersistence, maxMessages]);

  // Save messages to localStorage if persistence is enabled
  useEffect(() => {
    if (enablePersistence && userId && messages.length > 0) {
      try {
        localStorage.setItem(`chat_messages_${userId}`, JSON.stringify(messages));
      } catch (err) {
        console.warn('Failed to save messages to localStorage:', err);
      }
    }
  }, [messages, userId, enablePersistence]);

  const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const sendMessage = useCallback(async (content: string) => {
    console.log('🚀 Sending message:', { content, hasService: !!service, userId });

    if (!service || !content.trim()) {
      console.error('❌ Cannot send message:', {
        hasService: !!service,
        contentTrimmed: content.trim(),
        userId
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    // Add user message
    const userMessage: ConversationMessage = {
      id: generateMessageId(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date()
    };

    console.log('📝 Adding user message to state:', userMessage);
    setMessages(prev => {
      const newMessages = [...prev, userMessage];
      console.log('💬 Updated messages state:', newMessages);
      return newMessages;
    });
    onMessageSend?.(content);

    try {
      // Create conversation context from previous messages
      const conversationHistory = messages.slice(-10).map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Generate AI response
      const response = await service.generateResponse({
        prompt: content,
        userId,
        context: {
          conversationHistory,
          category: 'general'
        }
      });

      // Add AI response
      const aiMessage: ConversationMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: response.response,
        timestamp: new Date(),
        metadata: {
          model: response.model,
          responseId: response.id,
          category: response.context.category
        }
      };

      setMessages(prev => {
        const updated = [...prev, aiMessage];
        // Limit messages to maxMessages
        return updated.length > maxMessages ? updated.slice(-maxMessages) : updated;
      });

      onMessageReceive?.(response.response);

    } catch (err) {
      const error = err as Error;
      console.error('🔥 Error in sendMessage:', error);
      setError(error);
      onError?.(error);

      // Add error message
      const errorMessage: ConversationMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}`,
        timestamp: new Date(),
        metadata: {
          error: true
        }
      };

      console.log('❌ Adding error message:', errorMessage);
      setMessages(prev => {
        const newMessages = [...prev, errorMessage];
        console.log('💬 Messages after error:', newMessages);
        return newMessages;
      });
    } finally {
      setIsLoading(false);
    }
  }, [service, userId, messages, maxMessages, onMessageSend, onMessageReceive, onError]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    if (enablePersistence && userId) {
      localStorage.removeItem(`chat_messages_${userId}`);
    }
  }, [enablePersistence, userId]);

  const retryLastMessage = useCallback(async () => {
    const lastUserMessage = messages.slice().reverse().find(msg => msg.role === 'user');
    if (lastUserMessage) {
      // Remove the last AI response (likely the error) and retry
      setMessages(prev => prev.slice(0, -1));
      await sendMessage(lastUserMessage.content);
    }
  }, [messages, sendMessage]);

  const updateService = useCallback((newService: IAIService) => {
    setService(newService);
  }, []);

  const getCurrentService = useCallback(() => {
    return service;
  }, [service]);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearHistory,
    retryLastMessage,
    setService: updateService,
    getService: getCurrentService
  };
}