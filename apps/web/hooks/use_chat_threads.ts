/**
 * use_chat_threads Hook
 *
 * Manages durable conversation threads without treating the most recent
 * conversation as the default screen. A blank AI page is always a new draft;
 * historical conversations are opened only when the user explicitly chooses one.
 */

'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { trpc } from '@/lib/trpc-client';

/** New chat threads always use the one unified R&D agent. */
export type AgentType = 'rnd_ai';

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
  threads: ChatThread[];
  threads_loading: boolean;
  active_thread_id: string | null;
  active_thread: ChatThread | null;
  messages: ChatMessage[];
  messages_loading: boolean;
  select_thread: (thread_id: string) => void;
  start_new_chat: () => void;
  add_message: (role: 'user' | 'assistant', content: string, metadata?: any) => Promise<ChatMessage | null>;
  update_message_metadata: (message_id: string, metadata: any) => Promise<boolean>;
  archive_thread: (thread_id: string) => Promise<void>;
  refresh_threads: () => void;
  is_new_chat: boolean;
}

function to_chat_message(message: any): ChatMessage {
  return {
    id: message.id,
    threadId: message.threadId,
    role: message.role as 'user' | 'assistant',
    content: message.content,
    metadata: message.metadata ?? undefined,
    createdAt: new Date(message.createdAt),
  };
}

/**
 * @param agent_type        Agent that owns the thread list.
 * @param initial_thread_id Explicit history item from `?thread=` only.
 */
export function use_chat_threads(
  agent_type: AgentType,
  initial_thread_id?: string | null,
  new_chat_key?: string | null,
): UseChatThreadsReturn {
  const [active_thread_id, set_active_thread_id] = useState<string | null>(initial_thread_id ?? null);
  const [is_new_chat, set_is_new_chat] = useState(!initial_thread_id);
  const [pending_messages, set_pending_messages] = useState<ChatMessage[]>([]);
  const active_thread_id_ref = useRef<string | null>(initial_thread_id ?? null);
  const pending_thread_ref = useRef<string | null>(null);
  const last_requested_thread_id_ref = useRef<string | null>(initial_thread_id ?? null);
  const last_new_chat_key_ref = useRef<string | null>(new_chat_key ?? null);
  const utils = trpc.useUtils();

  const threads_query = trpc.chatThreads.list.useQuery(
    { agentType: agent_type, limit: 30 },
    { refetchOnWindowFocus: false },
  );

  const messages_query = trpc.chatThreads.getMessages.useQuery(
    { threadId: active_thread_id || '', limit: 50 },
    { enabled: Boolean(active_thread_id), refetchOnWindowFocus: false },
  );

  const create_mutation = trpc.chatThreads.create.useMutation();
  const add_message_mutation = trpc.chatThreads.addMessage.useMutation();
  const update_metadata_mutation = trpc.chatThreads.updateMessageMetadata.useMutation();
  const archive_mutation = trpc.chatThreads.archive.useMutation();

  useEffect(() => {
    active_thread_id_ref.current = active_thread_id;
  }, [active_thread_id]);

  const start_new_chat = useCallback(() => {
    active_thread_id_ref.current = null;
    pending_thread_ref.current = null;
    set_active_thread_id(null);
    set_is_new_chat(true);
    set_pending_messages([]);
  }, []);

  /** Keep `?thread=` navigation explicit, including in-page history links. */
  useEffect(() => {
    const requested_thread_id = initial_thread_id ?? null;
    if (requested_thread_id === last_requested_thread_id_ref.current) return;

    last_requested_thread_id_ref.current = requested_thread_id;
    if (!requested_thread_id) {
      start_new_chat();
      return;
    }

    active_thread_id_ref.current = requested_thread_id;
    pending_thread_ref.current = null;
    set_active_thread_id(requested_thread_id);
    set_is_new_chat(false);
    set_pending_messages([]);
  }, [initial_thread_id, start_new_chat]);

  /** A navigation click on an AI item deliberately starts a fresh draft. */
  useEffect(() => {
    const requested_new_chat_key = new_chat_key ?? null;
    if (!requested_new_chat_key || requested_new_chat_key === last_new_chat_key_ref.current) return;
    last_new_chat_key_ref.current = requested_new_chat_key;
    start_new_chat();
  }, [new_chat_key, start_new_chat]);

  const server_messages = useMemo(
    () => (messages_query.data || []).map(to_chat_message),
    [messages_query.data],
  );

  /**
   * Keep saved local messages visible until the query contains their real ID.
   * This avoids the previous race where an empty/stale query removed an AI reply.
   */
  const messages = useMemo(() => {
    const server_ids = new Set(server_messages.map((message) => message.id));
    const local_messages = pending_messages.filter(
      (message) => message.threadId === active_thread_id && !server_ids.has(message.id),
    );

    return [...server_messages, ...local_messages].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );
  }, [active_thread_id, pending_messages, server_messages]);

  const select_thread = useCallback((thread_id: string) => {
    active_thread_id_ref.current = thread_id;
    pending_thread_ref.current = null;
    set_active_thread_id(thread_id);
    set_is_new_chat(false);
    set_pending_messages([]);
  }, []);

  const add_message = useCallback(async (
    role: 'user' | 'assistant',
    content: string,
  metadata?: any,
  ): Promise<ChatMessage | null> => {
    let thread_id = active_thread_id_ref.current || pending_thread_ref.current;
    let local_id: string | null = null;

    try {
      if (!thread_id) {
        const title = role === 'user'
          ? `${content.slice(0, 50)}${content.length > 50 ? '...' : ''}`
          : 'New chat';
        const thread = await create_mutation.mutateAsync({ agentType: agent_type, title });
        thread_id = thread.id;
        pending_thread_ref.current = thread.id;
        active_thread_id_ref.current = thread.id;
        set_active_thread_id(thread.id);
        set_is_new_chat(false);
      }

      const pending_message_id = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      local_id = pending_message_id;
      const optimistic_message: ChatMessage = {
        id: pending_message_id,
        threadId: thread_id,
        role,
        content,
        metadata,
        createdAt: new Date(),
      };
      set_pending_messages((current) => [...current, optimistic_message]);

      const persisted = to_chat_message(await add_message_mutation.mutateAsync({
        threadId: thread_id,
        role,
        content,
        metadata,
      }));

      // Swap the temporary ID for the server ID. It remains visible until the
      // query receives that exact record, so no reply flickers or disappears.
      set_pending_messages((current) => current.map((message) => (
        message.id === pending_message_id ? persisted : message
      )));

      await Promise.all([
        utils.chatThreads.list.invalidate({ agentType: agent_type, limit: 30 }),
        utils.chatThreads.getMessages.invalidate({ threadId: thread_id, limit: 50 }),
      ]);
      return persisted;
    } catch (error) {
      console.error('[use_chat_threads] Unable to save message', error);
      if (local_id) {
        set_pending_messages((current) => current.filter((message) => message.id !== local_id));
      }
      return null;
    }
  }, [add_message_mutation, agent_type, create_mutation, utils.chatThreads.getMessages, utils.chatThreads.list]);

  const update_message_metadata = useCallback(async (message_id: string, metadata: any): Promise<boolean> => {
    const target_thread_id = messages.find((message) => message.id === message_id)?.threadId || active_thread_id_ref.current;
    if (!target_thread_id) return false;

    try {
      await update_metadata_mutation.mutateAsync({ messageId: message_id, metadata });
      set_pending_messages((current) => current.map((message) => (
        message.id === message_id ? { ...message, metadata } : message
      )));
      await utils.chatThreads.getMessages.invalidate({ threadId: target_thread_id, limit: 50 });
      return true;
    } catch (error) {
      console.error('[use_chat_threads] Unable to update message metadata', error);
      return false;
    }
  }, [messages, update_metadata_mutation, utils.chatThreads.getMessages]);

  const archive_thread = useCallback(async (thread_id: string) => {
    try {
      await archive_mutation.mutateAsync({ threadId: thread_id });
      if (active_thread_id_ref.current === thread_id) start_new_chat();
      await utils.chatThreads.list.invalidate({ agentType: agent_type, limit: 30 });
    } catch (error) {
      console.error('[use_chat_threads] Unable to archive thread', error);
    }
  }, [agent_type, archive_mutation, start_new_chat, utils.chatThreads.list]);

  const refresh_threads = useCallback(() => {
    void utils.chatThreads.list.invalidate({ agentType: agent_type, limit: 30 });
  }, [agent_type, utils.chatThreads.list]);

  const active_thread = active_thread_id
    ? (threads_query.data || []).find((thread: any) => thread.id === active_thread_id) || null
    : null;

  return {
    threads: (threads_query.data || []) as ChatThread[],
    threads_loading: threads_query.isLoading,
    active_thread_id,
    active_thread: active_thread as ChatThread | null,
    messages,
    messages_loading: messages_query.isLoading && Boolean(active_thread_id),
    select_thread,
    start_new_chat,
    add_message,
    update_message_metadata,
    archive_thread,
    refresh_threads,
    is_new_chat,
  };
}
