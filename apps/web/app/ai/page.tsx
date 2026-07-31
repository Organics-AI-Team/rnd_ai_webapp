'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bot, Search, Sparkles } from 'lucide-react';

import { useAuth } from '@/lib/app-auth';
import { useChatThreads } from '@/hooks/use_chat_threads';
import { useAgentRun } from '@/hooks/use_agent_run';
import { trpc } from '@/lib/trpc-client';
import {
  AIAuthGuard,
  AIChatHeader,
  AIChatInputArea,
  AIChatInputContainer,
  AIChatLayout,
  AIChatMessagesArea,
  AIChatMessagesContainer,
  AIChatSidebar,
  AiRunView,
  SidebarToggleButton,
  type Message,
} from '@/components/ai';

const THAI_CHAR_REGEX = /[\u0E00-\u0E7F]/;

type AgentKey = 'raw_material_research' | 'formulation' | 'sales_rnd';

/**
 * Select a specialist card without making people choose a separate chat.
 * The selected card only tunes the governed run; every conversation remains
 * in the one durable R&D AI history.
 */
function select_agent_key(message: string): AgentKey {
  const normalized_message = message.toLowerCase();
  if (/(\bsales?\b|market|competitor|positioning|client|b2b|commercial|revenue|ขาย|ตลาด|คู่แข่ง|ลูกค้า|ยอดขาย|วางตำแหน่ง)/i.test(normalized_message)) {
    return 'sales_rnd';
  }
  if (/(ingredient|\binci\b|supplier|raw material|retinol|niacinamide|preservative|regulat|วัตถุดิบ|ส่วนผสม|สารสกัด|ซัพพลายเออร์|ผู้ขาย|กฎระเบียบ|ข้อกำหนด|ความเข้ากัน)/i.test(normalized_message)) {
    return 'raw_material_research';
  }
  return 'formulation';
}

interface UnifiedChatProps {
  readonly thread_id: string | null;
}

/** Render the one persistent workspace for all R&D and commercial questions. */
function UnifiedChat({ thread_id }: UnifiedChatProps) {
  const { user } = useAuth();
  const chat = useChatThreads('rnd_ai', thread_id);
  const agent_run = useAgentRun();
  const submit_feedback = trpc.feedback.submit.useMutation();

  const [input, set_input] = useState('');
  const [send_error, set_send_error] = useState<string | null>(null);
  const [feedback_error, set_feedback_error] = useState<string | null>(null);
  const [is_sending, set_is_sending] = useState(false);
  const [feedback_submitted, set_feedback_submitted] = useState<Set<string>>(new Set());
  const [input_area_height, set_input_area_height] = useState(0);
  const [is_sidebar_open, set_is_sidebar_open] = useState(() => (
    typeof window === 'undefined' || window.innerWidth >= 1024
  ));
  const is_loading = is_sending || agent_run.is_starting || agent_run.is_streaming;

  useEffect(() => {
    if (agent_run.state.status === 'completed') void chat.refresh_messages();
  }, [agent_run.state.status, chat.refresh_messages]);

  const display_messages: Message[] = chat.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: new Date(message.createdAt),
    metadata: message.metadata || undefined,
  }));

  /** Persist a turn, then route the run to the right internal R&D skill. */
  const handle_send_message = useCallback(async () => {
    if (!input.trim() || is_loading) return;

    const user_input = input.trim();
    set_is_sending(true);
    set_send_error(null);
    try {
      const added_message = await chat.add_message('user', user_input);
      set_input('');
      await agent_run.start_run({
        thread_id: added_message.thread_id,
        agent_key: select_agent_key(user_input),
        message: user_input,
        attachment_source_ids: [],
        response_preferences: {
          language: THAI_CHAR_REGEX.test(user_input) ? 'th' : 'en',
          detail: 'standard',
        },
      });
    } catch {
      set_send_error('Your message could not be saved. Please retry.');
    } finally {
      set_is_sending(false);
    }
  }, [agent_run, chat, input, is_loading]);

  /** Save message feedback against the specialist that produced the answer. */
  const handle_feedback = useCallback(async (message_id: string, is_positive: boolean) => {
    if (feedback_submitted.has(message_id)) return;

    set_feedback_error(null);
    try {
      const response_index = display_messages.findIndex((message) => message.id === message_id);
      const response = display_messages[response_index];
      const prompt = [...display_messages.slice(0, response_index)]
        .reverse()
        .find((message) => message.role === 'user');
      if (!response || response.role !== 'assistant') return;

      await submit_feedback.mutateAsync({
        responseId: message_id,
        service_name: 'rnd_ai',
        type: is_positive ? 'helpful' : 'not_helpful',
        score: is_positive ? 5 : 2,
        prompt: prompt?.content ?? '',
        aiResponse: response.content,
        aiModel: 'governed-agentic',
      });
      set_feedback_submitted((current) => new Set([...current, message_id]));
    } catch {
      set_feedback_error('Your feedback could not be saved. Please retry.');
    }
  }, [display_messages, feedback_submitted, submit_feedback]);

  if (!user) {
    return (
      <AIAuthGuard
        icon={<Bot className="h-16 w-16" />}
        title="Sign in to use R&D AI"
        description="One workspace for ingredients, formulation, market, and sales work."
      />
    );
  }

  return (
    <div className="h-[calc(100vh-0.5rem)] p-2 lg:p-3">
      <AIChatLayout
        is_sidebar_open={is_sidebar_open}
        on_toggle_sidebar={() => set_is_sidebar_open((current) => !current)}
        sidebar={
          <AIChatSidebar
            threads={chat.threads}
            active_thread_id={chat.active_thread?.id || null}
            loading={chat.threads_loading}
            on_select={(selected_thread_id) => {
              agent_run.reset_run();
              chat.select_thread(selected_thread_id);
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
        <div className="flex min-h-0 flex-1 flex-col">
          <AIChatMessagesContainer
            header={
              <AIChatHeader
                title={chat.active_thread?.title || 'R&D AI'}
                badgeText="Unified workspace"
                leading={
                  <SidebarToggleButton
                    is_open={is_sidebar_open}
                    on_toggle={() => set_is_sidebar_open((current) => !current)}
                  />
                }
              />
            }
            messagesArea={
              <AIChatMessagesArea
                messages={display_messages}
                isLoading={is_loading}
                themeColor="blue"
                emptyStateIcon={<Sparkles className="h-10 w-10" />}
                emptyStateGreeting="Ask naturally — R&D AI will handle ingredients, formulas, market, and sales work in one conversation."
                emptyStateSuggestions={[
                  'Find ingredients that improve hydration',
                  'Draft a lightweight SPF 50 serum',
                  'Improve this vitamin C serum stability',
                  'Analyze the sunscreen market opportunity',
                ]}
                onSuggestionClick={set_input}
                onQuickAction={set_input}
                loadingMessage="Planning and gathering evidence..."
                metadataIcon={<Search className="h-3 w-3" />}
                metadataLabel="R&D AI"
                inputAreaHeight={input_area_height}
                bottomPadding={8}
                onFeedback={handle_feedback}
                feedbackSubmitted={feedback_submitted}
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

          {send_error && <p role="alert" className="px-4 py-2 text-sm text-red-600">{send_error}</p>}
          {feedback_error && <p role="alert" className="px-4 py-2 text-sm text-red-600">{feedback_error}</p>}
          {chat.sync_error && <p role="status" className="px-4 py-2 text-sm text-amber-700">{chat.sync_error}</p>}

          <AIChatInputContainer
            inputArea={
              <AIChatInputArea
                input={input}
                onInputChange={set_input}
                onSend={handle_send_message}
                placeholder="Ask about ingredients, formulas, costs, market, or sales..."
                disabled={is_loading}
                onHeightChange={set_input_area_height}
              />
            }
          />
        </div>
      </AIChatLayout>
    </div>
  );
}

/** Ignore legacy mode URL parameters: all modes now share one workspace. */
function UnifiedAIAgentPageContent() {
  const search_params = useSearchParams();
  const thread_id = search_params.get('thread');

  return <UnifiedChat key={thread_id || 'default'} thread_id={thread_id} />;
}

/** The only user-facing AI entry point. */
export default function UnifiedAIAgentPage() {
  return (
    <Suspense fallback={null}>
      <UnifiedAIAgentPageContent />
    </Suspense>
  );
}
