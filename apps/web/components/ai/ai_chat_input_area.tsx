'use client';

import React, { useEffect, useRef } from 'react';
import { AIChatInput } from './ai_chat_input';
import { AIFeedbackButtons } from './ai_feedback_buttons';
import type { Message } from './ai_chat_message';

/**
 * AI Chat Input Area - Input with optional feedback buttons
 *
 * @param input - Current input value
 * @param onInputChange - Input change callback
 * @param onSend - Send message callback
 * @param placeholder - Input placeholder text
 * @param disabled - Whether input is disabled
 * @param messages - Messages array for feedback context
 * @param onFeedback - Feedback submission callback
 * @param feedbackDisabled - Set of message IDs with feedback submitted
 * @param showFeedback - Whether to show feedback buttons
 * @param onHeightChange - Height change callback for parent spacing
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

  const should_show_feedback =
    showFeedback &&
    messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant' &&
    onFeedback;

  /**
   * Measures and reports container height changes via ResizeObserver
   */
  useEffect(() => {
    if (!container_ref.current || !onHeightChange) return;

    const measure_height = () => {
      if (container_ref.current) {
        onHeightChange(container_ref.current.offsetHeight);
      }
    };

    measure_height();

    const resize_observer = new ResizeObserver(measure_height);
    resize_observer.observe(container_ref.current);

    return () => { resize_observer.disconnect(); };
  }, [onHeightChange, should_show_feedback]);

  return (
    <div ref={container_ref}>
      {should_show_feedback && (
        <AIFeedbackButtons
          messageId={messages[messages.length - 1].id}
          onFeedback={onFeedback!}
          disabled={feedbackDisabled.has(messages[messages.length - 1].id)}
        />
      )}
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
