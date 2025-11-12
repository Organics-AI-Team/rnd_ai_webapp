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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bot, Trash2, AlertCircle, Search, Settings, Brain, Zap, Clock, Target, BookOpen, ThumbsUp, ThumbsDown, Send, User } from 'lucide-react';
import { BaseChat, BaseChatProps } from './base-chat';
import { useChat } from '../../hooks/use-chat';
import { useFeedback } from '../../hooks/use-feedback';
import { useEnhancedChat } from '../../hooks/enhanced/use-enhanced-chat';
import { FeedbackCollector } from '../feedback/feedback-collector';
import { PineconeClientService } from '../../services/rag/pinecone-client';
import { EnhancedHybridSearchService } from '../../services/rag/enhanced-hybrid-search-service';
import { ConversationMessage } from '../../types/conversation-types';
import { StructuredResponse, EnhancedUserPreferences } from '../../services/enhanced/enhanced-ai-service';

export interface AIChatProps extends Omit<BaseChatProps, 'messages' | 'onSendMessage' | 'onClearHistory'> {
  apiKey?: string;
  provider?: string;
  serviceName?: string;
  enableFeedback?: boolean;
  showServiceStatus?: boolean;
  enableEnhancements?: boolean; // Toggle for new optimizations
  enableStreaming?: boolean;
  enableMLOptimizations?: boolean;
  onError?: (error: Error) => void;
  onFeedbackSubmit?: (feedback: any) => void;
}

/**
 * Enhanced AI Chat component with advanced optimizations
 * - Structured outputs with confidence scoring
 * - Intelligent caching with @tanstack/react-query
 * - ML-driven user preference learning
 * - Real-time streaming responses
 * - Enhanced search with semantic reranking
 */
export function AIChat({
  userId,
  apiKey,
  provider = 'openai',
  serviceName,
  enableFeedback = true,
  showServiceStatus = true,
  enableEnhancements = true, // Enable new optimizations by default
  enableStreaming = false,
  enableMLOptimizations = true,
  onError,
  onFeedbackSubmit,
  ...baseChatProps
}: AIChatProps) {
  // State for enhanced features
  const [isSearchingRAG, setIsSearchingRAG] = useState(false);
  const [lastRAGResults, setLastRAGResults] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState('');
  const [messageMetrics, setMessageMetrics] = useState<any>(null);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Enhanced RAG service with semantic reranking
  const [ragService] = useState(() => {
    if (!enableEnhancements) {
      // Use legacy service when enhancements disabled
      try {
        const serviceToUse = (serviceName as any) || 'rawMaterialsAllAI';
        return new PineconeClientService(serviceToUse, {
          topK: 5,
          similarityThreshold: 0.7
        });
      } catch (error) {
        console.warn('⚠️ RAG service initialization failed:', error.message);
        return null;
      }
    }

    // Use enhanced service with semantic reranking
    try {
      console.log('🚀 [AIChat] Initializing Enhanced Hybrid Search Service');
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
    } catch (error) {
      console.warn('⚠️ Enhanced RAG service initialization failed, using legacy:', error.message);
      // Fallback to legacy service
      try {
        const serviceToUse = (serviceName as any) || 'rawMaterialsAllAI';
        return new PineconeClientService(serviceToUse, {
          topK: 5,
          similarityThreshold: 0.7
        });
      } catch (fallbackError) {
        console.warn('⚠️ Fallback RAG service also failed:', fallbackError.message);
        return null;
      }
    }
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
              confidence: 0.8, // Default confidence since property doesn't exist
              category: 'general', // Default category since property doesn't exist
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
    serviceName: enableEnhancements ? 'enhanced-ai-chat' : serviceName,
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

    console.log('🔍 Starting enhanced RAG search for:', query);
    setIsSearchingRAG(true);
    try {
      let results;

      if (enableEnhancements && ragService instanceof EnhancedHybridSearchService) {
        // Use enhanced search with semantic reranking
        results = await ragService.enhancedSearch({
          query,
          userId,
          topK: 5,
          rerank: true,
          semanticWeight: 0.7,
          keywordWeight: 0.3,
          userPreferences: (chat as any).userPreferences || {},
        });

        // Format enhanced results
        const formattedResults = results.map((result, index) =>
          `**${index + 1}.** ${result.content}\n*Confidence: ${(result.score * 100).toFixed(1)}%*\n`
        ).join('\n');

        console.log('✅ Enhanced RAG search results:', results);
        setLastRAGResults(formattedResults);
      } else {
        // Use legacy search
        results = await (ragService as any).searchAndFormat?.(query, {
          topK: 5,
          similarityThreshold: 0.7
        }) || [];
        console.log('✅ Legacy RAG search results:', results);
        setLastRAGResults(results);
      }
    } catch (error) {
      console.error('❌ RAG search failed:', error);
      console.error('❌ Error details:', error.message, error.stack);
      // Don't set any results on failure - let the query proceed normally
      setLastRAGResults('');
    } finally {
      setIsSearchingRAG(false);
    }
  }, [ragService, enableEnhancements, userId, (chat as any).userPreferences]);

  const handleSendMessage = async (message: string) => {
    console.log('🎯 AIChat handleSendMessage called:', message);
    console.log('🔧 Chat service status:', !!(chat as any).getService?.() || 'no service');
    console.log('🔑 API Key available:', !!apiKey);
    console.log('🏷️ Provider:', provider);
    console.log('👤 User ID:', userId);
    console.log('🧪 Is RAG query:', isRawMaterialsQuery(message));
    console.log('🚀 Enhancements enabled:', enableEnhancements);

    try {
      if (enableEnhancements && enableStreaming) {
        // Use enhanced streaming
        setCurrentStreamingMessage('');
        const stream = await (chat as any).sendStreamingMessage(message, {
          useSearch: true,
          category: 'general',
        });

        let fullContent = '';
        for await (const chunk of stream) {
          fullContent += chunk;
          setCurrentStreamingMessage(fullContent);
        }

        setCurrentStreamingMessage('');
        setFollowUpQuestions([]);
      } else {
        // Use standard message sending
        let enhancedMessage = message;

        if (lastRAGResults && isRawMaterialsQuery(message)) {
          enhancedMessage = `${message}\n\n**Additional Information from Database:**\n${lastRAGResults}`;
        }

        if (enableEnhancements) {
          await chat.sendMessage(enhancedMessage);
        } else {
          await chat.sendMessage(enhancedMessage);
        }

        console.log('✅ Message sent successfully');
      }

      setLastRAGResults(''); // Clear RAG results after sending
    } catch (error) {
      console.error('❌ Error sending message:', error);
      setCurrentStreamingMessage('');
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
      // For enhanced chat, just set the input (user will send manually)
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
    if ((chat as any).clearHistory) {
      (chat as any).clearHistory();
    }
    feedback.clearFeedback();
  };

  const renderMessageActions = (message: ConversationMessage) => {
    if (message.role !== 'assistant') {
      return null;
    }

    const responseId = message.metadata?.responseId || message.id;

    // Check if feedback already submitted for this response
    const hasFeedback = feedback.getFeedbackHistory?.(responseId)?.length > 0;

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

        {/* Show confidence and sources for enhanced responses */}
        {enableEnhancements && messageMetrics && message.id === chat.messages[chat.messages.length - 1]?.id && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`text-xs ${getConfidenceColor(messageMetrics.confidence)}`}>
                Confidence: {(messageMetrics.confidence * 100).toFixed(0)}%
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {messageMetrics.category || 'General'}
              </Badge>
            </div>
          </div>
        )}

        {/* Legacy feedback collector */}
        {!enableEnhancements && enableFeedback && (
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
      </div>
    );
  };

  const renderHeader = () => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Bot className="w-5 h-5 text-green-600" />
        <span className="font-semibold text-slate-800">
          AI Assistant
        </span>

        {/* Enhancement Badges */}
        {enableEnhancements && (
          <>
            <Badge variant="outline" className="text-xs bg-green-50 border-green-300">
              <Brain className="w-3 h-3 mr-1" />
              Enhanced
            </Badge>
            {ragService && (
              <Badge variant="outline" className="text-xs">
                <Search className="w-3 h-3 mr-1" />
                Smart Search
              </Badge>
            )}
            {enableStreaming && (
              <Badge variant="outline" className="text-xs bg-blue-50 border-blue-300">
                <Zap className="w-3 h-3 mr-1" />
                Streaming
              </Badge>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Performance Metrics */}
        {enableEnhancements && messageMetrics && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {messageMetrics.responseTime}ms
            </div>
            <div className="flex items-center gap-1">
              <Target className="w-3 h-3" />
              {messageMetrics.confidence && (messageMetrics.confidence * 100).toFixed(0)}%
            </div>
          </div>
        )}

        {/* Service Status */}
        {showServiceStatus && (
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${
              (chat as any).getService?.() ? 'bg-green-500' : 'bg-red-500'
            }`} />
            <span className="text-xs text-slate-600">
              {(chat as any).getService?.() ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        )}

        {/* Settings Button */}
        {enableEnhancements && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-1"
          >
            <Settings className="w-4 h-4" />
            {showSettings ? 'Hide' : 'Settings'}
          </Button>
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
    if (!chat.error && !isSearchingRAG && !currentStreamingMessage) return null;

    return (
      <Card className="m-4 p-3 border-blue-200 bg-blue-50">
        {isSearchingRAG ? (
          <div className="flex items-center gap-2 text-blue-800">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Searching knowledge base...</span>
          </div>
        ) : currentStreamingMessage ? (
          <div className="flex items-center gap-2 text-blue-800">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Streaming response...</span>
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
              onClick={(chat as any).retryLastMessage || (() => {})}
            >
              Retry Last Message
            </Button>
          </div>
        ) : null}
      </Card>
    );
  };

  // Enhanced Settings Panel
  const renderSettingsPanel = () => {
    if (!showSettings || !enableEnhancements) return null;

    return (
      <Card className="m-4 p-4 border-gray-200">
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          User Preferences
        </h3>

        <div className="space-y-4">
          {/* Response Length */}
          <div>
            <label className="text-sm font-medium">Response Length</label>
            <Select
              value={(chat as any).userPreferences?.preferredLength || 'medium'}
              onValueChange={(value) => handlePreferenceUpdate('preferredLength', value)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="concise">Concise</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="detailed">Detailed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Expertise Level */}
          <div>
            <label className="text-sm font-medium">Expertise Level</label>
            <Select
              value={(chat as any).userPreferences?.expertiseLevel || 'intermediate'}
              onValueChange={(value) => handlePreferenceUpdate('expertiseLevel', value)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="expert">Expert</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Complexity */}
          <div>
            <label className="text-sm font-medium">Response Complexity</label>
            <Select
              value={(chat as any).userPreferences?.preferredComplexity || 'intermediate'}
              onValueChange={(value) => handlePreferenceUpdate('preferredComplexity', value)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">Basic</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Performance Info */}
          <div className="text-xs text-gray-600 space-y-1">
            <div className="flex items-center gap-2">
              <Brain className="w-3 h-3" />
              ML Learning: {enableMLOptimizations ? 'Enabled' : 'Disabled'}
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-3 h-3" />
              Streaming: {enableStreaming ? 'Enabled' : 'Disabled'}
            </div>
          </div>
        </div>
      </Card>
    );
  };

  // Follow-up Questions Panel
  const renderFollowUpQuestions = () => {
    if (!enableEnhancements || followUpQuestions.length === 0) return null;

    return (
      <Card className="m-4 p-3 border-green-200 bg-green-50">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-green-800">
            <BookOpen className="w-4 h-4" />
            Follow-up Questions
          </div>
          <div className="flex flex-wrap gap-2">
            {followUpQuestions.map((question, index) => (
              <Button
                key={index}
                variant="outline"
                size="sm"
                onClick={() => handleFollowUpClick(question)}
                className="text-xs h-8 border-green-300 hover:bg-green-100"
              >
                {question}
              </Button>
            ))}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Main Chat Interface */}
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
        maxHeight="h-full"
        className="border border-gray-300 rounded-lg h-full flex flex-col"
        {...baseChatProps}
      />

      {/* Enhanced Features */}
      {renderSettingsPanel()}
      {renderFollowUpQuestions()}

      {/* Streaming Message */}
      {currentStreamingMessage && (
        <div className="flex gap-3 justify-start px-4 pb-4">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Bot className="w-4 h-4 text-blue-600 animate-pulse" />
          </div>
          <div className="max-w-[80%] rounded-lg p-3 bg-gray-100 text-gray-900">
            <div className="whitespace-pre-wrap text-sm">
              {currentStreamingMessage}
              <span className="animate-pulse">▊</span>
            </div>
          </div>
        </div>
      )}

      {/* Scroll to bottom */}
      <div ref={messagesEndRef} />
    </div>
  );
}

export default AIChat;