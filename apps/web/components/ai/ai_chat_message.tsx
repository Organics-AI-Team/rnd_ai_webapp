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
  blue: { icon: 'text-blue-600', bg: 'bg-blue-50', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  green: { icon: 'text-emerald-600', bg: 'bg-emerald-50', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  purple: { icon: 'text-violet-600', bg: 'bg-violet-50', badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  orange: { icon: 'text-orange-600', bg: 'bg-orange-50', badge: 'bg-orange-50 text-orange-700 border-orange-200' }
};

export function AIChatMessage({
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
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-gray-900">
            {message.role === 'assistant' ? 'AI Assistant' : 'You'}
          </span>
          <span className="text-2xs text-gray-400">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {message.role === 'assistant' ? (
          <div className="text-sm text-gray-900 leading-relaxed">
            <MarkdownRenderer content={message.content} />
          </div>
        ) : (
          <p className="text-sm text-gray-900 whitespace-pre-wrap">{message.content}</p>
        )}

        {/* Metadata */}
        {message.role === 'assistant' && message.metadata && (
          <div className="mt-2 flex items-center gap-2">
            {message.metadata.ragUsed && (
              <Badge variant="outline" className={`text-2xs ${colors.badge}`}>
                {metadataIcon && <span className="mr-0.5">{metadataIcon}</span>}
                {metadataLabel}
              </Badge>
            )}
            {message.metadata.confidence && (
              <span className="text-2xs text-gray-400">
                {(message.metadata.confidence * 100).toFixed(0)}% confidence
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
