// tests/ai-control/artifact-api-handler.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import {
  TENANT_ROLE_PERMISSIONS,
  type RequestPrincipal,
  type TenantExecutionContext,
} from "../../packages/shared-types/src/auth";
import { build_tenant_execution_context } from "../../apps/ai/server/auth/tenant-execution-context";
import { create_ai_artifact_repository } from "../../apps/ai/server/repositories/ai-artifact-repository";
import { handle_get_artifact } from "../../apps/ai/server/services/ai-gateway/artifact-api-handler";
import { governed_formula_artifact } from "./helpers";

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

/** Build a frozen member context for one tenant. */
function context_for(tenant_id: string): TenantExecutionContext {
  const principal: RequestPrincipal = {
    auth_provider: "clerk",
    provider_user_id: "user_1",
    internal_user_id: "507f1f77bcf86cd79943a003",
    active_tenant_id: tenant_id,
    platform_role: null,
    tenant_role: "user",
    permissions: TENANT_ROLE_PERMISSIONS.user,
    membership_status: "active",
  };
  return build_tenant_execution_context(principal, null, {
    clerk_organization_id: `org_${tenant_id}`,
    membership_id: "mem_1",
  });
}

/** Seed one draft artifact and return its id. */
async function seed_artifact(tenant_id: string, content: unknown, hash_char: string): Promise<string> {
  const document = await create_ai_artifact_repository(db).persist_draft(context_for(tenant_id), {
    runId: "run-1",
    artifactType: "formula",
    schemaVersion: "1",
    content,
    contentHash: hash_char.repeat(64),
    validationResult: { valid: true, findings: [] },
    sourceEvidenceIds: ["source-niacinamide"],
  });
  return String(document._id);
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("artifact_api");
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

describe("handle_get_artifact", () => {
  const deps = () => ({ artifacts: create_ai_artifact_repository(db) });

  it("returns the validated formula content for the owning tenant", async () => {
    const artifact_id = await seed_artifact(TENANT_A, governed_formula_artifact(), "a");
    const response = await handle_get_artifact(context_for(TENANT_A), artifact_id, deps());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artifact_id).toBe(artifact_id);
    expect(body.artifact_type).toBe("formula");
    expect(body.status).toBe("draft");
    expect(body.content.name).toBe("Evidence-backed synthetic serum");
    expect(body.content.ingredients.length).toBeGreaterThan(0);
  });

  it("returns 404 for a cross-tenant or unknown artifact (identical shape)", async () => {
    const artifact_id = await seed_artifact(TENANT_B, governed_formula_artifact(), "b");
    const cross = await handle_get_artifact(context_for(TENANT_A), artifact_id, deps());
    expect(cross.status).toBe(404);
    const missing = await handle_get_artifact(context_for(TENANT_A), "00000000000000000000ffff", deps());
    expect(missing.status).toBe(404);
  });

  it("returns 500 without leaking content when the stored artifact is not a valid formula", async () => {
    const artifact_id = await seed_artifact(TENANT_A, { junk: true }, "c");
    const response = await handle_get_artifact(context_for(TENANT_A), artifact_id, deps());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("AI_ARTIFACT_CONTENT_INVALID");
    expect(JSON.stringify(body)).not.toContain("junk");
  });
});
