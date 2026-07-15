/**
 * Approval interrupt node (G4.7).
 *
 * For a commit-class action the gate routed here, this node idempotently upserts
 * the approval (replay returns the same one — exactly once), then durably
 * interrupts with an ApprovalRequestV1. On resume the ApprovalService verifies
 * tenant, checkpoint, permission, decider, expiry, and status. The node records
 * the verified `approval_result` and returns to the gate (fixed edge); the gate
 * consumes an approved result to route to `act`, and a denied result back to the
 * agent as an observation. The interrupt is never wrapped in try/catch.
 */

import { interrupt } from "@langchain/langgraph";
import type { ProposedActionV1 } from "../contracts";
import { build_observation } from "../schemas/observation";
import type { AgentLoopRuntime } from "../ports";
import { log_loop_event } from "../ports";
import { build_run_error } from "../routing";
import type { AgentLoopStateType, AgentLoopStateUpdate } from "../state";

/**
 * Deterministic per-action approval idempotency key (stable across replay).
 *
 * @param run_id - Run identifier.
 * @param action - The commit-class tool proposal awaiting approval.
 * @returns The approval idempotency key.
 */
export function approval_idempotency_key(
  run_id: string,
  action: Extract<ProposedActionV1, { kind: "tool" }>,
): string {
  return `${run_id}:approval:${action.tool_name}:${action.arguments_hash}`;
}

/**
 * Interrupt for a manager approval and record the verified decision. Routing on
 * the decision is performed by the gate (fixed edge back to gate).
 *
 * @param state - Current loop state (pending_action must be a tool action).
 * @param runtime - Injected ports and trusted context.
 * @returns State update with approval_result (and a denial observation).
 */
export async function request_approval(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): Promise<AgentLoopStateUpdate> {
  const action = state.pending_action;
  if (!action || action.kind !== "tool") {
    log_loop_event(runtime, "error", "request_approval.missing_action");
    return {
      error: build_run_error(
        runtime,
        "ORCHESTRATOR_INVARIANT_VIOLATION",
        "Approval was reached without a pending tool action.",
      ),
    };
  }

  const key = approval_idempotency_key(state.run_id, action);
  const summary = `Approve ${action.tool_name} (${action.arguments_hash.slice(0, 8)}).`;
  const approval = await runtime.ports.approvals.ensure_pending(
    state.run_id,
    key,
    summary,
    runtime.context,
  );
  log_loop_event(runtime, "info", "request_approval.pending", {
    approval_id: approval.approval_id,
  });

  const resumed = interrupt({
    schema_version: "1",
    approval_id: approval.approval_id,
    run_id: state.run_id,
    summary,
  });

  const result = await runtime.ports.approvals.verify_resume(
    { run_id: state.run_id, action_idempotency_key: key, resume: resumed },
    runtime.context,
  );

  if (result.status === "approved") {
    log_loop_event(runtime, "info", "request_approval.approved", {
      approval_id: result.approval_id,
    });
    return {
      approval_result: { ...result, action_arguments_hash: action.arguments_hash },
    };
  }

  const { clock, ids } = runtime.ports;
  const observation = build_observation({
    observation_id: ids.next_id(),
    run_id: state.run_id,
    iteration: state.iteration,
    type: "policy_denied",
    source: { kind: "system", tool_name: action.tool_name, source_ids: [] },
    content: JSON.stringify({
      reason: "approval_denied",
      tool_name: action.tool_name,
      approval_id: result.approval_id,
    }),
    trust: "trusted_system",
    cost_usd: "0",
    latency_ms: 0,
    occurred_at: clock.now_iso(),
    metadata: { approval_id: result.approval_id },
  });
  log_loop_event(runtime, "info", "request_approval.denied", {
    approval_id: result.approval_id,
  });
  return { approval_result: result, pending_action: null, observations: [observation] };
}
