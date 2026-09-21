/** Credential-free provider outage and recovery verification (G5.8). */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { create_ai_run_repository } from "../../apps/ai/server/repositories/ai-run-repository";
import { create_event_store } from "../../apps/ai/server/services/ai-gateway/event-store";
import { create_run_job_queue } from "../../apps/ai/server/services/ai-gateway/run-job-queue";
import {
  process_one_job,
  type RunExecutionResult,
  type RunExecutor,
  type RunWorkerDeps,
} from "../../apps/ai/server/services/ai-gateway/run-worker";
import type { AgentRunEventV1 } from "../../packages/shared-types/src/ai/contracts";

const TENANT = "507f1f77bcf86cd7994390a1";
const T0 = new Date("2026-07-15T00:00:00.000Z");
const BACKOFF_MS = 5_000;
const LEASE_MS = 30_000;

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let now_ms = T0.getTime();

/** Executor whose scripted provider attempts either fail or complete. */
class ScriptedProviderExecutor implements RunExecutor {
  readonly attempts: string[] = [];

  constructor(private readonly outcomes: readonly (Error | RunExecutionResult)[]) {}

  async execute(job: { run_id: string }): Promise<RunExecutionResult> {
    const outcome = this.outcomes[this.attempts.length];
    this.attempts.push(job.run_id);
    if (outcome instanceof Error) throw outcome;
    if (!outcome) throw new Error("provider script exhausted");
    return outcome;
  }
}

/** Create a queued synthetic run and return its identifier. */
async function seed_run(suffix: string): Promise<string> {
  const runs = create_ai_run_repository(db);
  const { run } = await runs.create(
    {
      tenant_id: TENANT,
      document: {
        idempotencyKey: `provider-${suffix}`,
        correlationId: `corr-provider-${suffix}`,
        actorProfileId: "507f1f77bcf86cd79943a001",
        agentKey: "synthetic-resilience",
        executor: "agentic",
        input: { schema_version: "1", message: "Synthetic provider resilience input" },
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

/** Build worker dependencies over real Mongo persistence and an injected provider. */
function worker(executor: RunExecutor): RunWorkerDeps {
  return {
    jobs: create_run_job_queue(db),
    runs: create_ai_run_repository(db),
    events: create_event_store(db),
    executor,
    worker_id: "provider-resilience-worker",
    now: () => new Date(now_ms),
    lease_ms: LEASE_MS,
    backoff_ms: BACKOFF_MS,
  };
}

/** Build one terminal event without any tenant content. */
function completed_event(run_id: string): AgentRunEventV1 {
  return {
    schema_version: "1",
    event_id: `evt-${run_id}`,
    run_id,
    sequence: 0,
    occurred_at: new Date(now_ms).toISOString(),
    type: "run.completed",
    payload: { status: "completed", output_schema_version: "1" },
  } as AgentRunEventV1;
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("provider_resilience");
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
  now_ms = T0.getTime();
  await Promise.all([
    db.collection("ai_runs").deleteMany({}),
    db.collection("ai_run_jobs").deleteMany({}),
    db.collection("ai_run_events").deleteMany({}),
  ]);
});

describe("provider outage recovery", () => {
  it.each([
    ["timeout", "PROVIDER_TIMEOUT"],
    ["rate limit", "PROVIDER_RATE_LIMITED_429"],
  ])("backs off after a provider %s and completes once the provider recovers", async (suffix, code) => {
    const run_id = await seed_run(suffix.replace(" ", "-"));
    const executor = new ScriptedProviderExecutor([
      Object.assign(new Error(code), { code, retryable: true }),
      { status: "completed", events: [completed_event(run_id)] },
    ]);

    const failed_attempt = await process_one_job(worker(executor));
    expect(failed_attempt).toMatchObject({ processed: true, run_id, status: "released" });
    expect(await db.collection("ai_run_events").countDocuments({ runId: run_id })).toBe(0);

    now_ms += BACKOFF_MS - 1;
    expect(await process_one_job(worker(executor))).toEqual({ processed: false });

    now_ms += 2;
    const recovered = await process_one_job(worker(executor));
    expect(recovered).toMatchObject({ processed: true, run_id, status: "completed" });
    expect(executor.attempts).toHaveLength(2);
    expect(await db.collection("ai_run_events").countDocuments({ runId: run_id })).toBe(1);
    expect(await db.collection("ai_run_jobs").findOne({ runId: run_id })).toMatchObject({
      status: "completed",
      attempts: 2,
    });
    expect(await db.collection("ai_runs").findOne({ _id: run_id as never })).toBeNull();
    expect(await db.collection("ai_runs").findOne({ correlationId: `corr-provider-${suffix.replace(" ", "-")}` })).toMatchObject({
      status: "completed",
    });
  });
});
