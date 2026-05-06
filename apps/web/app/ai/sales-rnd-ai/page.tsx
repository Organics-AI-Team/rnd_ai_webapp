'use client';

import React, { Suspense, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { TrendingUp, BarChart3 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { use_chat_threads } from '@/hooks/use_chat_threads';
import {
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

const THAI_CHAR_REGEX = /[\u0E00-\u0E7F]/;

function get_error_message(user_input: string): string {
  if (!THAI_CHAR_REGEX.test(user_input)) {
    return 'Sorry, I encountered an error while processing your request. Please try again later.';
  }

  return 'ขออภัย ระบบประมวลผลคำขอไม่สำเร็จในรอบนี้ กรุณาลองใหม่อีกครั้ง หรือระบุเงื่อนไขให้แคบลง';
}

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

function SalesRndAIPageContent() {
  const { user } = useAuth();
  const search_params = useSearchParams();
  const thread_param = search_params.get('thread');
  const chat = use_chat_threads('sales_rnd_ai', thread_param);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<Set<string>>(new Set());
  const [inputAreaHeight, setInputAreaHeight] = useState<number>(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth >= 1024;
    return true;
  });

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
      // 60s timeout to prevent hanging requests
      const abort_controller = new AbortController();
      const timeout_id = setTimeout(() => abort_controller.abort(), 60000);

      const response = await fetch('/api/ai/enhanced-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort_controller.signal,
        body: JSON.stringify({
          prompt: user_input,
          userId: user?.id,
          organizationId: user?.organizationId,
          sessionId: chat.active_thread?.id || undefined,
          conversationHistory: chat.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
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
      clearTimeout(timeout_id);

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      const data = await response.json();
      const artifacts = data.data?.metadata?.artifacts;
      const ai_content = data.data?.response || (
        THAI_CHAR_REGEX.test(user_input)
          ? 'ขออภัย ระบบยังประมวลผลคำขอนี้ไม่สำเร็จ'
          : 'Sorry, I could not process your request at the moment.'
      );
      const ai_metadata = {
        sources: data.data?.sources || artifacts?.citations || [],
        confidence: data.data?.confidence || 0.5,
        ragUsed: data.performance?.searchPerformed || false,
        responseTime: data.performance?.responseTime || 0,
        toolCalls: data.data?.metadata?.toolCalls || [],
        processSteps: artifacts?.processSteps || [],
        formula: artifacts?.formula,
        citations: artifacts?.citations || [],
        quickActions: artifacts?.quickActions || [],
        language: artifacts?.language,
      };

      // Persist assistant message
      await chat.add_message('assistant', ai_content, ai_metadata);

      console.log('[SalesRndAI] handle_send_message — done');
    } catch (error) {
      console.error('[SalesRndAI] handle_send_message — error', error);
      await chat.add_message(
        'assistant',
        get_error_message(user_input),
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
    <div className="h-[calc(100vh-0.5rem)] p-2 lg:p-3">
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
        <div className="flex-1 min-h-0 flex flex-col">
          <AIChatMessagesContainer
            header={
              <AIChatHeader
                title={chat.active_thread?.title || 'Sales R&D AI'}
                badgeText="Market"
                leading={
                  <SidebarToggleButton
                    is_open={isSidebarOpen}
                    on_toggle={() => setIsSidebarOpen((prev) => !prev)}
                  />
                }
              />
            }
            messagesArea={
              <AIChatMessagesArea
                messages={display_messages}
                isLoading={isLoading}
                themeColor="purple"
                emptyStateIcon={<TrendingUp className="w-10 h-10" />}
                emptyStateGreeting="ถามเรื่องตลาด การขาย หรือสูตรที่ต้องใช้ฐานข้อมูลวัตถุดิบ"
                emptyStateSuggestions={[
                  'วิเคราะห์เทรนด์ตลาดกันแดดตอนนี้',
                  'ช่วยทำสูตร SPF 50 PA++++ เนื้อเบาไม่เหนียว',
                  'เปรียบเทียบราคาคู่แข่งกลุ่ม anti-aging',
                  'ทำแผนเพิ่มยอดขาย Q2',
                  'หาโอกาส B2B ใหม่สำหรับวัตถุดิบ',
                ]}
                onSuggestionClick={(s) => setInput(s)}
                onQuickAction={(prompt) => setInput(prompt)}
                loadingMessage="กำลังวิเคราะห์..."
                metadataIcon={<BarChart3 className="w-3 h-3" />}
                metadataLabel="Market"
                inputAreaHeight={inputAreaHeight}
                bottomPadding={8}
                onFeedback={handle_feedback}
                feedbackSubmitted={feedbackSubmitted}
              />
            }
          />

          <AIChatInputContainer
            inputArea={
              <AIChatInputArea
                input={input}
                onInputChange={setInput}
                onSend={handle_send_message}
                placeholder="ถามเรื่องตลาด การขาย หรือสูตรที่ต้องใช้ฐานข้อมูลวัตถุดิบ..."
                disabled={isLoading}
                onHeightChange={setInputAreaHeight}
              />
            }
          />
        </div>
      </AIChatLayout>
    </div>
  );
}

export default function SalesRndAIPage() {
  return (
    <Suspense fallback={null}>
      <SalesRndAIPageContent />
    </Suspense>
  );
}
