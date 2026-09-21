'use client';

import React from 'react';
import { Activity, AlertCircle, CheckCircle2, FileBox, Search, Square, Wrench } from 'lucide-react';

import type { AgentRunClientError } from '../../lib/agent_run_client';
import type { AgentRunViewState } from '../../lib/agent_run_view';
import { MarkdownRenderer } from '@/ai/components/chat/markdown-renderer';
import { AiApprovalCard } from './ai_approval_card';
import { AiClarificationCard } from './ai_clarification_card';
import { AiEvidenceList } from './ai_evidence_list';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';

/** Props for the reusable governed-run status panel. */
export interface AiRunViewProps {
  readonly state: AgentRunViewState;
  readonly client_error: AgentRunClientError | null;
  readonly is_streaming: boolean;
  readonly is_resuming: boolean;
  readonly is_manager: boolean;
  readonly on_clarification: (answer: string) => void;
  readonly on_approval: (approval_id: string, decision: 'approve' | 'deny') => void;
  readonly on_cancel_stream: () => void;
}

const STAGE_LABELS: Readonly<Record<NonNullable<AgentRunViewState['stage']>, string>> = {
  thinking: 'Thinking',
  acting: 'Acting',
  waiting_user: 'Waiting for you',
  finalizing: 'Finalizing',
};

/**
 * Render public typed run events and terminal output without prose-derived state.
 *
 * @param props - Typed reducer state and strict user actions.
 * @returns The run panel, or null before a run/event/error exists.
 */
export function AiRunView({
  state,
  client_error,
  is_streaming,
  is_resuming,
  is_manager,
  on_clarification,
  on_approval,
  on_cancel_stream,
}: AiRunViewProps): React.ReactElement | null {
  if (state.last_sequence < 0 && client_error === null && !is_streaming) return null;

  const artifacts = state.output?.artifacts ?? state.artifacts;
  const activity = [
    ...state.decisions.map((decision) => ({ type: 'decision' as const, sequence: decision.sequence, decision })),
    ...state.actions.map((action) => ({ type: 'action' as const, sequence: action.sequence, action })),
  ].sort((left, right) => left.sequence - right.sequence);

  return (
    <section className="space-y-3 py-3" aria-label="AI run activity" data-testid="ai-run-view">
      <Surface variant="quiet" className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink" data-testid="run-stage">
          <Activity className="h-4 w-4 text-brand" />
          <span>{state.stage ? STAGE_LABELS[state.stage] : 'Run accepted'}</span>
        </div>
        {is_streaming && (
          <Button
            type="button"
            onClick={on_cancel_stream}
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
          >
            <Square className="h-3 w-3" /> Stop live updates
          </Button>
        )}
      </Surface>

      {activity.length > 0 && (
        <Surface variant="default" className="p-4" data-testid="run-activity">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Decision trail</h3>
          <ol className="mt-3 space-y-2 text-sm text-ink">
            {activity.map((item) => item.type === 'decision' ? (
              <li key={`decision-${item.sequence}`} className="flex gap-2">
                <Search className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                <span><span className="font-medium">Step {item.decision.iteration}:</span>{' '}{item.decision.rationale_summary}</span>
              </li>
            ) : (
              <li key={`action-${item.sequence}-${item.action.action_id}`} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2"><Wrench className="h-4 w-4 text-muted" />{item.action.tool_name}</span>
                <span className="text-xs uppercase text-muted">
                  {item.action.status}{item.action.latency_ms !== null ? ` · ${item.action.latency_ms} ms` : ''}
                </span>
              </li>
            ))}
          </ol>
        </Surface>
      )}

      <AiEvidenceList observations={state.observations} citations={state.output?.citations} />

      {state.pending_clarification && (
        <AiClarificationCard
          questions={state.pending_clarification}
          onSubmit={on_clarification}
          disabled={is_resuming}
        />
      )}

      {state.pending_approval && (
        <AiApprovalCard
          approval={state.pending_approval}
          is_manager={is_manager}
          disabled={is_resuming}
          onDecision={(decision) => on_approval(state.pending_approval!.approval_id, decision)}
        />
      )}

      {artifacts.map((artifact) => (
        <Surface
          key={artifact.artifact_id}
          variant="quiet"
          className="flex items-center justify-between p-4 text-sm"
          data-testid="artifact-card"
        >
          <span className="inline-flex items-center gap-2 font-semibold text-ink">
            <FileBox className="h-4 w-4 text-brand" /> Formula artifact
          </span>
          <span className="text-xs font-medium text-muted">
            {artifact.artifact_id} · v{artifact.version}
            {'status' in artifact ? ` · ${artifact.status}` : ''}
          </span>
        </Surface>
      ))}

      {state.usage && (
        <p className="text-right text-xs font-medium text-muted">
          {state.usage.tokens_used} tokens · ${state.usage.cost_usd_used}
          {state.usage.model_latency_ms !== null
            ? ` · model ${state.usage.model_latency_ms} ms`
            : ''}
        </p>
      )}

      {state.output?.answer && (
        <Surface variant="default" className="p-5 text-sm text-ink" data-testid="run-answer">
          <MarkdownRenderer content={state.output.answer} />
        </Surface>
      )}

      {state.output && (
        <Surface asChild variant="default">
          <details className="p-4 text-sm" data-testid="run-decision-summary">
            <summary className="cursor-pointer font-semibold text-ink">Evidence and decision summary</summary>
            <div className="mt-3 space-y-3 text-ink">
            {state.output.decision_summary.action_rationales.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {state.output.decision_summary.action_rationales.map((rationale, index) => (
                  <li key={`rationale-${index}`}>{rationale}</li>
                ))}
              </ul>
            )}
            {state.output.decision_summary.uncertainty.length > 0 && (
              <div>
                <p className="font-medium text-amber-700">Uncertainty</p>
                <ul className="list-disc space-y-1 pl-5">
                  {state.output.decision_summary.uncertainty.map((item, index) => (
                    <li key={`uncertainty-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            </div>
          </details>
        </Surface>
      )}

      {state.status === 'completed' && (
        <Surface variant="quiet" className="flex items-center gap-2 p-4 text-sm font-medium text-ink" data-testid="run-completed">
          <CheckCircle2 className="h-4 w-4 text-brand" /> Run completed
        </Surface>
      )}

      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="run-failed">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" /> {state.error.code}
          </div>
          <p className="mt-1">{state.error.safe_message}</p>
        </div>
      )}

      {client_error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="run-client-error">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" /> {client_error.code}
          </div>
          <p className="mt-1">{client_error.message}</p>
        </div>
      )}
    </section>
  );
}
