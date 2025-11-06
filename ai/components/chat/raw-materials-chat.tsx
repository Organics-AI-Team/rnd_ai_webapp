'use client';

// Version: 3.0 - Enhanced with AI optimizations: structured outputs, caching, ML learning, streaming
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bot, Trash2, Search, AlertCircle, Package, Settings, Brain, Zap, Clock, Target, BookOpen, ThumbsUp, ThumbsDown, Send, User } from 'lucide-react';
import { BaseChat, BaseChatProps } from './base-chat';
import { useChat } from '../../hooks/use-chat';
import { useFeedback } from '../../hooks/use-feedback';
import { useEnhancedChat } from '../../hooks/enhanced/use-enhanced-chat';
import { FeedbackCollector } from '../feedback/feedback-collector';
import { PineconeClientService } from '../../services/rag/pinecone-client';
import { HybridSearchClient } from '../../services/rag/hybrid-search-client';
import { UnifiedSearchClient } from '../../services/rag/unified-search-client';
import { EnhancedHybridSearchService } from '../../services/rag/enhanced-hybrid-search-service';
import { ResponseReranker } from '../../services/response/response-reranker';
import { classify_query } from '../../utils/query-classifier';
import { ConversationMessage } from '../../types/conversation-types';
import { StructuredResponse, EnhancedUserPreferences } from '../../services/enhanced/enhanced-ai-service';

export interface RawMaterialsChatProps extends Omit<BaseChatProps, 'messages' | 'onSendMessage' | 'onClearHistory'> {
  apiKey?: string;
  provider?: string;
  serviceName?: string;
  enableRAG?: boolean;
  ragConfig?: {
    topK?: number;
    similarityThreshold?: number;
  };
  enableEnhancements?: boolean; // Toggle for new optimizations
  enableStreaming?: boolean;
  enableMLOptimizations?: boolean;
  enableResponseReranking?: boolean; // Toggle response scoring
  onError?: (error: Error) => void;
  onFeedbackSubmit?: (feedback: any) => void;
}

/**
 * Enhanced Raw Materials Chat with AI optimizations
 * - Structured outputs with confidence scoring
 * - Intelligent caching with @tanstack/react-query
 * - ML-driven user preference learning
 * - Real-time streaming responses
 * - Enhanced search with semantic reranking
 * - Response quality scoring and fact-checking
 */
export function RawMaterialsChat({
  userId,
  apiKey,
  provider = 'agent', // Use custom agent API
  serviceName,
  enableRAG = false,
  ragConfig = {
    topK: 5,
    similarityThreshold: 0.7
  },
  enableEnhancements = true, // Enable new optimizations by default
  enableStreaming = false,
  enableMLOptimizations = true,
  enableResponseReranking = true,
  onError,
  onFeedbackSubmit,
  ...baseChatProps
}: RawMaterialsChatProps) {
  // State for enhanced features
  const [isSearchingRAG, setIsSearchingRAG] = useState(false);
  const [lastRAGResults, setLastRAGResults] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState('');
  const [messageMetrics, setMessageMetrics] = useState<any>(null);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [responseScores, setResponseScores] = useState<Map<string, any>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track if tools are enabled (via API route)
  const [toolsEnabled] = useState(true);

  // Enhanced RAG service with semantic reranking
  const [ragService] = useState(() => {
    if (!enableRAG) return null;

    try {
      // Use enhanced service with semantic reranking when optimizations enabled
      if (enableEnhancements) {
        console.log('🚀 [RawMaterialsChat] Initializing Enhanced Hybrid Search Service');
        const enhancedService = new EnhancedHybridSearchService(
          process.env.NEXT_PUBLIC_PINECONE_API_KEY!,
          process.env.MONGODB_URI!,
          'rnd_ai',
          'raw_materials_console',
          'raw-materials-stock'
        );
        // Initialize async (don't block render)
        enhancedService.initialize().catch(error => {
          console.warn('⚠️ Enhanced RAG service initialization failed, falling back to legacy:', error);
        });
        return enhancedService;
      }

      // Use legacy service when optimizations disabled
      const serviceToUse = (serviceName as any) || 'rawMaterialsAI';
      console.log('🚀 [RawMaterialsChat] Initializing UnifiedSearchClient with multi-collection support');
      return new UnifiedSearchClient(serviceToUse, ragConfig);
    } catch (error: any) {
      console.warn('⚠️ RAG service initialization failed for raw materials chat:', error.message);
      return null;
    }
  });

  // Response reranking service
  const [responseReranker] = useState(() => {
    if (enableEnhancements && enableResponseReranking) {
      return new ResponseReranker(process.env.NEXT_PUBLIC_PINECONE_API_KEY!);
    }
    return null;
  });

  // Choose chat hook based on enhancements enabled
  const chat = enableEnhancements
    ? useEnhancedChat({
        userId,
        apiKey: apiKey!,
        model: 'gpt-4',
        enabled: true,
        onSuccess: (response) => {
          if (response.structuredData) {
            setFollowUpQuestions(response.structuredData.followUpQuestions || []);
          }
          if (response.metadata) {
            setMessageMetrics({
              responseTime: response.metadata.latency || 0,
              confidence: 0.8, // Default confidence
              category: 'general', // Default category
            });
          }
        },
        onError: (error) => {
          console.error('Enhanced chat error:', error);
        },
      })
    : useChat({
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
    serviceName: enableEnhancements ? 'enhanced-raw-materials-chat' : serviceName,
    service: (chat as any).getService?.() || 'default-service',
    onFeedbackSubmit: onFeedbackSubmit
  });

  // Auto-scroll to bottom on new messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chat.messages, currentStreamingMessage, scrollToBottom]);

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
   * Perform enhanced RAG search with intelligent collection routing and semantic reranking
   * Uses EnhancedHybridSearchService when optimizations are enabled
   */
  const performRAGSearch = useCallback(async (query: string) => {
    if (!ragService) return;

    setIsSearchingRAG(true);
    try {
      console.log('🔍 [RawMaterialsChat] Performing enhanced RAG search for:', query);

      let results;

      if (enableEnhancements && ragService instanceof EnhancedHybridSearchService) {
        // Use enhanced search with semantic reranking and personalization
        results = await ragService.enhancedSearch({
          query,
          userId,
          topK: 10,
          rerank: true,
          semanticWeight: 0.7,
          keywordWeight: 0.3,
          userPreferences: (chat as any).userPreferences,
        });

        // Format enhanced results with confidence scores
        const formattedResults = results.map((result, index) =>
          `**${index + 1}.** ${result.content}\n*Confidence: ${(result.score * 100).toFixed(1)}%*\n`
        ).join('\n');

        console.log(`✅ [RawMaterialsChat] Enhanced search completed with semantic reranking`);
        setLastRAGResults(formattedResults);
      } else {
        // Use legacy unified search
        const unifiedClient = ragService as UnifiedSearchClient;
        const formatted = await unifiedClient.search_and_format(query, {
          ...ragConfig,
          topK: 10,
          similarityThreshold: 0.5,
          enable_exact_match: true,
          enable_fuzzy_match: true,
          enable_semantic_search: true,
          enable_metadata_filter: true,
          max_results: 10,
          min_score: 0.5,
          include_availability_context: true,
        });

        console.log(`✅ [RawMaterialsChat] Legacy unified search completed`);
        setLastRAGResults(formatted);
      }
    } catch (error) {
      console.error('❌ [RawMaterialsChat] RAG search failed:', error);
      setLastRAGResults('\n\n⚠️ Database search temporarily unavailable. Providing response based on general knowledge.');
    } finally {
      setIsSearchingRAG(false);
    }
  }, [ragService, ragConfig, enableEnhancements, userId, (chat as any).userPreferences]);

  const handleSendMessage = async (message: string) => {
    console.log('🎯 [RawMaterialsChat] Sending message:', message);
    console.log('🚀 Enhancements enabled:', enableEnhancements);
    console.log('🔧 Tools enabled:', toolsEnabled);
    console.log('🧪 RAG query:', isRawMaterialsQuery(message));

    try {
      if (enableEnhancements && enableStreaming) {
        // Use enhanced streaming
        setCurrentStreamingMessage('');
        const stream = await (chat as any).sendStreamingMessage(message, {
          useSearch: true,
          category: 'raw-materials',
        });

        let fullContent = '';
        for await (const chunk of stream) {
          fullContent += chunk;
          setCurrentStreamingMessage(fullContent);
        }

        // Score the response using Response Reranker
        if (responseReranker && fullContent && lastRAGResults) {
          const searchResults = parseRAGResults(lastRAGResults);
          const scoreData = await responseReranker.scoreResponse(
            message,
            fullContent,
            searchResults,
            {
              enableFactCheck: true,
              enablePersonalization: enableMLOptimizations,
              userPreferences: (chat as any).userPreferences
            }
          );

          // Store response score
          const messageId = `msg_${Date.now()}`;
          setResponseScores(prev => new Map(prev.set(messageId, scoreData)));

          console.log('📊 [RawMaterialsChat] Response scored:', {
            overall: scoreData.overallScore.toFixed(3),
            relevance: scoreData.relevanceScore.toFixed(3),
            accuracy: scoreData.factualAccuracy.toFixed(3),
            sources: scoreData.sources.length
          });

          // Enhance response if score is low
          if (scoreData.overallScore < 0.7) {
            const enhanced = await responseReranker.enhanceResponse(
              message,
              fullContent,
              searchResults
            );
            setCurrentStreamingMessage(enhanced.response);
          }
        }

        setCurrentStreamingMessage('');
        setFollowUpQuestions([]);
      } else {
        // Use standard message sending
        let enhancedMessage = message;
        const ragWasUsed = !!lastRAGResults;

        if (lastRAGResults) {
          enhancedMessage = `${message}\n\n${lastRAGResults}`;
          console.log('✅ [RawMaterialsChat] RAG results will be used for this message');
        }

        // Send with metadata
        if (enableEnhancements) {
          await chat.sendMessage(enhancedMessage);
        } else {
          await chat.sendMessage(enhancedMessage, {
            ragUsed: ragWasUsed,
            ragSources: ragWasUsed ? ['vector-database'] : undefined
          });
        }

        console.log('✅ [RawMaterialsChat] Message sent successfully');
      }

      setLastRAGResults(''); // Clear RAG results after sending
    } catch (error) {
      console.error('❌ [RawMaterialsChat] Error sending message:', error);
      setCurrentStreamingMessage('');
    }
  };

  // Parse RAG results from formatted string
  const parseRAGResults = (formattedResults: string): any[] => {
    if (!formattedResults) return [];

    try {
      return formattedResults
        .split('\n\n')
        .filter(line => line.trim() && line.startsWith('**'))
        .map(line => ({
          content: line.replace(/\*\*\d+\.\*\*/g, '').trim(),
          score: 0.8 // Default score for parsed results
        }));
    } catch (error) {
      console.warn('⚠️ Failed to parse RAG results:', error);
      return [];
    }
  };

  // Handle feedback submission for enhanced chat
  const handleFeedback = useCallback((messageId: string, isPositive: boolean) => {
    const feedbackType = isPositive ? 'helpful' : 'not_helpful';
    const score = isPositive ? 5 : 2;

    if (enableEnhancements && (chat as any).submitFeedback) {
      (chat as any).submitFeedback(messageId, { type: feedbackType, score });
    } else {
      // Use legacy feedback
      const responseId = messageId;
      const aiResponse = chat.messages.find(m => m.id === messageId)?.content || '';

      feedback.submitFeedback({
        responseId,
        userId,
        aiResponse,
        aiModel: 'gpt-4',
        prompt: chat.messages.find(m => m.role === 'user')?.content || '',
        type: feedbackType,
        score,
      });
    }
  }, [chat, feedback, enableEnhancements, userId]);

  // Handle follow-up question click
  const handleFollowUpClick = useCallback((question: string) => {
    if (enableEnhancements && chat.messages.length > 0) {
      // For enhanced chat, just log the selection (user will send manually)
      console.log('Follow-up question selected:', question);
    } else {
      // For legacy chat, send automatically
      handleSendMessage(question);
    }
  }, [chat, enableEnhancements, handleSendMessage]);

  // Handle preference updates for enhanced chat
  const handlePreferenceUpdate = useCallback((key: keyof EnhancedUserPreferences, value: any) => {
    if (enableEnhancements && (chat as any).updateEnhancedUserPreferences) {
      (chat as any).updateEnhancedUserPreferences({ [key]: value });
    }
  }, [chat, enableEnhancements]);

  // Get confidence color
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.6) return 'text-yellow-600';
    return 'text-red-600';
  };

  const handleClearHistory = async () => {
    (chat as any).clearHistory();
    feedback.clearFeedback();
    setLastRAGResults('');
  };

  const renderMessageActions = (message: ConversationMessage) => {
    if (message.role !== 'assistant') {
      return null;
    }

    const responseId = message.metadata?.responseId || message.id;

    // Check if feedback already submitted for this response
    const hasFeedback = feedback.getFeedbackHistory?.(responseId)?.length > 0;

    // Get response score for enhanced chat
    const responseScore = enableEnhancements && responseId
      ? responseScores.get(responseId)
      : null;

    return (
      <div className="mt-2 space-y-2">
        {/* Enhanced Feedback Buttons */}
        {enableEnhancements ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleFeedback(responseId, true)}
              disabled={hasFeedback || chat.isLoading}
              className="h-6 px-2 text-xs"
            >
              <ThumbsUp className="w-3 h-3 mr-1" />
              Helpful
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleFeedback(responseId, false)}
              disabled={hasFeedback || chat.isLoading}
              className="h-6 px-2 text-xs"
            >
              <ThumbsDown className="w-3 h-3 mr-1" />
              Not Helpful
            </Button>
          </div>
        ) : (
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
        )}

        {/* Response Quality Score for Enhanced Chat */}
        {enableEnhancements && responseScore && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`text-xs ${getConfidenceColor(responseScore.overallScore)}`}>
                Quality: {(responseScore.overallScore * 100).toFixed(0)}%
              </Badge>
              <Badge variant="outline" className="text-xs">
                Sources: {responseScore.sources.length}
              </Badge>
            </div>
            {responseScore.overallScore < 0.7 && (
              <div className="text-xs text-orange-600">
                ⚠️ Response enhanced for accuracy
              </div>
            )}
          </div>
        )}

        {/* Legacy RAG indicator */}
        {!enableEnhancements && message.content.includes('Vector Database Search Results') && (
          <Badge variant="secondary" className="text-xs">
            <Search className="w-3 h-3 mr-1" />
            Enhanced with Database Search
          </Badge>
        )}

        {/* Enhanced RAG indicator */}
        {enableEnhancements && message.content.includes('Confidence:') && (
          <Badge variant="secondary" className="text-xs bg-blue-50 border-blue-300">
            <Brain className="w-3 h-3 mr-1" />
            Smart Search
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
            (chat as any).getService?.() ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-xs text-slate-600">
            {(chat as any).getService?.() ? 'Connected' : 'Disconnected'}
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
              onClick={(chat as any).retryLastMessage}
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
      maxHeight="h-full"
      className="border border-gray-300 rounded-lg h-full"
      {...baseChatProps}
    />
  );
}

export default RawMaterialsChat;
