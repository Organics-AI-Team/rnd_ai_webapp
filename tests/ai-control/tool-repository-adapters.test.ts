/**
 * G3.4 — repository-backed governed tool adapters.
 *
 * Proves the wired ports (search/comment/confirm) delegate to the tenant-scoped
 * FormulaRepository over a bound run context: cross-tenant IDs surface as
 * FORMULA_NOT_FOUND, search never leaks another tenant's rows, a tenant
 * mismatch on the trusted context fails closed, and the Qdrant/web ports stay
 * NOT_WIRED (no legacy fallback).
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  TENANT_ROLE_PERMISSIONS,
  type RequestPrincipal,
  type TenantExecutionContext,
} from "../../packages/shared-types/src/auth";
import { build_tenant_execution_context } from "../../apps/ai/server/auth/tenant-execution-context";
import { create_formula_repository } from "../../apps/ai/server/repositories/formula-repository";
import { create_ai_artifact_repository } from "../../apps/ai/server/repositories/ai-artifact-repository";
import { create_ai_approval_gate } from "../../apps/ai/server/repositories/ai-approval-gate";
import { FormulaArtifactService } from "../../apps/ai/server/services/ai-control/formula-artifact-service";
import { create_repository_backed_tool_ports } from "../../apps/ai/server/services/ai-control/tools/repository-adapters";
import type { TrustedToolContext } from "../../apps/ai/server/services/ai-control/tool-definition";
import { governed_formula_artifact } from "./helpers";

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";
const MANAGER_A = "507f1f77bcf86cd79943a003";
const FORMULA_A = "00000000000000000000f0a1";
const FORMULA_B = "00000000000000000000f0b1";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

/**
 * Build a frozen manager TenantExecutionContext.
 *
 * @param tenant_id - Tenant scope.
 * @param profile_id - Acting profile id.
 * @returns Frozen member-mode context with the manager permission catalogue.
 */
function manager_context(
  tenant_id: string,
  profile_id: string,
): TenantExecutionContext {
  const principal: RequestPrincipal = {
    auth_provider: "clerk",
    provider_user_id: `user_${profile_id}`,
    internal_user_id: profile_id,
    active_tenant_id: tenant_id,
    platform_role: null,
    tenant_role: "manager",
    permissions: TENANT_ROLE_PERMISSIONS.manager,
    membership_status: "active",
  };
  return build_tenant_execution_context(principal, null, {
    clerk_organization_id: `org_${tenant_id}`,
    membership_id: `mem_${profile_id}`,
  });
}

/**
 * Build a trusted tool context for a run.
 *
 * @param tenant_id - Trusted tenant scope.
 * @param idempotency_key - Deterministic call key.
 * @returns TrustedToolContext fixture.
 */
function trusted(tenant_id: string, idempotency_key = "idem-1"): TrustedToolContext {
  return {
    tenant_id,
    actor_profile_id: MANAGER_A,
    run_id: "run-1",
    correlation_id: "corr-1",
    idempotency_key,
    signal: new AbortController().signal,
  };
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("test");
});

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await db.collection("formulas").deleteMany({});
  await db.collection("formula_comments").deleteMany({});
  await db.collection("formula_version_logs").deleteMany({});
  await db.collection("ai_artifacts").deleteMany({});
  await db.collection("ai_approvals").deleteMany({});
  await db.collection("formulas").insertMany([
    {
      _id: new ObjectId(FORMULA_A),
      tenantId: TENANT_A,
      ownerProfileId: MANAGER_A,
      formulaCode: "F000001",
      formulaName: "Tenant A Brightening Serum",
      status: "draft",
      version: 0,
      client: "Acme",
      targetBenefits: ["brightening"],
      ingredients: [{ rm_code: "RM1", inci_name: "Niacinamide", percentage: 5 }],
      totalAmount: 100,
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    },
    {
      _id: new ObjectId(FORMULA_B),
      tenantId: TENANT_B,
      ownerProfileId: "507f1f77bcf86cd79943b003",
      formulaCode: "F000002",
      formulaName: "Tenant B Brightening Cream",
      status: "draft",
      version: 0,
      targetBenefits: ["brightening"],
      ingredients: [],
    },
  ]);
});

function ports_for(tenant_id: string, profile_id = MANAGER_A) {
  const tenant_context = manager_context(tenant_id, profile_id);
  const formula_repository = create_formula_repository(db);
  return create_repository_backed_tool_ports({
    tenant_context,
    formula_repository,
    formula_commit: {
      service: new FormulaArtifactService(
        { async load_evidence() { return {}; } },
        undefined,
        create_ai_artifact_repository(db),
        formula_repository,
        tenant_context,
      ),
      approval_gate: create_ai_approval_gate(db),
    },
  });
}

async function seed_artifact(
  tenant_id: string,
  profile_id: string,
  hash_character: string,
): Promise<string> {
  const context = manager_context(tenant_id, profile_id);
  const document = await create_ai_artifact_repository(db).persist_draft(context, {
    runId: "run-1",
    artifactType: "formula",
    schemaVersion: "1",
    content: governed_formula_artifact(),
    contentHash: hash_character.repeat(64),
    validationResult: { valid: true, findings: [] },
    sourceEvidenceIds: ["source-niacinamide"],
  });
  return String(document._id);
}

describe("formula_search adapter", () => {
  it("returns only the caller's tenant formulas", async () => {
    const ports = ports_for(TENANT_A);
    const result = await ports.formula_search.search_formulas(
      { query: "brightening" },
      trusted(TENANT_A),
    );
    const names = result.formulas.map((f) => f.formula_name);
    expect(names).toContain("Tenant A Brightening Serum");
    expect(names).not.toContain("Tenant B Brightening Cream");
    expect(result.result_count).toBe(1);
  });
});

describe("formula_comment adapter", () => {
  it("adds a comment to a tenant-A formula", async () => {
    const ports = ports_for(TENANT_A);
    const out = await ports.formula_comment.add_formula_comment(
      { formula_id: FORMULA_A, content: "looks great", comment_type: "approval" },
      trusted(TENANT_A),
    );
    expect(out.formula_id).toBe(FORMULA_A);
    expect(out.comment_type).toBe("approval");
  });

  it("cannot comment on a tenant-B formula (FORMULA_NOT_FOUND)", async () => {
    const ports = ports_for(TENANT_A);
    await expect(
      ports.formula_comment.add_formula_comment(
        { formula_id: FORMULA_B, content: "x" },
        trusted(TENANT_A),
      ),
    ).rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });
  });
});

describe("formula_confirm adapter", () => {
  it("commits a tenant-A validated artifact after durable manager approval", async () => {
    const artifact_id = await seed_artifact(TENANT_A, MANAGER_A, "a");
    await db.collection("ai_approvals").insertOne({
      tenantId: TENANT_A,
      runId: "run-1",
      artifactId: artifact_id,
      status: "approved",
    });
    const ports = ports_for(TENANT_A);
    const out = await ports.formula_confirm.confirm_formula(
      { artifact_id },
      trusted(TENANT_A),
    );
    expect(out.status).toBe("confirmed");
    expect(out.artifact_id).toBe(artifact_id);
    expect(out.formula_id).toMatch(/^[a-f0-9]{24}$/);
    expect(out.already_committed).toBe(false);
  });

  it("cannot confirm a tenant-B artifact", async () => {
    const artifact_id = await seed_artifact(
      TENANT_B,
      "507f1f77bcf86cd79943b003",
      "b",
    );
    const ports = ports_for(TENANT_A);
    await expect(
      ports.formula_confirm.confirm_formula(
        { artifact_id },
        trusted(TENANT_A),
      ),
    ).rejects.toMatchObject({ code: "AI_ARTIFACT_NOT_FOUND" });
  });
});

describe("formula artifact draft/revision adapters", () => {
  it("returns the canonical artifact for a governed draft", async () => {
    const ports = ports_for(TENANT_A);
    const artifact = governed_formula_artifact();

    await expect(
      ports.formula_draft.create_draft_formula({ artifact }, trusted(TENANT_A)),
    ).resolves.toEqual(artifact);
  });

  it("requires an owned tenant draft before returning a revised artifact", async () => {
    const ports = ports_for(TENANT_A);
    const artifact = governed_formula_artifact();

    await expect(
      ports.formula_revise.revise_formula(
        {
          formula_id: FORMULA_A,
          artifact,
          revision_summary: "Apply the reviewed evidence constraints.",
        },
        trusted(TENANT_A),
      ),
    ).resolves.toEqual(artifact);
    await expect(
      ports.formula_revise.revise_formula(
        {
          formula_id: FORMULA_B,
          artifact,
          revision_summary: "Must not reveal a foreign formula.",
        },
        trusted(TENANT_A),
      ),
    ).rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });
  });
});

describe("tenant guard and unwired ports", () => {
  it("rejects a trusted context whose tenant differs from the run context", async () => {
    const ports = ports_for(TENANT_A);
    await expect(
      ports.formula_search.search_formulas({ query: "x" }, trusted(TENANT_B)),
    ).rejects.toMatchObject({ code: "TOOL_INPUT_INVALID" });
  });

  it("keeps knowledge/web ports fail-closed NOT_WIRED", async () => {
    const ports = ports_for(TENANT_A);
    await expect(
      ports.knowledge_search.search_knowledge({ query: "x" } as never, trusted(TENANT_A)),
    ).rejects.toMatchObject({ code: "NOT_WIRED" });
    await expect(
      ports.web_search.search_web({ query: "x" } as never, trusted(TENANT_A)),
    ).rejects.toMatchObject({ code: "NOT_WIRED" });
  });
});
