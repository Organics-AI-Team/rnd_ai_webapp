/**
 * G4.8d-iii wiring — concrete FormulaApprovalGate over ai_approvals.
 *
 * Proves the gate returns true only for an "approved" AIApproval matching the
 * tenant, run, and artifact — and false for a pending/rejected approval, a
 * different artifact/run, or another tenant. A pure DB read, no credentials.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { create_ai_approval_gate } from "../../apps/ai/server/repositories/ai-approval-gate";
import type { FormulaApprovalGate } from "../../apps/ai/server/services/ai-control/formula-artifact-service";
import type { TenantExecutionContext } from "../../packages/shared-types/src/tenant";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let gate: FormulaApprovalGate;

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";
const RUN = "507f1f77bcf86cd79943c001";
const ARTIFACT = "507f1f77bcf86cd79943e001";

// Only tenant_id is read from the context here; scope is carried in the query.
const CONTEXT = { tenant_id: TENANT_A } as TenantExecutionContext;

/** Insert an approval document with a given status. */
async function seed_approval(status: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await db.collection("ai_approvals").insertOne({
    tenantId: TENANT_A,
    runId: RUN,
    artifactId: ARTIFACT,
    status,
    ...overrides,
  });
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("test_approval_gate");
  gate = create_ai_approval_gate(db);
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

beforeEach(async () => {
  await db.collection("ai_approvals").deleteMany({});
});

describe("create_ai_approval_gate", () => {
  const query = { tenant_id: TENANT_A, artifact_id: ARTIFACT, run_id: RUN };

  it("is true for an approved approval matching tenant, run, and artifact", async () => {
    await seed_approval("approved");
    expect(await gate.has_approved_artifact(query, CONTEXT)).toBe(true);
  });

  it("accepts the exact approved graph checkpoint when the pending record predates the artifact link", async () => {
    const checkpoint_id = `${RUN}:approval:formula.confirm:${"a".repeat(64)}`;
    await seed_approval("approved", { artifactId: null, checkpointId: checkpoint_id });
    expect(
      await gate.has_approved_artifact(
        { ...query, approval_checkpoint_id: checkpoint_id },
        CONTEXT,
      ),
    ).toBe(true);
  });

  it("is false for a pending or rejected approval", async () => {
    await seed_approval("pending");
    expect(await gate.has_approved_artifact(query, CONTEXT)).toBe(false);
    await db.collection("ai_approvals").deleteMany({});
    await seed_approval("rejected");
    expect(await gate.has_approved_artifact(query, CONTEXT)).toBe(false);
  });

  it("is false when no approval exists", async () => {
    expect(await gate.has_approved_artifact(query, CONTEXT)).toBe(false);
  });

  it("does not match an approval for a different artifact or run", async () => {
    await seed_approval("approved", { artifactId: "507f1f77bcf86cd79943eeee" });
    expect(await gate.has_approved_artifact(query, CONTEXT)).toBe(false);
  });

  it("does not match another tenant's approval", async () => {
    await seed_approval("approved", { tenantId: TENANT_B });
    expect(await gate.has_approved_artifact(query, CONTEXT)).toBe(false);
  });
});
