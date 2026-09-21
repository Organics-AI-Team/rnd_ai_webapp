'use client';

import React from 'react';
import { ShieldCheck, Check, X } from 'lucide-react';
import type { RunApprovalView } from '../../lib/agent_run_view';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';

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
    <Surface variant="quiet" className="border-amber-200 bg-amber-50 p-5" data-testid="ai-approval-card">
      <div className="flex items-center gap-2 text-amber-800">
        <ShieldCheck className="h-4 w-4" />
        <span className="font-medium">Approval required</span>
      </div>
      <p className="mt-2 text-sm text-ink">{approval.summary}</p>
      <p className="mt-1 text-xs font-medium text-muted">Tool: {approval.tool_name}</p>
      {is_manager ? (
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            disabled={disabled}
            onClick={() => onDecision?.('approve')}
            className="h-10 px-4"
          >
            <Check className="h-4 w-4" /> Approve
          </Button>
          <Button
            type="button"
            disabled={disabled}
            onClick={() => onDecision?.('deny')}
            variant="outline"
            className="h-10 px-4"
          >
            <X className="h-4 w-4" /> Deny
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs font-medium text-amber-800">
          A workspace manager must decide this approval.
        </p>
      )}
    </Surface>
  );
}
