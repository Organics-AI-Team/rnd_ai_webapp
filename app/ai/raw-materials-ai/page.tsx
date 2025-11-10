'use client';

import React, { useState } from 'react';
import { Package, Search, Brain } from 'lucide-react';
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
 * Raw Materials AI Page
 *
 * AI assistant specialized in raw materials, ingredients, formulation guidance,
 * and regulatory information for the cosmetics industry.
 *
 * Features:
 * - Gemini 2.0 Flash AI with tool calling
 * - RAG-enhanced responses with database search
 * - User feedback collection
 * - Real-time confidence scoring
 * - Separated rendering for all UI components
 * - No hardcoded HTML - fully component-based
 */

export default function RawMaterialsAIPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<Set<string>>(new Set());
  const [inputAreaHeight, setInputAreaHeight] = useState<number>(0);

  /**
   * Sends user message to AI and processes response
   * Uses Gemini 2.0 Flash with tool calling for enhanced accuracy
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
      const response = await fetch('/api/ai/raw-materials-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: input,
          userId: user?.id || 'anonymous',
          conversationHistory: messages.map(m => ({
            role: m.role,
            content: m.content
          })),
          enableEnhancements: true,     // ✅ Enable enhanced features for tool calling
          enableStreaming: false,        // Keep disabled for stability
          enableMLOptimizations: true,   // ✅ Enable ML personalization
          enableSearch: true             // ✅ CRITICAL: Enable database search and tool calls
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      const data = await response.json();

      const assistant_message: Message = {
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

      setMessages(prev => [...prev, assistant_message]);
    } catch (error) {
      console.error('Error sending message:', error);

      const error_message: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error while searching the database. Please try again later.',
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
        icon={<Package className="w-16 h-16" />}
        title="กรุณาเข้าสู่ระบบเพื่อใช้ผู้ช่วย AI สำหรับวัตถุดิบ"
        description="คุณต้องได้รับการยืนยันตัวตนเพื่อเข้าถึงผู้ช่วย AI ที่เชี่ยวชาญด้านวัตถุดิบและส่วนผสมในอุตสาหกรรมเครื่องสำอาง"
      />
    );
  }

  return (
    <div className="container mx-auto px-6 pt-6 pb-2 h-[calc(100vh-8rem)]">
      <div className="flex flex-col h-full gap-2">
        {/* Header Section - Component */}
        <AIPageHeader
          icon={<Package className="w-8 h-8" />}
          title="Raw Materials AI Assistant"
          description="Ingredient research, formulation guidance, and regulatory information"
          iconColor="text-blue-600"
        />

        {/* Messages Container - Separate Component with overflow constraint */}
        <div className="flex-1 min-h-0 flex flex-col relative">
          <AIChatMessagesContainer
            header={
              <AIChatHeader
                icon={<Brain className="w-5 h-5" />}
                title="Raw Materials AI Chat"
                iconColor="text-blue-600"
                badgeText="RAG Enhanced"
                badgeColor="bg-green-50 border-green-300"
              />
            }
            messagesArea={
              <AIChatMessagesArea
                messages={messages}
                isLoading={isLoading}
                themeColor="blue"
                emptyStateIcon={<Package className="w-12 h-12" />}
                emptyStateGreeting="Hello! I'm your Raw Materials AI assistant. Ask me about:"
                emptyStateSuggestions={[
                  'Raw materials and ingredients',
                  'Formulation guidance',
                  'Regulatory compliance (FDA)',
                  'Supplier information',
                  'Material safety and usage'
                ]}
                loadingMessage="Searching database..."
                metadataIcon={<Search className="w-3 h-3" />}
                metadataLabel="Database Enhanced"
                inputAreaHeight={inputAreaHeight}
                bottomPadding={8}
              />
            }
          />

          {/* Input Container - Sticky at bottom within scroll context */}
          <AIChatInputContainer
            inputArea={
              <AIChatInputArea
                input={input}
                onInputChange={setInput}
                onSend={handle_send_message}
                placeholder="Ask about raw materials, ingredients, formulations, or regulatory information..."
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
    </div>
  );
}
