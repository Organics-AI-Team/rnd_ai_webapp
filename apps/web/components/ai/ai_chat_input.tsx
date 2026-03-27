'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowUp } from 'lucide-react';

/**
 * AI Chat Input Component - ChatGPT-style clean input
 *
 * @param value - Current input value
 * @param onChange - Input change callback
 * @param onSend - Send message callback
 * @param placeholder - Placeholder text
 * @param disabled - Whether input is disabled during loading
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
  placeholder = 'Type your message...',
  disabled = false
}: AIChatInputProps) {
  /**
   * Handles keyboard events - Enter sends, Shift+Enter adds newline
   *
   * @param e - Keyboard event from textarea
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
    <div className="px-4 py-3">
      <div className="relative flex items-end gap-2 max-w-3xl mx-auto">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-h-[40px] max-h-[120px] resize-none rounded-lg border-border bg-background text-sm py-2.5 px-3 pr-10"
          onKeyDown={handle_key_down}
          disabled={disabled}
          rows={1}
        />
        <Button
          onClick={onSend}
          disabled={!value.trim() || disabled}
          size="icon"
          className="absolute right-1.5 bottom-1.5 h-7 w-7 rounded-md"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
