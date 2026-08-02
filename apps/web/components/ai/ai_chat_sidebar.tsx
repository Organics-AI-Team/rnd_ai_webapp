'use client';

import React from 'react';
import { Archive, Loader2, MessageSquare, Plus, Sparkles } from 'lucide-react';
import { cn } from '@rnd-ai/shared-utils';
import { ScrollArea } from '@/components/ui/scroll-area';
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
 */

interface AIChatSidebarProps {
  threads: ChatThread[];
  active_thread_id: string | null;
  loading: boolean;
  on_select: (thread_id: string) => void;
  on_new_chat: () => void;
  on_archive: (thread_id: string) => void;
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
  const grouped = group_threads_by_date(threads);
  const group_order = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-emerald-50/80 via-white to-green-50/60">
      {/* New Chat */}
      <div className="h-12 flex items-center px-3 border-b border-emerald-100/80">
        <button
          type="button"
          onClick={on_new_chat}
          className="flex w-full items-center gap-2 rounded-xl bg-white/75 px-2 py-1.5 text-[12px] font-medium text-emerald-800 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white hover:text-emerald-950"
        >
          <span className="rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 p-1 text-white"><Plus size={12} strokeWidth={2} /></span>
          <span>New chat</span>
          <Sparkles size={12} className="ml-auto text-emerald-500" />
        </button>
      </div>

      {/* Thread List */}
      <ScrollArea className="flex-1">
        <div className="py-2 px-1.5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-emerald-400">
              <Loader2 size={14} className="animate-spin" />
            </div>
          ) : threads.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[11px] text-emerald-800/45">No conversations yet</p>
            </div>
          ) : (
            group_order.map((group_name) => {
              const items = grouped.get(group_name);
              if (!items?.length) return null;

              return (
                <div key={group_name} className="mb-3">
                  <p className="text-[10px] font-medium text-emerald-800/45 uppercase tracking-wider px-2 py-1">
                    {group_name}
                  </p>
                  {items.map((thread) => {
                    const is_active = thread.id === active_thread_id;
                    return (
                      <div
                        key={thread.id}
                        className={cn(
                          'group flex items-center gap-1 rounded-xl transition-all',
                          is_active
                            ? 'bg-white shadow-[0_5px_14px_rgba(16,185,129,0.12)] text-emerald-950'
                            : 'text-emerald-800/65 hover:bg-white/80 hover:text-emerald-900',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => on_select(thread.id)}
                          className="flex min-w-0 flex-1 items-center gap-1 px-2 py-[7px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset"
                          aria-current={is_active ? 'page' : undefined}
                        >
                          <p className={cn(
                            'flex-1 min-w-0 text-[11.5px] truncate leading-tight',
                            is_active && 'font-medium',
                          )}>
                            {thread.title}
                          </p>
                          <span className="mr-0.5 flex-shrink-0 text-[10px] text-emerald-800/35 tabular-nums">
                            {format_time(thread.lastMessageAt)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm('Archive this conversation?')) on_archive(thread.id);
                          }}
                          className="mr-1 flex-shrink-0 rounded-lg p-1 text-emerald-800/35 transition-all hover:bg-emerald-50 hover:text-emerald-700 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                          aria-label="Archive conversation"
                          title="Archive conversation"
                        >
                          <Archive size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
