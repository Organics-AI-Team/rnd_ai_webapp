/**
 * G4.9d — real MongoDBSaver durability (closes the G4.7 remainder).
 *
 * The MemorySaver cases in interrupt-resume.test.ts prove the resume semantics;
 * this proves those checkpoints actually survive a process restart when backed by
 * MongoDB. A run is driven to an approval interrupt with one MongoDBSaver, then a
 * SECOND, independently-constructed MongoDBSaver over the same database resumes
 * it — so the durable state came from Mongo, not process memory. This became
 * possible once the orchestration package resolved langgraph 1.4.x +
 * langgraph-checkpoint-mongodb 1.4.0 (the old 0.2.74 pin was incompatible).
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  make_context_pack,
  make_fake_runtime,
  make_loop_state,
  make_tool_definition,
  tool_call_turn,
  FakeApprovalService,
  FakeToolExecutor,
  FakePolicyEngine,
} from "../orchestration/helpers/fake_runtime";
import type {
  ModelGateway,
  ModelTurnV1,
} from "../../packages/ai-orchestration/src/ports";
import { compile_agent_loop_graph } from "../../packages/ai-orchestration/src/graph";
import {
  build_checkpoint_thread_id,
  Command,
  get_mongodb_saver,
} from "../../packages/ai-orchestration/src/checkpoint";

const THREAD_CONFIG = {
  configurable: { thread_id: build_checkpoint_thread_id("tenant_alpha", "thread_0001") },
};

let repl: MongoMemoryReplSet;
let client: MongoClient;

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

beforeAll(async () => {
  // MongoDBSaver uses transactions, which require a replica set.
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(repl.getUri());
  await client.connect();
}, 60_000);

afterAll(async () => {
  await client.close();
  await repl.stop();
});

describe("MongoDBSaver durability", () => {
  it("resumes an approval from Mongo across a fresh saver + graph (restart)", async () => {
    const approvals = new FakeApprovalService(() => "approved");
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

    // First process: drive to the approval interrupt, persisting to Mongo.
    const saver_a = await get_mongodb_saver(client, "test_langgraph_ckpt");
    const first = compile_agent_loop_graph(runtime, saver_a);
    const paused = await first.invoke(commit_state(), THREAD_CONFIG);
    expect(paused.output).toBeNull();

    // Restart: a brand-new saver instance over the SAME Mongo database resumes.
    const saver_b = await get_mongodb_saver(client, "test_langgraph_ckpt");
    const restarted = compile_agent_loop_graph(runtime, saver_b);
    const resumed = await restarted.invoke(
      new Command({
        resume: { approval_id: "a1", decision: "approve", decided_by_profile_id: "p1" },
      }),
      THREAD_CONFIG,
    );

    expect(resumed.approval_result?.status).toBe("approved");
    expect(await approvals.count_for_run("run_0001")).toBe(1);
    expect(tools.executions.filter((e) => e.tool_name === "formula.confirm")).toHaveLength(1);
  }, 60_000);
});
