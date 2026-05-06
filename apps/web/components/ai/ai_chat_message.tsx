'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
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

const themeColorMap = {
  blue: { icon: 'text-blue-500', bg: 'bg-blue-50/80', badge: 'bg-blue-50/80 text-blue-600 border-blue-200/60' },
  green: { icon: 'text-emerald-500', bg: 'bg-emerald-50/80', badge: 'bg-emerald-50/80 text-emerald-600 border-emerald-200/60' },
  purple: { icon: 'text-violet-500', bg: 'bg-violet-50/80', badge: 'bg-violet-50/80 text-violet-600 border-violet-200/60' },
  orange: { icon: 'text-orange-500', bg: 'bg-orange-50/80', badge: 'bg-orange-50/80 text-orange-600 border-orange-200/60' },
};

function getDisplayContent(content: string): string {
  const leakedToolTrace =
    content.includes('I reached the maximum number of reasoning steps') &&
    content.includes('**Tool:');

  if (!leakedToolTrace) return content;

  return [
    'ขออภัย ระบบดึงข้อมูลจากเครื่องมือได้แล้ว แต่ยังสรุปคำตอบสุดท้ายไม่สมบูรณ์',
    '',
    'กรุณาลองส่งคำถามอีกครั้งแบบเจาะจงขึ้น เช่น ระบุ product type, target benefits, texture, หรือข้อจำกัดของสูตร',
  ].join('\n');
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
  themeColor = 'blue',
  metadataIcon,
  metadataLabel = 'Enhanced',
  onFeedback,
  feedbackSubmitted = false,
  onQuickAction,
}: AIChatMessageProps) {
  const colors = themeColorMap[themeColor];
  const displayContent = getDisplayContent(message.content);
  const processSteps = getProcessSteps(message.metadata);

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
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-medium text-gray-700">
            {message.role === 'assistant' ? 'AI' : 'คุณ'}
          </span>
          <span className="text-[10px] text-gray-300 tabular-nums">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {message.role === 'assistant' ? (
          <div className="text-sm text-gray-900 leading-relaxed break-words overflow-hidden">
            <MarkdownRenderer content={displayContent} />
          </div>
        ) : (
          <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">{displayContent}</p>
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
              <Badge variant="outline" className={`text-[10px] leading-none px-1.5 py-0.5 font-normal ${colors.badge}`}>
                {metadataIcon && <span className="mr-0.5">{metadataIcon}</span>}
                {metadataLabel}
              </Badge>
            )}
            {message.metadata.confidence != null && message.metadata.confidence > 0 && (
              <span className="text-[10px] text-gray-300 tabular-nums">
                {(message.metadata.confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
        )}

        {message.role === 'assistant' && processSteps.length > 0 && (
          <details className="group mt-2 text-[11px] text-gray-400">
            <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-md px-1.5 py-1 hover:bg-gray-50 hover:text-gray-600">
              <span className="transition-transform group-open:rotate-90">›</span>
              <span>ขั้นตอน</span>
              <span className="text-gray-300">({processSteps.length})</span>
            </summary>
            <div className="mt-1 ml-4 border-l border-gray-100 pl-3 text-gray-500">
              {processSteps.map((step, index) => (
                <div key={`${step.key}-${index}`} className="py-0.5">
                  {index + 1}. {step.label}
                </div>
              ))}
              {message.metadata.responseTime != null && message.metadata.responseTime > 0 && (
                <div className="py-0.5 text-gray-400">
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
