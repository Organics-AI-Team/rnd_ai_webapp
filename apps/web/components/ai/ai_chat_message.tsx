'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { IconTile } from '@/components/ui/surface';
import { Bot, User } from 'lucide-react';
import { MarkdownRenderer } from '@/ai/components/chat/markdown-renderer';
import { AIFeedbackButtons } from './ai_feedback_buttons';
import { AIFormulaResult } from './ai_formula_result';

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
    toolCalls?: string[];
    processSteps?: Array<{ key: string; label: string }>;
    formula?: any;
    citations?: any[];
    quickActions?: Array<{ label: string; prompt?: string; href?: string }>;
    language?: 'th' | 'en';
  };
}

interface AIChatMessageProps {
  message: Message;
  themeColor?: 'blue' | 'green' | 'purple' | 'orange';
  metadataIcon?: React.ReactNode;
  metadataLabel?: string;
  /** Callback when user clicks Yes/No feedback on this message */
  onFeedback?: (messageId: string, isPositive: boolean) => void;
  /** Whether feedback has already been submitted for this message */
  feedbackSubmitted?: boolean;
  /** Callback when user clicks a quick action prompt */
  onQuickAction?: (prompt: string) => void;
}

function getDisplayContent(content: string): string {
  return content;
}

function getProcessSteps(metadata: Message['metadata']): Array<{ key: string; label: string }> {
  if (!metadata) return [];

  if (Array.isArray(metadata.processSteps) && metadata.processSteps.length > 0) {
    return metadata.processSteps.filter((step) => step?.key && step?.label);
  }

  const toolCalls = Array.isArray(metadata.toolCalls)
    ? metadata.toolCalls.filter((tool): tool is string => typeof tool === 'string' && tool.trim().length > 0)
    : [];

  const labels: Record<string, string> = {
    qdrant_search: 'ค้นวัตถุดิบจากฐานข้อมูล RAG',
    mongo_query: 'ค้นข้อมูลใน MongoDB',
    formula_calculate: 'คำนวณสูตรหรือต้นทุน',
    web_search: 'ค้นข้อมูลภายนอก',
    context_memory: 'อ่านบริบทจากแชทก่อนหน้า',
    generate_formula: 'สร้างสูตร draft',
    search_reference_formulas: 'ค้นสูตรอ้างอิง',
    revise_formula: 'ปรับสูตรตาม feedback',
    get_formula_with_comments: 'อ่านสูตรและคอมเมนต์',
    confirm_formula: 'ยืนยันสูตรเป็น version ทางการ',
  };

  const steps = [...new Set(toolCalls)];
  if (metadata.ragUsed && !steps.includes('qdrant_search')) {
    steps.unshift('qdrant_search');
  }

  return steps.map((step) => ({
    key: step,
    label: labels[step] || step.replace(/_/g, ' '),
  }));
}

/**
 * Memoized to prevent re-rendering all messages when a new one is added.
 * Only re-renders when the specific message's props change.
 */
export const AIChatMessage = React.memo(function AIChatMessage({
  message,
  themeColor: _themeColor = 'blue',
  metadataIcon,
  metadataLabel = 'Enhanced',
  onFeedback,
  feedbackSubmitted = false,
  onQuickAction,
}: AIChatMessageProps) {
  const displayContent = getDisplayContent(message.content);
  const processSteps = getProcessSteps(message.metadata);

  return (
    <div className="flex gap-3 py-4">
      {/* Avatar */}
      <div className="flex-shrink-0 mt-0.5">
        {message.role === 'assistant' ? (
          <IconTile tone="brand" className="size-8 rounded-xl">
            <Bot className="h-3.5 w-3.5" />
          </IconTile>
        ) : (
          <IconTile className="size-8 rounded-xl">
            <User className="h-3.5 w-3.5" />
          </IconTile>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-ink">
            {message.role === 'assistant' ? 'AI' : 'คุณ'}
          </span>
          <span className="text-xs text-muted tabular-nums">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {message.role === 'assistant' ? (
          <div className="break-words overflow-hidden text-sm leading-relaxed text-ink">
            <MarkdownRenderer content={displayContent} />
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-ink">{displayContent}</p>
        )}

        {message.role === 'assistant' && message.metadata?.formula && (
          <AIFormulaResult
            formula={message.metadata.formula}
            citations={message.metadata.citations}
            quickActions={message.metadata.quickActions}
            language={message.metadata.language}
            onQuickAction={onQuickAction}
          />
        )}

        {/* Metadata */}
        {message.role === 'assistant' && message.metadata && (
          <div className="mt-1.5 flex items-center gap-2">
            {message.metadata.ragUsed && (
              <Badge variant="outline" className="px-2 py-0.5 text-xs font-normal leading-none">
                {metadataIcon && <span className="mr-0.5">{metadataIcon}</span>}
                {metadataLabel}
              </Badge>
            )}
            {message.metadata.confidence != null && message.metadata.confidence > 0 && (
              <span className="text-xs text-muted tabular-nums">
                {(message.metadata.confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
        )}

        {message.role === 'assistant' && processSteps.length > 0 && (
          <details className="group mt-3 text-xs text-muted">
            <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-lg border border-transparent px-2 py-1.5 hover:border-border hover:bg-subtle hover:text-ink">
              <span className="transition-transform group-open:rotate-90">›</span>
              <span>ขั้นตอน</span>
              <span>({processSteps.length})</span>
            </summary>
            <div className="ml-4 mt-1 border-l border-border pl-3 text-ink">
              {processSteps.map((step, index) => (
                <div key={`${step.key}-${index}`} className="py-0.5">
                  {index + 1}. {step.label}
                </div>
              ))}
              {message.metadata.responseTime != null && message.metadata.responseTime > 0 && (
                <div className="py-0.5 text-muted">
                  เวลา: {(message.metadata.responseTime / 1000).toFixed(1)}s
                </div>
              )}
            </div>
          </details>
        )}

        {/* Per-message feedback — shown under every assistant message */}
        {message.role === 'assistant' && onFeedback && (
          <AIFeedbackButtons
            messageId={message.id}
            onFeedback={onFeedback}
            disabled={feedbackSubmitted}
          />
        )}
      </div>
    </div>
  );
});
