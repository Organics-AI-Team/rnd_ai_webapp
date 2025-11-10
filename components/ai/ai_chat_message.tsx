'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Brain, User } from 'lucide-react';
import { MarkdownRenderer } from '@/ai/components/chat/markdown-renderer';

/**
 * AI Chat Message Component
 *
 * Displays a single message in an AI chat interface with role-based styling,
 * avatar, timestamp, and optional metadata badges.
 *
 * @param message - Message object containing role, content, timestamp, and optional metadata
 * @param themeColor - Primary theme color for assistant messages (default: 'blue')
 * @param metadataIcon - Custom icon for metadata badge
 * @param metadataLabel - Custom label for metadata badge
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
  blue: {
    avatar: 'bg-blue-100',
    icon: 'text-blue-600',
    badge: 'bg-blue-50 border-blue-300'
  },
  green: {
    avatar: 'bg-green-100',
    icon: 'text-green-600',
    badge: 'bg-green-50 border-green-300'
  },
  purple: {
    avatar: 'bg-purple-100',
    icon: 'text-purple-600',
    badge: 'bg-purple-50 border-purple-300'
  },
  orange: {
    avatar: 'bg-orange-100',
    icon: 'text-orange-600',
    badge: 'bg-orange-50 border-orange-300'
  }
};

export function AIChatMessage({
  message,
  themeColor = 'blue',
  metadataIcon,
  metadataLabel = 'Enhanced'
}: AIChatMessageProps) {
  const colors = themeColorMap[themeColor];

  return (
    <div
      className={`flex items-start gap-3 ${
        message.role === 'user' ? 'justify-end' : 'justify-start'
      }`}
    >
      {message.role === 'assistant' && (
        <div className={`w-8 h-8 rounded-full ${colors.avatar} flex items-center justify-center flex-shrink-0`}>
          <Brain className={`w-4 h-4 ${colors.icon}`} />
        </div>
      )}

      <div
        className={`max-w-[70%] rounded-lg p-3 ${
          message.role === 'user'
            ? 'bg-green-500 text-white'
            : 'bg-gray-100 text-gray-900'
        }`}
      >
        {message.role === 'assistant' ? (
          <div className="text-sm">
            <MarkdownRenderer content={message.content} />
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        )}

        {/* Enhanced features metadata */}
        {message.role === 'assistant' && message.metadata && (
          <div className="mt-2 space-y-1">
            {message.metadata.ragUsed && (
              <Badge variant="secondary" className={`text-xs ${colors.badge}`}>
                {metadataIcon && <span className="mr-1">{metadataIcon}</span>}
                {metadataLabel}
              </Badge>
            )}
            {message.metadata.confidence && (
              <div className="text-xs text-gray-500">
                Confidence: {(message.metadata.confidence * 100).toFixed(0)}%
              </div>
            )}
          </div>
        )}

        <p className={`text-xs mt-1 ${
          message.role === 'user' ? 'text-green-100' : 'text-gray-500'
        }`}>
          {message.timestamp.toLocaleTimeString()}
        </p>
      </div>

      {message.role === 'user' && (
        <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-white" />
        </div>
      )}
    </div>
  );
}
