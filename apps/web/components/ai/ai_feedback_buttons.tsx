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
    <div className="px-4 py-1.5 flex items-center gap-1.5">
      <span className="text-2xs text-muted-foreground">Helpful?</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onFeedback(messageId, true)}
        disabled={disabled}
        className="h-5 px-1.5 text-2xs text-muted-foreground hover:text-emerald-600"
      >
        <ThumbsUp className="w-2.5 h-2.5 mr-0.5" />
        Yes
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onFeedback(messageId, false)}
        disabled={disabled}
        className="h-5 px-1.5 text-2xs text-muted-foreground hover:text-red-600"
      >
        <ThumbsDown className="w-2.5 h-2.5 mr-0.5" />
        No
      </Button>
    </div>
  );
}
