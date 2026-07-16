'use client';

import React from 'react';
import { ShieldCheck, Check, X } from 'lucide-react';
import type { RunApprovalView } from '../../lib/agent_run_view';

/**
 * Props for {@link AiApprovalCard}.
 */
interface AiApprovalCardProps {
  /** The pending approval derived from the run's typed events. */
  approval: RunApprovalView;
  /** Invoked with the reviewer's decision (wired to the resume route). */
  onDecision?: (decision: 'approve' | 'deny') => void;
  /** Disables the buttons while a decision is in flight. */
  disabled?: boolean;
  /** Whether the verified session is displayed as a workspace manager. */
  is_manager?: boolean;
}

/**
 * Renders a pending approval interrupt with approve/deny actions. Purely
 * presentational: it reads only the typed approval state produced by the run
 * reducer and never inspects model prose.
 *
 * @param props - The pending approval and decision handler.
 * @returns The approval card element.
 */
export function AiApprovalCard({
  approval,
  onDecision,
  disabled,
  is_manager = false,
}: AiApprovalCardProps): React.ReactElement {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4" data-testid="ai-approval-card">
      <div className="flex items-center gap-2 text-amber-800">
        <ShieldCheck className="h-4 w-4" />
        <span className="font-medium">Approval required</span>
      </div>
      <p className="mt-2 text-sm text-gray-700">{approval.summary}</p>
      <p className="mt-1 text-xs text-gray-500">Tool: {approval.tool_name}</p>
      {is_manager ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDecision?.('approve')}
            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> Approve
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDecision?.('deny')}
            className="inline-flex items-center gap-1 rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-800 disabled:opacity-50"
          >
            <X className="h-4 w-4" /> Deny
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs font-medium text-amber-800">
          A workspace manager must decide this approval.
        </p>
      )}
    </div>
  );
}
