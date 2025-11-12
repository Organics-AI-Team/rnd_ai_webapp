'use client';

import React, { useEffect, useRef } from 'react';
import { AIChatInput } from './ai_chat_input';
import { AIFeedbackButtons } from './ai_feedback_buttons';
import type { Message } from './ai_chat_message';

/**
 * AI Chat Input Area Component
 *
 * Displays the chat input area with optional feedback buttons for the last message.
 * Renders as a separate, independent component for better modularity.
 * Reports its height to parent for spacing calculations.
 *
 * @param input - Current input value
 * @param onInputChange - Callback when input changes
 * @param onSend - Callback when message is sent
 * @param placeholder - Input placeholder text
 * @param disabled - Whether input is disabled
 * @param messages - Array of messages (to check for last assistant message)
 * @param onFeedback - Callback when feedback is submitted
 * @param feedbackDisabled - Set of message IDs with feedback already submitted
 * @param showFeedback - Whether to show feedback buttons (default: true)
 * @param onHeightChange - Callback when input area height changes
 */

interface AIChatInputAreaProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  messages?: Message[];
  onFeedback?: (messageId: string, isPositive: boolean) => void;
  feedbackDisabled?: Set<string>;
  showFeedback?: boolean;
  onHeightChange?: (height: number) => void;
}

export function AIChatInputArea({
  input,
  onInputChange,
  onSend,
  placeholder = 'Type your message...',
  disabled = false,
  messages = [],
  onFeedback,
  feedbackDisabled = new Set(),
  showFeedback = true,
  onHeightChange
}: AIChatInputAreaProps) {
  const container_ref = useRef<HTMLDivElement>(null);

  /**
   * Checks if feedback buttons should be displayed
   */
  const should_show_feedback =
    showFeedback &&
    messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant' &&
    onFeedback;

  /**
   * Measure and report container height changes
   * Uses ResizeObserver to detect height changes dynamically
   */
  useEffect(() => {
    if (!container_ref.current || !onHeightChange) return;

    const measure_height = () => {
      if (container_ref.current) {
        const height = container_ref.current.offsetHeight;
        onHeightChange(height);
      }
    };

    // Initial measurement
    measure_height();

    // Observe size changes
    const resize_observer = new ResizeObserver(measure_height);
    resize_observer.observe(container_ref.current);

    return () => {
      resize_observer.disconnect();
    };
  }, [onHeightChange, should_show_feedback]);

  return (
    <div ref={container_ref}>
      {/* Feedback buttons for last assistant message */}
      {should_show_feedback && (
        <AIFeedbackButtons
          messageId={messages[messages.length - 1].id}
          onFeedback={onFeedback!}
          disabled={feedbackDisabled.has(messages[messages.length - 1].id)}
        />
      )}

      {/* Input */}
      <AIChatInput
        value={input}
        onChange={onInputChange}
        onSend={onSend}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
}
