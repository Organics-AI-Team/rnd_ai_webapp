'use client';

import React from 'react';
import { Activity, AlertCircle, CheckCircle2, FileBox, Square } from 'lucide-react';

import type { AgentRunClientError } from '../../lib/agent_run_client';
import type { AgentRunViewState } from '../../lib/agent_run_view';
import { MarkdownRenderer } from '@/ai/components/chat/markdown-renderer';
import { AiApprovalCard } from './ai_approval_card';
import { AiClarificationCard } from './ai_clarification_card';
import { AiEvidenceList } from './ai_evidence_list';

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

  return (
    <section className="space-y-3 py-3" aria-label="AI run activity" data-testid="ai-run-view">
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-gray-700" data-testid="run-stage">
          <Activity className="h-4 w-4" />
          <span>{state.stage ? STAGE_LABELS[state.stage] : 'Run accepted'}</span>
        </div>
        {is_streaming && (
          <button
            type="button"
            onClick={on_cancel_stream}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <Square className="h-3 w-3" /> Stop live updates
          </button>
        )}
      </div>

      {(state.decisions.length > 0 || state.actions.length > 0) && (
        <div className="rounded-lg border border-gray-200 bg-white p-3" data-testid="run-activity">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Activity</h3>
          <ol className="mt-2 space-y-2 text-sm text-gray-700">
            {state.decisions.map((decision) => (
              <li key={`decision-${decision.iteration}-${decision.kind}`}>
                <span className="font-medium">Decision {decision.iteration}:</span>{' '}
                {decision.rationale_summary}
              </li>
            ))}
            {state.actions.map((action) => (
              <li key={action.action_id} className="flex items-center justify-between gap-3">
                <span>{action.tool_name}</span>
                <span className="text-xs uppercase text-gray-400">{action.status}</span>
              </li>
            ))}
          </ol>
        </div>
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
        <div
          key={artifact.artifact_id}
          className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm"
          data-testid="artifact-card"
        >
          <span className="inline-flex items-center gap-2 font-medium text-violet-800">
            <FileBox className="h-4 w-4" /> Formula artifact
          </span>
          <span className="text-xs text-violet-600">
            {artifact.artifact_id} · v{artifact.version}
            {'status' in artifact ? ` · ${artifact.status}` : ''}
          </span>
        </div>
      ))}

      {state.usage && (
        <p className="text-right text-xs text-gray-400">
          {state.usage.tokens_used} tokens · ${state.usage.cost_usd_used}
        </p>
      )}

      {state.output?.answer && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-900" data-testid="run-answer">
          <MarkdownRenderer content={state.output.answer} />
        </div>
      )}

      {state.status === 'completed' && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800" data-testid="run-completed">
          <CheckCircle2 className="h-4 w-4" /> Run completed
        </div>
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
