/** Mongo lease reclaim and exactly-once synthetic commit verification (G5.8). */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { create_ai_run_repository } from "../../apps/ai/server/repositories/ai-run-repository";
import { ToolCatalogue } from "../../apps/ai/server/services/ai-control/tool-catalogue";
import {
  ToolExecutor,
  type IdempotencyStorePort,
} from "../../apps/ai/server/services/ai-control/tool-executor";
import { create_event_store } from "../../apps/ai/server/services/ai-gateway/event-store";
import {
  create_run_job_queue,
  type ClaimedRunJob,
} from "../../apps/ai/server/services/ai-gateway/run-job-queue";
import {
  process_one_job,
  type RunExecutionResult,
  type RunExecutor,
  type RunWorkerDeps,
} from "../../apps/ai/server/services/ai-gateway/run-worker";
import type { AgentRunEventV1 } from "../../packages/shared-types/src/ai/contracts";
import {
  make_context,
  make_echo_tool,
  make_policy,
  make_ports,
  make_temp_cards_root,
} from "../ai-control/helpers";

const TENANT = "507f1f77bcf86cd7994390a1";
const T0 = new Date("2026-07-15T00:00:00.000Z");
const LEASE_MS = 30_000;
const TOOL_NAME = "formula.synthetic_commit";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

/** Shared store standing in for the durable idempotency adapter across workers. */
class DurableSyntheticIdempotencyStore implements IdempotencyStorePort {
  readonly values = new Map<string, unknown>();

  async get(key: string): Promise<unknown | undefined> {
    return this.values.get(key);
  }

  async put(key: string, output: unknown): Promise<void> {
    this.values.set(key, output);
  }
}

/** Run executor that reaches a governed commit tool through the real ToolExecutor. */
class SyntheticCommitRunExecutor implements RunExecutor {
  readonly cache_results: boolean[] = [];

  constructor(
    private readonly tool_executor: ToolExecutor,
    private readonly now: Date,
  ) {}

  async execute(job: ClaimedRunJob): Promise<RunExecutionResult> {
    const result = await this.tool_executor.execute(
      { name: TOOL_NAME, arguments: { query: "synthetic formula commit" } },
      make_context({
        tenant_id: job.tenant_id,
        run_id: job.run_id,
        step_id: "commit-step-1",
        permissions: ["ai:run"],
        policy: make_policy({
          tenant_id: job.tenant_id,
          allowed_tools: [TOOL_NAME],
          approval_rules: {},
        }),
      }),
    );
    this.cache_results.push(result.from_cache);
    const event: AgentRunEventV1 = {
      schema_version: "1",
      event_id: `evt-${job.run_id}`,
      run_id: job.run_id,
      sequence: 0,
      occurred_at: this.now.toISOString(),
      type: "run.completed",
      payload: { status: "completed", output_schema_version: "1" },
    } as AgentRunEventV1;
    return { status: "completed", events: [event] };
  }
}

/** Build a fresh process-local executor over the shared durable store. */
function commit_executor(
  store: IdempotencyStorePort,
  commit_counter: { value: number },
  now: Date,
): SyntheticCommitRunExecutor {
  const catalogue = new ToolCatalogue();
  catalogue.register(
    make_echo_tool(make_temp_cards_root(), {
      name: TOOL_NAME,
      side_effect: "commit",
      required_permission: "ai:run",
      execute: async () => {
        commit_counter.value += 1;
        return { echoed: "synthetic formula committed" };
      },
    }),
  );
  return new SyntheticCommitRunExecutor(
    new ToolExecutor(catalogue, {
      ...make_ports(),
      idempotency_store: store,
    }),
    now,
  );
}

/** Seed one run and its idempotent start job. */
async function seed_run(): Promise<string> {
  const runs = create_ai_run_repository(db);
  const { run } = await runs.create(
    {
      tenant_id: TENANT,
      document: {
        idempotencyKey: "mongodb-worker-recovery",
        correlationId: "corr-mongodb-worker-recovery",
        actorProfileId: "507f1f77bcf86cd79943a001",
        agentKey: "synthetic-resilience",
        executor: "agentic",
        input: { schema_version: "1", message: "Synthetic lease recovery input" },
      },
    },
    T0,
  );
  const run_id = String(run._id);
  await create_run_job_queue(db).enqueue(
    { tenant_id: TENANT, run_id, command: "start", idempotency_key: "start" },
    T0,
  );
  return run_id;
}

/** Build the second worker that reclaims the expired lease. */
function recovery_worker(executor: RunExecutor, now: Date): RunWorkerDeps {
  return {
    jobs: create_run_job_queue(db),
    runs: create_ai_run_repository(db),
    events: create_event_store(db),
    executor,
    worker_id: "worker-b",
    now: () => now,
    lease_ms: LEASE_MS,
    backoff_ms: 1_000,
  };
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("mongodb_worker_recovery");
  await db.collection("ai_runs").createIndex({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
  await db.collection("ai_runs").createIndex({ correlationId: 1 }, { unique: true });
  await db.collection("ai_run_jobs").createIndex(
    { runId: 1, command: 1, idempotencyKey: 1 },
    { unique: true },
  );
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

beforeEach(async () => {
  await Promise.all([
    db.collection("ai_runs").deleteMany({}),
    db.collection("ai_run_jobs").deleteMany({}),
    db.collection("ai_run_events").deleteMany({}),
  ]);
});

describe("Mongo worker recovery", () => {
  it("reclaims a crashed worker lease without repeating a committed action", async () => {
    const run_id = await seed_run();
    const queue = create_run_job_queue(db);
    const store = new DurableSyntheticIdempotencyStore();
    const commits = { value: 0 };
    const worker_a_executor = commit_executor(store, commits, T0);
    const claimed = await queue.claim({ worker_id: "worker-a", now: T0, lease_ms: LEASE_MS });
    expect(claimed?.run_id).toBe(run_id);

    const run = await create_ai_run_repository(db).get(TENANT, run_id);
    await worker_a_executor.execute(claimed!, run);
    expect(commits.value).toBe(1);
    // Simulate process loss after the external action but before event/status/job acknowledgement.

    const recovered_at = new Date(T0.getTime() + LEASE_MS + 1);
    const worker_b_executor = commit_executor(store, commits, recovered_at);
    const outcome = await process_one_job(recovery_worker(worker_b_executor, recovered_at));

    expect(outcome).toMatchObject({ processed: true, run_id, status: "completed" });
    expect(commits.value).toBe(1);
    expect(worker_b_executor.cache_results).toEqual([true]);
    expect(store.values.size).toBe(1);
    expect(await db.collection("ai_run_events").countDocuments({ runId: run_id })).toBe(1);
    expect(await db.collection("ai_run_jobs").findOne({ runId: run_id })).toMatchObject({
      status: "completed",
      attempts: 2,
    });
    expect(await db.collection("ai_runs").findOne({ correlationId: "corr-mongodb-worker-recovery" })).toMatchObject({
      status: "completed",
    });
  });
});
