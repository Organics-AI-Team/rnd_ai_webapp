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
import { HybridSearchClient } from '../../services/rag/hybrid-search-client';
import { UnifiedSearchClient } from '../../services/rag/unified-search-client';
import { classify_query } from '../../utils/query-classifier';
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
  provider = 'agent', // Use custom agent API
  serviceName,
  enableRAG = false, // RAG disabled - using tools instead
  ragConfig = {
    topK: 5,
    similarityThreshold: 0.7
  },
  onError,
  onFeedbackSubmit,
  ...baseChatProps
}: RawMaterialsChatProps) {
  // Track if tools are enabled (via API route)
  const [toolsEnabled] = useState(true); // Always enabled - agent API handles it

  const [ragService] = useState(() => {
    if (!enableRAG) return null;

    try {
      // Use provided serviceName or default to 'rawMaterialsAI'
      const serviceToUse = (serviceName as any) || 'rawMaterialsAI';
      // Use UnifiedSearchClient for intelligent multi-collection search
      console.log('🚀 [RawMaterialsChat] Initializing UnifiedSearchClient with multi-collection support');
      return new UnifiedSearchClient(serviceToUse, ragConfig);
    } catch (error: any) {
      console.warn('⚠️ RAG service initialization failed for raw materials chat:', error.message);
      return null;
    }
  });
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
    serviceName, // Pass serviceName for isolated learning
    service: chat.getService(),
    onFeedbackSubmit: onFeedbackSubmit
  });

  /**
   * Intelligent query detection using query classifier
   * Replaces simple keyword matching with ML-based classification
   */
  const isRawMaterialsQuery = (message: string): boolean => {
    const classification = classify_query(message);
    console.log('🔍 [RawMaterialsChat] Query classification:', classification);

    // Use classifier's determination with confidence threshold
    return classification.is_raw_materials_query && classification.confidence > 0.3;
  };

  /**
   * Perform unified RAG search with intelligent collection routing
   * Uses UnifiedSearchService for automatic in-stock vs FDA separation
   */
  const performRAGSearch = useCallback(async (query: string) => {
    if (!ragService) return;

    setIsSearchingRAG(true);
    try {
      console.log('🔍 [RawMaterialsChat] Performing unified search with intelligent routing for:', query);

      // Use client-side unified search (calls API with automatic routing)
      const unifiedClient = ragService as UnifiedSearchClient;
      const formatted = await unifiedClient.search_and_format(query, {
        ...ragConfig,
        topK: 10, // Search across both collections
        similarityThreshold: 0.5, // Lowered for broader matching
        enable_exact_match: true,
        enable_fuzzy_match: true,
        enable_semantic_search: true,
        enable_metadata_filter: true,
        max_results: 10,
        min_score: 0.5,
        include_availability_context: true, // Show in-stock vs FDA indicators
        // collection: 'both' // Auto-routes by default, or specify: 'in_stock', 'all_fda', 'both'
      });

      console.log(`✅ [RawMaterialsChat] Received formatted results from unified search with collection routing`);

      setLastRAGResults(formatted);
    } catch (error) {
      console.error('❌ [RawMaterialsChat] Unified search failed:', error);
      setLastRAGResults('\n\n⚠️ Database search temporarily unavailable. Providing response based on general knowledge.');
    } finally {
      setIsSearchingRAG(false);
    }
  }, [ragService, ragConfig]);

  const handleSendMessage = async (message: string) => {
    // Enhance prompt with RAG results if available
    let enhancedMessage = message;
    const ragWasUsed = !!lastRAGResults;

    if (lastRAGResults) {
      enhancedMessage = `${message}\n\n${lastRAGResults}`;
      console.log('✅ [RawMaterialsChat] RAG results will be used for this message');
    }

    // Pass RAG metadata to track that RAG was used
    await chat.sendMessage(enhancedMessage, {
      ragUsed: ragWasUsed,
      ragSources: ragWasUsed ? ['vector-database'] : undefined
    });

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
        {toolsEnabled && (
          <Badge variant="outline" className="text-xs bg-green-50 border-green-300">
            🔧 Tools Enabled
          </Badge>
        )}
        {enableRAG && !toolsEnabled && (
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
      className="border border-gray-300 rounded-lg h-full"
      {...baseChatProps}
    />
  );
}

export default RawMaterialsChat;