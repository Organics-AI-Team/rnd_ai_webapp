/**
 * G4.9f — private run worker orchestration.
 *
 * Proves process_one_job claims a job, runs the pinned AIRun through an injected
 * executor, appends events, records terminal/interim status, and completes the
 * job — releasing it with a backoff on a handled failure, and retiring a job
 * whose run vanished. Exercised against a real in-memory MongoDB with the queue,
 * run repository, and event store; the executor is faked (no provider creds).
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Document, type WithId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { create_ai_run_repository } from "../../apps/ai/server/repositories/ai-run-repository";
import { create_run_job_queue } from "../../apps/ai/server/services/ai-gateway/run-job-queue";
import { create_event_store } from "../../apps/ai/server/services/ai-gateway/event-store";
import {
  process_one_job,
  type RunExecutionResult,
  type RunExecutor,
  type RunWorkerDeps,
} from "../../apps/ai/server/services/ai-gateway/run-worker";
import type { ClaimedRunJob } from "../../apps/ai/server/services/ai-gateway/run-job-queue";
import type { AgentRunEventV1 } from "@rnd-ai/shared-types/src/ai/contracts";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const TENANT = "507f1f77bcf86cd7994390a1";
const T0 = new Date("2026-07-15T00:00:00.000Z");

/** A scripted executor returning a fixed result (or throwing). */
class FakeExecutor implements RunExecutor {
  constructor(private readonly result: RunExecutionResult | Error) {}
  public seen: Array<{ command: string; run_id: string }> = [];
  async execute(job: ClaimedRunJob): Promise<RunExecutionResult> {
    this.seen.push({ command: job.command, run_id: job.run_id });
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

class DelayedExecutor implements RunExecutor {
  async execute(): Promise<RunExecutionResult> {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { status: "completed", events: [] };
  }
}

/** An event for the given sequence. */
function event(run_id: string, sequence: number, type: string, payload: unknown): AgentRunEventV1 {
  return {
    schema_version: "1",
    event_id: `evt_${sequence}`,
    run_id,
    sequence,
    occurred_at: "2026-07-15T00:00:00.000Z",
    type,
    payload,
  } as AgentRunEventV1;
}

/** Seed a queued run + start job; return the run id. */
async function seed_run(key: string, correlation: string): Promise<string> {
  const runs = create_ai_run_repository(db);
  const { run } = await runs.create(
    {
      tenant_id: TENANT,
      document: {
        idempotencyKey: key,
        correlationId: correlation,
        actorProfileId: "507f1f77bcf86cd79943a001",
        agentKey: "formulation",
        executor: "agentic",
        input: { schema_version: "1", message: "Synthetic primary input" },
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

/** Build worker deps around a given executor. */
function make_deps(executor: RunExecutor): RunWorkerDeps {
  return {
    jobs: create_run_job_queue(db),
    runs: create_ai_run_repository(db),
    events: create_event_store(db),
    executor,
    worker_id: "worker_a",
    now: () => T0,
    lease_ms: 30_000,
    backoff_ms: 5000,
  };
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("test_worker");
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
  await db.collection("ai_runs").deleteMany({});
  await db.collection("ai_run_jobs").deleteMany({});
  await db.collection("ai_run_events").deleteMany({});
});

describe("process_one_job", () => {
  it("runs a job to completion: appends events, marks completed, completes the job", async () => {
    const run_id = await seed_run("idem-w-0001", "corr-w-1");
    const executor = new FakeExecutor({
      status: "completed",
      events: [event(run_id, 0, "run.completed", { status: "completed", output_schema_version: "1" })],
      usage_summary: { total_tokens: 42 },
      output: { schema_version: "1", run_id, answer: "Grounded final answer." },
    });
    const outcome = await process_one_job(make_deps(executor));

    expect(outcome).toMatchObject({ processed: true, run_id, status: "completed" });
    const run = await db.collection("ai_runs").findOne({ _id: { $exists: true } });
    expect(run?.status).toBe("completed");
    expect(run?.usageSummary).toEqual({ total_tokens: 42 });
    expect(run?.output).toEqual({
      schema_version: "1",
      run_id,
      answer: "Grounded final answer.",
    });
    expect(await db.collection("ai_run_events").countDocuments({ runId: run_id })).toBe(1);
    expect(await db.collection("ai_run_jobs").countDocuments({ status: "completed" })).toBe(1);
  });

  it("starts isolated shadow work only after the primary run and job are committed", async () => {
    const run_id = await seed_run("idem-w-shadow", "corr-w-shadow");
    const executor = new FakeExecutor({
      status: "completed",
      events: [event(run_id, 0, "run.completed", { status: "completed", output_schema_version: "1" })],
      output: { schema_version: "1", run_id, answer: "Primary answer." },
    });
    const statuses_seen: string[] = [];
    const shadow = {
      run_after_primary: vi.fn(async () => {
        const run = await db.collection("ai_runs").findOne({});
        const job = await db.collection("ai_run_jobs").findOne({});
        statuses_seen.push(String(run?.status), String(job?.status));
        throw new Error("shadow must not alter primary");
      }),
    };
    const outcome = await process_one_job({ ...make_deps(executor), shadow });

    expect(outcome).toEqual({ processed: true, run_id, status: "completed" });
    expect(statuses_seen).toEqual(["completed", "completed"]);
    expect(shadow.run_after_primary).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ input: expect.any(Object) }),
        result: expect.objectContaining({ status: "completed" }),
      }),
    );
  });

  it("reports no work when the queue is empty", async () => {
    expect(await process_one_job(make_deps(new FakeExecutor({ status: "completed", events: [] })))).toEqual({
      processed: false,
    });
  });

  it("releases an explicitly retryable executor failure with a backoff", async () => {
    await seed_run("idem-w-0002", "corr-w-2");
    const failure = Object.assign(new Error("provider timeout"), {
      code: "MODEL_PROVIDER_ERROR",
      retryable: true,
    });
    const outcome = await process_one_job(make_deps(new FakeExecutor(failure)));
    expect(outcome.status).toBe("released");
    const job = await db.collection("ai_run_jobs").findOne({});
    expect(job?.status).toBe("available"); // reclaimable after the backoff
    expect(job?.lastError).toBe("MODEL_PROVIDER_ERROR");
    const run = await db.collection("ai_runs").findOne({});
    expect(run?.status).toBe("running"); // not marked completed
  });

  it("retires a non-retryable runtime failure and marks the run failed", async () => {
    const run_id = await seed_run("idem-w-poison", "corr-w-poison");
    const failure = Object.assign(new Error("safe runtime failure"), {
      code: "RUN_RUNTIME_UNAVAILABLE",
      retryable: false,
    });

    const outcome = await process_one_job(make_deps(new FakeExecutor(failure)));

    expect(outcome).toEqual({ processed: true, run_id, status: "failed" });
    expect(await db.collection("ai_run_jobs").findOne({ runId: run_id })).toMatchObject({
      status: "failed",
      lastError: "RUN_RUNTIME_UNAVAILABLE",
    });
    expect(await db.collection("ai_runs").findOne({ correlationId: "corr-w-poison" }))
      .toMatchObject({ status: "failed", errorCode: "RUN_RUNTIME_UNAVAILABLE" });
  });

  it("retires a retryable failure after its bounded attempt budget", async () => {
    const run_id = await seed_run("idem-w-exhausted", "corr-w-exhausted");
    const failure = Object.assign(new Error("provider unavailable"), {
      code: "MODEL_PROVIDER_ERROR",
      retryable: true,
    });
    const deps = {
      ...make_deps(new FakeExecutor(failure)),
      max_attempts: 1,
    };

    const outcome = await process_one_job(deps);

    expect(outcome).toEqual({ processed: true, run_id, status: "failed" });
    expect(await db.collection("ai_run_jobs").findOne({ runId: run_id })).toMatchObject({
      status: "failed",
      attempts: 1,
    });
  });

  it("uses bounded exponential backoff with deterministic injected jitter", async () => {
    const run_id = await seed_run("idem-w-exponential", "corr-w-exponential");
    const failure = Object.assign(new Error("provider unavailable"), {
      code: "MODEL_PROVIDER_ERROR",
      retryable: true,
    });
    let current = T0;
    const deps: RunWorkerDeps = {
      ...make_deps(new FakeExecutor(failure)),
      now: () => current,
      backoff_ms: 100,
      max_backoff_ms: 1_000,
      max_attempts: 3,
      retry_jitter: () => 0.5,
    };

    expect((await process_one_job(deps)).status).toBe("released");
    let stored = await db.collection("ai_run_jobs").findOne({ runId: run_id });
    expect(stored?.availableAt).toEqual(new Date(T0.getTime() + 100));

    current = new Date(T0.getTime() + 101);
    expect((await process_one_job(deps)).status).toBe("released");
    stored = await db.collection("ai_run_jobs").findOne({ runId: run_id });
    expect(stored?.availableAt).toEqual(new Date(current.getTime() + 200));
  });

  it("pauses the run and completes the job on an interrupt", async () => {
    const run_id = await seed_run("idem-w-0003", "corr-w-3");
    const executor = new FakeExecutor({
      status: "waiting_approval",
      events: [event(run_id, 0, "approval.required", { approval_id: "a1", summary: "confirm", tool_name: "formula.confirm" })],
      current_stage: "waiting_user",
    });
    const outcome = await process_one_job(make_deps(executor));
    expect(outcome.status).toBe("waiting_approval");
    const run = await db.collection("ai_runs").findOne({});
    expect(run?.status).toBe("waiting_approval");
    expect(await db.collection("ai_run_jobs").countDocuments({ status: "completed" })).toBe(1);
  });

  it("renews the job lease while a long execution turn is in flight", async () => {
    await seed_run("idem-w-heartbeat", "corr-w-heartbeat");
    const jobs = create_run_job_queue(db);
    const heartbeat = vi.spyOn(jobs, "heartbeat");
    const deps = {
      ...make_deps(new DelayedExecutor()),
      jobs,
      lease_ms: 60,
      heartbeat_interval_ms: 5,
    };

    const outcome = await process_one_job(deps);

    expect(outcome.status).toBe("completed");
    expect(heartbeat).toHaveBeenCalled();
  });

  it("retires a job whose run has vanished", async () => {
    // Enqueue a job for a run id that does not exist.
    await create_run_job_queue(db).enqueue(
      {
        tenant_id: TENANT,
        run_id: "507f1f77bcf86cd79943dead",
        command: "start",
        idempotency_key: "start",
      },
      T0,
    );
    const outcome = await process_one_job(make_deps(new FakeExecutor({ status: "completed", events: [] })));
    expect(outcome.status).toBe("orphaned");
    expect(await db.collection("ai_run_jobs").countDocuments({ status: "completed" })).toBe(1);
  });
});
