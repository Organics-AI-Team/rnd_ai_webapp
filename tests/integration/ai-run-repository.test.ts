/**
 * G4.9e (part 1) — governed AI run persistence.
 *
 * Proves run creation is idempotent on [tenantId, idempotencyKey] (a retry
 * returns the same run), reads are tenant-scoped, and status transitions patch
 * the run. Exercised against a real in-memory MongoDB with the unique indexes
 * the deployment provisions.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AIRunNotFoundError,
  create_ai_run_repository,
  type AIRunRepository,
} from "../../apps/ai/server/repositories/ai-run-repository";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let runs: AIRunRepository;

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";
const T0 = new Date("2026-07-15T00:00:00.000Z");

/** A minimal AIRun document with a given idempotency key and correlation id. */
function run_doc(idempotency_key: string, correlation_id: string): Record<string, unknown> {
  return {
    idempotencyKey: idempotency_key,
    correlationId: correlation_id,
    actorProfileId: "507f1f77bcf86cd79943a001",
    agentKey: "formulation",
    deploymentId: "507f1f77bcf86cd79943d001",
    orchestratorVersion: "2026.07.0",
    executor: "agentic",
  };
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("test_ai_runs");
  await db.collection("ai_runs").createIndex({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
  await db.collection("ai_runs").createIndex({ correlationId: 1 }, { unique: true });
  runs = create_ai_run_repository(db);
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

beforeEach(async () => {
  await db.collection("ai_runs").deleteMany({});
});

describe("AIRunRepository", () => {
  it("creates a run, then finds and reads it tenant-scoped", async () => {
    const { run, created } = await runs.create(
      { tenant_id: TENANT_A, document: run_doc("idem-00000001", "corr-1") },
      T0,
    );
    expect(created).toBe(true);
    expect(run.status).toBe("queued");
    expect(run.tenantId).toBe(TENANT_A);
    const id = String(run._id);
    expect(String((await runs.get(TENANT_A, id))._id)).toBe(id);
    expect(String((await runs.find_by_idempotency(TENANT_A, "idem-00000001"))?._id)).toBe(id);
  });

  it("is idempotent — a retried create returns the same run", async () => {
    const first = await runs.create(
      { tenant_id: TENANT_A, document: run_doc("idem-00000002", "corr-2") },
      T0,
    );
    const second = await runs.create(
      { tenant_id: TENANT_A, document: run_doc("idem-00000002", "corr-2") },
      new Date(T0.getTime() + 5000),
    );
    expect(second.created).toBe(false);
    expect(String(second.run._id)).toBe(String(first.run._id));
    expect(await db.collection("ai_runs").countDocuments({ tenantId: TENANT_A })).toBe(1);
  });

  it("does not read a run across tenants", async () => {
    const { run } = await runs.create(
      { tenant_id: TENANT_A, document: run_doc("idem-00000003", "corr-3") },
      T0,
    );
    await expect(runs.get(TENANT_B, String(run._id))).rejects.toBeInstanceOf(AIRunNotFoundError);
  });

  it("allows the same idempotency key under different tenants", async () => {
    const a = await runs.create({ tenant_id: TENANT_A, document: run_doc("shared-key-01", "corr-a") }, T0);
    const b = await runs.create({ tenant_id: TENANT_B, document: run_doc("shared-key-01", "corr-b") }, T0);
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(String(a.run._id)).not.toBe(String(b.run._id));
  });

  it("marks a run's terminal status", async () => {
    const { run } = await runs.create(
      { tenant_id: TENANT_A, document: run_doc("idem-00000004", "corr-4") },
      T0,
    );
    const updated = await runs.mark_status(TENANT_A, String(run._id), {
      status: "running",
      startedAt: T0,
    });
    expect(updated.status).toBe("running");
    await expect(runs.mark_status(TENANT_B, String(run._id), { status: "failed" })).rejects.toBeInstanceOf(
      AIRunNotFoundError,
    );
  });
});
