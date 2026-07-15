/**
 * Finalize: the deterministic terminal node (G4.8c).
 *
 * When the model proposes `finalize`, this node authoritatively validates any
 * tenant artifact the run produced (via the injected ArtifactService — the
 * orchestration package never holds material evidence itself), computes the
 * public run output, reconciles usage, and records completion. A blocking
 * validation finding is NOT silently accepted: while budget remains the node
 * routes back to the agent with a typed validation_finding observation so the
 * model can revise; only when the iteration budget is exhausted does it complete
 * with the findings surfaced as warnings and no confirmable artifact. The model
 * can never pass a failed deterministic check.
 */
import { Command } from "@langchain/langgraph";
import type { ArtifactReferenceV1, ValidationResultV1 } from "../contracts";
import { build_run_event } from "../events";
import type { ArtifactValidationFindingV1, AgentLoopRuntime } from "../ports";
import { log_loop_event } from "../ports";
import { build_output_document } from "../output";
import type { BuildOutputArgs } from "../output";
import { LOOP_NODE, build_run_error } from "../routing";
import { build_observation } from "../schemas/observation";
import type { AgentLoopStateType, AgentLoopStateUpdate } from "../state";

/** A formula/tenant artifact recovered from the run's observations. */
interface ArtifactCandidate {
  /** The parsed tool-produced artifact payload passed to the ArtifactService. */
  readonly artifact: unknown;
  /** Stable content hash of the producing observation — the draft artifact id. */
  readonly content_hash: string;
}

/**
 * Recover the most recent tenant artifact the run produced, if any.
 *
 * Scans observations newest-first for a tool_result whose producing tool is
 * registered as `produces_artifact`, then parses its recorded content. Returns
 * null for runs that produced no artifact (the common answer-only path), which
 * keeps finalize behavior unchanged for non-artifact runs.
 *
 * @param state - Current loop state.
 * @param runtime - Node runtime (tool registry).
 * @returns The recovered candidate, or null.
 */
function extract_artifact_candidate(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): ArtifactCandidate | null {
  for (let index = state.observations.length - 1; index >= 0; index -= 1) {
    const observation = state.observations[index]!;
    if (observation.type !== "tool_result") continue;
    const tool_name = observation.source.tool_name;
    if (!tool_name) continue;
    const definition = runtime.ports.tools.describe(tool_name, runtime.context);
    if (!definition?.produces_artifact) continue;
    try {
      return {
        artifact: JSON.parse(observation.content),
        content_hash: observation.content_hash,
      };
    } catch {
      // A produces_artifact tool result must be JSON; skip an unparseable one.
      return null;
    }
  }
  return null;
}

/**
 * Map ArtifactService findings to the public ValidationResultV1 shape.
 *
 * @param findings - Deterministic validation findings.
 * @returns One ValidationResultV1 per finding (blocking → failed), capped at 100.
 */
function to_validation_results(
  findings: readonly ArtifactValidationFindingV1[],
): ValidationResultV1[] {
  return findings.slice(0, 100).map((finding) => ({
    code: finding.code,
    passed: finding.severity !== "blocking",
    detail: finding.safe_message.slice(0, 500),
  }));
}

/**
 * Reconcile usage, record completion, and emit the run.completed event.
 *
 * @param state - Current loop state.
 * @param runtime - Node runtime (usage/runs ports, clock, ids).
 * @param args - Output document arguments (status, answer, quality, artifacts).
 * @returns Terminal state update; the static finalize→END edge ends the run.
 */
async function complete_run(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
  args: BuildOutputArgs,
): Promise<AgentLoopStateUpdate> {
  const output = build_output_document(state, runtime, args);
  await runtime.ports.usage.reconcile(
    state.run_id,
    {
      model_calls: state.usage.model_calls,
      tool_calls: state.usage.tool_calls,
      tokens_used: state.usage.tokens_used,
      cost_usd_used: state.usage.cost_usd_used,
    },
    runtime.context,
  );
  await runtime.ports.runs.mark_completed(state.run_id, output, runtime.context);
  const events = [
    build_run_event(
      state,
      { clock: runtime.ports.clock, ids: runtime.ports.ids },
      0,
      "run.completed",
      { status: "completed", output_schema_version: "1" },
    ),
  ];
  log_loop_event(runtime, "info", "finalize.finish");
  return { output, pending_action: null, events };
}

/**
 * Route a blocking finalize-time validation back to the agent as an observation.
 *
 * @param state - Current loop state.
 * @param runtime - Node runtime (ids, clock).
 * @param blocking - The blocking findings that prevent finalization.
 * @returns Command targeting the agent with a typed validation_finding.
 */
function route_finalize_revision(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
  blocking: readonly ArtifactValidationFindingV1[],
): Command {
  const { clock, ids } = runtime.ports;
  const observation = build_observation({
    observation_id: ids.next_id(),
    run_id: state.run_id,
    iteration: state.iteration,
    type: "validation_finding",
    source: { kind: "system", tool_name: null, source_ids: [] },
    content: JSON.stringify(
      blocking.map((finding) => ({
        code: finding.code,
        safe_message: finding.safe_message,
      })),
    ),
    trust: "trusted_system",
    cost_usd: "0",
    latency_ms: 0,
    occurred_at: clock.now_iso(),
    metadata: { blocking: true, phase: "finalize", finding_count: blocking.length },
  });
  const sources = { clock, ids };
  log_loop_event(runtime, "warn", "finalize.blocking_revision", {
    blocking_count: blocking.length,
  });
  return new Command({
    goto: LOOP_NODE.agent,
    update: {
      pending_action: null,
      observations: [observation],
      events: [
        build_run_event(state, sources, 0, "observation.added", {
          observation_id: observation.observation_id,
          observation_type: observation.type,
          trust: observation.trust,
          source_kind: observation.source.kind,
          tool_name: null,
          content_hash: observation.content_hash,
        }),
        build_run_event(state, sources, 1, "stage.changed", { stage: "thinking" }),
      ],
    },
  });
}

/**
 * Finalize the run: validate any produced artifact, then complete or revise.
 *
 * @param state - Current loop state carrying the finalize proposal.
 * @param runtime - Injected ports and trusted context.
 * @returns A terminal state update (→ END via the static edge) on completion, or
 *          a Command routing back to the agent when a blocking validation still
 *          has budget to be revised.
 */
export async function finalize(
  state: AgentLoopStateType,
  runtime: AgentLoopRuntime,
): Promise<AgentLoopStateUpdate | Command> {
  log_loop_event(runtime, "info", "finalize.start");
  const action = state.pending_action;
  if (!action || action.kind !== "finalize") {
    log_loop_event(runtime, "error", "finalize.missing_request");
    return {
      error: build_run_error(
        runtime,
        "ORCHESTRATOR_INVARIANT_VIOLATION",
        "Finalize was reached without a finalize proposal.",
      ),
    };
  }

  const base_args: BuildOutputArgs = {
    status: "completed",
    answer: action.request.answer,
    citations: action.request.citations,
    uncertainty: action.request.uncertainty,
  };

  const candidate = extract_artifact_candidate(state, runtime);
  if (!candidate) {
    return complete_run(state, runtime, base_args);
  }

  const validation = await runtime.ports.artifacts.validate_draft(
    candidate.artifact,
    runtime.context,
  );
  const blocking = validation.findings.filter(
    (finding) => finding.severity === "blocking",
  );
  const validation_results = to_validation_results(validation.findings);

  if (blocking.length > 0) {
    const remaining = state.budget.max_iterations - state.iteration;
    if (remaining > 0) {
      return route_finalize_revision(state, runtime, blocking);
    }
    // Budget exhausted: complete honestly with the blocking findings surfaced
    // as warnings and NO confirmable artifact reference.
    log_loop_event(runtime, "warn", "finalize.blocking_budget_exhausted", {
      blocking_count: blocking.length,
    });
    return complete_run(state, runtime, {
      ...base_args,
      quality_dimensions: validation.quality_dimensions,
      validation_results,
      extra_warnings: blocking.map((finding) => finding.safe_message),
    });
  }

  const artifact_reference: ArtifactReferenceV1 = {
    artifact_id: candidate.content_hash,
    artifact_type: "formula",
    version: 1,
    status: "draft",
  };
  return complete_run(state, runtime, {
    ...base_args,
    quality_dimensions: validation.quality_dimensions,
    validation_results,
    artifacts: [artifact_reference],
  });
}
