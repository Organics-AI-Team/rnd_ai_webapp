'use client';

import React from 'react';
import { AIChatInput } from './ai_chat_input';

/**
 * AI Chat Input Area - Input field wrapper
 *
 * @param input - Current input value
 * @param onInputChange - Input change callback
 * @param onSend - Send message callback
 * @param placeholder - Input placeholder text
 * @param disabled - Whether input is disabled
 */

interface AIChatInputAreaProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export function AIChatInputArea({
  input,
  onInputChange,
  onSend,
  placeholder = 'Type your message...',
  disabled = false,
}: AIChatInputAreaProps) {
  return (
    <div>
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
