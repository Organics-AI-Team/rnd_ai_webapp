/**
 * use_chat_threads Hook
 *
 * Manages persistent chat thread state via tRPC. Provides:
 *   - Thread list (sorted by most recent)
 *   - Active thread selection
 *   - Message loading/sending with automatic thread creation
 *   - New chat / archive thread actions
 *
 * Used by both Raw Materials AI and Sales R&D AI pages.
 *
 * @param agent_type - The AI agent type ("raw_materials_ai" | "sales_rnd_ai")
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentType = 'raw_materials_ai' | 'sales_rnd_ai';

export interface ChatThread {
  id: string;
  title: string;
  agentType: string;
  messageCount: number;
  lastMessageAt: Date;
  isArchived: boolean;
  createdAt: Date;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: any;
  createdAt: Date;
}

export interface UseChatThreadsReturn {
  /** List of threads for the current agent type */
  threads: ChatThread[];
  /** Whether the thread list is loading */
  threads_loading: boolean;
  /** Currently active thread (null if no thread selected) */
  active_thread: ChatThread | null;
  /** Messages for the active thread */
  messages: ChatMessage[];
  /** Whether messages are loading */
  messages_loading: boolean;
  /** Select a thread by ID */
  select_thread: (thread_id: string) => void;
  /** Start a new chat (clears active thread; thread created on first message) */
  start_new_chat: () => void;
  /** Add a message to the active thread (creates thread if needed) */
  add_message: (role: 'user' | 'assistant', content: string, metadata?: any) => Promise<string | null>;
  /** Archive (soft delete) a thread */
  archive_thread: (thread_id: string) => Promise<void>;
  /** Refresh thread list */
  refresh_threads: () => void;
  /** Whether we're in "new chat" mode (no active thread yet) */
  is_new_chat: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook for managing persistent AI chat threads.
 *
 * @param agent_type - The AI agent type to scope threads to
 * @returns Chat thread state and actions
 */
export function use_chat_threads(agent_type: AgentType): UseChatThreadsReturn {
  const [active_thread_id, set_active_thread_id] = useState<string | null>(null);
  const [is_new_chat, set_is_new_chat] = useState(false);
  const [optimistic_messages, set_optimistic_messages] = useState<ChatMessage[]>([]);
  const pending_thread_ref = useRef<string | null>(null);

  /**
   * Ref that mirrors active_thread_id state.
   * Needed because add_message's useCallback closure captures stale state —
   * between user message (creates thread) and assistant message (same turn),
   * React hasn't re-rendered yet so the closure still sees null.
   */
  const active_thread_id_ref = useRef<string | null>(null);
  useEffect(() => {
    active_thread_id_ref.current = active_thread_id;
  }, [active_thread_id]);

  // --- tRPC queries ---
  const threads_query = trpc.chatThreads.list.useQuery(
    { agentType: agent_type, limit: 30 },
    { refetchOnWindowFocus: false },
  );

  const messages_query = trpc.chatThreads.getMessages.useQuery(
    { threadId: active_thread_id || '', limit: 50 },
    { enabled: !!active_thread_id, refetchOnWindowFocus: false },
  );

  // --- tRPC mutations ---
  const create_mutation = trpc.chatThreads.create.useMutation();
  const add_message_mutation = trpc.chatThreads.addMessage.useMutation();
  const archive_mutation = trpc.chatThreads.archive.useMutation();

  // --- Auto-select most recent thread on first load ---
  useEffect(() => {
    if (threads_query.data && threads_query.data.length > 0 && !active_thread_id && !is_new_chat) {
      set_active_thread_id(threads_query.data[0].id);
    }
  }, [threads_query.data, active_thread_id, is_new_chat]);

  // --- Clear optimistic messages when real messages load ---
  useEffect(() => {
    if (messages_query.data && active_thread_id) {
      set_optimistic_messages([]);
    }
  }, [messages_query.data, active_thread_id]);

  // --- Merge server messages with optimistic messages ---
  const merged_messages: ChatMessage[] = [
    ...(messages_query.data || []).map((m: any) => ({
      id: m.id,
      threadId: m.threadId,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      metadata: m.metadata,
      createdAt: new Date(m.createdAt),
    })),
    ...optimistic_messages,
  ];

  /**
   * Select a thread by ID and load its messages.
   *
   * @param thread_id - The thread ID to select
   */
  const select_thread = useCallback((thread_id: string) => {
    console.log('[use_chat_threads] select_thread', { thread_id });
    active_thread_id_ref.current = thread_id;
    pending_thread_ref.current = null;
    set_active_thread_id(thread_id);
    set_is_new_chat(false);
    set_optimistic_messages([]);
  }, []);

  /**
   * Start a new chat. Clears the active thread.
   * The actual thread will be created on the first message send.
   */
  const start_new_chat = useCallback(() => {
    console.log('[use_chat_threads] start_new_chat');
    active_thread_id_ref.current = null;
    pending_thread_ref.current = null;
    set_active_thread_id(null);
    set_is_new_chat(true);
    set_optimistic_messages([]);
  }, []);

  /**
   * Add a message to the active thread.
   * If no thread exists (new chat mode), creates one first using the
   * first user message as the title.
   *
   * @param role     - "user" or "assistant"
   * @param content  - Message content
   * @param metadata - Optional metadata (confidence, tools, etc.)
   * @returns The created message ID, or null on error
   */
  const add_message = useCallback(async (
    role: 'user' | 'assistant',
    content: string,
    metadata?: any,
  ): Promise<string | null> => {
    // Read from ref — NOT the stale closure — so assistant messages
    // in the same turn see the thread created by the user message.
    let thread_id = active_thread_id_ref.current || pending_thread_ref.current;
    console.log('[use_chat_threads] add_message — start', { role, has_thread: !!thread_id });

    try {
      // Create thread on first message
      if (!thread_id) {
        const title = role === 'user'
          ? content.slice(0, 50) + (content.length > 50 ? '...' : '')
          : 'New Chat';

        const new_thread = await create_mutation.mutateAsync({
          agentType: agent_type,
          title,
        });

        thread_id = new_thread.id;
        pending_thread_ref.current = thread_id;
        active_thread_id_ref.current = thread_id;
        set_active_thread_id(thread_id);
        set_is_new_chat(false);
      }

      // Add optimistic message immediately for snappy UI
      const optimistic_id = `optimistic-${Date.now()}`;
      set_optimistic_messages((prev) => [
        ...prev,
        {
          id: optimistic_id,
          threadId: thread_id!,
          role,
          content,
          metadata,
          createdAt: new Date(),
        },
      ]);

      // Persist to server
      const result = await add_message_mutation.mutateAsync({
        threadId: thread_id!,
        role,
        content,
        metadata,
      });

      // Refresh thread list to update lastMessageAt + messageCount
      threads_query.refetch();

      // Refetch messages to replace optimistic with real
      messages_query.refetch();

      console.log('[use_chat_threads] add_message — done', { messageId: result.id });
      return result.id;
    } catch (error) {
      console.error('[use_chat_threads] add_message — error', error);
      return null;
    }
  }, [agent_type, create_mutation, add_message_mutation, threads_query, messages_query]);

  /**
   * Archive (soft delete) a thread.
   * If the archived thread was active, switches to the next available thread.
   *
   * @param thread_id - The thread ID to archive
   */
  const archive_thread = useCallback(async (thread_id: string) => {
    console.log('[use_chat_threads] archive_thread', { thread_id });
    try {
      await archive_mutation.mutateAsync({ threadId: thread_id });

      if (active_thread_id === thread_id) {
        set_active_thread_id(null);
        set_is_new_chat(true);
      }

      threads_query.refetch();
    } catch (error) {
      console.error('[use_chat_threads] archive_thread — error', error);
    }
  }, [active_thread_id, archive_mutation, threads_query]);

  /**
   * Refresh the thread list.
   */
  const refresh_threads = useCallback(() => {
    console.log('[use_chat_threads] refresh_threads');
    threads_query.refetch();
  }, [threads_query]);

  // --- Find active thread object ---
  const active_thread = active_thread_id
    ? (threads_query.data || []).find((t: any) => t.id === active_thread_id) || null
    : null;

  return {
    threads: (threads_query.data || []) as ChatThread[],
    threads_loading: threads_query.isLoading,
    active_thread: active_thread as ChatThread | null,
    messages: merged_messages,
    messages_loading: messages_query.isLoading && !!active_thread_id,
    select_thread,
    start_new_chat,
    add_message,
    archive_thread,
    refresh_threads,
    is_new_chat,
  };
}
