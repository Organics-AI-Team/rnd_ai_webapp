/**
 * G4.7 — durable clarification/approval interrupts and resume.
 *
 * Compiles the governed graph with a checkpointer and drives it to an interrupt,
 * then resumes with `new Command({ resume })`. A fresh graph instance sharing
 * the same saver simulates a process restart, proving the approval resolves
 * exactly once and a clarification answer re-enters the agent as a trusted-user
 * observation. A MongoDBSaver integration test proves durability survives a
 * restart against an in-memory MongoDB.
 */

import { describe, expect, it } from "vitest";

import {
  make_context_pack,
  make_fake_runtime,
  make_loop_state,
  make_tool_definition,
  tool_call_turn,
  FakeApprovalService,
  FakeToolExecutor,
  FakePolicyEngine,
} from "./helpers/fake_runtime";
import type {
  ModelGateway,
  ModelTurnV1,
} from "../../packages/ai-orchestration/src/ports";
import { compile_agent_loop_graph } from "../../packages/ai-orchestration/src/graph";
// Import Command + MemorySaver via the package re-export so they resolve to the
// SAME LangGraph instance the compiled graph uses (avoids a checkpoint skew).
import {
  build_checkpoint_thread_id,
  Command,
  MemorySaver,
} from "../../packages/ai-orchestration/src/checkpoint";
import { resume_run } from "../../packages/ai-orchestration/src/resume";

const THREAD_CONFIG = {
  configurable: { thread_id: build_checkpoint_thread_id("tenant_alpha", "thread_0001") },
};

/** A model that returns queued turns, then always finalizes. */
class QueueModel implements ModelGateway {
  constructor(private readonly queue: ModelTurnV1[]) {}
  async complete_turn(): Promise<ModelTurnV1> {
    return (
      this.queue.shift() ??
      tool_call_turn("finalize", { answer: "done", citations: [], uncertainty: [] })
    );
  }
}

/** Loop state whose context pack declares the tools the scripted model uses. */
function commit_state() {
  const pack = make_context_pack(["formula.confirm", "knowledge.search"]);
  const base = make_loop_state();
  return {
    ...base,
    context_pack: pack,
    pins: { ...base.pins, context_pack_hash: pack.pack_hash },
  };
}

describe("approval interrupt + resume", () => {
  it("resumes an approval exactly once across a simulated restart", async () => {
    const saver = new MemorySaver();
    const approvals = new FakeApprovalService(() => "approved");
    // The model asks to confirm (commit); policy requires approval for it.
    const model = new QueueModel([tool_call_turn("formula.confirm", { formula_id: "f1" })]);
    const tools = new FakeToolExecutor([
      make_tool_definition("formula.confirm", { side_effect: "commit" }),
    ]);
    const policy = new FakePolicyEngine((action) =>
      action.tool_name === "formula.confirm"
        ? { kind: "approval_required", reason_code: "APPROVAL_REQUIRED", safe_reason: "commit" }
        : { kind: "allowed" },
    );
    const { runtime } = make_fake_runtime({ model, tools, policy, approvals });

    const first = compile_agent_loop_graph(runtime, saver);
    const paused = await first.invoke(commit_state(), THREAD_CONFIG);
    // The run paused at the approval interrupt (no output yet).
    expect(paused.output).toBeNull();

    // Simulate a process restart: a NEW graph instance over the SAME saver.
    const restarted = compile_agent_loop_graph(runtime, saver);
    const resumed = await restarted.invoke(
      new Command({
        resume: { approval_id: "a1", decision: "approve", decided_by_profile_id: "p1" },
      }),
      THREAD_CONFIG,
    );

    expect(resumed.approval_result?.status).toBe("approved");
    expect(await approvals.count_for_run("run_0001")).toBe(1);
    // The commit tool executed exactly once after approval.
    expect(tools.executions.filter((e) => e.tool_name === "formula.confirm")).toHaveLength(1);
  });

  it("routes a denied approval back to the agent as an observation", async () => {
    const saver = new MemorySaver();
    const approvals = new FakeApprovalService(() => "denied");
    const model = new QueueModel([tool_call_turn("formula.confirm", { formula_id: "f1" })]);
    const tools = new FakeToolExecutor([
      make_tool_definition("formula.confirm", { side_effect: "commit" }),
    ]);
    const policy = new FakePolicyEngine((action) =>
      action.tool_name === "formula.confirm"
        ? { kind: "approval_required", reason_code: "APPROVAL_REQUIRED", safe_reason: "commit" }
        : { kind: "allowed" },
    );
    const { runtime } = make_fake_runtime({ model, tools, policy, approvals });

    const graph = compile_agent_loop_graph(runtime, saver);
    await graph.invoke(commit_state(), THREAD_CONFIG);
    const resumed = await graph.invoke(
      new Command({
        resume: { approval_id: "a1", decision: "deny", decided_by_profile_id: "p1" },
      }),
      THREAD_CONFIG,
    );
    expect(resumed.approval_result?.status).toBe("denied");
    // The commit never executed.
    expect(tools.executions.filter((e) => e.tool_name === "formula.confirm")).toHaveLength(0);
  });
});

describe("clarification interrupt + resume", () => {
  it("re-enters the agent with the answer as a trusted-user observation", async () => {
    const saver = new MemorySaver();
    const model = new QueueModel([
      tool_call_turn("request_clarification", { questions: ["Which skin type?"] }),
    ]);
    const { runtime } = make_fake_runtime({ model });
    const graph = compile_agent_loop_graph(runtime, saver);

    await graph.invoke(make_loop_state(), THREAD_CONFIG);
    const resumed = await graph.invoke(
      new Command({ resume: { answer: "Oily, acne-prone." } }),
      THREAD_CONFIG,
    );
    // The clarification answer became a trusted-user observation the run saw.
    const answers = resumed.observations.filter(
      (obs) => obs.trust === "trusted_user" && obs.content.includes("Oily"),
    );
    expect(answers.length).toBeGreaterThanOrEqual(1);
    expect(resumed.output?.status).toBe("completed");
  });
});

describe("resume_run authorization", () => {
  const context = {
    tenant_id: "tenant_alpha",
    actor_profile_id: "p1",
    run_id: "run_0001",
    parent_run_id: null,
    delegation_depth: 0,
    correlation_id: "c1",
  };
  const run = {
    run_id: "run_0001",
    tenant_id: "tenant_alpha",
    thread_id: "thread_0001",
    pins: {
      orchestrator_version: "agentic-1.0.0",
      policy_version: "policy_v1",
      deployment_version: "deploy_v1",
      prompt_version: "prompt_v1",
      context_pack_hash: "0".repeat(64),
    },
  };

  it("resumes for the owning tenant with available pins", async () => {
    const result = await resume_run(
      {
        load_run: async () => run,
        can_resume: () => true,
        verify_pins: async () => true,
        invoke_resume: async () => ({ ok: true }),
      },
      { run_id: "run_0001", context, resume_value: { answer: "x" } },
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects a cross-tenant, forbidden, or version-unavailable resume", async () => {
    const base = {
      load_run: async () => run,
      can_resume: () => true,
      verify_pins: async () => true,
      invoke_resume: async () => ({ ok: true }),
    };
    await expect(
      resume_run(base, {
        run_id: "run_0001",
        context: { ...context, tenant_id: "tenant_beta" },
        resume_value: {},
      }),
    ).rejects.toMatchObject({ code: "RESUME_TENANT_MISMATCH" });
    await expect(
      resume_run({ ...base, can_resume: () => false }, { run_id: "run_0001", context, resume_value: {} }),
    ).rejects.toMatchObject({ code: "RESUME_FORBIDDEN" });
    await expect(
      resume_run({ ...base, verify_pins: async () => false }, { run_id: "run_0001", context, resume_value: {} }),
    ).rejects.toMatchObject({ code: "RESUME_VERSION_UNAVAILABLE" });
    await expect(
      resume_run({ ...base, load_run: async () => null }, { run_id: "run_0001", context, resume_value: {} }),
    ).rejects.toMatchObject({ code: "RESUME_RUN_NOT_FOUND" });
  });
});

// NOTE: The MemorySaver cases above prove the resume + exactly-once semantics
// through the checkpointer interface. Real MongoDBSaver durability across a
// process restart is proven in tests/integration/mongodb-checkpoint.test.ts
// (G4.9d), now that the orchestration package resolves langgraph 1.4.x +
// langgraph-checkpoint-mongodb 1.4.0 (the old 0.2.74 pin was incompatible).
