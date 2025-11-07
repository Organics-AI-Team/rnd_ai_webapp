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
 * Calculates spacing from input box to prevent message overlap.
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
 * @param inputAreaHeight - Height of input area in pixels (for bottom spacing calculation)
 * @param bottomPadding - Additional bottom padding in pixels (default: 16)
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
   * Calculate total bottom spacing to prevent overlap with input area
   * Accounts for input area height plus additional padding
   */
  const calculated_bottom_spacing = inputAreaHeight > 0
    ? inputAreaHeight + bottomPadding
    : bottomPadding;

  return (
    <ScrollArea className="flex-1 p-4">
      <div
        className="space-y-4"
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
