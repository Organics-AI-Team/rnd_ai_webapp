'use client';

import { Suspense, useCallback, useState } from 'react';
import { Bot, Loader2, Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { trpc } from '@/lib/trpc-client';
import { use_chat_threads } from '@/hooks/use_chat_threads';
import { to_formula_create_input, type GeneratedFormula } from '@/lib/ai/formula-conversion';
import {
  AIAgentSkills,
  AGENT_SKILLS,
  type AgentSkill,
  type AgentSkillId,
  AIAuthGuard,
  AIChatHeader,
  AIChatInputArea,
  AIChatInputContainer,
  AIChatLayout,
  AIChatMessagesArea,
  AIChatMessagesContainer,
  AIChatSidebar,
  SidebarToggleButton,
  type Message,
} from '@/components/ai';

const THAI_CHAR_REGEX = /[\u0E00-\u0E7F]/;

/** Return a localized fallback message when the agent request cannot complete. */
function get_error_message(user_input: string): string {
  return THAI_CHAR_REGEX.test(user_input)
    ? 'ขออภัย ระบบประมวลผลคำขอไม่สำเร็จในรอบนี้ กรุณาลองใหม่อีกครั้ง หรือระบุรายละเอียดให้แคบลง'
    : 'Sorry, I could not process your request at the moment. Please try again with more detail.';
}

/**
 * Unified R&D agent workspace for material, formulation, and commercial work.
 * The ReAct backend selects the appropriate skill and tool for each request.
 */
function UnifiedAIAgentPageContent() {
  const { user, isLoading: is_auth_loading } = useAuth();
  const router = useRouter();
  const search_params = useSearchParams();
  const thread_param = search_params.get('thread');
  const new_chat_param = search_params.get('new');
  const chat = use_chat_threads('rnd_ai', thread_param, new_chat_param);

  const [input, set_input] = useState('');
  const [active_skill_id, set_active_skill_id] = useState<AgentSkillId>('materials');
  const [is_loading, set_is_loading] = useState(false);
  const [feedback_submitted, set_feedback_submitted] = useState<Set<string>>(new Set());
  const [is_sidebar_open, set_is_sidebar_open] = useState(() => (
    typeof window === 'undefined' || window.innerWidth >= 1024
  ));
  const create_formula = trpc.formulas.create.useMutation();
  const active_skill = AGENT_SKILLS.find((skill) => skill.id === active_skill_id) || AGENT_SKILLS[0];

  const display_messages: Message[] = chat.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: new Date(message.createdAt),
    metadata: message.metadata || undefined,
  }));

  /** Change the visible task focus without changing the chat thread or agent. */
  const handle_select_skill = useCallback((skill: AgentSkill) => {
    set_active_skill_id(skill.id);
    set_input((current) => current.trim() ? current : skill.prompt);
  }, []);

  /** Close the overlay after a mobile history action, while retaining desktop history. */
  const close_mobile_sidebar = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      set_is_sidebar_open(false);
    }
  }, []);

  /** Send a user turn through the unified ReAct agent and persist its reply. */
  const handle_send_message = useCallback(async () => {
    if (!input.trim() || is_loading) return;

    const user_input = input.trim();
    set_input('');
    set_is_loading(true);
    console.log('[UnifiedAIAgent] handle_send_message — start');

    let timeout_id: ReturnType<typeof setTimeout> | undefined;
    let persisted_user_message: Awaited<ReturnType<typeof chat.add_message>> = null;

    try {
      persisted_user_message = await chat.add_message('user', user_input);
      if (!persisted_user_message) {
        set_input(user_input);
        return;
      }

      const abort_controller = new AbortController();
      timeout_id = setTimeout(() => abort_controller.abort(), 60000);
      const response = await fetch('/api/ai/rnd-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort_controller.signal,
        body: JSON.stringify({
          prompt: user_input,
          userId: user?.id || 'anonymous',
          organizationId: user?.organizationId,
          sessionId: persisted_user_message.threadId,
          persistFormula: false,
          // The API appends `prompt` as the current user turn. Supplying the
          // newly persisted message here as well produces two consecutive
          // user turns, which can break Gemini's multi-turn context.
          conversationHistory: chat.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })).slice(-30),
          enableEnhancements: true,
          enableStreaming: false,
          enableMLOptimizations: true,
          enableSearch: true,
        }),
      });
      if (!response.ok) {
        const error_body = await response.json().catch(() => null);
        throw new Error(error_body?.error || 'Failed to get AI response');
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

      await chat.add_message('assistant', ai_content, ai_metadata);
      console.log('[UnifiedAIAgent] handle_send_message — done');
    } catch (error) {
      console.error('[UnifiedAIAgent] handle_send_message — error', error);
      if (persisted_user_message) {
        await chat.add_message('assistant', get_error_message(user_input));
      } else {
        set_input(user_input);
      }
    } finally {
      if (timeout_id) clearTimeout(timeout_id);
      set_is_loading(false);
    }
  }, [chat, input, is_loading, user]);

  /** Save a structured formula preview as an editable draft in the formula library. */
  const handle_convert_formula = useCallback(async (message_id: string, formula: GeneratedFormula) => {
    const result = await create_formula.mutateAsync(to_formula_create_input(formula));
    const source_message = chat.messages.find((message) => message.id === message_id);
    await chat.update_message_metadata(message_id, {
      ...(source_message?.metadata || {}),
      formula: {
        ...formula,
        formula_id: result._id,
        formula_code: result.formulaCode,
        saved_to_db: true,
        status: 'draft',
      },
    });
    return { id: result._id, formulaCode: result.formulaCode };
  }, [chat, create_formula]);

  /** Submit message-level feedback for the unified agent's learning flow. */
  const handle_feedback = useCallback(async (message_id: string, is_positive: boolean) => {
    if (feedback_submitted.has(message_id)) return;

    try {
      const response = await fetch('/api/ai/rnd-agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          messageId: message_id,
          feedback: {
            messageId: message_id,
            type: is_positive ? 'positive' : 'negative',
            score: is_positive ? 5 : 2,
            timestamp: new Date(),
          },
        }),
      });
      if (response.ok) {
        set_feedback_submitted((current) => new Set([...current, message_id]));
      }
    } catch (error) {
      console.error('[UnifiedAIAgent] handle_feedback — error', error);
    }
  }, [feedback_submitted, user]);

  if (is_auth_loading) {
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-sm text-emerald-800/60">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
          กำลังเปิด R&D AI...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <AIAuthGuard
        icon={<Bot className="h-16 w-16" />}
        title="กรุณาเข้าสู่ระบบเพื่อใช้ R&D AI Agent"
        description="ผู้ช่วยคนเดียวสำหรับวัตถุดิบ สูตร ต้นทุน ตลาด และแผนการขาย"
      />
    );
  }

  return (
    <div className="h-full">
      <AIChatLayout
        is_sidebar_open={is_sidebar_open}
        on_toggle_sidebar={() => set_is_sidebar_open((current) => !current)}
        sidebar={
          <AIChatSidebar
            threads={chat.threads}
            active_thread_id={chat.active_thread_id}
            loading={chat.threads_loading}
            on_select={(thread_id) => {
              chat.select_thread(thread_id);
              close_mobile_sidebar();
            }}
            on_new_chat={() => {
              chat.start_new_chat();
              close_mobile_sidebar();
              router.replace('/ai');
            }}
            on_archive={chat.archive_thread}
          />
        }
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <AIChatMessagesContainer
            header={
              <AIChatHeader
                title={chat.active_thread?.title || 'R&D AI Agent'}
                badgeText={`Unified · ${active_skill.label}`}
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
                <AIAgentSkills
                  active_skill_id={active_skill_id}
                  on_select={handle_select_skill}
                />
                <AIChatMessagesArea
                  messages={display_messages}
                  isLoading={is_loading}
                  isInitialLoading={chat.messages_loading}
                  themeColor="green"
                  emptyStateIcon={<Bot className="h-10 w-10" />}
                  emptyStateGreeting={`ผู้ช่วย R&D คนเดียวสำหรับทุกงาน · ${active_skill.description}`}
                  emptyStateSuggestions={active_skill.suggestions}
                  onSuggestionClick={set_input}
                  onQuickAction={set_input}
                  onConvertFormula={handle_convert_formula}
                  loadingMessage="กำลังวางแผนและค้นหาข้อมูล..."
                  metadataIcon={<Search className="h-3 w-3" />}
                  metadataLabel="Agent"
                  bottomPadding={8}
                  onFeedback={handle_feedback}
                  feedbackSubmitted={feedback_submitted}
                />
              </>
            }
          />

          <AIChatInputContainer
            inputArea={
              <AIChatInputArea
                input={input}
                onInputChange={set_input}
                onSend={handle_send_message}
                placeholder={active_skill.placeholder}
                disabled={is_loading}
              />
            }
          />
        </div>
      </AIChatLayout>
    </div>
  );
}

/** Render search-parameter-aware unified workspace after the route is ready. */
export default function UnifiedAIAgentPage() {
  return (
    <Suspense fallback={null}>
      <UnifiedAIAgentPageContent />
    </Suspense>
  );
}
