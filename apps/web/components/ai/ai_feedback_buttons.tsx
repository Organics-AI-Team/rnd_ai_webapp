'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

/**
 * AI Feedback Buttons - Subtle thumbs up/down for response rating
 *
 * @param messageId - ID of the rated message
 * @param onFeedback - Callback with (messageId, isPositive)
 * @param disabled - Whether already submitted
 */

interface AIFeedbackButtonsProps {
  messageId: string;
  onFeedback: (messageId: string, isPositive: boolean) => void;
  disabled?: boolean;
}

export function AIFeedbackButtons({
  messageId,
  onFeedback,
  disabled = false
}: AIFeedbackButtonsProps) {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2">
      <span className="text-2xs font-medium text-muted">Helpful?</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onFeedback(messageId, true)}
        disabled={disabled}
        className="h-7 px-2 text-2xs"
      >
        <ThumbsUp className="w-2.5 h-2.5 mr-0.5" />
        Yes
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onFeedback(messageId, false)}
        disabled={disabled}
        className="h-7 px-2 text-2xs hover:text-red-700 hover:bg-red-50"
      >
        <ThumbsDown className="w-2.5 h-2.5 mr-0.5" />
        No
      </Button>
    </div>
  );
}
