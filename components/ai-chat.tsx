'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Send, Bot, User, ThumbsUp, ThumbsDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { FeedbackCollector } from './feedback-collector';
import { GeminiSimpleService } from '@/lib/gemini-simple-service';
import { HybridConversationMemoryManager } from '@/lib/hybrid-conversation-memory';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  feedbackSubmitted?: boolean;
  responseId?: string;
}

interface AIChatProps {
  userId: string;
  apiKey?: string;
  onFeedbackSubmit?: (feedback: any) => void;
}

export function AIChat({ userId, apiKey, onFeedbackSubmit }: AIChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [aiService] = useState(() =>
    apiKey ? new GeminiSimpleService(apiKey) : null
  );
  const [memoryManager] = useState(() => new HybridConversationMemoryManager(userId));

  // Load conversation history on mount and sync with MongoDB
  useEffect(() => {
    if (userId) {
      memoryManager.setUserId(userId);
      memoryManager.syncWithMongoDB().then(() => {
        memoryManager.getConversationHistory(userId).then(history => {
          setMessages(history);
        });
      });
    }
  }, [userId, memoryManager]);

  const handleSendMessage = useCallback(async () => {
    if (!input.trim() || !aiService || isLoading) return;

    const userMessage: Message = {
      id: `user_${Date.now()}`,
      content: input.trim(),
      role: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    await memoryManager.addMessage(userId, userMessage);
    setInput('');
    setIsLoading(true);

    try {
      // Get conversation history for context (last 40 messages)
      const recentMessages = await memoryManager.getFormattedHistory(userId, 40);

      // Generate AI response
      const aiResponse = await aiService.generateResponse({
        prompt: input.trim(),
        userId,
        context: {
          previousResponses: messages
            .filter(m => m.role === 'assistant')
            .map(m => m.content)
            .slice(-3), // Last 3 AI responses for context
          conversationHistory: messages.map(m => ({
            role: m.role,
            content: m.content
          })),
          recentMessages: recentMessages // Full conversation memory
        }
      });

      const assistantMessage: Message = {
        id: aiResponse.id,
        content: aiResponse.response,
        role: 'assistant',
        timestamp: aiResponse.timestamp,
        responseId: aiResponse.id
      };

      setMessages(prev => [...prev, assistantMessage]);
      await memoryManager.addMessage(userId, assistantMessage);

    } catch (error) {
      console.error('Error generating response:', error);

      const errorMessage: Message = {
        id: `error_${Date.now()}`,
        content: 'ขออภัย ฉันพบข้อผิดพลาดในการสร้างคำตอบ กรุณาลองใหม่อีกครั้ง',
        role: 'assistant',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, errorMessage]);
      await memoryManager.addMessage(userId, errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [input, aiService, isLoading, userId, memoryManager]);

  const handleFeedbackSubmit = useCallback(async (messageId: string, feedback: any) => {
    if (!aiService) return;

    const message = messages.find(m => m.id === messageId);
    if (!message || !message.responseId) return;

    try {
      // Create feedback object (only include required fields)
      const feedbackData = {
        responseId: message.responseId,
        type: feedback.type as any,
        score: feedback.score,
        comment: feedback.comment || '',
        prompt: messages[messages.indexOf(message) - 1]?.content || '',
        aiResponse: message.content,
        aiModel: 'gemini-2.0-flash-exp'
      };

      // Submit feedback via callback
      await onFeedbackSubmit(feedbackData);

      // Add feedback to AI service for learning
      aiService.addFeedback(feedbackData);

      // Mark message as having feedback submitted
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, feedbackSubmitted: true }
          : m
      ));

    } catch (error) {
      console.error('Error submitting feedback:', error);
    }
  }, [aiService, messages, onFeedbackSubmit, userId]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearHistory = useCallback(async () => {
    await memoryManager.clearConversationHistory(userId);
    setMessages([]);
  }, [userId, memoryManager]);

  // Get memory stats
  const memoryStats = memoryManager.getMemoryStats(userId);

  return (
    <div className="flex flex-col h-full max-h-screen">

      {/* Header with memory info */}
      <div className="border-b p-4 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Bot className="w-5 h-5 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">AI Assistant</span>
            {memoryStats.totalMessages > 0 && (
              <span className="text-xs text-gray-500">
                Memory: {memoryStats.totalMessages}/40 messages
              </span>
            )}
          </div>
          {memoryStats.totalMessages > 0 && (
            <Button
              onClick={handleClearHistory}
              variant="outline"
              size="sm"
              className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Clear History
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <Bot className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-2">สวัสดี! ฉันคือผู้ช่วย AI ของคุณ</p>
            <p className="text-sm mb-6">ถามอะไรก็ได้และฉันจะให้คำตอบที่เป็นประโยชน์ คุณสามารถให้คะแนนคำตอบของฉันเพื่อช่วยให้ฉันดีขึ้น!</p>

            {/* Example Questions */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-400 mb-3">ลองถาม:</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  "เทรนด์การดูแลผิวใหม่ล่าสุดคืออะไร?",
                  "ฉันจะสร้างสูตรต้านริ้วรอยที่มีประสิทธิภาพได้อย่างไร?",
                  "ส่วนผสมใดที่เหมาะกับผิวบอบบางที่สุด?",
                  "คุณสามารถอธิบายวิทยาศาสตร์เบื่องหลังไฮยาลูรอนิกแอซิดได้ไหม?",
                  "ฉันควรใช้ผลิตภัณฑ์ดูแลผิวซ้ำซ้อนกันอย่างไร?"
                ].map((question, index) => (
                  <button
                    key={index}
                    onClick={() => setInput(question)}
                    className="px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-colors text-left max-w-xs"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div className={`flex items-start space-x-2 max-w-[80%] ${
                message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
              }`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {message.role === 'user' ? (
                    <User className="w-4 h-4" />
                  ) : (
                    <Bot className="w-4 h-4" />
                  )}
                </div>
                <div className={`rounded-lg p-3 ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}>
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <div className={`text-xs mt-1 ${
                    message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                  }`}>
                    {message.timestamp.toLocaleTimeString()}
                  </div>
                  {message.role === 'assistant' && message.responseId && !message.feedbackSubmitted && (
                    <FeedbackCollector
                      responseId={message.responseId}
                      aiResponse={message.content}
                      prompt={messages[messages.indexOf(message) - 1]?.content || ''}
                      model="gemini-2.5-flash"
                      onFeedbackSubmit={(feedback) =>
                        handleFeedbackSubmit(message.id, feedback)
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="flex items-start space-x-2">
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                <Bot className="w-4 h-4 text-gray-600" />
              </div>
              <div className="bg-gray-100 rounded-lg p-3">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

  
      {/* Input */}
      <div className="border-t p-4">
        <div className="flex space-x-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="ถามอะไรก็ได้..."
            className="flex-1 min-h-[40px] max-h-[120px] resize-none"
            disabled={isLoading || !aiService}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading || !aiService}
            size="icon"
            className="self-end"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        {!aiService && (
          <p className="text-xs text-red-500 mt-2">
            บริการ AI ไม่ได้กำหนดค่า กรุณาใส่คีย์ API
          </p>
        )}
      </div>
    </div>
  );
}