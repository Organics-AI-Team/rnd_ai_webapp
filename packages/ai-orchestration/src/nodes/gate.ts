/**
 * Gate: the deterministic per-action authorization node.
 *
 * Immediately before execution it re-checks (through the injected policy
 * engine) emergency disable, pinned policy/deployment status, tool allowlist,
 * permission, budget reservation, and approval class. The gate never executes
 * a tool and never trusts model claims — only catalogue and policy facts.
 *
 * Non-fatal denials return to the agent as typed policy_denied observations;
 * repeated identical normalized actions (denied or not) trip LOOP_DETECTED
 * and route to fail. Fatal denials (emergency disable, revoked pins) end the
 * run directly.
 */
import { Command } from "@langchain/langgraph";
import { is_loop_detected } from "../loop-detection";
import type { AgentLoopRuntime } from "../ports";
import { log_loop_event } from "../ports";
import {
  LOOP_NODE,
  build_run_error,
  fail_command,
  route_denial,
  to_run_error_code,
} from "../routing";
import type { AgentLoopStateType } from "../state";

/**
 * Authorize the pending proposed action and route the loop accordingly.
 *
 * @param state - Current loop state carrying the pending tool proposal.
 * @param runtime - Injected ports, policy engine, trusted context, config.
 * @returns Command to act (allowed), request_approval (approval class),
 *          agent (typed denial observation), or fail (loop trip / fatal
 *          denial / invariant violation).
 */
export async function gate(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): Promise<Command> {
  log_loop_event(runtime, "info", "gate.start", {
    iteration: state.iteration,
  });

  // Consume a verified approval recorded by request_approval (G4.7): an approved
  // action proceeds straight to act (every other gate condition already
  // cleared); a denied action is routed back to the agent (its denial
  // observation was already appended). The result is cleared so a later action
  // never inherits a stale approval.
  if (state.approval_result) {
    if (
      state.approval_result.status === "approved" &&
      state.pending_action?.kind === "tool" &&
      state.approval_result.action_arguments_hash ===
        state.pending_action.arguments_hash
    ) {
      // Approved for THIS exact action: proceed to act. The result is left on
      // the run for audit; because it is pinned to this action's hash a later,
      // different action can never inherit it (and the executor re-checks
      // approval independently).
      log_loop_event(runtime, "info", "gate.approval_consumed", {
        tool_name: state.pending_action.tool_name,
      });
      return new Command({ goto: LOOP_NODE.act });
    }
    if (state.approval_result.status === "denied") {
      log_loop_event(runtime, "info", "gate.approval_denied_replan");
      return new Command({
        goto: LOOP_NODE.agent,
        update: { pending_action: null },
      });
    }
  }

  const action = state.pending_action;
  if (!action || action.kind !== "tool") {
    log_loop_event(runtime, "error", "gate.missing_pending_action");
    return fail_command(
      build_run_error(
        runtime,
        "ORCHESTRATOR_INVARIANT_VIOLATION",
        "The gate received no pending tool action.",
      ),
    );
  }

  if (
    is_loop_detected(
      state.decision_log,
      action,
      runtime.config.loop_detection_threshold,
    )
  ) {
    log_loop_event(runtime, "warn", "gate.loop_detected", {
      tool_name: action.tool_name,
      threshold: runtime.config.loop_detection_threshold,
    });
    return fail_command(
      build_run_error(
        runtime,
        "LOOP_DETECTED",
        "The run repeated the same action too many times and was stopped.",
      ),
      { pending_action: null },
    );
  }

  const verdict = await runtime.policy.evaluate_action(
    { tool_name: action.tool_name, arguments: action.arguments },
    runtime.context,
  );

  if (verdict.kind === "denied") {
    if (verdict.fatal) {
      log_loop_event(runtime, "error", "gate.fatal_denial", {
        reason_code: verdict.reason_code,
      });
      return fail_command(
        build_run_error(
          runtime,
          to_run_error_code(verdict.reason_code),
          verdict.safe_reason,
        ),
        { pending_action: null },
      );
    }
    return route_denial(state, runtime, action, verdict);
  }

  if (verdict.kind === "approval_required") {
    log_loop_event(runtime, "info", "gate.approval_required", {
      tool_name: action.tool_name,
    });
    return new Command({ goto: LOOP_NODE.request_approval });
  }

  log_loop_event(runtime, "info", "gate.allowed", {
    tool_name: action.tool_name,
  });
  return new Command({ goto: LOOP_NODE.act });
}
