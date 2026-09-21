'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowUp } from 'lucide-react';

/**
 * AI Chat Input — ChatGPT-style centered pill input.
 *
 * @param value       - Current input value
 * @param onChange    - Input change callback
 * @param onSend     - Send message callback
 * @param placeholder - Placeholder text
 * @param disabled   - Whether input is disabled during loading
 */

interface AIChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export function AIChatInput({
  value,
  onChange,
  onSend,
  placeholder = 'Message...',
  disabled = false
}: AIChatInputProps) {
  /**
   * Handles keyboard events — Enter sends, Shift+Enter newline.
   *
   * @param e - Keyboard event
   */
  const handle_key_down = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) {
        onSend();
      }
    }
  };

  return (
    <div className="px-5 py-5 sm:px-8">
      <div className="relative mx-auto max-w-3xl">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-h-[58px] max-h-[160px] resize-none py-4 pl-4 pr-16"
          onKeyDown={handle_key_down}
          disabled={disabled}
          rows={1}
          aria-label="Chat message input"
        />
        <Button
          onClick={onSend}
          disabled={!value.trim() || disabled}
          size="icon"
          className="absolute bottom-2.5 right-2.5 h-10 w-10"
          aria-label="Send message"
        >
          <ArrowUp className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
