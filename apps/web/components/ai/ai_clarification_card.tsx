'use client';

import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Props for {@link AiClarificationCard}.
 */
interface AiClarificationCardProps {
  /** The clarifying questions the run is waiting on (from typed events). */
  questions: readonly string[];
  /** Submit an actor-free clarification response through the resume route. */
  onSubmit?: (answer: string) => void;
  /** Disable response controls while a resume request is in flight. */
  disabled?: boolean;
}

/**
 * Renders the clarifying questions of a paused run. Purely presentational: the
 * questions come from the run reducer's typed clarification state, not from
 * parsing model prose.
 *
 * @param props - The pending clarification questions.
 * @returns The clarification card element, or null when there are no questions.
 */
export function AiClarificationCard({
  questions,
  onSubmit,
  disabled = false,
}: AiClarificationCardProps): React.ReactElement | null {
  const [answer, set_answer] = useState('');
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
      {onSubmit && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = answer.trim();
            if (!normalized) return;
            onSubmit(normalized);
          }}
        >
          <label className="block text-xs font-medium text-blue-800" htmlFor="ai-clarification-answer">
            Your answer
          </label>
          <textarea
            id="ai-clarification-answer"
            value={answer}
            disabled={disabled}
            onChange={(event) => set_answer(event.target.value)}
            className="min-h-20 w-full rounded-md border border-blue-200 bg-white p-2 text-sm text-gray-800 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={disabled || answer.trim().length === 0}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Continue run
          </button>
        </form>
      )}
    </div>
  );
}
