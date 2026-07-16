'use client';

import React, { Suspense, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Package, Search } from 'lucide-react';
import { useAuth } from "@/lib/app-auth";
import { useChatThreads } from '@/hooks/use_chat_threads';
import { useAgentRun } from '@/hooks/use_agent_run';
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
  AiRunView,
  type Message,
} from '@/components/ai';

const THAI_CHAR_REGEX = /[\u0E00-\u0E7F]/;

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
  const chat = useChatThreads('raw_materials_ai', thread_param);
  const agent_run = useAgentRun();

  const [input, setInput] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<Set<string>>(new Set());
  const [inputAreaHeight, setInputAreaHeight] = useState<number>(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth >= 1024;
    return true;
  });
  const isLoading = agent_run.is_starting || agent_run.is_streaming;

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
   * Persist a user turn, then start the governed run for that concrete thread.
   */
  const handle_send_message = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const user_input = input;
    setInput('');
    console.log('[RawMaterialsAI] handle_send_message — start');
    const added_message = await chat.add_message('user', user_input);
    if (!added_message) return;
    await agent_run.start_run({
      thread_id: added_message.thread_id,
      agent_key: 'raw_material_research',
      message: user_input,
      attachment_source_ids: [],
      response_preferences: {
        language: THAI_CHAR_REGEX.test(user_input) ? 'th' : 'en',
        detail: 'standard',
      },
    });
    console.log('[RawMaterialsAI] handle_send_message — governed run requested');
  }, [input, isLoading, chat, agent_run]);

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
            on_select={(thread_id) => {
              agent_run.reset_run();
              chat.select_thread(thread_id);
            }}
            on_new_chat={() => {
              agent_run.reset_run();
              chat.start_new_chat();
            }}
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
                runContent={
                  <AiRunView
                    state={agent_run.state}
                    client_error={agent_run.client_error}
                    is_streaming={agent_run.is_streaming}
                    is_resuming={agent_run.is_resuming}
                    is_manager={user.role === 'admin'}
                    on_clarification={agent_run.submit_clarification}
                    on_approval={agent_run.submit_approval}
                    on_cancel_stream={agent_run.cancel_stream}
                  />
                }
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
