'use client';

import React from 'react';
import { Bot } from 'lucide-react';
import { IconTile } from '@/components/ui/surface';

/**
 * AI Loading Indicator - Subtle typing indicator with bouncing dots
 *
 * @param message - Loading text
 * @param themeColor - Theme color for avatar
 */

interface AILoadingIndicatorProps {
  message?: string;
  themeColor?: 'blue' | 'green' | 'purple' | 'orange';
}

export function AILoadingIndicator({
  message = 'Thinking...',
  themeColor: _themeColor = 'blue'
}: AILoadingIndicatorProps) {
  return (
    <div className="flex items-start gap-3 py-4" aria-label={message} aria-live="polite" role="status">
      <IconTile tone="brand" className="size-8 rounded-xl">
        <Bot className="h-3.5 w-3.5" />
      </IconTile>
      <div className="flex items-center gap-2 pt-1">
        <div className="flex space-x-1">
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand"></div>
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" style={{animationDelay: '0.15s'}}></div>
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" style={{animationDelay: '0.3s'}}></div>
        </div>
        <span className="text-sm font-medium text-ink">{message}</span>
      </div>
    </div>
  );
}
