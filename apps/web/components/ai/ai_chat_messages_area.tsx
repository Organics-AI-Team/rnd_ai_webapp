'use client';

import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AIChatMessage } from './ai_chat_message';
import { AILoadingIndicator } from './ai_loading_indicator';
import { AIEmptyState } from './ai_empty_state';
import type { Message } from './ai_chat_message';

/**
 * AI Chat Messages Area - Scrollable message list with empty/loading states
 *
 * @param messages - Array of chat messages
 * @param isLoading - Whether AI is processing
 * @param themeColor - Theme color for messages
 * @param emptyStateIcon - Icon for empty state
 * @param emptyStateGreeting - Empty state greeting text
 * @param emptyStateSuggestions - Suggestion strings for empty state
 * @param loadingMessage - Loading indicator text
 * @param metadataIcon - Icon for message metadata
 * @param metadataLabel - Label for message metadata
 * @param inputAreaHeight - Deprecated, unused
 * @param bottomPadding - Bottom spacing in pixels
 */

interface AIChatMessagesAreaProps {
  messages: Message[];
  isLoading: boolean;
  themeColor?: 'blue' | 'green' | 'purple' | 'orange';
  emptyStateIcon: React.ReactNode;
  emptyStateGreeting: string;
  emptyStateSuggestions: string[];
  loadingMessage?: string;
  metadataIcon?: React.ReactNode;
  metadataLabel?: string;
  inputAreaHeight?: number;
  bottomPadding?: number;
}

export function AIChatMessagesArea({
  messages,
  isLoading,
  themeColor = 'blue',
  emptyStateIcon,
  emptyStateGreeting,
  emptyStateSuggestions,
  loadingMessage = 'Thinking...',
  metadataIcon,
  metadataLabel = 'Enhanced',
  bottomPadding = 16
}: AIChatMessagesAreaProps) {
  return (
    <ScrollArea className="flex-1 px-4 pt-2">
      <div
        className={messages.length === 0 ? "min-h-full flex items-center justify-center" : "divide-y divide-border/50"}
        style={{ paddingBottom: `${bottomPadding}px` }}
      >
        {messages.length === 0 ? (
          <AIEmptyState
            icon={emptyStateIcon}
            greeting={emptyStateGreeting}
            suggestions={emptyStateSuggestions}
          />
        ) : (
          messages.map((message) => (
            <AIChatMessage
              key={message.id}
              message={message}
              themeColor={themeColor}
              metadataIcon={metadataIcon}
              metadataLabel={metadataLabel}
            />
          ))
        )}
        {isLoading && (
          <AILoadingIndicator
            message={loadingMessage}
            themeColor={themeColor}
          />
        )}
      </div>
    </ScrollArea>
  );
}
