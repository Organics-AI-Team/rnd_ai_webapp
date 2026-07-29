/**
 * G5.5 — tenant-stable AI canary assignment and rollback.
 *
 * These tests use a real Mongo replica set so authorization, deployment
 * validation, optimistic concurrency, audit events, and transactional rollback
 * are exercised together.
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AIRolloutAuthorizationError,
  AIRolloutConflictError,
  AIRolloutDeploymentUnavailableError,
  create_ai_rollout_repository,
  type AIRolloutRepository,
} from "../../apps/ai/server/repositories/ai-rollout-repository";
import {
  select_executor,
  type RolloutAssignmentSource,
} from "../../apps/ai/server/services/ai-gateway/run-selector";
import {
  parse_set_ai_rollout_args,
  set_ai_rollout,
} from "../../apps/ai/scripts/set-ai-rollout";
import {
  parse_rollback_ai_rollout_args,
  rollback_ai_rollout,
} from "../../apps/ai/scripts/rollback-ai-rollout";

let repl: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let repository: AIRolloutRepository;

const TENANT_A = new ObjectId("507f1f77bcf86cd7994390a1");
const TENANT_B = new ObjectId("507f1f77bcf86cd7994390a2");
const DEPLOYMENT_A = new ObjectId("507f1f77bcf86cd7994390d1");
const RETIRED_DEPLOYMENT_A = new ObjectId("507f1f77bcf86cd7994390d2");
const SUPER_ADMIN = new ObjectId("507f1f77bcf86cd7994390f1");
const PLATFORM_ADMIN = new ObjectId("507f1f77bcf86cd7994390f2");
const NOW = new Date("2026-07-16T00:00:00.000Z");

/** Seed the minimum control-plane documents used by the rollout repository. */
async function seed_control_plane(): Promise<void> {
  await db.collection("user_profiles").insertMany([
    {
      _id: SUPER_ADMIN,
      clerkUserId: "user_super",
      platformRole: "super_admin",
      status: "active",
    },
    {
      _id: PLATFORM_ADMIN,
      clerkUserId: "user_admin",
      platformRole: "admin",
      status: "active",
    },
  ]);
  await db.collection("agent_deployments").insertMany([
    {
      _id: DEPLOYMENT_A,
      tenantId: TENANT_A,
      agentKey: "formulation",
      revision: 3,
      status: "active",
    },
    {
      _id: RETIRED_DEPLOYMENT_A,
      tenantId: TENANT_A,
      agentKey: "formulation",
      revision: 2,
      status: "retired",
    },
  ]);
}

/** Create the initial governed-loop assignment for tenant A. */
async function assign_tenant_a(): Promise<Awaited<ReturnType<AIRolloutRepository["assign"]>>> {
  return repository.assign(
    {
      tenant_id: TENANT_A.toHexString(),
      executor: "agentic",
      deployment_id: DEPLOYMENT_A.toHexString(),
      cohort: "internal",
      actor_profile_id: SUPER_ADMIN.toHexString(),
      reason: "Initial internal canary",
      expected_version: null,
    },
    NOW,
  );
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(repl.getUri());
  await client.connect();
  db = client.db("test_ai_rollout");
  await db.collection("ai_rollout_assignments").createIndex({ tenantId: 1 }, { unique: true });
  await db.collection("ai_rollout_events").createIndex({ idempotencyKey: 1 }, { unique: true });
  repository = create_ai_rollout_repository(db);
}, 60_000);

afterAll(async () => {
  await client.close();
  await repl.stop();
});

beforeEach(async () => {
  await Promise.all([
    db.collection("ai_rollout_assignments").deleteMany({}),
    db.collection("ai_rollout_events").deleteMany({}),
    db.collection("ai_runs").deleteMany({}),
    db.collection("agent_deployments").deleteMany({}),
    db.collection("user_profiles").deleteMany({}),
  ]);
  await seed_control_plane();
});

describe("AI tenant rollout repository", () => {
  it("keeps one stable assignment for every request from a tenant", async () => {
    const assigned = await assign_tenant_a();

    const first = await select_executor(TENANT_A.toHexString(), repository);
    const second = await select_executor(TENANT_A.toHexString(), repository);

    expect(first).toEqual(second);
    expect(first).toEqual({
      executor: "agentic",
      deployment_id: DEPLOYMENT_A.toHexString(),
      assignment_id: assigned.assignment._id.toString(),
      assignment_version: 1,
    });
    expect(await db.collection("ai_rollout_assignments").countDocuments({ tenantId: TENANT_A })).toBe(1);
  });

  it("loads exactly one assignment and never performs a per-request split", async () => {
    const assignment = {
      _id: new ObjectId(),
      tenantId: TENANT_A,
      executor: "agentic" as const,
      deploymentId: DEPLOYMENT_A,
      version: 7,
    };
    let loads = 0;
    const source: RolloutAssignmentSource = {
      async select_for_run() {
        loads += 1;
        return assignment;
      },
    };

    expect(await select_executor(TENANT_A.toHexString(), source)).toEqual({
      executor: "agentic",
      deployment_id: DEPLOYMENT_A.toHexString(),
      assignment_id: assignment._id.toHexString(),
      assignment_version: 7,
    });
    expect(loads).toBe(1);
  });

  it("keeps an in-flight run pinned after tenant rollback", async () => {
    await assign_tenant_a();
    const selection = await select_executor(TENANT_A.toHexString(), repository);
    const inserted = await db.collection("ai_runs").insertOne({
      tenantId: TENANT_A,
      executor: selection.executor,
      deploymentId: new ObjectId(selection.deployment_id),
      rolloutAssignmentVersion: selection.assignment_version,
    });

    await repository.rollback(
      {
        tenant_id: TENANT_A.toHexString(),
        expected_version: 1,
        actor_profile_id: SUPER_ADMIN.toHexString(),
        reason: "Canary health threshold exceeded",
      },
      new Date(NOW.getTime() + 1_000),
    );

    expect((await db.collection("ai_runs").findOne({ _id: inserted.insertedId }))?.executor).toBe("agentic");
    expect((await select_executor(TENANT_A.toHexString(), repository)).executor).toBe("legacy");
  });

  it("rejects an agentic assignment when its deployment is not active", async () => {
    await expect(
      repository.assign(
        {
          tenant_id: TENANT_A.toHexString(),
          executor: "agentic",
          deployment_id: RETIRED_DEPLOYMENT_A.toHexString(),
          cohort: "internal",
          actor_profile_id: SUPER_ADMIN.toHexString(),
          reason: "Must not select a retired deployment",
          expected_version: null,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(AIRolloutDeploymentUnavailableError);
    expect(await db.collection("ai_rollout_assignments").countDocuments({})).toBe(0);
  });

  it("uses compare-and-set versions for assignment changes", async () => {
    await assign_tenant_a();

    await expect(
      repository.assign(
        {
          tenant_id: TENANT_A.toHexString(),
          executor: "agentic",
          deployment_id: DEPLOYMENT_A.toHexString(),
          cohort: "design_partner",
          actor_profile_id: SUPER_ADMIN.toHexString(),
          reason: "Stale promotion attempt",
          expected_version: 2,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(AIRolloutConflictError);
  });

  it("makes rollback replay idempotent without duplicating audit events", async () => {
    await assign_tenant_a();
    const input = {
      tenant_id: TENANT_A.toHexString(),
      expected_version: 1,
      actor_profile_id: SUPER_ADMIN.toHexString(),
      reason: "Operator rollback drill",
    };

    const first = await repository.rollback(input, NOW);
    const replayed = await repository.rollback(input, new Date(NOW.getTime() + 5_000));

    expect(replayed.replayed).toBe(true);
    expect(replayed.assignment.version).toBe(first.assignment.version);
    expect(await db.collection("ai_rollout_events").countDocuments({ eventType: "rolled_back" })).toBe(1);
  });

  it("allows only an active super admin to change an assignment", async () => {
    await expect(
      repository.assign(
        {
          tenant_id: TENANT_A.toHexString(),
          executor: "agentic",
          deployment_id: DEPLOYMENT_A.toHexString(),
          cohort: "internal",
          actor_profile_id: PLATFORM_ADMIN.toHexString(),
          reason: "Platform admin is not sufficient",
          expected_version: null,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(AIRolloutAuthorizationError);
    expect(await db.collection("ai_rollout_assignments").countDocuments({})).toBe(0);
  });
});

describe("AI rollout operator scripts", () => {
  it("requires exactly one tenant target or a named cohort plus all safety arguments", () => {
    expect(
      parse_set_ai_rollout_args([
        "--tenant=507f1f77bcf86cd7994390a1",
        "--executor=ooda",
        "--deployment=507f1f77bcf86cd7994390d1",
        "--reason=internal canary",
        "--actor-clerk-id=user_super",
        "--expected-version=new",
      ]),
    ).toMatchObject({ executor: "agentic", expected_version: null });
    expect(() => parse_set_ai_rollout_args([])).toThrow(/--tenant.*--cohort/);
    expect(() =>
      parse_set_ai_rollout_args([
        "--tenant=a",
        "--cohort=internal",
        "--executor=agentic",
        "--deployment=d",
        "--reason=r",
        "--actor-clerk-id=u",
        "--expected-version=new",
      ]),
    ).toThrow(/exactly one/i);
  });

  it("resolves a super admin through injected ports and emits a signed tenant-list manifest", async () => {
    const result = await set_ai_rollout(
      {
        cohort: "internal",
        executor: "agentic",
        deployment_id: DEPLOYMENT_A.toHexString(),
        reason: "Internal cohort promotion",
        actor_clerk_user_id: "user_super",
        expected_version: null,
      },
      {
        resolve_super_admin: async (clerk_user_id) =>
          clerk_user_id === "user_super" ? { profile_id: SUPER_ADMIN.toHexString() } : null,
        resolve_cohort_tenant_ids: async () => [TENANT_A.toHexString()],
        assign: (input, now) => repository.assign(input, now),
        sign_manifest: async (payload) => `signed:${payload.length}`,
        now: () => NOW,
      },
    );

    expect(result.manifest.tenant_ids).toEqual([TENANT_A.toHexString()]);
    expect(result.manifest.executor).toBe("agentic");
    expect(result.signature).toMatch(/^signed:/);
  });

  it("fails closed when the injected actor resolver cannot prove super-admin status", async () => {
    await expect(
      set_ai_rollout(
        {
          tenant_id: TENANT_A.toHexString(),
          executor: "agentic",
          deployment_id: DEPLOYMENT_A.toHexString(),
          reason: "Unauthorized promotion",
          actor_clerk_user_id: "user_admin",
          expected_version: null,
        },
        {
          resolve_super_admin: async () => null,
          resolve_cohort_tenant_ids: async () => [],
          assign: (input, now) => repository.assign(input, now),
          sign_manifest: async () => "must-not-sign",
          now: () => NOW,
        },
      ),
    ).rejects.toBeInstanceOf(AIRolloutAuthorizationError);
  });

  it("requires an expected version for rollback and routes it through the injected port", async () => {
    await assign_tenant_a();
    const parsed = parse_rollback_ai_rollout_args([
      `--tenant=${TENANT_A.toHexString()}`,
      "--expected-version=1",
      "--reason=rollback drill",
      "--actor-clerk-id=user_super",
    ]);
    const result = await rollback_ai_rollout(parsed, {
      resolve_super_admin: async () => ({ profile_id: SUPER_ADMIN.toHexString() }),
      rollback: (input, now) => repository.rollback(input, now),
      now: () => NOW,
    });

    expect(result.assignment.executor).toBe("legacy");
    expect(result.assignment.version).toBe(2);
    expect(() => parse_rollback_ai_rollout_args([])).toThrow(/--expected-version/);
  });
});
