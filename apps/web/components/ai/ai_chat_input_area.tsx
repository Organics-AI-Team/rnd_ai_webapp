'use client';

import React, { useEffect, useRef } from 'react';
import { AIChatInput } from './ai_chat_input';

/**
 * AI Chat Input Area - Input field with height reporting
 *
 * @param input - Current input value
 * @param onInputChange - Input change callback
 * @param onSend - Send message callback
 * @param placeholder - Input placeholder text
 * @param disabled - Whether input is disabled
 * @param onHeightChange - Height change callback for parent spacing
 */

interface AIChatInputAreaProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  onHeightChange?: (height: number) => void;
}

export function AIChatInputArea({
  input,
  onInputChange,
  onSend,
  placeholder = 'Type your message...',
  disabled = false,
  onHeightChange
}: AIChatInputAreaProps) {
  const container_ref = useRef<HTMLDivElement>(null);

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
  }, [onHeightChange]);

  return (
    <div ref={container_ref}>
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
