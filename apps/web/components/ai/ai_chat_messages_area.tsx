'use client';

import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AIChatMessage } from './ai_chat_message';
import { AILoadingIndicator } from './ai_loading_indicator';
import { AIEmptyState } from './ai_empty_state';
import type { Message } from './ai_chat_message';

/**
 * AI Chat Messages Area Component
 *
 * Displays the scrollable chat messages area with empty state, messages list, and loading indicator.
 * Renders as a separate, independent component for better modularity.
 * Optimized for maximum space utilization with sticky input.
 *
 * @param messages - Array of chat messages to display
 * @param isLoading - Whether AI is currently processing
 * @param themeColor - Theme color for messages and loading indicator
 * @param emptyStateIcon - Icon for empty state
 * @param emptyStateGreeting - Greeting message when no messages
 * @param emptyStateSuggestions - Array of suggestions for empty state
 * @param loadingMessage - Loading indicator message
 * @param metadataIcon - Icon for message metadata badge
 * @param metadataLabel - Label for message metadata badge
 * @param inputAreaHeight - Height of input area in pixels (deprecated - no longer used)
 * @param bottomPadding - Small gap between messages and sticky input (default: 16)
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
  inputAreaHeight = 0,
  bottomPadding = 16
}: AIChatMessagesAreaProps) {
  /**
   * Calculate minimal bottom spacing to prevent overlap with sticky input
   * Since input is sticky with its own background, we only need small gap
   */
  const calculated_bottom_spacing = bottomPadding;

  return (
    <ScrollArea className="flex-1 px-4 pt-4">
      <div
        className={messages.length === 0 ? "min-h-full flex items-center justify-center" : "space-y-4"}
        style={{
          paddingBottom: `${calculated_bottom_spacing}px`
        }}
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
