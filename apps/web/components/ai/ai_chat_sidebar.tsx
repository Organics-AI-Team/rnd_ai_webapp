'use client';

import React, { useState } from 'react';
import { Plus, MessageSquare, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@rnd-ai/shared-utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import type { ChatThread } from '@/hooks/use_chat_threads';

/**
 * AI Chat Sidebar — Cloudflare/ChatGPT-inspired thread history panel.
 * Minimal borders, soft backgrounds, clean typography.
 *
 * @param threads          - Array of chat threads
 * @param active_thread_id - Currently selected thread ID
 * @param loading          - Whether threads are loading
 * @param on_select        - Thread selection callback
 * @param on_new_chat      - New chat callback
 * @param on_archive       - Archive callback
 * @param is_new_chat      - New-chat mode flag
 * @param theme_color      - Accent color key (unused in minimal design)
 */

interface AIChatSidebarProps {
  threads: ChatThread[];
  active_thread_id: string | null;
  loading: boolean;
  on_select: (thread_id: string) => void;
  on_new_chat: () => void;
  on_archive: (thread_id: string) => Promise<void>;
  is_new_chat: boolean;
  theme_color?: string;
}

/**
 * Group threads by relative date.
 *
 * @param threads - Thread array
 * @returns Map of date groups to thread arrays
 */
function group_threads_by_date(threads: ChatThread[]): Map<string, ChatThread[]> {
  const groups = new Map<string, ChatThread[]>();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const seven_days_ago = new Date(today.getTime() - 7 * 86400000);

  for (const thread of threads) {
    const d = new Date(thread.lastMessageAt);
    const group = d >= today ? 'Today'
      : d >= yesterday ? 'Yesterday'
      : d >= seven_days_ago ? 'Previous 7 days'
      : 'Older';
    const list = groups.get(group) || [];
    list.push(thread);
    groups.set(group, list);
  }
  return groups;
}

/**
 * Format relative time — ultra-short.
 *
 * @param date - Date to format
 * @returns Short time string
 */
function format_time(date: Date): string {
  const ms = Date.now() - new Date(date).getTime();
  const min = Math.floor(ms / 60000);
  const hr = Math.floor(ms / 3600000);
  const day = Math.floor(ms / 86400000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  if (hr < 24) return `${hr}h`;
  if (day < 7) return `${day}d`;
  return new Date(date).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export function AIChatSidebar({
  threads,
  active_thread_id,
  loading,
  on_select,
  on_new_chat,
  on_archive,
}: AIChatSidebarProps) {
  const [archiving_thread_id, set_archiving_thread_id] = useState<string | null>(null);
  const [archive_error, set_archive_error] = useState<string | null>(null);
  const grouped = group_threads_by_date(threads);
  const group_order = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

  const archive = async (thread_id: string): Promise<void> => {
    if (archiving_thread_id) return;
    set_archiving_thread_id(thread_id);
    set_archive_error(null);
    try {
      await on_archive(thread_id);
    } catch {
      console.error('[AIChatSidebar] archive failed');
      set_archive_error('The conversation could not be deleted. Please retry.');
    } finally {
      set_archiving_thread_id(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* New Chat */}
      <div className="flex h-16 items-center border-b border-border px-4">
        <Button
          onClick={on_new_chat}
          className="h-10 w-full justify-start px-4 text-sm"
        >
          <span className="rounded-full bg-white/20 p-1"><Plus size={13} strokeWidth={2} /></span>
          <span>New chat</span>
        </Button>
      </div>

      {/* Thread List */}
      <ScrollArea className="flex-1">
        <div className="px-2 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted">
              <Loader2 size={14} className="animate-spin" />
            </div>
          ) : threads.length === 0 ? (
            <div className="text-center py-12">
              <div className="flex flex-col items-center gap-2 py-3 text-muted">
                <MessageSquare size={18} strokeWidth={1.5} />
                <p className="text-xs font-medium">No conversations yet</p>
              </div>
            </div>
          ) : (
            group_order.map((group_name) => {
              const items = grouped.get(group_name);
              if (!items?.length) return null;

              return (
                <div key={group_name} className="mb-3">
                  <p className="px-2 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                    {group_name}
                  </p>
                  {items.map((thread) => {
                    const is_active = thread.id === active_thread_id;
                    return (
                      <div
                        key={thread.id}
                        className={cn(
                          'group flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2.5 transition-colors',
                          is_active
                            ? 'bg-brand-soft text-ink'
                            : 'text-muted hover:bg-subtle hover:text-ink',
                        )}
                        onClick={() => on_select(thread.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && on_select(thread.id)}
                      >
                        <p className={cn(
                          'min-w-0 flex-1 truncate text-sm leading-tight',
                          is_active && 'font-medium',
                        )}>
                          {thread.title}
                        </p>
                        <span className="mr-0.5 shrink-0 text-xs tabular-nums text-muted">
                          {format_time(thread.lastMessageAt)}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); void archive(thread.id); }}
                          className="shrink-0 rounded-full p-1 text-muted opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                          aria-label="Delete conversation"
                          disabled={archiving_thread_id === thread.id}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
          {archive_error && (
            <p role="alert" className="mx-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {archive_error}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
