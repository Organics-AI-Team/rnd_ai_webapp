'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, Bot, FlaskConical, Package, Search, TrendingUp } from 'lucide-react';

import { useAuth } from '@/lib/app-auth';
import { useChatThreads, type AgentType } from '@/hooks/use_chat_threads';
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

/** One task focus within the single R&D AI workspace. */
const AGENT_MODES = [
  {
    id: 'materials',
    label: 'Materials',
    agent_type: 'raw_materials_ai' as AgentType,
    agent_key: 'raw_material_research' as const,
    icon: Package,
    theme_color: 'blue',
    badge: 'Materials',
    placeholder: 'Ask about ingredients, suppliers, regulations, or alternatives...',
    greeting: 'Research cosmetic ingredients, supplier options, compatibility, and regulations.',
    suggestions: [
      'Find ingredients that improve hydration',
      'Compare Niacinamide suppliers',
      'Check the restrictions for Retinol',
      'Suggest a suitable preservative system',
    ],
  },
  {
    id: 'formulation',
    label: 'Formulation',
    // Formula and material research share the same durable R&D history.
    agent_type: 'raw_materials_ai' as AgentType,
    agent_key: 'formulation' as const,
    icon: FlaskConical,
    theme_color: 'blue',
    badge: 'Formulation',
    placeholder: 'Describe the product you want to formulate...',
    greeting: 'Develop formulas, improve stability, estimate costs, and prepare R&D next steps.',
    suggestions: [
      'Draft a lightweight SPF 50 serum',
      'Improve the stability of this vitamin C serum',
      'Create a gentle anti-aging night cream',
      'Reduce this formula cost without changing the feel',
    ],
  },
  {
    id: 'sales',
    label: 'Sales & Market',
    agent_type: 'sales_rnd_ai' as AgentType,
    agent_key: 'sales_rnd' as const,
    icon: TrendingUp,
    theme_color: 'purple',
    badge: 'Sales & Market',
    placeholder: 'Ask about market trends, sales strategy, or commercial opportunities...',
    greeting: 'Analyze market opportunities, build sales plans, and connect commercial needs to R&D.',
    suggestions: [
      'Analyze current sunscreen market trends',
      'Find B2B opportunities for skincare ingredients',
      'Create a Q2 sales growth plan',
      'Compare anti-aging competitor positioning',
    ],
  },
] as const;

type AgentMode = (typeof AGENT_MODES)[number];

/** Select a safe default when a legacy or malformed mode appears in the URL. */
function resolve_agent_mode(value: string | null): AgentMode {
  return AGENT_MODES.find((mode) => mode.id === value) ?? AGENT_MODES[0];
}

interface UnifiedChatProps {
  readonly mode: AgentMode;
  readonly thread_id: string | null;
}

/** Render one persistent chat history and run panel for the selected R&D focus. */
function UnifiedChat({ mode, thread_id }: UnifiedChatProps) {
  const { user } = useAuth();
  const router = useRouter();
  const chat = useChatThreads(mode.agent_type, thread_id);
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
  const ModeIcon = mode.icon;

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

  /** Persist a turn, then start the selected skill through the one run API. */
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
        agent_key: mode.agent_key,
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
  }, [agent_run, chat, input, is_loading, mode.agent_key]);

  /** Save message feedback against the agent that produced the answer. */
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
        service_name: mode.agent_key,
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
  }, [display_messages, feedback_submitted, mode.agent_key, submit_feedback]);

  /** Navigate to a new focus; each focus keeps its existing conversation history. */
  const select_mode = useCallback((next_mode: AgentMode) => {
    if (next_mode.id === mode.id) return;
    router.replace(`/ai?mode=${next_mode.id}`);
  }, [mode.id, router]);

  if (!user) {
    return (
      <AIAuthGuard
        icon={<Bot className="h-16 w-16" />}
        title="Sign in to use R&D AI"
        description="One AI workspace for material research, formulation, sales, and market work."
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
            theme_color={mode.theme_color}
          />
        }
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <AIChatMessagesContainer
            header={
              <AIChatHeader
                title={chat.active_thread?.title || 'R&D AI Agent'}
                badgeText={`Unified · ${mode.badge}`}
                leading={
                  <SidebarToggleButton
                    is_open={is_sidebar_open}
                    on_toggle={() => set_is_sidebar_open((current) => !current)}
                  />
                }
              />
            }
            messagesArea={
              <>
                <div className="border-b border-border bg-surface px-3 py-2 sm:px-4">
                  <div
                    className="flex max-w-full gap-1 overflow-x-auto"
                    role="tablist"
                    aria-label="R&D AI focus"
                  >
                    {AGENT_MODES.map((agent_mode) => {
                      const TabIcon = agent_mode.icon;
                      const is_active = agent_mode.id === mode.id;
                      return (
                        <button
                          key={agent_mode.id}
                          type="button"
                          role="tab"
                          aria-selected={is_active}
                          onClick={() => select_mode(agent_mode)}
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                            is_active
                              ? 'bg-brand text-white'
                              : 'text-muted hover:bg-subtle hover:text-ink'
                          }`}
                        >
                          <TabIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          {agent_mode.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <AIChatMessagesArea
                  messages={display_messages}
                  isLoading={is_loading}
                  themeColor={mode.theme_color}
                  emptyStateIcon={<ModeIcon className="h-10 w-10" />}
                  emptyStateGreeting={mode.greeting}
                  emptyStateSuggestions={[...mode.suggestions]}
                  onSuggestionClick={set_input}
                  onQuickAction={set_input}
                  loadingMessage="Planning and gathering evidence..."
                  metadataIcon={mode.id === 'sales' ? <BarChart3 className="h-3 w-3" /> : <Search className="h-3 w-3" />}
                  metadataLabel={mode.id === 'sales' ? 'Market' : 'R&D'}
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
              </>
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
                placeholder={mode.placeholder}
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

/** Resolve URL mode/thread before mounting a fresh focused chat workspace. */
function UnifiedAIAgentPageContent() {
  const search_params = useSearchParams();
  const mode = resolve_agent_mode(search_params.get('mode'));
  const thread_id = search_params.get('thread');

  return <UnifiedChat key={`${mode.id}:${thread_id || 'default'}`} mode={mode} thread_id={thread_id} />;
}

/** The only user-facing AI entry point. */
export default function UnifiedAIAgentPage() {
  return (
    <Suspense fallback={null}>
      <UnifiedAIAgentPageContent />
    </Suspense>
  );
}
