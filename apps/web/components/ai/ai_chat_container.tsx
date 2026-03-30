'use client';

import React from 'react';

/**
 * AI Chat Messages Container — Clean wrapper, no card nesting.
 *
 * @param header       - Header toolbar
 * @param messagesArea - Scrollable messages area
 */

interface AIChatMessagesContainerProps {
  header: React.ReactNode;
  messagesArea: React.ReactNode;
}

export function AIChatMessagesContainer({
  header,
  messagesArea,
}: AIChatMessagesContainerProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {header}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {messagesArea}
      </div>
    </div>
  );
}

/**
 * AI Chat Input Container — Bottom input section with subtle top border.
 *
 * @param inputArea - Input area component
 */

interface AIChatInputContainerProps {
  inputArea: React.ReactNode;
}

export function AIChatInputContainer({ inputArea }: AIChatInputContainerProps) {
  return (
    <div className="bg-white">
      {inputArea}
    </div>
  );
}
