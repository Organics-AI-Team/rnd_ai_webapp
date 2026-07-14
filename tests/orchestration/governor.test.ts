import { describe, expect, it } from "vitest";
import { Command } from "@langchain/langgraph";
import { act } from "../../packages/ai-orchestration/src/nodes/act";
import { fail } from "../../packages/ai-orchestration/src/nodes/fail";
import { gate } from "../../packages/ai-orchestration/src/nodes/gate";
import {
  count_identical_proposals,
  is_loop_detected,
  normalize_action_signature,
} from "../../packages/ai-orchestration/src/loop-detection";
import { compile_agent_loop_graph } from "../../packages/ai-orchestration/src/graph";
import { hash_arguments } from "../../packages/ai-orchestration/src/hash";
import { build_observation } from "../../packages/ai-orchestration/src/schemas/observation";
import { build_initial_loop_state } from "../../packages/ai-orchestration/src/state";
import type { AgentLoopStateType } from "../../packages/ai-orchestration/src/state";
import type { ActionVerdictV1 } from "../../packages/ai-orchestration/src/ports";
import {
  FakeArtifactService,
  FakePolicyEngine,
  FakeToolExecutor,
  ScriptedModelGateway,
  goto_targets,
  make_fake_runtime,
  make_loop_state,
  make_pending_tool_action,
  make_tool_decision,
  make_tool_definition,
  tool_call_turn,
} from "./helpers/fake_runtime";

const search_args = { query: "humectants" };

/**
 * Build a state carrying one pending tool proposal ready for the gate.
 *
 * @param tool_name - Proposed tool.
 * @param args - Proposed arguments.
 * @param overrides - Extra channel overrides.
 * @returns Loop state at iteration 1 with the pending action set.
 */
function state_with_pending(
  tool_name: string,
  args: unknown,
  overrides: Partial<AgentLoopStateType> = {},
): AgentLoopStateType {
  return make_loop_state({
    iteration: 1,
    pending_action: make_pending_tool_action(tool_name, args),
    decision_log: [make_tool_decision(tool_name, args, 1)],
    ...overrides,
  });
}

/**
 * Verdict function denying a specific reason for every action.
 *
 * @param reason_code - Stable denial reason code.
 * @param fatal - Whether the denial ends the run.
 * @returns Policy decide function for FakePolicyEngine.
 */
function deny_with(reason_code: string, fatal: boolean) {
  return (): ActionVerdictV1 => ({
    kind: "denied",
    reason_code,
    safe_reason: `Denied by tenant policy (${reason_code}).`,
    fatal,
  });
}

describe("gate node", () => {
  it.each([
    ["POLICY_TOOL_NOT_ALLOWED"],
    ["POLICY_PERMISSION_MISSING"],
    ["BUDGET_RESERVATION_FAILED"],
  ])(
    "returns a typed %s denial observation to the agent",
    async (reason_code) => {
      const policy = new FakePolicyEngine(deny_with(reason_code, false));
      const { runtime, tools } = make_fake_runtime({ policy });
      const state = state_with_pending("knowledge.search", search_args);
      const command = (await gate(state, runtime)) as Command;
      expect(goto_targets(command)).toEqual(["agent"]);
      const update = command.update as Partial<AgentLoopStateType>;
      const denial = update.observations?.at(-1);
      expect(denial?.type).toBe("policy_denied");
      expect(denial?.trust).toBe("trusted_system");
      expect(denial?.content).toContain(reason_code);
      expect(update.pending_action).toBeNull();
      expect(tools.executions).toHaveLength(0);
    },
  );

  it.each([
    ["POLICY_EMERGENCY_DISABLED"],
    ["POLICY_DEPLOYMENT_REVOKED"],
  ])("routes a fatal %s denial to fail", async (reason_code) => {
    const policy = new FakePolicyEngine(deny_with(reason_code, true));
    const { runtime, tools } = make_fake_runtime({ policy });
    const state = state_with_pending("knowledge.search", search_args);
    const command = (await gate(state, runtime)) as Command;
    expect(goto_targets(command)).toEqual(["fail"]);
    const update = command.update as Partial<AgentLoopStateType>;
    expect(update.error?.code).toBe(reason_code);
    expect(tools.executions).toHaveLength(0);
  });

  it("routes approval-class actions to request_approval without executing", async () => {
    const policy = new FakePolicyEngine(() => ({
      kind: "approval_required",
      reason_code: "APPROVAL_COMMIT_CLASS",
      safe_reason: "Commit-class actions require manager approval.",
    }));
    const { runtime, tools } = make_fake_runtime({ policy });
    const state = state_with_pending("formula.draft", { base: "gel" });
    const command = (await gate(state, runtime)) as Command;
    expect(goto_targets(command)).toEqual(["request_approval"]);
    expect(tools.executions).toHaveLength(0);
  });

  it("routes an allowed action to act", async () => {
    const { runtime } = make_fake_runtime();
    const state = state_with_pending("knowledge.search", search_args);
    const command = (await gate(state, runtime)) as Command;
    expect(goto_targets(command)).toEqual(["act"]);
  });

  it("returns a typed denial observation and trips loop detection on repeats", async () => {
    const policy = new FakePolicyEngine(
      deny_with("POLICY_TOOL_NOT_ALLOWED", false),
    );
    const { runtime, tools } = make_fake_runtime({ policy });

    const first_denial = (await gate(
      state_with_pending("knowledge.search", search_args),
      runtime,
    )) as Command;
    const first_update = first_denial.update as Partial<AgentLoopStateType>;
    expect(first_update.observations?.at(-1)?.type).toBe("policy_denied");

    const state_after_three_identical_denials = state_with_pending(
      "knowledge.search",
      search_args,
      {
        iteration: 3,
        decision_log: [
          make_tool_decision("knowledge.search", search_args, 1),
          make_tool_decision("knowledge.search", search_args, 2),
          make_tool_decision("knowledge.search", search_args, 3),
        ],
      },
    );
    const tripped = (await gate(
      state_after_three_identical_denials,
      runtime,
    )) as Command;
    expect(goto_targets(tripped)).toEqual(["fail"]);
    const tripped_update = tripped.update as Partial<AgentLoopStateType>;
    expect(tripped_update.error?.code).toBe("LOOP_DETECTED");
    expect(tools.executions).toHaveLength(0);
  });

  it("trips loop detection on repeated identical allowed actions", async () => {
    const { runtime, tools } = make_fake_runtime();
    const state = state_with_pending("knowledge.search", search_args, {
      iteration: 3,
      decision_log: [
        make_tool_decision("knowledge.search", search_args, 1),
        make_tool_decision("knowledge.search", search_args, 2),
        make_tool_decision("knowledge.search", search_args, 3),
      ],
    });
    const command = (await gate(state, runtime)) as Command;
    expect(goto_targets(command)).toEqual(["fail"]);
    expect((command.update as Partial<AgentLoopStateType>).error?.code).toBe(
      "LOOP_DETECTED",
    );
    expect(tools.executions).toHaveLength(0);
  });

  it("does not trip loop detection for distinct arguments", async () => {
    const { runtime } = make_fake_runtime();
    const state = state_with_pending("knowledge.search", { query: "c" }, {
      iteration: 3,
      decision_log: [
        make_tool_decision("knowledge.search", { query: "a" }, 1),
        make_tool_decision("knowledge.search", { query: "b" }, 2),
        make_tool_decision("knowledge.search", { query: "c" }, 3),
      ],
    });
    const command = (await gate(state, runtime)) as Command;
    expect(goto_targets(command)).toEqual(["act"]);
  });

  it("fails on a missing pending action as an invariant violation", async () => {
    const { runtime } = make_fake_runtime();
    const state = make_loop_state({ iteration: 1, pending_action: null });
    const command = (await gate(state, runtime)) as Command;
    expect(goto_targets(command)).toEqual(["fail"]);
    expect((command.update as Partial<AgentLoopStateType>).error?.code).toBe(
      "ORCHESTRATOR_INVARIANT_VIOLATION",
    );
  });
});

describe("loop detection", () => {
  it("normalizes actions by tool name and canonical arguments hash", () => {
    const signature_a = normalize_action_signature({
      tool_name: "knowledge.search",
      arguments_hash: hash_arguments({ query: "x", limit: 5 }),
    });
    const signature_b = normalize_action_signature({
      tool_name: "knowledge.search",
      arguments_hash: hash_arguments({ limit: 5, query: "x" }),
    });
    expect(signature_a).toBe(signature_b);
  });

  it("counts identical proposals and applies the configured threshold", () => {
    const log = [
      make_tool_decision("knowledge.search", search_args, 1),
      make_tool_decision("knowledge.search", search_args, 2),
    ];
    const action = make_pending_tool_action("knowledge.search", search_args);
    expect(
      count_identical_proposals(log, normalize_action_signature(action)),
    ).toBe(2);
    expect(is_loop_detected(log, action, 3)).toBe(false);
    expect(
      is_loop_detected(
        [...log, make_tool_decision("knowledge.search", search_args, 3)],
        action,
        3,
      ),
    ).toBe(true);
  });
});

describe("act node", () => {
  it("executes an allowed read action exactly once per idempotency key", async () => {
    const tools = new FakeToolExecutor(
      [make_tool_definition("knowledge.search")],
      {
        "knowledge.search": [
          {
            status: "ok",
            output: { items: ["glycerin"], source_ids: ["doc_1"] },
            error_code: null,
            safe_error_message: null,
            retryable: false,
            cost_usd: "0.0002",
            latency_ms: 12,
          },
        ],
      },
    );
    const { runtime } = make_fake_runtime({ tools });
    const state = state_with_pending("knowledge.search", search_args);
    const update = await act(state, runtime);
    expect(update).not.toBeInstanceOf(Command);

    expect(tools.executions).toHaveLength(1);
    const expected_key = `run_0001:1:knowledge.search:${hash_arguments(search_args)}`;
    expect(tools.executions[0]!.idempotency_key).toBe(expected_key);

    const observation = update.observations?.at(-1);
    expect(observation).toMatchObject({
      type: "tool_result",
      trust: "untrusted_content",
    });
    expect(observation?.source.source_ids).toContain("doc_1");
    expect(observation?.metadata).toMatchObject({
      arguments_hash: hash_arguments(search_args),
    });

    const result = update.action_results?.[0];
    expect(result).toMatchObject({
      status: "ok",
      attempts: 1,
      idempotency_key: expected_key,
    });
    expect(update.usage?.tool_calls).toBe(1);
    expect(update.pending_action).toBeNull();
    const event_types = (update.events ?? []).map((event) => event.type);
    expect(event_types).toContain("action.started");
    expect(event_types).toContain("action.completed");

    const repeat = await act(state, runtime);
    expect(tools.executions).toHaveLength(2);
    expect(tools.executions[1]!.idempotency_key).toBe(expected_key);
    expect(repeat.action_results?.[0]?.idempotency_key).toBe(expected_key);
  });

  it("retries a retryable failure up to the definition retry budget", async () => {
    const tools = new FakeToolExecutor(
      [make_tool_definition("knowledge.search", { retry: 1 })],
      {
        "knowledge.search": [
          {
            status: "error",
            output: null,
            error_code: "UPSTREAM_TIMEOUT",
            safe_error_message: "The knowledge index timed out.",
            retryable: true,
            cost_usd: "0.0001",
            latency_ms: 30,
          },
          {
            status: "ok",
            output: { items: [], source_ids: [] },
            error_code: null,
            safe_error_message: null,
            retryable: false,
            cost_usd: "0.0002",
            latency_ms: 10,
          },
        ],
      },
    );
    const { runtime } = make_fake_runtime({ tools });
    const update = await act(
      state_with_pending("knowledge.search", search_args),
      runtime,
    );
    expect(tools.executions).toHaveLength(2);
    expect(update.action_results?.[0]).toMatchObject({
      status: "ok",
      attempts: 2,
    });
    expect(update.observations?.at(-1)?.type).toBe("tool_result");
  });

  it("does not retry a non-retryable failure", async () => {
    const tools = new FakeToolExecutor(
      [make_tool_definition("knowledge.search", { retry: 2 })],
      {
        "knowledge.search": [
          {
            status: "error",
            output: null,
            error_code: "INVALID_QUERY",
            safe_error_message: "The query was rejected.",
            retryable: false,
            cost_usd: "0.0001",
            latency_ms: 4,
          },
        ],
      },
    );
    const { runtime } = make_fake_runtime({ tools });
    const update = await act(
      state_with_pending("knowledge.search", search_args),
      runtime,
    );
    expect(tools.executions).toHaveLength(1);
    const observation = update.observations?.at(-1);
    expect(observation?.type).toBe("tool_error");
    expect(observation?.trust).toBe("trusted_system");
    expect(observation?.metadata).toMatchObject({ error_code: "INVALID_QUERY" });
    expect(update.action_results?.[0]).toMatchObject({
      status: "error",
      attempts: 1,
    });
  });

  it("returns a tool output-schema violation to the agent as an observation", async () => {
    const strict_schema = {
      /**
       * Reject every output to simulate a contract violation.
       *
       * @returns Always-unsuccessful parse result.
       */
      safeParse: () => ({ success: false, error: "shape mismatch" }),
    };
    const tools = new FakeToolExecutor([
      make_tool_definition("knowledge.search", { output_schema: strict_schema }),
    ]);
    const { runtime } = make_fake_runtime({ tools });
    const update = await act(
      state_with_pending("knowledge.search", search_args),
      runtime,
    );
    const observation = update.observations?.at(-1);
    expect(observation?.type).toBe("tool_error");
    expect(observation?.metadata).toMatchObject({ code: "TOOL_OUTPUT_INVALID" });
    expect(update.error ?? null).toBeNull();
  });

  it("returns blocking artifact validation to the agent as an observation", async () => {
    const tools = new FakeToolExecutor(
      [
        make_tool_definition("formula.draft", {
          side_effect: "draft",
          produces_artifact: true,
          result_trust: "trusted_system",
        }),
      ],
      {
        "formula.draft": [
          {
            status: "ok",
            output: { name: "Summer serum", total_percentage: "99.90" },
            error_code: null,
            safe_error_message: null,
            retryable: false,
            cost_usd: "0.0003",
            latency_ms: 20,
          },
        ],
      },
    );
    const artifacts = new FakeArtifactService({
      valid: false,
      findings: [
        {
          code: "TOTAL_PERCENTAGE_OUT_OF_TOLERANCE",
          severity: "blocking",
          safe_message: "Ingredient percentages must total 100.00 (+/-0.01).",
        },
        {
          code: "MISSING_PRESERVATIVE_WARNING",
          severity: "warning",
          safe_message: "Formula has no preservative warning.",
        },
      ],
    });
    const { runtime } = make_fake_runtime({ tools, artifacts });
    const update = await act(
      state_with_pending("formula.draft", { base: "gel" }),
      runtime,
    );
    expect(artifacts.validated).toHaveLength(1);
    const finding = (update.observations ?? []).find(
      (observation) => observation.type === "validation_finding",
    );
    expect(finding).toBeDefined();
    expect(finding?.metadata).toMatchObject({ blocking: true });
    expect(finding?.content).toContain("TOTAL_PERCENTAGE_OUT_OF_TOLERANCE");
    expect(update.warnings).toContain(
      "Formula has no preservative warning.",
    );
    expect(update.error ?? null).toBeNull();
  });

  it("flags a contradiction when identical arguments return different content", async () => {
    const prior = build_observation({
      observation_id: "obs_prior_result",
      run_id: "run_0001",
      iteration: 1,
      type: "tool_result",
      source: {
        kind: "tool",
        tool_name: "knowledge.search",
        source_ids: ["doc_1"],
      },
      content: JSON.stringify({ items: ["old answer"] }),
      trust: "untrusted_content",
      cost_usd: "0.0001",
      latency_ms: 5,
      occurred_at: "2026-07-15T00:00:01.000Z",
      metadata: { arguments_hash: hash_arguments(search_args) },
    });
    const tools = new FakeToolExecutor(
      [make_tool_definition("knowledge.search")],
      {
        "knowledge.search": [
          {
            status: "ok",
            output: { items: ["new different answer"] },
            error_code: null,
            safe_error_message: null,
            retryable: false,
            cost_usd: "0.0001",
            latency_ms: 5,
          },
        ],
      },
    );
    const { runtime } = make_fake_runtime({ tools });
    const state = state_with_pending("knowledge.search", search_args, {
      iteration: 2,
    });
    state.observations.push(prior);
    const update = await act(state, runtime);
    expect(update.observations?.at(-1)?.metadata).toMatchObject({
      contradicts_observation_id: "obs_prior_result",
    });
  });
});

describe("fail node", () => {
  it("marks the run failed with a safe partial output and reconciled usage", async () => {
    const { runtime, runs, usage } = make_fake_runtime();
    const state = make_loop_state({
      iteration: 8,
      usage: {
        model_calls: 8,
        tool_calls: 7,
        input_tokens: 9_000,
        output_tokens: 1_000,
        tokens_used: 10_000,
        cost_usd_used: "0.42",
      },
      error: {
        code: "LIMIT_MAX_ITERATIONS",
        safe_message: "The run reached its iteration budget.",
        retryable: false,
        correlation_id: "corr_0001",
        partial_output: null,
      },
    });
    const update = await fail(state, runtime);
    expect(update.error?.code).toBe("LIMIT_MAX_ITERATIONS");
    expect(update.error?.partial_output).toMatchObject({
      schema_version: "1",
      status: "failed",
      answer: null,
    });
    expect(update.error?.partial_output?.usage_summary.cost_usd).toBe("0.42");
    expect(runs.failed).toHaveLength(1);
    expect(usage.reconciled).toHaveLength(1);
    expect((update.events ?? []).map((event) => event.type)).toContain(
      "run.failed",
    );
  });
});

describe("governed loop end to end", () => {
  /**
   * Build the initial graph input for an end-to-end run.
   *
   * @returns Initial state channels for graph.invoke.
   */
  function initial_state() {
    const state = make_loop_state({ observations: [] });
    return build_initial_loop_state({
      run_id: state.run_id,
      thread_id: state.thread_id,
      tenant_id: state.tenant_id,
      actor_profile_id: state.actor_profile_id,
      input: state.input,
      context_pack: state.context_pack,
      pins: state.pins,
      budget: state.budget,
      started_at: state.started_at,
      deadline_at: state.deadline_at,
    });
  }

  it("completes a run through ingress, agent, gate, act, and finalize", async () => {
    const model = new ScriptedModelGateway([
      tool_call_turn("knowledge.search", search_args),
      tool_call_turn("finalize", {
        answer: "Glycerin 3% with sodium PCA 1% suits a light summer serum.",
        citations: [],
        uncertainty: [],
      }),
    ]);
    const { runtime, runs } = make_fake_runtime({ model });
    const app = compile_agent_loop_graph(runtime);
    const result = (await app.invoke(initial_state())) as AgentLoopStateType;
    expect(result.error).toBeNull();
    expect(result.output?.status).toBe("completed");
    const event_types = result.events.map((event) => event.type);
    expect(event_types).toContain("run.accepted");
    expect(event_types).toContain("action.completed");
    expect(event_types).toContain("run.completed");
    expect(runs.completed).toHaveLength(1);
    expect(
      result.observations.some(
        (observation) => observation.type === "tool_result",
      ),
    ).toBe(true);
  });

  it("re-plans after a denial and never reaches any executor for the denied tool", async () => {
    const model = new ScriptedModelGateway([
      tool_call_turn("formula.draft", { base: "gel" }),
      tool_call_turn("knowledge.search", search_args),
      tool_call_turn("finalize", {
        answer: "Search-backed answer without drafting.",
        citations: [],
        uncertainty: [],
      }),
    ]);
    const policy = new FakePolicyEngine((action) =>
      action.tool_name === "formula.draft"
        ? {
            kind: "denied",
            reason_code: "POLICY_TOOL_NOT_ALLOWED",
            safe_reason: "Drafting is disabled for this tenant.",
            fatal: false,
          }
        : { kind: "allowed" },
    );
    const { runtime, tools } = make_fake_runtime({ model, policy });
    const app = compile_agent_loop_graph(runtime);
    const result = (await app.invoke(initial_state())) as AgentLoopStateType;
    expect(result.output?.status).toBe("completed");
    expect(
      result.observations.some(
        (observation) => observation.type === "policy_denied",
      ),
    ).toBe(true);
    expect(
      tools.executions.map((execution) => execution.tool_name),
    ).toEqual(["knowledge.search"]);
  });

  it("fails a run with LOOP_DETECTED when the model repeats one action", async () => {
    const repeated = tool_call_turn("knowledge.search", search_args);
    const model = new ScriptedModelGateway([repeated, repeated, repeated]);
    const { runtime, runs } = make_fake_runtime({ model });
    const app = compile_agent_loop_graph(runtime);
    const result = (await app.invoke(initial_state())) as AgentLoopStateType;
    expect(result.error?.code).toBe("LOOP_DETECTED");
    expect(result.output).toBeNull();
    expect(runs.failed).toHaveLength(1);
    expect(result.events.map((event) => event.type)).toContain("run.failed");
  });

  it("fails a run with LIMIT_MAX_ITERATIONS instead of any fallback executor", async () => {
    const turns = Array.from({ length: 8 }, (_, index) =>
      tool_call_turn("knowledge.search", { query: `q${index}` }),
    );
    const model = new ScriptedModelGateway(turns);
    const { runtime, runs } = make_fake_runtime({
      model,
      config: { loop_detection_threshold: 100 },
    });
    const app = compile_agent_loop_graph(runtime);
    const initial = initial_state();
    const result = (await app.invoke(
      { ...initial, budget: { ...initial.budget!, max_iterations: 3 } },
      { recursionLimit: 64 },
    )) as AgentLoopStateType;
    expect(result.error?.code).toBe("LIMIT_MAX_ITERATIONS");
    expect(result.error?.partial_output?.status).toBe("failed");
    expect(runs.failed).toHaveLength(1);
  });
});
