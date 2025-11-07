'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Package, Search, Database, FlaskConical, Send, Bot, User, ThumbsUp, ThumbsDown, Brain } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: {
    sources?: any[];
    confidence?: number;
    ragUsed?: boolean;
    responseTime?: number;
  };
}

export default function RawMaterialsAIPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchingRAG, setIsSearchingRAG] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<Set<string>>(new Set());

  const features = [
    {
      title: 'Raw Materials Database',
      description: 'Access comprehensive database of raw materials and ingredients',
      icon: <Database className="w-5 h-5 text-blue-500" />
    },
    {
      title: 'Intelligent Search',
      description: 'AI-powered search with semantic matching and filtering',
      icon: <Search className="w-5 h-5 text-green-500" />
    },
    {
      title: 'Formulation Guidance',
      description: 'Expert advice on ingredient combinations and formulations',
      icon: <FlaskConical className="w-5 h-5 text-purple-500" />
    },
    {
      title: 'Regulatory Information',
      description: 'FDA compliance and regulatory status for materials',
      icon: <Package className="w-5 h-5 text-orange-500" />
    }
  ];

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Use Raw Materials Agent API with tool calling support (Gemini + Tools)
      const response = await fetch('/api/ai/raw-materials-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: input,  // API expects 'prompt' not 'query'
          userId: user?.id || 'anonymous',
          conversationHistory: messages.map(m => ({
            role: m.role,
            content: m.content
          })),
          enableEnhancements: false,  // Don't use OpenAI enhancements
          enableStreaming: false,
          enableMLOptimizations: false,
          enableSearch: false  // Tools will handle search
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || 'Sorry, I could not process your request at the moment.',
        timestamp: new Date(),
        metadata: {
          sources: data.searchResults || [],
          confidence: data.metadata?.confidence || 0.8,
          ragUsed: data.features?.searchEnabled || false,
          responseTime: data.metadata?.latency || 0
        }
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error while searching the database. Please try again later.',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedback = async (messageId: string, isPositive: boolean) => {
    if (feedbackSubmitted.has(messageId)) return;

    try {
      // Simple feedback API call
      const response = await fetch('/api/ai/enhanced-chat', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user?.id,
          feedback: {
            messageId,
            type: isPositive ? 'positive' : 'negative',
            score: isPositive ? 5 : 2,
            timestamp: new Date()
          }
        }),
      });

      if (response.ok) {
        setFeedbackSubmitted(prev => new Set([...prev, messageId]));
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h2 className="text-xl font-semibold mb-2">กรุณาเข้าสู่ระบบเพื่อใช้ผู้ช่วย AI สำหรับวัตถุดิบ</h2>
          <p className="text-gray-600">คุณต้องได้รับการยืนยันตัวตนเพื่อเข้าถึงผู้ช่วย AI ที่เชี่ยวชาญด้านวัตถุดิบและส่วนผสมในอุตสาหกรรมเครื่องสำอาง</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 h-[calc(100vh-8rem)]">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Package className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Raw Materials AI Assistant</h1>
              <p className="text-gray-600">Ingredient research, formulation guidance, and regulatory information</p>
            </div>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {features.map((feature, index) => (
              <Card key={index} className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  {feature.icon}
                  <h3 className="font-semibold text-sm">{feature.title}</h3>
                </div>
                <p className="text-xs text-gray-600">{feature.description}</p>
              </Card>
            ))}
          </div>
        </div>

        {/* Chat Container */}
        <Card className="flex-1 flex flex-col">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-blue-600" />
              Raw Materials AI Chat
              <Badge variant="outline" className="text-xs bg-green-50 border-green-300">
                RAG Enhanced
              </Badge>
            </CardTitle>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col p-0">
            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center py-8">
                    <Package className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p className="text-gray-500">Hello! I'm your Raw Materials AI assistant. Ask me about:</p>
                    <div className="mt-4 text-sm text-gray-400">
                      <p>• Raw materials and ingredients</p>
                      <p>• Formulation guidance</p>
                      <p>• Regulatory compliance (FDA)</p>
                      <p>• Supplier information</p>
                      <p>• Material safety and usage</p>
                    </div>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex items-start gap-3 ${
                        message.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {message.role === 'assistant' && (
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <Brain className="w-4 h-4 text-blue-600" />
                        </div>
                      )}
                      <div
                        className={`max-w-[70%] rounded-lg p-3 ${
                          message.role === 'user'
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}
                      >
                        <p className="text-sm">{message.content}</p>

                        {/* Enhanced features metadata */}
                        {message.role === 'assistant' && message.metadata && (
                          <div className="mt-2 space-y-1">
                            {message.metadata.ragUsed && (
                              <Badge variant="secondary" className="text-xs bg-blue-50 border-blue-300">
                                <Search className="w-3 h-3 mr-1" />
                                Database Enhanced
                              </Badge>
                            )}
                            {message.metadata.confidence && (
                              <div className="text-xs text-gray-500">
                                Confidence: {(message.metadata.confidence * 100).toFixed(0)}%
                              </div>
                            )}
                          </div>
                        )}

                        <p className={`text-xs mt-1 ${
                          message.role === 'user' ? 'text-green-100' : 'text-gray-500'
                        }`}>
                          {message.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                      {message.role === 'user' && (
                        <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                          <User className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </div>
                  ))
                )}
                {isLoading && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Brain className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="bg-gray-100 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                        </div>
                        <span className="text-sm text-gray-600">Searching database...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Feedback buttons for last assistant message */}
            {messages.length > 0 && messages[messages.length - 1].role === 'assistant' && (
              <div className="px-4 py-2 border-t flex items-center gap-2">
                <span className="text-xs text-gray-500">Was this helpful?</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleFeedback(messages[messages.length - 1].id, true)}
                  disabled={feedbackSubmitted.has(messages[messages.length - 1].id)}
                  className="h-6 px-2 text-xs"
                >
                  <ThumbsUp className="w-3 h-3 mr-1" />
                  Yes
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleFeedback(messages[messages.length - 1].id, false)}
                  disabled={feedbackSubmitted.has(messages[messages.length - 1].id)}
                  className="h-6 px-2 text-xs"
                >
                  <ThumbsDown className="w-3 h-3 mr-1" />
                  No
                </Button>
              </div>
            )}

            {/* Input */}
            <div className="p-4 border-t">
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about raw materials, ingredients, formulations, or regulatory information..."
                  className="flex-1 min-h-[60px] resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!input.trim() || isLoading}
                  className="px-4"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}