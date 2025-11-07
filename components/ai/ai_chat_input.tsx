'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';

/**
 * AI Chat Input Component
 *
 * Provides an input area with a send button for AI chat interfaces.
 * Supports Enter key to send (Shift+Enter for new line).
 *
 * @param value - Current input value
 * @param onChange - Callback when input changes
 * @param onSend - Callback when message is sent
 * @param placeholder - Placeholder text for input
 * @param disabled - Whether input is disabled (e.g., during loading)
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
   * Handles key down events in textarea
   * - Enter (without Shift): Send message
   * - Shift+Enter: New line
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
    <div className="p-4 border-t">
      <div className="flex gap-2">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-h-[60px] resize-none"
          onKeyDown={handle_key_down}
          disabled={disabled}
        />
        <Button
          onClick={onSend}
          disabled={!value.trim() || disabled}
          className="px-4"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
