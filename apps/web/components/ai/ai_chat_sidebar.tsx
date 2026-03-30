/**
 * AI Chat Sidebar
 *
 * Displays a toggleable history panel of chat threads for an AI agent.
 * Threads are grouped by date: Today, Yesterday, Previous 7 Days, Older.
 *
 * Features:
 *   - "+ New Chat" button
 *   - Active thread highlighting
 *   - Relative timestamps ("2h ago", "Yesterday")
 *   - Archive (swipe/delete) per thread
 *   - Responsive: hidden on mobile by default
 *
 * @param threads        - Array of chat threads to display
 * @param active_thread_id - Currently selected thread ID
 * @param loading        - Whether threads are loading
 * @param on_select      - Callback when a thread is clicked
 * @param on_new_chat    - Callback for "+ New Chat" button
 * @param on_archive     - Callback to archive a thread
 * @param is_new_chat    - Whether we're in new-chat mode (no active thread)
 */

'use client';

import React from 'react';
import { Plus, MessageSquare, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@rnd-ai/shared-utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChatThread } from '@/hooks/use_chat_threads';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Date Grouping Helpers
// ---------------------------------------------------------------------------

/**
 * Group threads by relative date categories.
 *
 * @param threads - Array of ChatThread objects
 * @returns Grouped map: { "Today": [...], "Yesterday": [...], ... }
 */
function group_threads_by_date(threads: ChatThread[]): Map<string, ChatThread[]> {
  const groups = new Map<string, ChatThread[]>();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const seven_days_ago = new Date(today.getTime() - 7 * 86400000);

  for (const thread of threads) {
    const thread_date = new Date(thread.lastMessageAt);
    let group: string;

    if (thread_date >= today) {
      group = 'Today';
    } else if (thread_date >= yesterday) {
      group = 'Yesterday';
    } else if (thread_date >= seven_days_ago) {
      group = 'Previous 7 Days';
    } else {
      group = 'Older';
    }

    const existing = groups.get(group) || [];
    existing.push(thread);
    groups.set(group, existing);
  }

  return groups;
}

/**
 * Format a date as a short relative time string.
 *
 * @param date - The date to format
 * @returns Relative time string (e.g., "2h ago", "3d ago")
 */
function format_relative_time(date: Date): string {
  const now = new Date();
  const diff_ms = now.getTime() - new Date(date).getTime();
  const diff_min = Math.floor(diff_ms / 60000);
  const diff_hr = Math.floor(diff_ms / 3600000);
  const diff_day = Math.floor(diff_ms / 86400000);

  if (diff_min < 1) return 'just now';
  if (diff_min < 60) return `${diff_min}m ago`;
  if (diff_hr < 24) return `${diff_hr}h ago`;
  if (diff_day < 7) return `${diff_day}d ago`;
  return new Date(date).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIChatSidebar({
  threads,
  active_thread_id,
  loading,
  on_select,
  on_new_chat,
  on_archive,
  is_new_chat,
  theme_color = 'blue',
}: AIChatSidebarProps) {
  console.log('[AIChatSidebar] render', { thread_count: threads.length, active_thread_id });

  const grouped = group_threads_by_date(threads);
  const group_order = ['Today', 'Yesterday', 'Previous 7 Days', 'Older'];

  /**
   * Color mapping for active thread highlight.
   */
  const active_bg = {
    blue: 'bg-blue-50 border-blue-200',
    purple: 'bg-purple-50 border-purple-200',
  }[theme_color] || 'bg-blue-50 border-blue-200';

  const button_color = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    purple: 'bg-purple-600 hover:bg-purple-700',
  }[theme_color] || 'bg-blue-600 hover:bg-blue-700';

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200 w-60">
      {/* New Chat Button */}
      <div className="p-3 border-b border-gray-100">
        <Button
          onClick={on_new_chat}
          className={cn(
            'w-full flex items-center gap-2 text-xs text-white',
            button_color,
          )}
          size="sm"
        >
          <Plus size={14} />
          New Chat
        </Button>
      </div>

      {/* Thread List */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 size={16} className="animate-spin mr-2" />
              <span className="text-xs">Loading...</span>
            </div>
          ) : threads.length === 0 ? (
            <div className="text-center py-8 px-3">
              <MessageSquare size={24} className="mx-auto mb-2 text-gray-300" />
              <p className="text-xs text-gray-400">No conversations yet</p>
              <p className="text-2xs text-gray-300 mt-1">Start a new chat to begin</p>
            </div>
          ) : (
            group_order.map((group_name) => {
              const group_threads = grouped.get(group_name);
              if (!group_threads || group_threads.length === 0) return null;

              return (
                <div key={group_name} className="mb-3">
                  {/* Group Header */}
                  <h4 className="text-2xs font-medium text-gray-400 uppercase tracking-wider px-2 pb-1">
                    {group_name}
                  </h4>

                  {/* Thread Items */}
                  <div className="space-y-0.5">
                    {group_threads.map((thread) => {
                      const is_active = thread.id === active_thread_id;

                      return (
                        <div
                          key={thread.id}
                          className={cn(
                            'group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
                            is_active
                              ? `${active_bg} border`
                              : 'hover:bg-gray-50 border border-transparent',
                          )}
                          onClick={() => on_select(thread.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === 'Enter' && on_select(thread.id)}
                        >
                          <MessageSquare
                            size={13}
                            className={cn(
                              'flex-shrink-0',
                              is_active ? 'text-gray-600' : 'text-gray-300',
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <p className={cn(
                              'text-xs truncate',
                              is_active ? 'font-medium text-gray-900' : 'text-gray-600',
                            )}>
                              {thread.title}
                            </p>
                            <p className="text-2xs text-gray-400">
                              {format_relative_time(thread.lastMessageAt)}
                            </p>
                          </div>

                          {/* Archive button — visible on hover */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              on_archive(thread.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 hover:text-red-500 text-gray-300 transition-all"
                            title="Archive thread"
                            aria-label="Archive thread"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
