'use client';

import React from 'react';
import { Brain } from 'lucide-react';

/**
 * AI Loading Indicator Component
 *
 * Displays an animated loading state with bouncing dots and custom message.
 * Used to indicate AI is processing a request.
 *
 * @param message - Loading message to display (default: 'Thinking...')
 * @param themeColor - Theme color for avatar background (default: 'blue')
 */

interface AILoadingIndicatorProps {
  message?: string;
  themeColor?: 'blue' | 'green' | 'purple' | 'orange';
}

const themeColorMap = {
  blue: {
    avatar: 'bg-blue-100',
    icon: 'text-blue-600'
  },
  green: {
    avatar: 'bg-green-100',
    icon: 'text-green-600'
  },
  purple: {
    avatar: 'bg-purple-100',
    icon: 'text-purple-600'
  },
  orange: {
    avatar: 'bg-orange-100',
    icon: 'text-orange-600'
  }
};

export function AILoadingIndicator({
  message = 'Thinking...',
  themeColor = 'blue'
}: AILoadingIndicatorProps) {
  const colors = themeColorMap[themeColor];

  return (
    <div className="flex items-start gap-3">
      <div className={`w-8 h-8 rounded-full ${colors.avatar} flex items-center justify-center flex-shrink-0`}>
        <Brain className={`w-4 h-4 ${colors.icon}`} />
      </div>
      <div className="bg-gray-100 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <div className="flex space-x-1">
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
          </div>
          <span className="text-sm text-gray-600">{message}</span>
        </div>
      </div>
    </div>
  );
}
