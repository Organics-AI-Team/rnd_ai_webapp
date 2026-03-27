'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * AI Chat Messages Container - Clean card wrapper for chat area
 *
 * @param header - Header component (AIChatHeader)
 * @param messagesArea - Messages area component (AIChatMessagesArea)
 */

interface AIChatMessagesContainerProps {
  header: React.ReactNode;
  messagesArea: React.ReactNode;
}

export function AIChatMessagesContainer({
  header,
  messagesArea
}: AIChatMessagesContainerProps) {
  return (
    <Card className="flex-1 flex flex-col min-h-0 overflow-hidden border-border">
      {header}
      <CardContent className="flex-1 flex flex-col p-0 min-h-0 overflow-hidden">
        {messagesArea}
      </CardContent>
    </Card>
  );
}

/**
 * AI Chat Input Container - Sticky bottom input wrapper
 *
 * @param inputArea - Input area component (AIChatInputArea)
 */

interface AIChatInputContainerProps {
  inputArea: React.ReactNode;
}

export function AIChatInputContainer({
  inputArea
}: AIChatInputContainerProps) {
  return (
    <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm z-10 border-t border-border">
      {inputArea}
    </div>
  );
}
