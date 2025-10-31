'use client';

import React, { useState, useCallback, useEffect, ReactNode } from 'react';
import { Send, Bot, User, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { ConversationMessage } from '../../types/conversation-types';

export interface BaseChatProps {
  userId: string;
  messages: ConversationMessage[];
  onSendMessage: (message: string) => Promise<void>;
  onClearHistory: () => Promise<void>;
  isLoading?: boolean;
  className?: string;
  placeholder?: string;
  header?: ReactNode;
  footer?: ReactNode;
  messageActions?: (message: ConversationMessage) => ReactNode;
  showTimestamp?: boolean;
  maxHeight?: string;
}

/**
 * Base reusable chat component that can be extended for specific AI contexts
 */
export function BaseChat({
  userId,
  messages,
  onSendMessage,
  onClearHistory,
  isLoading = false,
  className = '',
  placeholder = 'Type your message...',
  header,
  footer,
  messageActions,
  showTimestamp = true,
  maxHeight = 'h-96'
}: BaseChatProps) {
  const [input, setInput] = useState('');
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isScrolledToBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isScrolledToBottom]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    const isAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 50;
    setIsScrolledToBottom(isAtBottom);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const message = input.trim();
    console.log('🚫 BaseChat: Submitting message:', message);
    setInput('');

    try {
      await onSendMessage(message);
      console.log('✅ BaseChat: Message sent successfully');
    } catch (error) {
      console.error('❌ BaseChat: Error sending message:', error);
      // Restore input if send failed
      setInput(message);
    }
  }, [input, isLoading, onSendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  }, [handleSubmit]);

  const formatTimestamp = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(date);
  };

  const renderMessage = (message: ConversationMessage) => (
    <div
      key={message.id}
      className={`flex gap-3 p-4 ${
        message.role === 'user' ? 'bg-slate-50' : 'bg-white'
      }`}
    >
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        message.role === 'user' ? 'bg-blue-500' : 'bg-green-500'
      }`}>
        {message.role === 'user' ? (
          <User className="w-4 h-4 text-white" />
        ) : (
          <Bot className="w-4 h-4 text-white" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-sm font-medium text-slate-700">
            {message.role === 'user' ? 'You' : 'AI Assistant'}
          </span>
          {showTimestamp && (
            <span className="text-xs text-slate-500">
              {formatTimestamp(message.timestamp)}
            </span>
          )}
        </div>

        <div className="text-slate-800 whitespace-pre-wrap break-words">
          {message.content}
        </div>

        {messageActions && (
          <div className="mt-2">
            {messageActions(message)}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      {header && (
        <div className="flex-shrink-0 p-4 border-b border-slate-200">
          {header}
        </div>
      )}

      {/* Messages Container */}
      <div className={`flex-1 overflow-y-auto ${maxHeight === 'h-96' ? 'h-full' : maxHeight}`} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <Bot className="w-12 h-12 mb-4 text-slate-300" />
            <p className="text-lg font-medium">Start a conversation</p>
            <p className="text-sm mt-1">Ask me anything!</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {messages.map(renderMessage)}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer */}
      {footer && (
        <div className="flex-shrink-0 p-4 border-t border-slate-200">
          {footer}
        </div>
      )}

      {/* Input Form */}
      <div className="flex-shrink-0 p-4 border-t border-slate-200 bg-white">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isLoading}
            className="min-h-[40px] max-h-32 resize-none"
            rows={1}
          />
          <Button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}