'use client';

// Version: 2.1 - Added RAG support for chemical queries
import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bot, Trash2, AlertCircle, Search } from 'lucide-react';
import { BaseChat, BaseChatProps } from './base-chat';
import { useChat } from '../../hooks/use-chat';
import { useFeedback } from '../../hooks/use-feedback';
import { FeedbackCollector } from '../feedback/feedback-collector';
import { PineconeClientService } from '../../services/rag/pinecone-client';
import { ConversationMessage } from '../../types/conversation-types';

export interface AIChatProps extends Omit<BaseChatProps, 'messages' | 'onSendMessage' | 'onClearHistory'> {
  apiKey?: string;
  provider?: string;
  serviceName?: string;
  enableFeedback?: boolean;
  showServiceStatus?: boolean;
  onError?: (error: Error) => void;
  onFeedbackSubmit?: (feedback: any) => void;
}

/**
 * Refactored AI Chat component using shared base and hooks
 * Provides a clean interface for AI conversations with feedback collection
 */
export function AIChat({
  userId,
  apiKey,
  provider = 'openai',
  serviceName,
  enableFeedback = true,
  showServiceStatus = true,
  onError,
  onFeedbackSubmit,
  ...baseChatProps
}: AIChatProps) {
  const [ragService] = useState(() => new PineconeClientService({
    topK: 5,
    similarityThreshold: 0.7
  }));
  const [isSearchingRAG, setIsSearchingRAG] = useState(false);
  const [lastRAGResults, setLastRAGResults] = useState('');

  const chat = useChat({
    userId,
    apiKey,
    provider,
    serviceName,
    onError,
    maxMessages: 50,
    enablePersistence: true,
    onMessageSend: async (message) => {
      // Perform RAG search if message seems related to raw materials/chemicals
      if (ragService && isRawMaterialsQuery(message)) {
        console.log('🚀 Triggering RAG search in background...');
        // Don't await - let it run in background and not block the message
        performRAGSearch(message).catch(error => {
          console.error('❌ Background RAG search failed:', error);
        });
      }
    }
  });

  const feedback = useFeedback({
    userId,
    service: chat.getService(),
    onFeedbackSubmit: onFeedbackSubmit
  });

  const isRawMaterialsQuery = (message: string): boolean => {
    console.log('🔍 Checking RAG query:', message);
    const keywords = [
      'raw material', 'ingredient', 'formula', 'composition',
      'rm_code', 'inci', 'supplier', 'cost', 'benefit',
      'trade name', 'chemical', 'extract', 'active',
      '7-amino', 'benzothiazine', 'dihydro', 'compound', 'molecule'
    ];
    const isRAG = keywords.some(keyword =>
      message.toLowerCase().includes(keyword.toLowerCase())
    );
    console.log('🧪 RAG query result:', isRAG);
    return isRAG;
  };

  const performRAGSearch = useCallback(async (query: string) => {
    if (!ragService) {
      console.log('⚠️ No RAG service available');
      return;
    }

    console.log('🔍 Starting RAG search for:', query);
    setIsSearchingRAG(true);
    try {
      const results = await ragService.searchAndFormat(query, {
        topK: 5,
        similarityThreshold: 0.7
      });
      console.log('✅ RAG search results:', results);
      setLastRAGResults(results);
    } catch (error) {
      console.error('❌ RAG search failed:', error);
      console.error('❌ Error details:', error.message, error.stack);
      // Don't set any results on failure - let the query proceed normally
      setLastRAGResults('');
    } finally {
      setIsSearchingRAG(false);
    }
  }, [ragService]);

  const handleSendMessage = async (message: string) => {
    console.log('🎯 AIChat handleSendMessage called:', message);
    console.log('🔧 Chat service status:', !!chat.getService());
    console.log('🔑 API Key available:', !!apiKey);
    console.log('🏷️ Provider:', provider);
    console.log('👤 User ID:', userId);
    console.log('🧪 Is RAG query:', isRawMaterialsQuery(message));

    // Always send the original message first to ensure it works
    try {
      await chat.sendMessage(message);
      console.log('✅ Message sent successfully');

      // If there are RAG results, send a follow-up message with the enhanced context
      if (lastRAGResults && isRawMaterialsQuery(message)) {
        console.log('🔍 Sending follow-up with RAG results');
        setTimeout(() => {
          chat.sendMessage(`\n\n**Additional Information from Database:**\n${lastRAGResults}`)
            .catch(error => console.error('❌ Failed to send RAG follow-up:', error));
        }, 1000);
      }

      setLastRAGResults(''); // Clear RAG results after sending
    } catch (error) {
      console.error('❌ Error sending message:', error);
    }
  };

  const handleClearHistory = async () => {
    chat.clearHistory();
    feedback.clearFeedback();
  };

  const renderMessageActions = (message: ConversationMessage) => {
    if (message.role !== 'assistant' || !enableFeedback) {
      return null;
    }

    const responseId = message.metadata?.responseId;
    if (!responseId) {
      return null;
    }

    // Check if feedback already submitted for this response
    const hasFeedback = feedback.getFeedbackHistory(responseId).length > 0;

    return (
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
    );
  };

  const renderHeader = () => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Bot className="w-5 h-5 text-green-600" />
        <span className="font-semibold text-slate-800">AI Assistant</span>
        {ragService && (
          <Badge variant="outline" className="text-xs">
            <Search className="w-3 h-3 mr-1" />
            RAG Ready
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        {showServiceStatus && (
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${
              chat.getService() ? 'bg-green-500' : 'bg-red-500'
            }`} />
            <span className="text-xs text-slate-600">
              {chat.getService() ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        )}

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
            <span className="text-sm">Searching knowledge base for chemical information...</span>
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
      placeholder="Ask me anything... (Try asking about chemicals or raw materials!)"
      showTimestamp={true}
      className="border border-gray-300 rounded-lg h-full flex flex-col"
      {...baseChatProps}
    />
  );
}

export default AIChat;