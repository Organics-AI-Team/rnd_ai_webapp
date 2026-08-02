'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AIChatMessage } from './ai_chat_message';
import { AILoadingIndicator } from './ai_loading_indicator';
import { AIEmptyState } from './ai_empty_state';
import type { Message } from './ai_chat_message';
import type { GeneratedFormula } from '@/lib/ai/formula-conversion';

/**
 * AI Chat Messages Area - Scrollable message list with auto-scroll
 *
 * Features:
 *   - Auto-scrolls to bottom on new messages (unless user scrolled up)
 *   - Floating "scroll to bottom" button when user scrolls away
 *   - Smooth scroll animation
 *
 * @param messages            - Chat messages array
 * @param isLoading           - Whether AI is processing
 * @param isInitialLoading    - Whether the selected conversation is loading
 * @param themeColor          - Theme color for messages
 * @param emptyStateIcon      - Icon for empty state
 * @param emptyStateGreeting  - Empty state greeting
 * @param emptyStateSuggestions - Suggestion strings
 * @param loadingMessage      - Loading indicator text
 * @param metadataIcon        - Icon for metadata
 * @param metadataLabel       - Label for metadata
 * @param bottomPadding       - Bottom spacing pixels
 */

interface AIChatMessagesAreaProps {
  messages: Message[];
  isLoading: boolean;
  isInitialLoading?: boolean;
  themeColor?: 'blue' | 'green' | 'purple' | 'orange';
  emptyStateIcon: React.ReactNode;
  emptyStateGreeting: string;
  emptyStateSuggestions: string[];
  loadingMessage?: string;
  metadataIcon?: React.ReactNode;
  metadataLabel?: string;
  bottomPadding?: number;
  onSuggestionClick?: (suggestion: string) => void;
  onQuickAction?: (prompt: string) => void;
  onConvertFormula?: (messageId: string, formula: GeneratedFormula) => Promise<{ id: string; formulaCode?: string } | null>;
  /** Callback when user submits feedback on a message */
  onFeedback?: (messageId: string, isPositive: boolean) => void;
  /** Set of message IDs that already have feedback submitted */
  feedbackSubmitted?: Set<string>;
}

export function AIChatMessagesArea({
  messages,
  isLoading,
  isInitialLoading = false,
  themeColor = 'blue',
  emptyStateIcon,
  emptyStateGreeting,
  emptyStateSuggestions,
  loadingMessage = 'Thinking...',
  metadataIcon,
  metadataLabel = 'Enhanced',
  bottomPadding = 16,
  onSuggestionClick,
  onQuickAction,
  onConvertFormula,
  onFeedback,
  feedbackSubmitted = new Set(),
}: AIChatMessagesAreaProps) {
  const bottom_ref = useRef<HTMLDivElement>(null);
  const scroll_container_ref = useRef<HTMLDivElement>(null);
  const [is_near_bottom, set_is_near_bottom] = useState(true);
  const prev_message_count = useRef(messages.length);

  /**
   * Scroll to the bottom of the message list.
   */
  const scroll_to_bottom = useCallback(() => {
    bottom_ref.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  /**
   * Track whether user is near the bottom of the scroll area.
   * If they've scrolled up, don't auto-scroll on new messages.
   */
  const handle_scroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const threshold = 100; // px from bottom
    const at_bottom = target.scrollHeight - target.scrollTop - target.clientHeight < threshold;
    set_is_near_bottom(at_bottom);
  }, []);

  /**
   * Auto-scroll to bottom when new messages arrive (if user is near bottom).
   */
  useEffect(() => {
    if (messages.length > prev_message_count.current && is_near_bottom) {
      // Small delay to ensure DOM has rendered the new message
      requestAnimationFrame(() => {
        bottom_ref.current?.scrollIntoView({ behavior: 'smooth' });
      });
    }
    prev_message_count.current = messages.length;
  }, [messages.length, is_near_bottom]);

  /**
   * Also scroll to bottom when loading starts (user sent a message).
   */
  useEffect(() => {
    if (isLoading && is_near_bottom) {
      requestAnimationFrame(() => {
        bottom_ref.current?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, [isLoading, is_near_bottom]);

  return (
    <div className="relative flex-1 min-h-0">
      <ScrollArea className="h-full px-4 pt-2" onScrollCapture={handle_scroll}>
        <div
          className={messages.length === 0 ? "min-h-full flex items-center justify-center" : "max-w-2xl mx-auto space-y-1 py-2"}
          style={{ paddingBottom: `${bottomPadding}px` }}
          ref={scroll_container_ref}
        >
          {isInitialLoading ? (
            <div className="flex flex-col items-center gap-3 py-16 text-emerald-800/55" role="status" aria-live="polite">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
              <span className="text-xs">กำลังเปิดประวัติการสนทนา...</span>
            </div>
          ) : messages.length === 0 ? (
            <AIEmptyState
              icon={emptyStateIcon}
              greeting={emptyStateGreeting}
              suggestions={emptyStateSuggestions}
              on_suggestion_click={onSuggestionClick}
            />
          ) : (
            messages.map((message) => (
              <AIChatMessage
                key={message.id}
                message={message}
                themeColor={themeColor}
                metadataIcon={metadataIcon}
                metadataLabel={metadataLabel}
                onQuickAction={onQuickAction}
                onConvertFormula={onConvertFormula}
                onFeedback={onFeedback}
                feedbackSubmitted={feedbackSubmitted.has(message.id)}
              />
            ))
          )}
          {isLoading && (
            <AILoadingIndicator
              message={loadingMessage}
              themeColor={themeColor}
            />
          )}
          {/* Scroll anchor */}
          <div ref={bottom_ref} />
        </div>
      </ScrollArea>

      {/* Scroll to bottom button — visible when user scrolled up */}
      {!is_near_bottom && messages.length > 0 && (
        <button
          onClick={scroll_to_bottom}
          className="absolute bottom-4 right-4 z-10 bg-white/90 border border-emerald-100 shadow-[0_8px_20px_rgba(16,185,129,0.14)] rounded-full p-2 hover:bg-emerald-50 transition-all text-emerald-700 hover:text-emerald-950"
          aria-label="Scroll to latest message"
          title="Scroll to bottom"
        >
          <ChevronDown size={16} />
        </button>
      )}
    </div>
  );
}
