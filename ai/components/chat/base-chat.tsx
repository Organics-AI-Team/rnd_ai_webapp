'use client';

import React, { useState, useCallback, useEffect, ReactNode } from 'react';
import { Send, Bot, User, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { ConversationMessage } from '../../types/conversation-types';
import { MarkdownRenderer } from './markdown-renderer';

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
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [composerDimensions, setComposerDimensions] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0
  });
  const composerRef = React.useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);

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

      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700">
              {message.role === 'user' ? 'You' : 'AI Assistant'}
            </span>
            {message.role === 'assistant' && message.metadata?.ragUsed && (
              <div className="relative group">
                <div className="flex items-center gap-1 px-2 py-0.5 bg-green-100 rounded-full">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs font-medium text-green-700">RAG</span>
                </div>
                <div className="absolute hidden group-hover:block left-0 top-full mt-1 bg-slate-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10 shadow-lg">
                  ✅ Database search used
                  {message.metadata?.ragSources && message.metadata.ragSources.length > 0 && (
                    <span className="ml-1">({message.metadata.ragSources.length} sources)</span>
                  )}
                </div>
              </div>
            )}
          </div>
          {showTimestamp && (
            <span className="text-xs text-slate-500">
              {formatTimestamp(message.timestamp)}
            </span>
          )}
        </div>

        {message.role === 'assistant' ? (
          <MarkdownRenderer content={message.content} />
        ) : (
          <div className="text-slate-800 whitespace-pre-wrap break-words overflow-wrap-anywhere">
            {message.content}
          </div>
        )}

        {messageActions && (
          <div className="mt-2">
            {messageActions(message)}
          </div>
        )}
      </div>
    </div>
  );

  const updateComposerMetrics = useCallback(() => {
    if (typeof window === 'undefined') return;

    setIsMobileLayout(window.innerWidth < 1024);

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    setComposerDimensions({
      left: rect.left + window.scrollX,
      width: rect.width
    });

    if (composerRef.current) {
      const composerRect = composerRef.current.getBoundingClientRect();
      setComposerHeight(composerRect.height);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    updateComposerMetrics();
    window.addEventListener('resize', updateComposerMetrics);

    let resizeObserver: ResizeObserver | undefined;
    if ('ResizeObserver' in window && containerRef.current) {
      resizeObserver = new ResizeObserver(() => updateComposerMetrics());
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateComposerMetrics);
      resizeObserver?.disconnect();
    };
  }, [updateComposerMetrics]);

  const composerStyle = isMobileLayout
    ? {
        bottom: 0,
        left: 0,
        right: 0
      }
    : {
        bottom: 24,
        left: composerDimensions.left || 0,
        ...(composerDimensions.width > 0
          ? { width: composerDimensions.width }
          : { right: 0 })
      };

  const messagePadding = composerHeight
    ? `${composerHeight + (isMobileLayout ? 48 : 72)}px`
    : isMobileLayout
      ? '240px'
      : '280px';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!composerRef.current) return;

    const observer = new ResizeObserver(() => updateComposerMetrics());
    observer.observe(composerRef.current);
    updateComposerMetrics();

    return () => observer.disconnect();
  }, [updateComposerMetrics]);

  return (
    <div ref={containerRef} className={`relative flex flex-col flex-1 min-h-0 ${maxHeight} ${className}`}>
      {/* Header */}
      {header && (
        <div className="flex-shrink-0 p-4 border-b border-slate-200 bg-white">
          {header}
        </div>
      )}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto min-h-0"
        onScroll={handleScroll}
        style={{ paddingBottom: messagePadding }}
      >
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

      {/* Footer / Composer */}
      <div
        className={`fixed z-50 transition-all duration-200 ${
          isMobileLayout ? 'px-4' : ''
        }`}
        style={composerStyle}
      >
        <div ref={composerRef} className="bg-white border border-slate-200 shadow-xl rounded-xl">
          {footer && (
            <div className="p-4 border-b border-slate-200 bg-white rounded-t-xl">
              {footer}
            </div>
          )}
          <div className="p-3">
            <form onSubmit={handleSubmit} className="flex gap-2 items-center px-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={isLoading}
                className="flex-1 min-h-[44px] max-h-40 resize-none"
                rows={1}
              />
              <Button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="px-3 py-2 h-[44px] shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
