'use client';

import React, { useState, useCallback } from 'react';
import { TrendingUp, BarChart3, Brain } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { use_chat_threads } from '@/hooks/use_chat_threads';
import {
  AIPageHeader,
  AIChatHeader,
  AIChatMessagesContainer,
  AIChatInputContainer,
  AIChatMessagesArea,
  AIChatInputArea,
  AIAuthGuard,
  AIChatSidebar,
  AIChatLayout,
  SidebarToggleButton,
  type Message,
} from '@/components/ai';

/**
 * Sales R&D AI Page
 *
 * AI assistant specialized in sales strategies, market intelligence,
 * business development, and revenue optimization for the cosmetics industry.
 *
 * Features:
 * - Persistent conversation threads linked to organization
 * - Toggleable history sidebar with date-grouped threads
 * - Enhanced AI with RAG search for sales context
 * - Market intelligence and competitive analysis
 * - User feedback collection
 * - Thai language support
 */

export default function SalesRndAIPage() {
  const { user } = useAuth();
  const chat = use_chat_threads('sales_rnd_ai');

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<Set<string>>(new Set());
  const [inputAreaHeight, setInputAreaHeight] = useState<number>(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  /**
   * Convert persistent ChatMessages to the Message type expected by UI components.
   *
   * @returns Array of Message objects for rendering
   */
  const display_messages: Message[] = chat.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: new Date(m.createdAt),
    metadata: m.metadata || undefined,
  }));

  /**
   * Sends user message to AI and processes response.
   * Persists both user and assistant messages to the active thread.
   */
  const handle_send_message = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const user_input = input;
    setInput('');
    setIsLoading(true);

    console.log('[SalesRndAI] handle_send_message — start');

    // Persist user message (creates thread if needed)
    await chat.add_message('user', user_input);

    try {
      const response = await fetch('/api/ai/enhanced-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: user_input,
          userId: user?.id,
          context: {
            category: 'sales-rnd-ai',
            useSearch: true,
            preferences: {
              expertiseLevel: 'professional',
              language: 'thai',
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      const data = await response.json();
      const ai_content = data.data?.response || 'Sorry, I could not process your request at the moment.';
      const ai_metadata = {
        sources: data.data?.sources || [],
        confidence: data.data?.confidence || 0.5,
        ragUsed: data.performance?.searchPerformed || false,
        responseTime: data.performance?.responseTime || 0,
      };

      // Persist assistant message
      await chat.add_message('assistant', ai_content, ai_metadata);

      console.log('[SalesRndAI] handle_send_message — done');
    } catch (error) {
      console.error('[SalesRndAI] handle_send_message — error', error);
      await chat.add_message(
        'assistant',
        'Sorry, I encountered an error while processing your request. Please try again later.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, user, chat]);

  /**
   * Submits user feedback for ML preference learning.
   *
   * @param messageId  - The message ID being rated
   * @param isPositive - Whether the feedback is positive
   */
  const handle_feedback = async (messageId: string, isPositive: boolean) => {
    if (feedbackSubmitted.has(messageId)) return;

    try {
      const response = await fetch('/api/ai/enhanced-chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          feedback: {
            messageId,
            type: isPositive ? 'positive' : 'negative',
            score: isPositive ? 5 : 2,
            timestamp: new Date(),
          },
        }),
      });

      if (response.ok) {
        setFeedbackSubmitted((prev) => new Set([...prev, messageId]));
      }
    } catch (error) {
      console.error('[SalesRndAI] handle_feedback — error', error);
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
    <div className="container mx-auto px-6 pt-2 pb-1 h-[calc(100vh-1rem)]">
      <div className="flex flex-col h-full gap-1">
        {/* Header Section */}
        <AIPageHeader
          icon={<TrendingUp className="w-8 h-8" />}
          title="Sales R&D AI Assistant"
          description="Sales strategies, market intelligence, and business development"
          iconColor="text-purple-600"
        />

        {/* Chat Layout with Sidebar */}
        <div className="flex-1 min-h-0">
          <AIChatLayout
            is_sidebar_open={isSidebarOpen}
            on_toggle_sidebar={() => setIsSidebarOpen((prev) => !prev)}
            sidebar={
              <AIChatSidebar
                threads={chat.threads}
                active_thread_id={chat.active_thread?.id || null}
                loading={chat.threads_loading}
                on_select={chat.select_thread}
                on_new_chat={chat.start_new_chat}
                on_archive={chat.archive_thread}
                is_new_chat={chat.is_new_chat}
                theme_color="purple"
              />
            }
          >
            {/* Chat Messages + Input */}
            <div className="flex-1 min-h-0 flex flex-col">
              <AIChatMessagesContainer
                header={
                  <div className="flex items-center gap-2">
                    <SidebarToggleButton
                      is_open={isSidebarOpen}
                      on_toggle={() => setIsSidebarOpen((prev) => !prev)}
                    />
                    <AIChatHeader
                      icon={<Brain className="w-5 h-5" />}
                      title={chat.active_thread?.title || 'Sales R&D AI Chat'}
                      iconColor="text-purple-600"
                      badgeText="Market Enhanced"
                      badgeColor="bg-purple-50 border-purple-300"
                    />
                  </div>
                }
                messagesArea={
                  <AIChatMessagesArea
                    messages={display_messages}
                    isLoading={isLoading}
                    themeColor="purple"
                    emptyStateIcon={<TrendingUp className="w-12 h-12" />}
                    emptyStateGreeting="Hello! I'm your Sales R&D AI assistant. Ask me about:"
                    emptyStateSuggestions={[
                      'Sales strategies and tactics',
                      'Market trends and analysis',
                      'Business development opportunities',
                      'Revenue growth strategies',
                      'Competitive intelligence',
                    ]}
                    loadingMessage="Analyzing market data..."
                    metadataIcon={<BarChart3 className="w-3 h-3" />}
                    metadataLabel="Market Intelligence"
                    inputAreaHeight={inputAreaHeight}
                    bottomPadding={8}
                  />
                }
              />

              {/* Input Container */}
              <AIChatInputContainer
                inputArea={
                  <AIChatInputArea
                    input={input}
                    onInputChange={setInput}
                    onSend={handle_send_message}
                    placeholder="Ask about sales strategies, market trends, or business development..."
                    disabled={isLoading}
                    messages={display_messages}
                    onFeedback={handle_feedback}
                    feedbackDisabled={feedbackSubmitted}
                    showFeedback={true}
                    onHeightChange={setInputAreaHeight}
                  />
                }
              />
            </div>
          </AIChatLayout>
        </div>
      </div>
    </div>
  );
}
