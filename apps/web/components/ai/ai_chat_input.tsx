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
    <div className="px-3 sm:px-4 py-3">
      <div className="relative max-w-2xl mx-auto">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-h-[44px] max-h-[140px] resize-none rounded-xl border-gray-200/80 bg-gray-50/50 text-sm text-gray-900 py-3 px-4 pr-12 focus:bg-white focus:border-gray-300 transition-colors shadow-sm"
          onKeyDown={handle_key_down}
          disabled={disabled}
          rows={1}
          aria-label="Chat message input"
        />
        <Button
          onClick={onSend}
          disabled={!value.trim() || disabled}
          size="icon"
          className="absolute right-2 bottom-2 h-8 w-8 rounded-lg bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors shadow-sm"
          aria-label="Send message"
        >
          <ArrowUp className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
