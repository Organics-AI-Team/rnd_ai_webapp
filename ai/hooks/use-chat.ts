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
    console.log('🔧 [use-chat] Initializing service:', {
      hasService: !!service,
      serviceName,
      hasApiKey: !!apiKey,
      provider,
      userId
    });

    if (!service && (serviceName || (apiKey && provider))) {
      const factory = getAIServiceFactory();

      // Try to get registered service by name first
      if (serviceName) {
        console.log('🔍 [use-chat] Looking for registered service:', serviceName);
        const registeredService = factory.getService(serviceName);
        if (registeredService) {
          console.log('✅ [use-chat] Found registered service:', serviceName);
          setService(registeredService);
          return; // Early return when registered service is found
        } else {
          console.warn('⚠️ [use-chat] Service not found in registry:', serviceName);
          console.log('🔄 [use-chat] Falling back to creating new service...');
        }
      }

      // Fallback: Create new service if we have apiKey and provider
      // This handles both: serviceName not found, OR no serviceName at all
      if (apiKey && provider) {
        console.log('🏗️ [use-chat] Creating new service:', { provider, hasApiKey: !!apiKey, forServiceName: serviceName || 'anonymous' });
        try {
          // Pass serviceName to enable isolated learning for this specific AI service
          const newService = factory.createService(provider, apiKey, undefined, serviceName);
          console.log('✅ [use-chat] Service created successfully with serviceName:', serviceName);
          setService(newService);

          // Optionally register the newly created service if serviceName was provided
          if (serviceName) {
            console.log('📝 [use-chat] Registering service with name:', serviceName);
            factory.registerService(serviceName, newService);
          }

          // Load feedback history from database for this service
          if (userId && serviceName) {
            console.log('📥 [use-chat] Loading feedback history for service:', serviceName);
            newService.load_feedback_from_database?.(userId).catch((err: Error) => {
              console.warn('⚠️ [use-chat] Failed to load feedback history:', err);
            });
          }
        } catch (err) {
          console.error('❌ [use-chat] Failed to create service:', err);
          setError(err as Error);
          onError?.(err as Error);
        }
      } else {
        console.error('❌ [use-chat] Cannot initialize service: No apiKey or provider provided');
      }
    }
  }, [service, serviceName, apiKey, provider, userId, onError]);

  // Generate unique storage key for chat history
  // Scoped by userId and serviceName to isolate chat history per AI service
  const getStorageKey = () => {
    const baseKey = `chat_messages_${userId}`;
    return serviceName ? `${baseKey}_${serviceName}` : baseKey;
  };

  // Load messages from localStorage if persistence is enabled
  useEffect(() => {
    if (enablePersistence && userId) {
      try {
        const storageKey = getStorageKey();
        const stored = localStorage.getItem(storageKey);
        console.log('📂 [use-chat] Loading messages from:', storageKey);
        if (stored) {
          const parsedMessages = JSON.parse(stored).map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
          }));
          console.log('✅ [use-chat] Loaded', parsedMessages.length, 'messages');
          setMessages(parsedMessages.slice(-maxMessages));
        } else {
          console.log('📭 [use-chat] No stored messages found');
          setMessages([]); // Reset to empty when no messages found
        }
      } catch (err) {
        console.warn('⚠️ [use-chat] Failed to load messages from localStorage:', err);
        setMessages([]); // Reset on error
      }
    }
  }, [userId, serviceName, enablePersistence, maxMessages]);

  // Save messages to localStorage if persistence is enabled
  useEffect(() => {
    if (enablePersistence && userId && messages.length > 0) {
      try {
        const storageKey = getStorageKey();
        localStorage.setItem(storageKey, JSON.stringify(messages));
        console.log('💾 [use-chat] Saved', messages.length, 'messages to:', storageKey);
      } catch (err) {
        console.warn('⚠️ [use-chat] Failed to save messages to localStorage:', err);
      }
    }
  }, [messages, userId, serviceName, enablePersistence]);

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
    console.log('🗑️ [use-chat] Clearing chat history');
    setMessages([]);
    if (enablePersistence && userId) {
      const storageKey = getStorageKey();
      localStorage.removeItem(storageKey);
      console.log('✅ [use-chat] Cleared history from:', storageKey);
    }
  }, [enablePersistence, userId, serviceName]);

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