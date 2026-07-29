/**
 * G4.9a — durable run-job queue with compare-and-set leases.
 *
 * Proves enqueue is idempotent per [runId, command], a job is claimed by exactly
 * one worker at a time, an expired lease (crashed worker) is reclaimable, and
 * heartbeat/complete/release are owner-gated. Exercised against a real in-memory
 * MongoDB (single node — the queue needs no transactions).
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  create_run_job_queue,
  type RunJobQueue,
} from "../../apps/ai/server/services/ai-gateway/run-job-queue";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let queue: RunJobQueue;

const TENANT = "507f1f77bcf86cd7994390a1";
const RUN = "507f1f77bcf86cd79943c001";
const T0 = new Date("2026-07-15T00:00:00.000Z");
const LEASE_MS = 30_000;
const later = (ms: number) => new Date(T0.getTime() + ms);

/** Build one idempotently enqueued queue command. */
function job(command: "start" | "resume", idempotency_key = command) {
  return { tenant_id: TENANT, run_id: RUN, command, idempotency_key } as const;
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("test_run_jobs");
  queue = create_run_job_queue(db);
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

beforeEach(async () => {
  await db.collection("ai_run_jobs").deleteMany({});
});

describe("run-job queue", () => {
  it("enqueues idempotently per run and command", async () => {
    const first = await queue.enqueue(job("start"), T0);
    const second = await queue.enqueue(job("start"), later(1000));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job_id).toBe(first.job_id);
    expect(await db.collection("ai_run_jobs").countDocuments({ runId: RUN })).toBe(1);
  });

  it("distinguishes start and resume commands for the same run", async () => {
    await queue.enqueue(job("start"), T0);
    const resume = await queue.enqueue(job("resume", "resume-action-0001"), T0);
    expect(resume.created).toBe(true);
    expect(await db.collection("ai_run_jobs").countDocuments({ runId: RUN })).toBe(2);
  });

  it("deduplicates one resume action without suppressing a later interrupt", async () => {
    const first = await queue.enqueue(job("resume", "resume-action-0001"), T0);
    const retry = await queue.enqueue(job("resume", "resume-action-0001"), later(1));
    const later_interrupt = await queue.enqueue(job("resume", "resume-action-0002"), later(2));
    expect(first.created).toBe(true);
    expect(retry).toEqual({ job_id: first.job_id, created: false });
    expect(later_interrupt.created).toBe(true);
    expect(await db.collection("ai_run_jobs").countDocuments({ runId: RUN, command: "resume" })).toBe(2);
  });

  it("lets exactly one worker claim an available job", async () => {
    await queue.enqueue(job("start"), T0);
    const claimed = await queue.claim({ worker_id: "worker_a", now: later(100), lease_ms: LEASE_MS });
    const second = await queue.claim({ worker_id: "worker_b", now: later(200), lease_ms: LEASE_MS });
    expect(claimed?.run_id).toBe(RUN);
    expect(claimed?.command).toBe("start");
    expect(claimed?.attempts).toBe(1);
    expect(second).toBeNull(); // job is leased and not yet expired
  });

  it("reclaims a job whose lease has expired (crashed worker)", async () => {
    await queue.enqueue(job("start"), T0);
    await queue.claim({ worker_id: "worker_a", now: later(0), lease_ms: LEASE_MS });
    // Past the lease with no heartbeat: reclaimable by another worker.
    const reclaimed = await queue.claim({
      worker_id: "worker_b",
      now: later(LEASE_MS + 1),
      lease_ms: LEASE_MS,
    });
    expect(reclaimed?.run_id).toBe(RUN);
    expect(reclaimed?.attempts).toBe(2);
  });

  it("renews a lease on heartbeat only for the owning worker", async () => {
    await queue.enqueue(job("start"), T0);
    const claimed = await queue.claim({ worker_id: "worker_a", now: later(0), lease_ms: LEASE_MS });
    const owner_beat = await queue.heartbeat({
      job_id: claimed!.job_id,
      worker_id: "worker_a",
      now: later(LEASE_MS - 1),
      lease_ms: LEASE_MS,
    });
    const other_beat = await queue.heartbeat({
      job_id: claimed!.job_id,
      worker_id: "worker_b",
      now: later(LEASE_MS),
      lease_ms: LEASE_MS,
    });
    expect(owner_beat).toBe(true);
    expect(other_beat).toBe(false);
    // A renewed lease is not reclaimable at the original expiry.
    const steal = await queue.claim({ worker_id: "worker_b", now: later(LEASE_MS + 1), lease_ms: LEASE_MS });
    expect(steal).toBeNull();
  });

  it("completes a job so it is no longer claimable", async () => {
    await queue.enqueue(job("start"), T0);
    const claimed = await queue.claim({ worker_id: "worker_a", now: later(0), lease_ms: LEASE_MS });
    expect(await queue.complete({ job_id: claimed!.job_id, worker_id: "worker_a" })).toBe(true);
    const after = await queue.claim({ worker_id: "worker_b", now: later(LEASE_MS + 1), lease_ms: LEASE_MS });
    expect(after).toBeNull();
  });

  it("releases a job with a backoff before it becomes available again", async () => {
    await queue.enqueue(job("start"), T0);
    const claimed = await queue.claim({ worker_id: "worker_a", now: later(0), lease_ms: LEASE_MS });
    await queue.release({
      job_id: claimed!.job_id,
      worker_id: "worker_a",
      now: later(1000),
      backoff_ms: 5000,
      error: "provider timeout",
    });
    // Still inside the backoff window: not claimable.
    expect(await queue.claim({ worker_id: "worker_b", now: later(2000), lease_ms: LEASE_MS })).toBeNull();
    // After the backoff: claimable again.
    const requeued = await queue.claim({ worker_id: "worker_b", now: later(7000), lease_ms: LEASE_MS });
    expect(requeued?.run_id).toBe(RUN);
  });

  it("fails a poison job under the current lease so it cannot be reclaimed", async () => {
    await queue.enqueue(job("start"), T0);
    const claimed = await queue.claim({ worker_id: "worker_a", now: T0, lease_ms: LEASE_MS });

    expect(
      await queue.fail({
        job_id: claimed!.job_id,
        worker_id: "worker_a",
        now: later(100),
        error: "RUN_RUNTIME_UNAVAILABLE",
      }),
    ).toBe(true);
    expect(
      await queue.claim({ worker_id: "worker_b", now: later(LEASE_MS + 1), lease_ms: LEASE_MS }),
    ).toBeNull();
    expect(await db.collection("ai_run_jobs").findOne({ _id: claimed!.job_id as never }))
      .toBeNull();
    expect(await db.collection("ai_run_jobs").findOne({ runId: RUN })).toMatchObject({
      status: "failed",
      lastError: "RUN_RUNTIME_UNAVAILABLE",
    });
  });
});
