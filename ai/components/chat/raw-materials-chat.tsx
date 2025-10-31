'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bot, Trash2, Search, AlertCircle, Package } from 'lucide-react';
import { BaseChat, BaseChatProps } from './base-chat';
import { useChat } from '../../hooks/use-chat';
import { useFeedback } from '../../hooks/use-feedback';
import { FeedbackCollector } from '../feedback/feedback-collector';
import { PineconeClientService } from '../../services/rag/pinecone-client';
import { ConversationMessage } from '../../types/conversation-types';

export interface RawMaterialsChatProps extends Omit<BaseChatProps, 'messages' | 'onSendMessage' | 'onClearHistory'> {
  apiKey?: string;
  provider?: string;
  serviceName?: string;
  enableRAG?: boolean;
  ragConfig?: {
    topK?: number;
    similarityThreshold?: number;
  };
  onError?: (error: Error) => void;
  onFeedbackSubmit?: (feedback: any) => void;
}

/**
 * Specialized chat component for raw materials inquiries
 * Integrates RAG capabilities for raw materials database searches
 */
export function RawMaterialsChat({
  userId,
  apiKey,
  provider = 'gemini', // Better for technical content
  serviceName,
  enableRAG = true,
  ragConfig = {
    topK: 5,
    similarityThreshold: 0.7
  },
  onError,
  onFeedbackSubmit,
  ...baseChatProps
}: RawMaterialsChatProps) {
  const [ragService] = useState(() => enableRAG ? new PineconeClientService(ragConfig) : null);
  const [isSearchingRAG, setIsSearchingRAG] = useState(false);
  const [lastRAGResults, setLastRAGResults] = useState<string>('');

  const chat = useChat({
    userId,
    apiKey,
    provider,
    serviceName,
    onError,
    maxMessages: 50,
    enablePersistence: true,
    onMessageSend: async (message) => {
      // Perform RAG search if enabled and message seems related to raw materials
      if (ragService && isRawMaterialsQuery(message)) {
        await performRAGSearch(message);
      }
    }
  });

  const feedback = useFeedback({
    userId,
    service: chat.getService(),
    onFeedbackSubmit: onFeedbackSubmit
  });

  const isRawMaterialsQuery = (message: string): boolean => {
    const keywords = [
      'raw material', 'ingredient', 'formula', 'composition',
      'rm_code', 'inci', 'supplier', 'cost', 'benefit',
      'trade name', 'chemical', 'extract', 'active'
    ];
    return keywords.some(keyword =>
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  };

  const performRAGSearch = useCallback(async (query: string) => {
    if (!ragService) return;

    setIsSearchingRAG(true);
    try {
      const results = await ragService.searchAndFormat(query, ragConfig);
      setLastRAGResults(results);
    } catch (error) {
      console.error('RAG search failed:', error);
      setLastRAGResults('\n\nVector database search temporarily unavailable.');
    } finally {
      setIsSearchingRAG(false);
    }
  }, [ragService, ragConfig]);

  const handleSendMessage = async (message: string) => {
    // Enhance prompt with RAG results if available
    let enhancedMessage = message;
    if (lastRAGResults) {
      enhancedMessage = `${message}\n\n${lastRAGResults}`;
    }

    await chat.sendMessage(enhancedMessage);
    setLastRAGResults(''); // Clear RAG results after sending
  };

  const handleClearHistory = async () => {
    chat.clearHistory();
    feedback.clearFeedback();
    setLastRAGResults('');
  };

  const renderMessageActions = (message: ConversationMessage) => {
    if (message.role !== 'assistant') {
      return null;
    }

    const responseId = message.metadata?.responseId;
    if (!responseId) {
      return null;
    }

    const hasFeedback = feedback.getFeedbackHistory(responseId).length > 0;

    return (
      <div className="mt-2 space-y-2">
        <FeedbackCollector
          responseId={responseId}
          userId={userId}
          aiResponse={message.content}
          aiModel={message.metadata?.model || 'unknown'}
          prompt={chat.messages.find(m => m.id === message.id)?.content || ''}
          onSubmit={feedback.submitFeedback}
          disabled={hasFeedback || feedback.isSubmitting}
          showSubmitted={hasFeedback}
        />

        {/* Show if RAG was used for this response */}
        {message.content.includes('Vector Database Search Results') && (
          <Badge variant="secondary" className="text-xs">
            <Search className="w-3 h-3 mr-1" />
            Enhanced with Database Search
          </Badge>
        )}
      </div>
    );
  };

  const renderHeader = () => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Package className="w-5 h-5 text-blue-600" />
        <span className="font-semibold text-slate-800">Raw Materials AI</span>
        {enableRAG && (
          <Badge variant="outline" className="text-xs">
            RAG Enabled
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${
            chat.getService() ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-xs text-slate-600">
            {chat.getService() ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleClearHistory}
          className="flex items-center gap-1"
        >
          <Trash2 className="w-4 h-4" />
          Clear
        </Button>
      </div>
    </div>
  );

  const renderFooter = () => {
    if (!chat.error && !isSearchingRAG) return null;

    return (
      <Card className="m-4 p-3 border-blue-200 bg-blue-50">
        {isSearchingRAG ? (
          <div className="flex items-center gap-2 text-blue-800">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Searching raw materials database...</span>
          </div>
        ) : chat.error ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-red-800">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">
                Error: {chat.error.message}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={chat.retryLastMessage}
            >
              Retry Last Message
            </Button>
          </div>
        ) : null}
      </Card>
    );
  };

  return (
    <BaseChat
      userId={userId}
      messages={chat.messages}
      onSendMessage={handleSendMessage}
      onClearHistory={handleClearHistory}
      isLoading={chat.isLoading || isSearchingRAG}
      header={renderHeader()}
      footer={renderFooter()}
      messageActions={renderMessageActions}
      placeholder="Ask about raw materials, ingredients, formulations, or suppliers..."
      showTimestamp={true}
      className="border border-gray-300 rounded-lg h-full flex flex-col"
      {...baseChatProps}
    />
  );
}

export default RawMaterialsChat;