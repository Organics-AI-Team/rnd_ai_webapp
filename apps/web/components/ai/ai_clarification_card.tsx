'use client';

import React from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Props for {@link AiClarificationCard}.
 */
interface AiClarificationCardProps {
  /** The clarifying questions the run is waiting on (from typed events). */
  questions: readonly string[];
}

/**
 * Renders the clarifying questions of a paused run. Purely presentational: the
 * questions come from the run reducer's typed clarification state, not from
 * parsing model prose.
 *
 * @param props - The pending clarification questions.
 * @returns The clarification card element, or null when there are no questions.
 */
export function AiClarificationCard({ questions }: AiClarificationCardProps): React.ReactElement | null {
  if (questions.length === 0) return null;
  return (
    <div className="rounded-lg border border-blue-300 bg-blue-50 p-4" data-testid="ai-clarification-card">
      <div className="flex items-center gap-2 text-blue-800">
        <HelpCircle className="h-4 w-4" />
        <span className="font-medium">The assistant needs more detail</span>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
        {questions.map((question, index) => (
          <li key={index}>{question}</li>
        ))}
      </ul>
    </div>
  );
}
