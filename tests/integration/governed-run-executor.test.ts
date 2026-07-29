import { ObjectId, type Document, type WithId } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentLoopRuntime,
  AgentLoopStateType,
  ContextPackV1,
} from "@rnd-ai/ai-orchestration";
import {
  create_agentic_run_executor,
  RunExecutionStateInvalidError,
} from "../../apps/ai/server/services/ai-gateway/governed-run-executor";
import type { ClaimedRunJob } from "../../apps/ai/server/services/ai-gateway/run-job-queue";
import { make_context_pack } from "../orchestration/helpers/fake_runtime";

const RUN_ID = "507f1f77bcf86cd7994390e1";
const TENANT = "507f1f77bcf86cd7994390a1";
const ACTOR = "507f1f77bcf86cd7994390b1";

function run_document(pack: ContextPackV1): WithId<Document> {
  return {
    _id: new ObjectId(RUN_ID),
    tenantId: TENANT,
    actorProfileId: ACTOR,
    threadId: "507f1f77bcf86cd7994390c1",
    agentKey: "raw_material_research",
    executor: "agentic",
    input: {
      schema_version: "1",
      thread_id: "507f1f77bcf86cd7994390c1",
      agent_key: "raw_material_research",
      message: "Find a gentle surfactant.",
      attachment_source_ids: [],
      response_preferences: { language: "en", detail: "standard" },
      idempotency_key: "governed-executor-key-1",
    },
    orchestratorVersion: "agentic-1.0.0",
    policyVersion: 7,
    deploymentId: "507f1f77bcf86cd7994390d1",
    agentDefinitionVersion: "raw-material-research-1.0.0",
    promptVersionId: "507f1f77bcf86cd7994390f1",
    contextPackHash: pack.pack_hash,
    requestBudget: {
      max_iterations: 8,
      max_total_tokens: "50000",
      max_cost_microusd: "1250000",
    },
    correlationId: "corr-governed-executor",
  } as WithId<Document>;
}

function job(command: "start" | "resume", resume_payload?: unknown): ClaimedRunJob {
  return {
    job_id: "507f1f77bcf86cd7994390aa",
    tenant_id: TENANT,
    run_id: RUN_ID,
    command,
    ...(resume_payload === undefined ? {} : { resume_payload }),
    attempts: 1,
  };
}

function completed_state(initial: AgentLoopStateType): AgentLoopStateType {
  const output = {
    schema_version: "1" as const,
    run_id: RUN_ID,
    status: "completed" as const,
    answer: "Use sodium cocoyl glutamate.",
    decision_summary: {
      facts_considered: [],
      evidence_references: [],
      action_rationales: [],
      validation_results: [],
      uncertainty: [],
    },
    citations: [],
    artifacts: [],
    quality_dimensions: {
      groundedness: 1,
      evidence_coverage: 1,
      source_quality: 1,
      source_freshness_days: 1,
      contradiction_state: "none" as const,
      validation_rate: 1,
      completeness: 1,
      risk_severity: "none" as const,
    },
    warnings: [],
    usage_summary: {
      model_calls: 1,
      tool_calls: 0,
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      cost_usd: "0.01",
    },
    started_at: "2026-07-16T00:00:00.000Z",
    completed_at: "2026-07-16T00:00:01.000Z",
  };
  return {
    ...initial,
    output,
    events: [{
      schema_version: "1",
      event_id: "event-terminal",
      run_id: RUN_ID,
      sequence: 0,
      occurred_at: "2026-07-16T00:00:01.000Z",
      type: "run.completed",
      payload: { status: "completed", output_schema_version: "1", output },
    }],
  };
}

function fake_runtime(): AgentLoopRuntime {
  return {
    context: {
      tenant_id: TENANT,
      actor_profile_id: ACTOR,
      run_id: RUN_ID,
      parent_run_id: null,
      delegation_depth: 0,
      correlation_id: "corr-governed-executor",
    },
  } as AgentLoopRuntime;
}

describe("governed agentic run executor", () => {
  it("builds the pinned initial state and returns a terminal public result", async () => {
    const pack = make_context_pack(["knowledge.search"]);
    let invoked: AgentLoopStateType | undefined;
    const invoke = vi.fn(async (input: AgentLoopStateType) => {
      invoked = input;
      return completed_state(input);
    });
    const executor = create_agentic_run_executor({
      load_runtime: async () => ({ runtime: fake_runtime(), context_pack: pack }),
      create_checkpointer: async () => ({}),
      compile_graph: () => ({ invoke }),
      now: () => new Date("2026-07-16T00:00:00.000Z"),
      run_timeout_ms: 120_000,
    });

    const result = await executor.execute(job("start"), run_document(pack));

    expect(invoked).toMatchObject({
      run_id: RUN_ID,
      tenant_id: TENANT,
      actor_profile_id: ACTOR,
      context_pack: { pack_hash: pack.pack_hash },
      pins: {
        orchestrator_version: "agentic-1.0.0",
        policy_version: "7",
        deployment_version: "raw-material-research-1.0.0",
        prompt_version: "507f1f77bcf86cd7994390f1",
      },
      budget: { max_iterations: 8, max_total_tokens: 50000, max_cost_usd: "1.25" },
      deadline_at: "2026-07-16T00:02:00.000Z",
    });
    expect(result).toMatchObject({
      status: "completed",
      output: { answer: "Use sodium cocoyl glutamate." },
      usage_summary: { total_tokens: 15 },
    });
    expect(result.events).toHaveLength(1);
    expect(invoke.mock.calls[0]?.[1]).toEqual({
      configurable: { thread_id: `tenant:${TENANT}::thread:507f1f77bcf86cd7994390c1` },
    });
  });

  it("resumes only with the trusted job payload and classifies an approval interrupt", async () => {
    const pack = make_context_pack();
    const invoke = vi.fn(async () => ({
      output: null,
      error: null,
      pending_action: { kind: "tool", tool_name: "formula.confirm" },
      events: [],
      usage: { model_calls: 1, tool_calls: 0, input_tokens: 1, output_tokens: 1, tokens_used: 2, cost_usd_used: "0" },
    }));
    const executor = create_agentic_run_executor({
      load_runtime: async () => ({ runtime: fake_runtime(), context_pack: pack }),
      create_checkpointer: async () => ({}),
      compile_graph: () => ({ invoke }),
      now: () => new Date("2026-07-16T00:00:00.000Z"),
      run_timeout_ms: 120_000,
    });
    const resume = { approval_id: "approval-1", decision: "approve", decided_by_profile_id: ACTOR };

    const result = await executor.execute(job("resume", resume), run_document(pack));

    expect(result).toMatchObject({ status: "waiting_approval", current_stage: "waiting_user" });
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({ resume });
  });

  it("fails closed before graph invocation when the rebuilt context pack drifts", async () => {
    const stored_pack = make_context_pack(["knowledge.search"]);
    const rebuilt_pack = make_context_pack(["formula.draft"]);
    const invoke = vi.fn();
    const executor = create_agentic_run_executor({
      load_runtime: async () => ({ runtime: fake_runtime(), context_pack: rebuilt_pack }),
      create_checkpointer: async () => ({}),
      compile_graph: () => ({ invoke }),
      now: () => new Date("2026-07-16T00:00:00.000Z"),
      run_timeout_ms: 120_000,
    });

    await expect(executor.execute(job("start"), run_document(stored_pack))).rejects.toBeInstanceOf(
      RunExecutionStateInvalidError,
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
