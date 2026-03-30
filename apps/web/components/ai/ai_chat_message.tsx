'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Bot, User } from 'lucide-react';
import { MarkdownRenderer } from '@/ai/components/chat/markdown-renderer';

/**
 * AI Chat Message - ChatGPT-style full-width message rows
 *
 * @param message - Message object with role, content, timestamp, metadata
 * @param themeColor - Accent color for assistant avatar
 * @param metadataIcon - Icon for metadata badge
 * @param metadataLabel - Label for metadata badge
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: {
    sources?: any[];
    confidence?: number;
    ragUsed?: boolean;
    responseTime?: number;
  };
}

interface AIChatMessageProps {
  message: Message;
  themeColor?: 'blue' | 'green' | 'purple' | 'orange';
  metadataIcon?: React.ReactNode;
  metadataLabel?: string;
}

const themeColorMap = {
  blue: { icon: 'text-blue-500', bg: 'bg-blue-50/80', badge: 'bg-blue-50/80 text-blue-600 border-blue-200/60' },
  green: { icon: 'text-emerald-500', bg: 'bg-emerald-50/80', badge: 'bg-emerald-50/80 text-emerald-600 border-emerald-200/60' },
  purple: { icon: 'text-violet-500', bg: 'bg-violet-50/80', badge: 'bg-violet-50/80 text-violet-600 border-violet-200/60' },
  orange: { icon: 'text-orange-500', bg: 'bg-orange-50/80', badge: 'bg-orange-50/80 text-orange-600 border-orange-200/60' },
};

/**
 * Memoized to prevent re-rendering all messages when a new one is added.
 * Only re-renders when the specific message's props change.
 */
export const AIChatMessage = React.memo(function AIChatMessage({
  message,
  themeColor = 'blue',
  metadataIcon,
  metadataLabel = 'Enhanced'
}: AIChatMessageProps) {
  const colors = themeColorMap[themeColor];

  return (
    <div className="flex gap-3 py-3">
      {/* Avatar */}
      <div className="flex-shrink-0 mt-0.5">
        {message.role === 'assistant' ? (
          <div className={`w-6 h-6 rounded-md ${colors.bg} flex items-center justify-center`}>
            <Bot className={`w-3.5 h-3.5 ${colors.icon}`} />
          </div>
        ) : (
          <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-gray-500" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-medium text-gray-700">
            {message.role === 'assistant' ? 'AI' : 'You'}
          </span>
          <span className="text-[10px] text-gray-300 tabular-nums">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {message.role === 'assistant' ? (
          <div className="text-sm text-gray-900 leading-relaxed break-words overflow-hidden">
            <MarkdownRenderer content={message.content} />
          </div>
        ) : (
          <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">{message.content}</p>
        )}

        {/* Metadata */}
        {message.role === 'assistant' && message.metadata && (
          <div className="mt-1.5 flex items-center gap-2">
            {message.metadata.ragUsed && (
              <Badge variant="outline" className={`text-[10px] leading-none px-1.5 py-0.5 font-normal ${colors.badge}`}>
                {metadataIcon && <span className="mr-0.5">{metadataIcon}</span>}
                {metadataLabel}
              </Badge>
            )}
            {message.metadata.confidence != null && message.metadata.confidence > 0 && (
              <span className="text-[10px] text-gray-300 tabular-nums">
                {(message.metadata.confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
