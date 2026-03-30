'use client';

import React from 'react';
import { Plus, MessageSquare, Trash2, Loader2 } from 'lucide-react';
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
 * @param is_new_chat      - New-chat mode flag
 * @param theme_color      - Accent color key (unused in minimal design)
 */

interface AIChatSidebarProps {
  threads: ChatThread[];
  active_thread_id: string | null;
  loading: boolean;
  on_select: (thread_id: string) => void;
  on_new_chat: () => void;
  on_archive: (thread_id: string) => void;
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
  const grouped = group_threads_by_date(threads);
  const group_order = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

  return (
    <div className="flex flex-col h-full bg-[#fafafa]">
      {/* New Chat */}
      <div className="h-11 flex items-center px-3 border-b border-gray-100/80">
        <button
          onClick={on_new_chat}
          className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800 transition-colors"
        >
          <Plus size={14} strokeWidth={1.5} />
          <span>New chat</span>
        </button>
      </div>

      {/* Thread List */}
      <ScrollArea className="flex-1">
        <div className="py-2 px-1.5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-300">
              <Loader2 size={14} className="animate-spin" />
            </div>
          ) : threads.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[11px] text-gray-300">No conversations yet</p>
            </div>
          ) : (
            group_order.map((group_name) => {
              const items = grouped.get(group_name);
              if (!items?.length) return null;

              return (
                <div key={group_name} className="mb-3">
                  <p className="text-[10px] font-medium text-gray-400/80 uppercase tracking-wider px-2 py-1">
                    {group_name}
                  </p>
                  {items.map((thread) => {
                    const is_active = thread.id === active_thread_id;
                    return (
                      <div
                        key={thread.id}
                        className={cn(
                          'group flex items-center gap-1 px-2 py-[6px] rounded-lg cursor-pointer transition-all',
                          is_active
                            ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-gray-900'
                            : 'text-gray-500 hover:bg-white/70 hover:text-gray-700',
                        )}
                        onClick={() => on_select(thread.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && on_select(thread.id)}
                      >
                        <p className={cn(
                          'flex-1 min-w-0 text-[11.5px] truncate leading-tight',
                          is_active && 'font-medium',
                        )}>
                          {thread.title}
                        </p>
                        <span className="text-[10px] text-gray-300 flex-shrink-0 tabular-nums mr-0.5">
                          {format_time(thread.lastMessageAt)}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); on_archive(thread.id); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 hover:text-red-400 text-gray-200 transition-all flex-shrink-0"
                          aria-label="Delete conversation"
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
        </div>
      </ScrollArea>
    </div>
  );
}
