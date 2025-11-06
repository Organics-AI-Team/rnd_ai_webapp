/**
 * Enhanced Chat Interface Component
 * Integrates all AI optimizations: structured outputs, caching, streaming, ML learning
 */

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useEnhancedChat } from '@/ai/hooks/enhanced/use-enhanced-chat';
import { StructuredResponse, EnhancedUserPreferences } from '@/ai/services/enhanced/enhanced-ai-service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Bot,
  User,
  ThumbsUp,
  ThumbsDown,
  Send,
  Settings,
  Brain,
  Zap,
  Search,
  Clock,
  Target,
  BookOpen,
  TrendingUp
} from 'lucide-react';

interface EnhancedChatProps {
  userId: string;
  apiKey: string;
  className?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  structuredData?: StructuredResponse;
  isStreaming?: boolean;
}

interface MessageMetrics {
  responseTime: number;
  confidence: number;
  cacheHit: boolean;
  searchPerformed: boolean;
  searchResultCount: number;
}

export function EnhancedChatInterface({ userId, apiKey, className }: EnhancedChatProps) {
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [messageMetrics, setMessageMetrics] = useState<MessageMetrics | null>(null);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    sendStreamingMessage,
    clearMessages,
    userPreferences,
    updateUserPreferences,
    submitFeedback,
    getRelatedQueries,
    optimisticResponse,
    cancelCurrentRequest,
  } = useEnhancedChat({
    userId,
    apiKey,
    model: 'gpt-4',
    enabled: true,
    onSuccess: (response) => {
      if (response.structuredData) {
        setFollowUpQuestions(response.structuredData.followUpQuestions || []);
      }
    },
    onError: (error) => {
      console.error('Enhanced chat error:', error);
    },
  });

  // Auto-scroll to bottom on new messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentStreamingMessage, scrollToBottom]);

  // Handle message sending
  const handleSendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const messageContent = input.trim();
    setInput('');
    setIsStreaming(true);
    setCurrentStreamingMessage('');
    setMessageMetrics(null);

    try {
      // Add optimistic response for better UX
      optimisticResponse(messageContent);

      // Send streaming message
      const stream = await sendStreamingMessage(messageContent, {
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
    } catch (error) {
      console.error('Failed to send message:', error);
      setCurrentStreamingMessage('');
    } finally {
      setIsStreaming(false);
    }
  }, [input, isLoading, sendMessage, sendStreamingMessage, optimisticResponse]);

  // Handle feedback submission
  const handleFeedback = useCallback((messageId: string, isPositive: boolean) => {
    const feedbackType = isPositive ? 'helpful' : 'not_helpful';
    const score = isPositive ? 5 : 2;

    submitFeedback(messageId, { type: feedbackType, score });
  }, [submitFeedback]);

  // Handle follow-up question click
  const handleFollowUpClick = useCallback((question: string) => {
    setInput(question);
  }, []);

  // Handle preference updates
  const handlePreferenceUpdate = useCallback((key: keyof EnhancedUserPreferences, value: any) => {
    if (userPreferences) {
      updateUserPreferences({ [key]: value });
    }
  }, [userPreferences, updateUserPreferences]);

  // Format timestamp
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Get confidence color
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.6) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-600" />
            Enhanced AI Assistant
            <Badge variant="secondary" className="text-xs">
              <Zap className="w-3 h-3 mr-1" />
              Optimized
            </Badge>
          </CardTitle>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
            >
              <Settings className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearMessages}
            >
              Clear
            </Button>
          </div>
        </div>

        {messageMetrics && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {messageMetrics.responseTime}ms
            </div>
            <div className="flex items-center gap-1">
              <Target className="w-3 h-3" />
              Confidence: {(messageMetrics.confidence * 100).toFixed(0)}%
            </div>
            {messageMetrics.cacheHit && (
              <Badge variant="secondary" className="text-xs">
                <Zap className="w-3 h-3 mr-1" />
                Cached
              </Badge>
            )}
            {messageMetrics.searchPerformed && (
              <Badge variant="outline" className="text-xs">
                <Search className="w-3 h-3 mr-1" />
                {messageMetrics.searchResultCount} results
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      {/* Settings Panel */}
      {showSettings && userPreferences && (
        <CardContent className="pb-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">User Preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Response Length</label>
                  <Select
                    value={userPreferences.preferredLength}
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

                <div>
                  <label className="text-sm font-medium">Expertise Level</label>
                  <Select
                    value={userPreferences.expertiseLevel}
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
              </div>
            </CardContent>
          </Card>
        </CardContent>
      )}

      {/* Messages Area */}
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full px-6">
          <div className="space-y-4 pb-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                )}

                <div
                  className={`max-w-[80%] rounded-lg p-3 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <div className="whitespace-pre-wrap text-sm">
                    {message.content}
                  </div>

                  {message.structuredData && (
                    <div className="mt-3 space-y-2">
                      {/* Confidence Badge */}
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-xs ${getConfidenceColor(message.structuredData.confidence)}`}
                        >
                          Confidence: {(message.structuredData.confidence * 100).toFixed(0)}%
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {message.structuredData.metadata.category}
                        </Badge>
                      </div>

                      {/* Sources */}
                      {message.structuredData.sources && message.structuredData.sources.length > 0 && (
                        <div className="text-xs">
                          <span className="font-medium">Sources: </span>
                          {message.structuredData.sources.slice(0, 3).join(', ')}
                        </div>
                      )}

                      {/* Feedback Buttons */}
                      <div className="flex items-center gap-2 pt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleFeedback(message.id, true)}
                          className="h-6 px-2 text-xs"
                        >
                          <ThumbsUp className="w-3 h-3 mr-1" />
                          Helpful
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleFeedback(message.id, false)}
                          className="h-6 px-2 text-xs"
                        >
                          <ThumbsDown className="w-3 h-3 mr-1" />
                          Not Helpful
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="text-xs opacity-70 mt-2">
                    {formatTime(message.timestamp)}
                  </div>
                </div>

                {message.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-gray-600" />
                  </div>
                )}
              </div>
            ))}

            {/* Current Streaming Message */}
            {isStreaming && currentStreamingMessage && (
              <div className="flex gap-3 justify-start">
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

            {/* Loading Indicator */}
            {isLoading && !isStreaming && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-blue-600 animate-pulse" />
                </div>
                <div className="rounded-lg p-3 bg-gray-100">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    </div>
                    Thinking...
                  </div>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="flex gap-3 justify-center">
                <div className="max-w-[80%] rounded-lg p-3 bg-red-100 text-red-900">
                  <div className="text-sm">
                    Error: {error.message}
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      </CardContent>

      {/* Follow-up Questions */}
      {followUpQuestions.length > 0 && (
        <CardContent className="pb-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
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
                  className="text-xs h-8"
                >
                  {question}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      )}

      {/* Input Area */}
      <CardContent className="pt-3">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about ingredients, formulations, regulations..."
            className="min-h-[60px] resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            disabled={isLoading}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading}
            className="self-end"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        {isLoading && (
          <Button
            variant="outline"
            size="sm"
            onClick={cancelCurrentRequest}
            className="mt-2"
          >
            Cancel Request
          </Button>
        )}
      </CardContent>
    </div>
  );
}