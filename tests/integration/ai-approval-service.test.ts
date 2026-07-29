/**
 * Durable orchestration ApprovalService adapter integration tests.
 *
 * The suite exercises real Mongo atomic transitions and mixed historical
 * string/ObjectId encodings without provider credentials.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TrustedRuntimeContext } from "../../packages/ai-orchestration/src/ports";
import {
  ApprovalServiceError,
  create_ai_approval_service,
} from "../../apps/ai/server/repositories/ai-approval-service";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";
const RUN_A = "507f1f77bcf86cd79943c001";
const RUN_B = "507f1f77bcf86cd79943c002";
const REQUESTER = "507f1f77bcf86cd79943a001";
const MANAGER = "507f1f77bcf86cd79943a002";
const OTHER_MANAGER = "507f1f77bcf86cd79943a003";
const ACTION_KEY = `${RUN_A}:approval:formula.confirm:${"a".repeat(64)}`;
const NOW = new Date("2026-07-16T04:00:00.000Z");

/** Trusted runtime context for tenant A's run. */
function context(overrides: Partial<TrustedRuntimeContext> = {}): TrustedRuntimeContext {
  return {
    tenant_id: TENANT_A,
    actor_profile_id: REQUESTER,
    run_id: RUN_A,
    parent_run_id: null,
    delegation_depth: 0,
    correlation_id: "corr-approval-test",
    ...overrides,
  };
}

/** Seed a manager membership using either historical storage encoding. */
async function seed_manager(
  profile_id = MANAGER,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db.collection("tenant_membership_projections").insertOne({
    tenantId: new ObjectId(TENANT_A),
    userProfileId: profile_id,
    tenantRole: "manager",
    status: "active",
    ...overrides,
  });
}

/** Build a strict approval resume payload. */
function resume(
  approval_id: string,
  decision: "approve" | "deny" = "approve",
  decided_by_profile_id = MANAGER,
): Record<string, unknown> {
  return { approval_id, decision, decided_by_profile_id };
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("test_ai_approval_service");
  await db.collection("ai_approvals").createIndex({ idempotencyKey: 1 }, { unique: true });
}, 60_000);

afterAll(async () => {
  await client.close();
  await server.stop();
});

beforeEach(async () => {
  await Promise.all([
    db.collection("ai_approvals").deleteMany({}),
    db.collection("tenant_membership_projections").deleteMany({}),
  ]);
});

describe("create_ai_approval_service", () => {
  it("idempotently creates one active pending approval with a safe bounded summary", async () => {
    const service = create_ai_approval_service(db, TENANT_A, {
      now: () => NOW,
      pending_ttl_ms: 60_000,
    });
    const unsafe_summary = `  Approve\u0000 formula\n${"x".repeat(2_100)}  `;

    const first = await service.ensure_pending(RUN_A, ACTION_KEY, unsafe_summary, context());
    const replay = await service.ensure_pending(RUN_A, ACTION_KEY, unsafe_summary, context());

    expect(replay).toEqual(first);
    expect(await db.collection("ai_approvals").countDocuments({})).toBe(1);
    const stored = await db.collection("ai_approvals").findOne({ _id: new ObjectId(first.approval_id) });
    expect(stored).toMatchObject({
      tenantId: new ObjectId(TENANT_A),
      runId: new ObjectId(RUN_A),
      checkpointId: ACTION_KEY,
      requestedByProfileId: new ObjectId(REQUESTER),
      requiredPermission: "formula:confirm",
      status: "pending",
    });
    expect(String(stored?.summary)).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(String(stored?.summary).length).toBeLessThanOrEqual(2_000);
    expect(stored?.expiresAt).toEqual(new Date(NOW.getTime() + 60_000));
  });

  it("keys pending approvals by tenant, run, and action", async () => {
    const tenant_a = create_ai_approval_service(db, TENANT_A, { now: () => NOW });
    const tenant_b = create_ai_approval_service(db, TENANT_B, { now: () => NOW });

    const first = await tenant_a.ensure_pending(RUN_A, ACTION_KEY, "Approve A", context());
    const other_run = await tenant_a.ensure_pending(
      RUN_B,
      ACTION_KEY,
      "Approve B",
      context({ run_id: RUN_B }),
    );
    const other_tenant = await tenant_b.ensure_pending(
      RUN_A,
      ACTION_KEY,
      "Approve tenant B",
      context({ tenant_id: TENANT_B }),
    );

    expect(new Set([first.approval_id, other_run.approval_id, other_tenant.approval_id]).size).toBe(3);
  });

  it("rejects an expired pending approval instead of silently replacing it", async () => {
    const service = create_ai_approval_service(db, TENANT_A, {
      now: () => NOW,
      pending_ttl_ms: 1_000,
    });
    await service.ensure_pending(RUN_A, ACTION_KEY, "Approve formula", context());
    const later = create_ai_approval_service(db, TENANT_A, {
      now: () => new Date(NOW.getTime() + 2_000),
    });

    await expect(
      later.ensure_pending(RUN_A, ACTION_KEY, "Approve formula", context()),
    ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    expect(await db.collection("ai_approvals").countDocuments({})).toBe(1);
  });

  it("strictly binds resume to approval ID, tenant, run, and action key", async () => {
    const service = create_ai_approval_service(db, TENANT_A, { now: () => NOW });
    const pending = await service.ensure_pending(RUN_A, ACTION_KEY, "Approve formula", context());
    await seed_manager();

    await expect(
      service.verify_resume(
        {
          run_id: RUN_A,
          action_idempotency_key: ACTION_KEY,
          resume: { ...resume(pending.approval_id), extra: "not allowed" },
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_RESUME_INVALID" });
    await expect(
      service.verify_resume(
        {
          run_id: RUN_A,
          action_idempotency_key: `${ACTION_KEY}:different`,
          resume: resume(pending.approval_id),
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" });
    await expect(
      service.verify_resume(
        {
          run_id: RUN_B,
          action_idempotency_key: ACTION_KEY,
          resume: resume(pending.approval_id),
        },
        context({ run_id: RUN_B }),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" });
    await expect(
      service.verify_resume(
        {
          run_id: RUN_A,
          action_idempotency_key: ACTION_KEY,
          resume: resume(pending.approval_id),
        },
        context({ tenant_id: TENANT_B }),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_CONTEXT_MISMATCH" });
  });

  it("requires the decider to hold an active manager membership in the tenant", async () => {
    const service = create_ai_approval_service(db, TENANT_A, { now: () => NOW });
    const pending = await service.ensure_pending(RUN_A, ACTION_KEY, "Approve formula", context());
    await seed_manager(MANAGER, { tenantRole: "user" });
    await seed_manager(OTHER_MANAGER, { status: "suspended" });

    await expect(
      service.verify_resume(
        { run_id: RUN_A, action_idempotency_key: ACTION_KEY, resume: resume(pending.approval_id) },
        context(),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_DECIDER_FORBIDDEN" });
    await expect(
      service.verify_resume(
        {
          run_id: RUN_A,
          action_idempotency_key: ACTION_KEY,
          resume: resume(pending.approval_id, "approve", OTHER_MANAGER),
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_DECIDER_FORBIDDEN" });
  });

  it("atomically approves and permits only an exact idempotent replay", async () => {
    const service = create_ai_approval_service(db, TENANT_A, { now: () => NOW });
    const pending = await service.ensure_pending(RUN_A, ACTION_KEY, "Approve formula", context());
    await seed_manager();
    const args = {
      run_id: RUN_A,
      action_idempotency_key: ACTION_KEY,
      resume: resume(pending.approval_id),
    };

    expect(await service.verify_resume(args, context())).toEqual({
      approval_id: pending.approval_id,
      status: "approved",
    });
    expect(await service.verify_resume(args, context())).toEqual({
      approval_id: pending.approval_id,
      status: "approved",
    });
    await expect(
      service.verify_resume(
        { ...args, resume: resume(pending.approval_id, "deny") },
        context(),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_DECISION_CONFLICT" });
    await seed_manager(OTHER_MANAGER);
    await expect(
      service.verify_resume(
        { ...args, resume: resume(pending.approval_id, "approve", OTHER_MANAGER) },
        context(),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_DECISION_CONFLICT" });

    const stored = await db.collection("ai_approvals").findOne({ _id: new ObjectId(pending.approval_id) });
    expect(stored).toMatchObject({
      status: "approved",
      decidedByProfileId: new ObjectId(MANAGER),
      decidedAt: NOW,
    });
  });

  it("allows only one of two conflicting concurrent decisions to win", async () => {
    const service = create_ai_approval_service(db, TENANT_A, { now: () => NOW });
    const pending = await service.ensure_pending(RUN_A, ACTION_KEY, "Approve formula", context());
    await seed_manager();
    await seed_manager(OTHER_MANAGER);

    const results = await Promise.allSettled([
      service.verify_resume(
        { run_id: RUN_A, action_idempotency_key: ACTION_KEY, resume: resume(pending.approval_id, "approve", MANAGER) },
        context(),
      ),
      service.verify_resume(
        { run_id: RUN_A, action_idempotency_key: ACTION_KEY, resume: resume(pending.approval_id, "deny", OTHER_MANAGER) },
        context(),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: "APPROVAL_DECISION_CONFLICT",
    });
  });

  it("denies an expired resume and marks the pending record expired", async () => {
    const service = create_ai_approval_service(db, TENANT_A, {
      now: () => NOW,
      pending_ttl_ms: 1_000,
    });
    const pending = await service.ensure_pending(RUN_A, ACTION_KEY, "Approve formula", context());
    await seed_manager();
    const later = create_ai_approval_service(db, TENANT_A, {
      now: () => new Date(NOW.getTime() + 2_000),
    });

    await expect(
      later.verify_resume(
        { run_id: RUN_A, action_idempotency_key: ACTION_KEY, resume: resume(pending.approval_id) },
        context(),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    expect((await db.collection("ai_approvals").findOne({ _id: new ObjectId(pending.approval_id) }))?.status).toBe("expired");
  });

  it("counts only the bound tenant and run across string/ObjectId encodings", async () => {
    await db.collection("ai_approvals").insertMany([
      { tenantId: TENANT_A, runId: RUN_A, idempotencyKey: "one" },
      { tenantId: new ObjectId(TENANT_A), runId: new ObjectId(RUN_A), idempotencyKey: "two" },
      { tenantId: TENANT_B, runId: RUN_A, idempotencyKey: "other-tenant" },
      { tenantId: TENANT_A, runId: RUN_B, idempotencyKey: "other-run" },
    ]);
    const service = create_ai_approval_service(db, TENANT_A, { now: () => NOW });

    expect(await service.count_for_run(RUN_A)).toBe(2);
  });

  it("exposes stable safe errors without echoing untrusted identifiers", async () => {
    const service = create_ai_approval_service(db, TENANT_A, { now: () => NOW });
    const secret = "secret-action-value";

    const error = await service
      .verify_resume(
        {
          run_id: RUN_A,
          action_idempotency_key: secret,
          resume: resume(new ObjectId().toHexString()),
        },
        context(),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApprovalServiceError);
    expect(error).toMatchObject({ code: "APPROVAL_NOT_FOUND" });
    expect(String((error as Error).message)).not.toContain(secret);
  });
});
