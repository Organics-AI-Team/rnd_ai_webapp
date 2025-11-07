'use client';

import React, { useState } from 'react';
import { TrendingUp, BarChart3, Brain } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  AIPageHeader,
  AIChatHeader,
  AIChatMessagesContainer,
  AIChatInputContainer,
  AIChatMessagesArea,
  AIChatInputArea,
  AIAuthGuard,
  type Message
} from '@/components/ai';

/**
 * Sales R&D AI Page
 *
 * AI assistant specialized in sales strategies, market intelligence,
 * business development, and revenue optimization for the cosmetics industry.
 *
 * Features:
 * - Enhanced AI with RAG search for sales context
 * - Market intelligence and competitive analysis
 * - User feedback collection
 * - Thai language support
 */

export default function SalesRndAIPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<Set<string>>(new Set());
  const [inputAreaHeight, setInputAreaHeight] = useState<number>(0);

  /**
   * Sends user message to AI and processes response
   * Uses enhanced AI with RAG search for market intelligence
   */
  const handle_send_message = async () => {
    if (!input.trim() || isLoading) return;

    const user_message: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, user_message]);
    setInput('');
    setIsLoading(true);

    try {
      // Enhanced API call with RAG search
      const response = await fetch('/api/ai/enhanced-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: input,
          userId: user?.id,
          context: {
            category: 'sales-rnd-ai',
            useSearch: true, // Enable RAG search for sales context
            preferences: {
              expertiseLevel: 'professional',
              language: 'thai'
            }
          }
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      const data = await response.json();

      const assistant_message: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.data?.response || 'Sorry, I could not process your request at the moment.',
        timestamp: new Date(),
        metadata: {
          sources: data.data?.sources || [],
          confidence: data.data?.confidence || 0.8,
          ragUsed: data.performance?.searchPerformed || false,
          responseTime: data.performance?.responseTime || 0
        }
      };

      setMessages(prev => [...prev, assistant_message]);
    } catch (error) {
      console.error('Error sending message:', error);

      const error_message: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error while processing your request. Please try again later.',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, error_message]);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Submits user feedback for ML preference learning
   */
  const handle_feedback = async (messageId: string, isPositive: boolean) => {
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

  // Auth guard: Require user to be logged in
  if (!user) {
    return (
      <AIAuthGuard
        icon={<TrendingUp className="w-16 h-16" />}
        title="กรุณาเข้าสู่ระบบเพื่อใช้ผู้ช่วย AI สำหรับ Sales และ Marketing"
        description="คุณต้องได้รับการยืนยันตัวตนเพื่อเข้าถึงผู้ช่วย AI ที่เชี่ยวชาญด้านการขายและการตลาดตลายในอุตสาหกรรมวัตถุดิบ"
      />
    );
  }

  return (
    <div className="container mx-auto p-6 h-[calc(100vh-8rem)]">
      <div className="flex flex-col h-full gap-4">
        {/* Header Section - Component */}
        <AIPageHeader
          icon={<TrendingUp className="w-8 h-8" />}
          title="Sales R&D AI Assistant"
          description="Sales strategies, market intelligence, and business development"
          iconColor="text-purple-600"
        />

        {/* Messages Container - Separate Component */}
        <AIChatMessagesContainer
          header={
            <AIChatHeader
              icon={<Brain className="w-5 h-5" />}
              title="Sales R&D AI Chat"
              iconColor="text-purple-600"
              badgeText="Market Enhanced"
              badgeColor="bg-purple-50 border-purple-300"
            />
          }
          messagesArea={
            <AIChatMessagesArea
              messages={messages}
              isLoading={isLoading}
              themeColor="purple"
              emptyStateIcon={<TrendingUp className="w-12 h-12" />}
              emptyStateGreeting="Hello! I'm your Sales R&D AI assistant. Ask me about:"
              emptyStateSuggestions={[
                'Sales strategies and tactics',
                'Market trends and analysis',
                'Business development opportunities',
                'Revenue growth strategies',
                'Competitive intelligence'
              ]}
              loadingMessage="Analyzing market data..."
              metadataIcon={<BarChart3 className="w-3 h-3" />}
              metadataLabel="Market Intelligence"
              inputAreaHeight={inputAreaHeight}
              bottomPadding={16}
            />
          }
        />

        {/* Input Container - Separate Component */}
        <AIChatInputContainer
          inputArea={
            <AIChatInputArea
              input={input}
              onInputChange={setInput}
              onSend={handle_send_message}
              placeholder="Ask about sales strategies, market trends, or business development..."
              disabled={isLoading}
              messages={messages}
              onFeedback={handle_feedback}
              feedbackDisabled={feedbackSubmitted}
              showFeedback={true}
              onHeightChange={setInputAreaHeight}
            />
          }
        />
      </div>
    </div>
  );
}
