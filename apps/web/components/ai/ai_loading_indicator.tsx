'use client';

import React from 'react';
import { Bot } from 'lucide-react';

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

const themeColorMap = {
  blue: { bg: 'bg-emerald-50', icon: 'text-emerald-600' },
  green: { bg: 'bg-emerald-50', icon: 'text-emerald-600' },
  purple: { bg: 'bg-emerald-50', icon: 'text-emerald-600' },
  orange: { bg: 'bg-emerald-50', icon: 'text-emerald-600' }
};

export function AILoadingIndicator({
  message = 'Thinking...',
  themeColor = 'blue'
}: AILoadingIndicatorProps) {
  const colors = themeColorMap[themeColor];

  return (
    <div className="flex items-start gap-3 py-3" aria-label={message} aria-live="polite" role="status">
      <div className={`w-6 h-6 rounded-lg ${colors.bg} flex items-center justify-center flex-shrink-0`}>
        <Bot className={`w-3.5 h-3.5 ${colors.icon}`} />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <div className="flex space-x-1">
          <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce"></div>
          <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{animationDelay: '0.15s'}}></div>
          <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{animationDelay: '0.3s'}}></div>
        </div>
        <span className="text-xs text-emerald-800/65">{message}</span>
      </div>
    </div>
  );
}
