'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * AI Chat Messages Container Component
 *
 * Wraps chat messages area with Card component for consistent styling.
 * Renders ONLY the messages area with header - input area is separate.
 * No hardcoded HTML - fully component-based.
 *
 * @param header - Header component (typically AIChatHeader)
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
    <Card className="flex-1 flex flex-col">
      {header}
      <CardContent className="flex-1 flex flex-col p-0">
        {messagesArea}
      </CardContent>
    </Card>
  );
}

/**
 * AI Chat Input Container Component
 *
 * Wraps chat input area with consistent styling.
 * Renders ONLY the input area - messages area is separate.
 * No hardcoded HTML - fully component-based.
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
    <div className="mt-0">
      {inputArea}
    </div>
  );
}
