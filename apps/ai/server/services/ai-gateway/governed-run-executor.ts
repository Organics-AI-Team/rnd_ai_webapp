/**
 * Durable agentic graph executor for the private run worker.
 *
 * Rebuilds the runtime outside model-visible input, verifies every stored pin,
 * invokes the checkpointed graph for start/resume commands, and reduces the
 * materialized graph state into the worker's terminal/interim result. It never
 * switches executors and never repairs a drifted context pack.
 */

import type { Document, WithId } from "mongodb";
import {
  Command,
  agent_run_event_v1_schema,
  agent_run_input_v1_schema,
  agent_run_output_v1_schema,
  build_initial_loop_state,
  build_thread_config,
  compile_agent_loop_graph,
  run_error_v1_schema,
  validate_context_pack,
  type AgentLoopRuntime,
  type AgentLoopStateType,
  type ContextPackV1,
} from "@rnd-ai/ai-orchestration";

import type { ClaimedRunJob } from "./run-job-queue";
import type { RunExecutionResult, RunExecutor } from "./run-worker";

/** Runtime and context pack rebuilt from trusted persistence for one run. */
export interface AgenticRunRuntimeBundle {
  readonly runtime: AgentLoopRuntime;
  readonly context_pack: ContextPackV1;
}

/** Minimal compiled graph surface used by the executor. */
export interface CompiledRunGraph {
  invoke(input: unknown, config: unknown): Promise<unknown>;
}

/** Injectable construction seams; production uses the real graph compiler. */
export interface AgenticRunExecutorDeps {
  readonly load_runtime: (
    run: WithId<Document>,
    job: ClaimedRunJob,
  ) => Promise<AgenticRunRuntimeBundle>;
  readonly create_checkpointer: (run: WithId<Document>) => Promise<unknown>;
  readonly compile_graph?: (
    runtime: AgentLoopRuntime,
    checkpointer: unknown,
  ) => CompiledRunGraph;
  readonly now: () => Date;
  readonly run_timeout_ms: number;
}

/** Stable fail-closed error for malformed/drifted persisted execution state. */
export class RunExecutionStateInvalidError extends Error {
  readonly code = "RUN_EXECUTION_STATE_INVALID";
  readonly retryable = false;
  constructor() {
    super("The pinned run execution state is invalid or unavailable.");
    this.name = "RunExecutionStateInvalidError";
  }
}

function required_string(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RunExecutionStateInvalidError();
  }
  return value;
}

function required_positive_integer(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new RunExecutionStateInvalidError();
  }
  return number;
}

/** Convert integer micro-USD to the decimal USD string required by the loop. */
function microusd_to_usd(value: unknown): string {
  const text = required_string(value);
  if (!/^\d+$/.test(text)) throw new RunExecutionStateInvalidError();
  const micros = BigInt(text);
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

/** Verify the runtime identity was reconstructed from this exact AIRun. */
function assert_runtime_scope(
  runtime: AgentLoopRuntime,
  run: WithId<Document>,
  run_id: string,
): void {
  if (
    runtime.context.tenant_id !== String(run.tenantId) ||
    runtime.context.actor_profile_id !== String(run.actorProfileId) ||
    runtime.context.run_id !== run_id ||
    runtime.context.correlation_id !== String(run.correlationId)
  ) {
    throw new RunExecutionStateInvalidError();
  }
}

/** Build the first graph input exclusively from validated stored fields. */
function initial_state(
  run: WithId<Document>,
  context_pack: ContextPackV1,
  now: Date,
  timeout_ms: number,
): AgentLoopStateType {
  const parsed_input = agent_run_input_v1_schema.safeParse(run.input);
  if (!parsed_input.success || timeout_ms <= 0) {
    throw new RunExecutionStateInvalidError();
  }
  const input = parsed_input.data;
  if (String(run.threadId) !== input.thread_id || String(run.agentKey) !== input.agent_key) {
    throw new RunExecutionStateInvalidError();
  }
  const request_budget = run.requestBudget as Record<string, unknown> | undefined;
  if (!request_budget) throw new RunExecutionStateInvalidError();

  return build_initial_loop_state({
    run_id: String(run._id),
    thread_id: input.thread_id,
    tenant_id: required_string(run.tenantId),
    actor_profile_id: required_string(run.actorProfileId),
    input,
    context_pack,
    pins: {
      orchestrator_version: required_string(run.orchestratorVersion),
      policy_version: required_positive_integer(run.policyVersion).toString(),
      deployment_version: required_string(run.agentDefinitionVersion),
      prompt_version: required_string(run.promptVersionId),
      context_pack_hash: required_string(run.contextPackHash),
    },
    budget: {
      max_iterations: required_positive_integer(request_budget.max_iterations),
      max_total_tokens: required_positive_integer(request_budget.max_total_tokens),
      max_cost_usd: microusd_to_usd(request_budget.max_cost_microusd),
    },
    started_at: now.toISOString(),
    deadline_at: new Date(now.getTime() + timeout_ms).toISOString(),
  }) as AgentLoopStateType;
}

/** Validate and reduce a materialized graph state into a worker result. */
function execution_result(raw: unknown): RunExecutionResult {
  if (!raw || typeof raw !== "object") throw new RunExecutionStateInvalidError();
  const state = raw as Record<string, unknown>;
  if (!Array.isArray(state.events)) throw new RunExecutionStateInvalidError();
  const events = state.events.map((event) => {
    const parsed = agent_run_event_v1_schema.safeParse(event);
    if (!parsed.success) throw new RunExecutionStateInvalidError();
    return parsed.data;
  });

  const output = agent_run_output_v1_schema.safeParse(state.output);
  if (output.success) {
    if (output.data.status !== "completed") throw new RunExecutionStateInvalidError();
    return {
      status: "completed",
      events,
      output: output.data,
      usage_summary: output.data.usage_summary,
    };
  }

  const error = run_error_v1_schema.safeParse(state.error);
  if (error.success) {
    return {
      status: "failed",
      events,
      ...(error.data.partial_output ? { output: error.data.partial_output } : {}),
      ...(error.data.partial_output
        ? { usage_summary: error.data.partial_output.usage_summary }
        : {}),
      error_code: error.data.code,
    };
  }

  const pending = state.pending_action as { kind?: unknown } | null | undefined;
  if (pending?.kind === "clarification") {
    return {
      status: "waiting_clarification",
      events,
      current_stage: "waiting_user",
    };
  }
  if (pending?.kind === "tool") {
    return {
      status: "waiting_approval",
      events,
      current_stage: "waiting_user",
    };
  }
  throw new RunExecutionStateInvalidError();
}

/** Create the durable agentic executor consumed by `process_one_job`. */
export function create_agentic_run_executor(deps: AgenticRunExecutorDeps): RunExecutor {
  const compile =
    deps.compile_graph ??
    ((runtime: AgentLoopRuntime, checkpointer: unknown) =>
      compile_agent_loop_graph(
        runtime,
        checkpointer as Parameters<typeof compile_agent_loop_graph>[1],
      ) as unknown as CompiledRunGraph);

  return {
    async execute(job, run) {
      if (
        String(run.executor) !== "agentic" ||
        job.run_id !== String(run._id) ||
        job.tenant_id !== String(run.tenantId)
      ) {
        throw new RunExecutionStateInvalidError();
      }
      const { runtime, context_pack } = await deps.load_runtime(run, job);
      assert_runtime_scope(runtime, run, job.run_id);
      const validated_pack = validate_context_pack(context_pack);
      if (validated_pack.pack_hash !== String(run.contextPackHash)) {
        throw new RunExecutionStateInvalidError();
      }

      const checkpointer = await deps.create_checkpointer(run);
      const graph = compile(runtime, checkpointer) as CompiledRunGraph;
      const config = build_thread_config(job.tenant_id, required_string(run.threadId));
      const graph_input =
        job.command === "start"
          ? initial_state(run, validated_pack, deps.now(), deps.run_timeout_ms)
          : new Command({ resume: job.resume_payload });
      if (job.command === "resume" && job.resume_payload === undefined) {
        throw new RunExecutionStateInvalidError();
      }
      return execution_result(await graph.invoke(graph_input, config));
    },
  };
}
