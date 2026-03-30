'use client';

import React, { useState, useCallback } from 'react';
import { Package, Search, Brain } from 'lucide-react';
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

export default function RawMaterialsAIPage() {
  const { user } = useAuth();
  const chat = use_chat_threads('raw_materials_ai');

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

    console.log('[RawMaterialsAI] handle_send_message — start');

    // Persist user message (creates thread if needed)
    await chat.add_message('user', user_input);

    try {
      const response = await fetch('/api/ai/raw-materials-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: user_input,
          userId: user?.id || 'anonymous',
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

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      const data = await response.json();
      const ai_content = data.response || 'Sorry, I could not process your request at the moment.';
      const ai_metadata = {
        sources: data.searchResults || [],
        confidence: data.metadata?.confidence || 0.5,
        ragUsed: data.features?.searchEnabled || false,
        responseTime: data.metadata?.latency || 0,
      };

      // Persist assistant message
      await chat.add_message('assistant', ai_content, ai_metadata);

      console.log('[RawMaterialsAI] handle_send_message — done');
    } catch (error) {
      console.error('[RawMaterialsAI] handle_send_message — error', error);
      await chat.add_message(
        'assistant',
        'Sorry, I encountered an error while searching the database. Please try again later.',
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
    <div className="container mx-auto px-6 pt-2 pb-1 h-[calc(100vh-1rem)]">
      <div className="flex flex-col h-full gap-1">
        {/* Header Section */}
        <AIPageHeader
          icon={<Package className="w-8 h-8" />}
          title="Raw Materials AI Assistant"
          description="Ingredient research, formulation guidance, and regulatory information"
          iconColor="text-blue-600"
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
                theme_color="blue"
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
                      title={chat.active_thread?.title || 'Raw Materials AI Chat'}
                      iconColor="text-blue-600"
                      badgeText="RAG Enhanced"
                      badgeColor="bg-green-50 border-green-300"
                    />
                  </div>
                }
                messagesArea={
                  <AIChatMessagesArea
                    messages={display_messages}
                    isLoading={isLoading}
                    themeColor="blue"
                    emptyStateIcon={<Package className="w-12 h-12" />}
                    emptyStateGreeting="Hello! I'm your Raw Materials AI assistant. Ask me about:"
                    emptyStateSuggestions={[
                      'Raw materials and ingredients',
                      'Formulation guidance',
                      'Regulatory compliance (FDA)',
                      'Supplier information',
                      'Material safety and usage',
                    ]}
                    loadingMessage="Searching database..."
                    metadataIcon={<Search className="w-3 h-3" />}
                    metadataLabel="Database Enhanced"
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
                    placeholder="Ask about raw materials, ingredients, formulations, or regulatory information..."
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
