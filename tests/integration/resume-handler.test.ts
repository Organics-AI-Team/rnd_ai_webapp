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
  ResumeForbiddenError,
  ResumeRequestInvalidError,
  submit_resume,
  type ResumeHandlerDeps,
} from "../../apps/ai/server/services/ai-gateway/resume-handler";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let deps: ResumeHandlerDeps;

const TENANT = "507f1f77bcf86cd7994390a1";
const OTHER = "507f1f77bcf86cd7994390b1";
const T0 = new Date("2026-07-15T00:00:00.000Z");

const ACTOR_PROFILE_ID = "profile_server_verified";
const tenant = (overrides: Partial<TenantExecutionContext> = {}): TenantExecutionContext => ({
  tenant_id: TENANT,
  actor_profile_id: ACTOR_PROFILE_ID,
  tenant_role: "user",
  permissions: ["ai:run"],
  ...overrides,
} as TenantExecutionContext);
const CLARIFICATION = {
  kind: "clarification",
  answer: "Oily, acne-prone.",
  idempotency_key: "resume-clarification-0001",
};
const APPROVAL = {
  kind: "approval",
  approval_id: "a1",
  decision: "approve",
  idempotency_key: "resume-approval-0001",
};

/** Seed a run and return its id. */
async function seed_run(key: string, correlation: string): Promise<string> {
  const { run } = await create_ai_run_repository(db).create(
    {
      tenant_id: TENANT,
      document: {
        idempotencyKey: key,
        correlationId: correlation,
        agentKey: "formulation",
        actorProfileId: ACTOR_PROFILE_ID,
      },
    },
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
  await db.collection("ai_run_jobs").createIndex(
    { runId: 1, command: 1, idempotencyKey: 1 },
    { unique: true },
  );
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
    const result = await submit_resume(
      { tenant: tenant(), run_id, payload: CLARIFICATION },
      deps,
    );
    expect(result).toEqual({ run_id, status: "accepted" });
    const run = await db.collection("ai_runs").findOne({});
    expect(run?.pendingResume).toEqual({ answer: CLARIFICATION.answer });
    expect(await db.collection("ai_run_jobs").countDocuments({ command: "resume" })).toBe(1);
  });

  it("accepts an approval decision", async () => {
    const run_id = await seed_run("idem-r-2", "corr-r-2");
    await submit_resume(
      {
        tenant: tenant({ tenant_role: "manager", permissions: ["ai:run", "formula:confirm"] }),
        run_id,
        payload: APPROVAL,
      },
      deps,
    );
    const run = await db.collection("ai_runs").findOne({});
    expect(run?.pendingResume).toEqual({
      approval_id: APPROVAL.approval_id,
      decision: APPROVAL.decision,
      decided_by_profile_id: ACTOR_PROFILE_ID,
    });
  });

  it("rejects a client-supplied approval actor identity", async () => {
    const run_id = await seed_run("idem-r-actor", "corr-r-actor");
    await expect(
      submit_resume(
        {
          tenant: tenant({ tenant_role: "manager", permissions: ["ai:run", "formula:confirm"] }),
          run_id,
          payload: { ...APPROVAL, decided_by_profile_id: "attacker_profile" },
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(ResumeRequestInvalidError);
    expect(await db.collection("ai_run_jobs").countDocuments({})).toBe(0);
  });

  it("requires manager authority for an approval decision", async () => {
    const run_id = await seed_run("idem-r-manager", "corr-r-manager");
    await expect(
      submit_resume({ tenant: tenant(), run_id, payload: APPROVAL }, deps),
    ).rejects.toBeInstanceOf(ResumeForbiddenError);
    expect(await db.collection("ai_run_jobs").countDocuments({})).toBe(0);
  });

  it("rejects a different actor that has no manager authority", async () => {
    const run_id = await seed_run("idem-r-owner", "corr-r-owner");
    await expect(
      submit_resume(
        {
          tenant: tenant({ actor_profile_id: "different_profile" }),
          run_id,
          payload: CLARIFICATION,
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(ResumeForbiddenError);
    expect(await db.collection("ai_run_jobs").countDocuments({})).toBe(0);
  });

  it("deduplicates a retried resume action but schedules a later interrupt", async () => {
    const run_id = await seed_run("idem-r-generation", "corr-r-generation");
    const args = {
      tenant: tenant({ tenant_role: "manager", permissions: ["ai:run", "formula:confirm"] }),
      run_id,
      payload: CLARIFICATION,
    };
    await submit_resume(args, deps);
    await submit_resume(args, deps);
    await submit_resume(
      {
        ...args,
        payload: { ...APPROVAL, idempotency_key: "resume-approval-0002" },
      },
      deps,
    );
    expect(await db.collection("ai_run_jobs").countDocuments({ command: "resume" })).toBe(2);
  });

  it("rejects an invalid payload before any job is queued", async () => {
    const run_id = await seed_run("idem-r-3", "corr-r-3");
    await expect(
      submit_resume(
        { tenant: tenant(), run_id, payload: { kind: "nope" } },
        deps,
      ),
    ).rejects.toBeInstanceOf(ResumeRequestInvalidError);
    expect(await db.collection("ai_run_jobs").countDocuments({})).toBe(0);
  });

  it("rejects a cross-tenant resume", async () => {
    const run_id = await seed_run("idem-r-4", "corr-r-4");
    await expect(
      submit_resume(
        { tenant: tenant({ tenant_id: OTHER }), run_id, payload: CLARIFICATION },
        deps,
      ),
    ).rejects.toBeInstanceOf(AIRunNotFoundError);
    expect(await db.collection("ai_run_jobs").countDocuments({})).toBe(0);
  });
});
