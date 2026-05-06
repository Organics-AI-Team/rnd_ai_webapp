'use client';

import React, { Suspense, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Package, Search } from 'lucide-react';
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
    return 'Sorry, I encountered an error while searching the database. Please try again later.';
  }

  return 'ขออภัย ระบบค้นฐานข้อมูลไม่สำเร็จในรอบนี้ กรุณาลองใหม่อีกครั้ง หรือระบุวัตถุดิบ/ประเภทสูตรให้แคบลง';
}

/**
 * Raw Materials AI Page
 *
 * AI assistant specialized in raw materials, ingredients, formulation guidance,
 * and regulatory information for the cosmetics industry.
 *
 * Features:
 * - Persistent conversation threads linked to organization
 * - Toggleable history sidebar with date-grouped threads
 * - Gemini 3.1 Pro with ReAct agent and tool calling
 * - RAG-enhanced responses with database search
 * - User feedback collection
 * - Real-time confidence scoring
 */

function RawMaterialsAIPageContent() {
  const { user } = useAuth();
  const search_params = useSearchParams();
  const thread_param = search_params.get('thread');
  const chat = use_chat_threads('raw_materials_ai', thread_param);

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

    console.log('[RawMaterialsAI] handle_send_message — start');

    // Persist user message (creates thread if needed)
    await chat.add_message('user', user_input);

    try {
      // 60s timeout to prevent hanging requests
      const abort_controller = new AbortController();
      const timeout_id = setTimeout(() => abort_controller.abort(), 60000);

      const response = await fetch('/api/ai/raw-materials-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort_controller.signal,
        body: JSON.stringify({
          prompt: user_input,
          userId: user?.id || 'anonymous',
          organizationId: user?.organizationId,
          sessionId: chat.active_thread?.id || undefined,
          conversationHistory: chat.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          enableEnhancements: true,
          enableStreaming: false,
          enableMLOptimizations: true,
          enableSearch: true,
        }),
      });
      clearTimeout(timeout_id);

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      const data = await response.json();
      const artifacts = data.metadata?.artifacts;
      const ai_content = data.response || (
        THAI_CHAR_REGEX.test(user_input)
          ? 'ขออภัย ระบบยังประมวลผลคำขอนี้ไม่สำเร็จ'
          : 'Sorry, I could not process your request at the moment.'
      );
      const ai_metadata = {
        sources: data.searchResults || artifacts?.citations || [],
        confidence: data.metadata?.confidence || 0.5,
        ragUsed: data.features?.searchEnabled || false,
        responseTime: data.metadata?.processingTime || data.metadata?.latency || 0,
        toolCalls: data.features?.optimizationsApplied || [],
        processSteps: artifacts?.processSteps || [],
        formula: artifacts?.formula,
        citations: artifacts?.citations || [],
        quickActions: artifacts?.quickActions || [],
        language: artifacts?.language,
      };

      // Persist assistant message
      await chat.add_message('assistant', ai_content, ai_metadata);

      console.log('[RawMaterialsAI] handle_send_message — done');
    } catch (error) {
      console.error('[RawMaterialsAI] handle_send_message — error', error);
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
      console.error('[RawMaterialsAI] handle_feedback — error', error);
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
            theme_color="blue"
          />
        }
      >
        <div className="flex-1 min-h-0 flex flex-col">
          <AIChatMessagesContainer
            header={
              <AIChatHeader
                title={chat.active_thread?.title || 'Raw Materials AI'}
                badgeText="RAG"
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
                themeColor="blue"
                emptyStateIcon={<Package className="w-10 h-10" />}
                emptyStateGreeting="ถามเรื่องวัตถุดิบ ส่วนผสม หรือสูตรเครื่องสำอาง"
                emptyStateSuggestions={[
                  'ค้นวัตถุดิบเพิ่มความชุ่มชื้น',
                  'ทำสูตร anti-aging serum',
                  'หา preservative system ที่เหมาะสม',
                  'เปรียบเทียบ supplier ของ Niacinamide',
                  'เช็กข้อจำกัดการใช้ Retinol',
                ]}
                onSuggestionClick={(s) => setInput(s)}
                onQuickAction={(prompt) => setInput(prompt)}
                loadingMessage="กำลังค้นฐานข้อมูล..."
                metadataIcon={<Search className="w-3 h-3" />}
                metadataLabel="Database"
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
                placeholder="ถามเรื่องวัตถุดิบ ส่วนผสม หรือสูตรเครื่องสำอาง..."
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

export default function RawMaterialsAIPage() {
  return (
    <Suspense fallback={null}>
      <RawMaterialsAIPageContent />
    </Suspense>
  );
}
