'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Bot, Trash2, AlertCircle } from 'lucide-react';
import { BaseChat, BaseChatProps } from './base-chat';
import { useChat } from '../../hooks/use-chat';
import { useFeedback } from '../../hooks/use-feedback';
import { FeedbackCollector } from '../feedback/feedback-collector';
import { ConversationMessage } from '../../types/conversation-types';

export interface AIChatProps extends Omit<BaseChatProps, 'messages' | 'onSendMessage' | 'onClearHistory'> {
  apiKey?: string;
  provider?: string;
  serviceName?: string;
  enableFeedback?: boolean;
  showServiceStatus?: boolean;
  onError?: (error: Error) => void;
  onFeedbackSubmit?: (feedback: any) => void;
}

/**
 * Refactored AI Chat component using shared base and hooks
 * Provides a clean interface for AI conversations with feedback collection
 */
export function AIChat({
  userId,
  apiKey,
  provider = 'openai',
  serviceName,
  enableFeedback = true,
  showServiceStatus = true,
  onError,
  onFeedbackSubmit,
  ...baseChatProps
}: AIChatProps) {
  const chat = useChat({
    userId,
    apiKey,
    provider,
    serviceName,
    onError,
    maxMessages: 50,
    enablePersistence: true
  });

  const feedback = useFeedback({
    userId,
    service: chat.getService(),
    onFeedbackSubmit: onFeedbackSubmit
  });

  const handleSendMessage = async (message: string) => {
    await chat.sendMessage(message);
  };

  const handleClearHistory = async () => {
    chat.clearHistory();
    feedback.clearFeedback();
  };

  const renderMessageActions = (message: ConversationMessage) => {
    if (message.role !== 'assistant' || !enableFeedback) {
      return null;
    }

    const responseId = message.metadata?.responseId;
    if (!responseId) {
      return null;
    }

    // Check if feedback already submitted for this response
    const hasFeedback = feedback.getFeedbackHistory(responseId).length > 0;

    return (
      <FeedbackCollector
        responseId={responseId}
        userId={userId}
        aiResponse={message.content}
        aiModel={message.metadata?.model || 'unknown'}
        prompt={chat.messages.find(m => m.id === message.id)?.content || ''}
        onSubmit={feedback.submitFeedback}
        disabled={hasFeedback || feedback.isSubmitting}
        showSubmitted={hasFeedback}
      />
    );
  };

  const renderHeader = () => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Bot className="w-5 h-5 text-green-600" />
        <span className="font-semibold text-slate-800">AI Assistant</span>
      </div>

      <div className="flex items-center gap-2">
        {showServiceStatus && (
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${
              chat.getService() ? 'bg-green-500' : 'bg-red-500'
            }`} />
            <span className="text-xs text-slate-600">
              {chat.getService() ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleClearHistory}
          className="flex items-center gap-1"
        >
          <Trash2 className="w-4 h-4" />
          Clear
        </Button>
      </div>
    </div>
  );

  const renderFooter = () => {
    if (!chat.error) return null;

    return (
      <Card className="m-4 p-3 border-red-200 bg-red-50">
        <div className="flex items-center gap-2 text-red-800">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">
            Error: {chat.error.message}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={chat.retryLastMessage}
          className="mt-2"
        >
          Retry Last Message
        </Button>
      </Card>
    );
  };

  return (
    <BaseChat
      userId={userId}
      messages={chat.messages}
      onSendMessage={handleSendMessage}
      onClearHistory={handleClearHistory}
      isLoading={chat.isLoading}
      header={renderHeader()}
      footer={renderFooter()}
      messageActions={renderMessageActions}
      placeholder="Ask me anything..."
      showTimestamp={true}
      className="border border-gray-300 rounded-lg h-full flex flex-col"
      {...baseChatProps}
    />
  );
}

export default AIChat;