'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

/**
 * AI Feedback Buttons Component
 *
 * Provides thumbs up/down feedback buttons for AI responses.
 * Displays "Was this helpful?" prompt with positive and negative feedback options.
 *
 * @param messageId - ID of the message being rated
 * @param onFeedback - Callback when feedback is submitted (messageId, isPositive)
 * @param disabled - Whether buttons are disabled (e.g., already submitted)
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
    <div className="px-4 py-2 border-t flex items-center gap-2">
      <span className="text-xs text-gray-500">Was this helpful?</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onFeedback(messageId, true)}
        disabled={disabled}
        className="h-6 px-2 text-xs"
      >
        <ThumbsUp className="w-3 h-3 mr-1" />
        Yes
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onFeedback(messageId, false)}
        disabled={disabled}
        className="h-6 px-2 text-xs"
      >
        <ThumbsDown className="w-3 h-3 mr-1" />
        No
      </Button>
    </div>
  );
}
