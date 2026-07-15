/**
 * G4.9g — run resume handler.
 *
 * Proves submit_resume accepts only a strict clarification/approval payload,
 * persists it on the tenant-scoped run, and enqueues a resume job — rejecting an
 * invalid payload and a cross-tenant run before any job is queued.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { create_ai_run_repository } from "../../apps/ai/server/repositories/ai-run-repository";
import { AIRunNotFoundError } from "../../apps/ai/server/repositories/ai-run-repository";
import { create_run_job_queue } from "../../apps/ai/server/services/ai-gateway/run-job-queue";
import {
  ResumeRequestInvalidError,
  submit_resume,
  type ResumeHandlerDeps,
} from "../../apps/ai/server/services/ai-gateway/resume-handler";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let deps: ResumeHandlerDeps;

const TENANT = "507f1f77bcf86cd7994390a1";
const OTHER = "507f1f77bcf86cd7994390b1";
const T0 = new Date("2026-07-15T00:00:00.000Z");

const CLARIFICATION = { kind: "clarification", answer: "Oily, acne-prone." };
const APPROVAL = { kind: "approval", approval_id: "a1", decision: "approve", decided_by_profile_id: "p1" };

/** Seed a run and return its id. */
async function seed_run(key: string, correlation: string): Promise<string> {
  const { run } = await create_ai_run_repository(db).create(
    { tenant_id: TENANT, document: { idempotencyKey: key, correlationId: correlation, agentKey: "formulation" } },
    T0,
  );
  return String(run._id);
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("test_resume_handler");
  await db.collection("ai_runs").createIndex({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
  await db.collection("ai_runs").createIndex({ correlationId: 1 }, { unique: true });
  await db.collection("ai_run_jobs").createIndex({ runId: 1, command: 1 }, { unique: true });
  deps = { runs: create_ai_run_repository(db), jobs: create_run_job_queue(db), now: () => T0 };
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

beforeEach(async () => {
  await db.collection("ai_runs").deleteMany({});
  await db.collection("ai_run_jobs").deleteMany({});
});

describe("submit_resume", () => {
  it("persists a clarification payload and enqueues a resume job", async () => {
    const run_id = await seed_run("idem-r-1", "corr-r-1");
    const result = await submit_resume({ tenant_id: TENANT, run_id, payload: CLARIFICATION }, deps);
    expect(result).toEqual({ run_id, status: "accepted" });
    const run = await db.collection("ai_runs").findOne({});
    expect(run?.pendingResume).toEqual(CLARIFICATION);
    expect(await db.collection("ai_run_jobs").countDocuments({ command: "resume" })).toBe(1);
  });

  it("accepts an approval decision", async () => {
    const run_id = await seed_run("idem-r-2", "corr-r-2");
    await submit_resume({ tenant_id: TENANT, run_id, payload: APPROVAL }, deps);
    const run = await db.collection("ai_runs").findOne({});
    expect(run?.pendingResume).toEqual(APPROVAL);
  });

  it("rejects an invalid payload before any job is queued", async () => {
    const run_id = await seed_run("idem-r-3", "corr-r-3");
    await expect(
      submit_resume({ tenant_id: TENANT, run_id, payload: { kind: "nope" } }, deps),
    ).rejects.toBeInstanceOf(ResumeRequestInvalidError);
    expect(await db.collection("ai_run_jobs").countDocuments({})).toBe(0);
  });

  it("rejects a cross-tenant resume", async () => {
    const run_id = await seed_run("idem-r-4", "corr-r-4");
    await expect(
      submit_resume({ tenant_id: OTHER, run_id, payload: CLARIFICATION }, deps),
    ).rejects.toBeInstanceOf(AIRunNotFoundError);
    expect(await db.collection("ai_run_jobs").countDocuments({})).toBe(0);
  });
});
