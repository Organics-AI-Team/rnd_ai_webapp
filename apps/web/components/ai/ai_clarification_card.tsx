'use client';

import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Textarea } from '@/components/ui/textarea';

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
    <Surface variant="quiet" className="p-5" data-testid="ai-clarification-card">
      <div className="flex items-center gap-2 text-ink">
        <HelpCircle className="h-4 w-4 text-brand" />
        <span className="font-semibold">The assistant needs more detail</span>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink">
        {questions.map((question, index) => (
          <li key={index}>{question}</li>
        ))}
      </ul>
      {onSubmit && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = answer.trim();
            if (!normalized) return;
            onSubmit(normalized);
          }}
        >
          <label className="block text-xs font-semibold text-ink" htmlFor="ai-clarification-answer">
            Your answer
          </label>
          <Textarea
            id="ai-clarification-answer"
            value={answer}
            disabled={disabled}
            onChange={(event) => set_answer(event.target.value)}
            className="min-h-24"
          />
          <Button
            type="submit"
            disabled={disabled || answer.trim().length === 0}
            className="h-10 px-5"
          >
            Continue run
          </Button>
        </form>
      )}
    </Surface>
  );
}
