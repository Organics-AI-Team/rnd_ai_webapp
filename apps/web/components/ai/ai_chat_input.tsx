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
    if (e.nativeEvent.isComposing) return;

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
          className="min-h-[48px] max-h-[140px] resize-none rounded-2xl border-emerald-200/80 bg-white/85 text-sm text-emerald-950 py-3 px-4 pr-12 focus:bg-white focus:border-emerald-400 transition-colors shadow-inner shadow-emerald-950/[0.03]"
          onKeyDown={handle_key_down}
          disabled={disabled}
          rows={1}
          aria-label="Chat message input"
        />
        <Button
          type="button"
          onClick={onSend}
          disabled={!value.trim() || disabled}
          size="icon"
          className="absolute right-2 bottom-2 h-8 w-8 rounded-xl bg-gradient-to-br from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 disabled:bg-emerald-100 disabled:text-emerald-500 transition-all shadow-[0_6px_14px_rgba(5,150,105,0.22)]"
          aria-label="Send message"
          aria-keyshortcuts="Enter"
        >
          <ArrowUp className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
