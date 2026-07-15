/**
 * G4.8d-ii — ai_artifacts persistence.
 *
 * The repository stores AI-produced formula drafts tenant-scoped: a draft can
 * never be read or confirmed across tenants, and FormulaArtifactService.persist_draft
 * records the validated content, its canonical hash, the validation outcome, and
 * cited evidence sources. Exercised against a real in-memory MongoDB.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { build_tenant_execution_context } from "../../apps/ai/server/auth/tenant-execution-context";
import { TENANT_ROLE_PERMISSIONS } from "../../packages/shared-types/src/auth";
import type { RequestPrincipal, TenantRole } from "../../packages/shared-types/src/auth";
import type { TenantExecutionContext } from "../../packages/shared-types/src/tenant";
import { ResourceNotFoundError } from "../../apps/ai/server/repositories/tenant-repository-base";
import {
  create_ai_artifact_repository,
  type AIArtifactRepository,
} from "../../apps/ai/server/repositories/ai-artifact-repository";
import {
  FormulaArtifactService,
  type MaterialEvidenceProvider,
} from "../../apps/ai/server/services/ai-control/formula-artifact-service";
import type {
  ArtifactValidationV1,
  FormulaArtifactV1,
} from "@rnd-ai/ai-orchestration";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repository: AIArtifactRepository;

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";
const PROFILE_A = "507f1f77bcf86cd79943a001";
const PROFILE_B = "507f1f77bcf86cd79943b001";
const RUN_ID = "507f1f77bcf86cd79943c001";

/**
 * Build a member-mode tenant execution context for tests.
 *
 * @param tenant_id - Tenant string ID the context is scoped to.
 * @param profile_id - Internal actor profile ID.
 * @param role - Tenant role deciding the permission catalogue.
 * @returns Frozen TenantExecutionContext in member mode.
 */
function make_context(
  tenant_id: string,
  profile_id: string,
  role: TenantRole,
): TenantExecutionContext {
  const principal: RequestPrincipal = {
    auth_provider: "clerk",
    provider_user_id: `user_${profile_id}`,
    internal_user_id: profile_id,
    active_tenant_id: tenant_id,
    platform_role: null,
    tenant_role: role,
    permissions: TENANT_ROLE_PERMISSIONS[role],
    membership_status: "active",
  };
  return build_tenant_execution_context(principal, null, {
    clerk_organization_id: `org_${tenant_id}`,
    membership_id: `mem_${profile_id}`,
  });
}

const a_manager = () => make_context(TENANT_A, PROFILE_A, "manager");
const b_manager = () => make_context(TENANT_B, PROFILE_B, "manager");

/** A minimal valid formula artifact for persistence provenance. */
function draft_artifact(): FormulaArtifactV1 {
  return {
    name: "Test serum",
    product_type: "serum",
    batch_size: "100",
    batch_unit: "g",
    ingredients: [
      {
        material_id: "AQUA",
        rm_code: "AQUA",
        phase: "water",
        percentage: "95.00",
        amount: "95.00",
        unit: "g",
        cost: "0.01",
        source_ids: [],
        rationale: "solvent base",
        is_water: true,
        external_unverified: false,
      },
      {
        material_id: "RM_ACTIVE",
        rm_code: "RM_ACTIVE",
        phase: "active",
        percentage: "5.00",
        amount: "5.00",
        unit: "g",
        cost: "1.00",
        source_ids: ["src-1"],
        rationale: "active",
        is_water: false,
        external_unverified: false,
      },
    ],
    claims: [{ text: "Brightening", source_ids: ["src-2"] }],
    warnings: [],
  };
}

const VALIDATION: ArtifactValidationV1 = { valid: true, findings: [] };
const evidence_provider: MaterialEvidenceProvider = { async load_evidence() { return {}; } };

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("test_ai_artifacts");
  repository = create_ai_artifact_repository(db);
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

beforeEach(async () => {
  await db.collection("ai_artifacts").deleteMany({});
});

describe("AIArtifactRepository", () => {
  it("persists a draft stamped with tenant, owner, and draft status", async () => {
    const context = a_manager();
    const doc = await repository.persist_draft(context, {
      runId: RUN_ID,
      artifactType: "formula",
      schemaVersion: "1",
      content: draft_artifact(),
      contentHash: "a".repeat(64),
      validationResult: VALIDATION,
      sourceEvidenceIds: ["src-1"],
    });
    expect(doc.status).toBe("draft");
    expect(doc.revision).toBe(1);
    expect(doc.tenantId).toBe(TENANT_A);
    expect(doc.ownerProfileId).toBe(PROFILE_A);
  });

  it("reads a draft back within the tenant but not across tenants", async () => {
    const created = await repository.persist_draft(a_manager(), {
      runId: RUN_ID,
      artifactType: "formula",
      schemaVersion: "1",
      content: draft_artifact(),
      contentHash: "a".repeat(64),
      validationResult: VALIDATION,
      sourceEvidenceIds: [],
    });
    const id = String(created._id);
    const read = await repository.get_artifact(a_manager(), id);
    expect(String(read._id)).toBe(id);
    await expect(repository.get_artifact(b_manager(), id)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("marks a draft confirmed idempotently", async () => {
    const created = await repository.persist_draft(a_manager(), {
      runId: RUN_ID,
      artifactType: "formula",
      schemaVersion: "1",
      content: draft_artifact(),
      contentHash: "a".repeat(64),
      validationResult: VALIDATION,
      sourceEvidenceIds: [],
    });
    const id = String(created._id);
    expect((await repository.mark_confirmed(a_manager(), id)).status).toBe("confirmed");
    expect((await repository.mark_confirmed(a_manager(), id)).status).toBe("confirmed");
  });
});

describe("FormulaArtifactService.persist_draft", () => {
  it("persists the validated draft with hash and collected source ids", async () => {
    const service = new FormulaArtifactService(evidence_provider, undefined, repository);
    const artifact = draft_artifact();
    const { artifact_id, content_hash } = await service.persist_draft(
      a_manager(),
      artifact,
      VALIDATION,
      RUN_ID,
    );
    expect(content_hash).toMatch(/^[a-f0-9]{64}$/);
    const stored = await repository.get_artifact(a_manager(), artifact_id);
    expect(stored.artifactType).toBe("formula");
    expect(stored.status).toBe("draft");
    expect(stored.contentHash).toBe(content_hash);
    expect(stored.sourceEvidenceIds).toEqual(expect.arrayContaining(["src-1", "src-2"]));
  });

  it("throws when no artifact repository is injected", async () => {
    const service = new FormulaArtifactService(evidence_provider);
    await expect(
      service.persist_draft(a_manager(), draft_artifact(), VALIDATION, RUN_ID),
    ).rejects.toThrow(/AIArtifactRepository/);
  });
});
