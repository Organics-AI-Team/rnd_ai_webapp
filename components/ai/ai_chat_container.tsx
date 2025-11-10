'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * AI Chat Messages Container Component
 *
 * Wraps chat messages area with Card component for consistent styling.
 * Renders ONLY the messages area with header - input area is separate.
 * Enables proper scrolling with min-h-0 and overflow-hidden.
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
    <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {header}
      <CardContent className="flex-1 flex flex-col p-0 min-h-0 overflow-hidden">
        {messagesArea}
      </CardContent>
    </Card>
  );
}

/**
 * AI Chat Input Container Component
 *
 * Wraps chat input area with sticky positioning at the bottom.
 * Input stays fixed at bottom of viewport during scroll.
 * Background color prevents content overlap.
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
    <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm z-10 pb-2">
      {inputArea}
    </div>
  );
}
