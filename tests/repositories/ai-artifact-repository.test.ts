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
import {
  PermissionDeniedError,
  ResourceNotFoundError,
} from "../../apps/ai/server/repositories/tenant-repository-base";
import {
  create_ai_artifact_repository,
  type AIArtifactRepository,
} from "../../apps/ai/server/repositories/ai-artifact-repository";
import {
  create_formula_repository,
  type FormulaRepository,
} from "../../apps/ai/server/repositories/formula-repository";
import {
  FormulaArtifactService,
  FormulaCommitNotApprovedError,
  type FormulaApprovalGate,
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
let formulas: FormulaRepository;

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
const a_user = () => make_context(TENANT_A, PROFILE_A, "user");
const b_manager = () => make_context(TENANT_B, PROFILE_B, "manager");

/** An approval gate with a switchable verdict, recording its queries. */
class FakeApprovalGate implements FormulaApprovalGate {
  public readonly queries: Array<Record<string, string>> = [];
  constructor(private approved: boolean) {}
  async has_approved_artifact(query: {
    tenant_id: string;
    artifact_id: string;
    run_id: string;
  }): Promise<boolean> {
    this.queries.push({ ...query });
    return this.approved;
  }
}

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
  formulas = create_formula_repository(db);
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

beforeEach(async () => {
  await db.collection("ai_artifacts").deleteMany({});
  await db.collection("formulas").deleteMany({});
  await db.collection("formula_version_logs").deleteMany({});
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
    const formula_id = "507f1f77bcf86cd79943d001";
    const first = await repository.mark_confirmed(a_manager(), id, formula_id);
    expect(first.status).toBe("confirmed");
    expect(first.confirmedFormulaId).toBe(formula_id);
    expect((await repository.mark_confirmed(a_manager(), id, formula_id)).status).toBe("confirmed");
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

describe("FormulaArtifactService.commit_confirmed", () => {
  const service = () =>
    new FormulaArtifactService(evidence_provider, undefined, repository, formulas);

  async function persist_draft(): Promise<string> {
    const { artifact_id } = await service().persist_draft(
      a_manager(),
      draft_artifact(),
      VALIDATION,
      RUN_ID,
    );
    return artifact_id;
  }

  const commit_args = (artifact_id: string) => ({
    artifact_id,
    run_id: RUN_ID,
    idempotency_key: `commit_${artifact_id}`,
  });

  it("creates and confirms a formula, links the artifact, and logs the confirm", async () => {
    const artifact_id = await persist_draft();
    const result = await service().commit_confirmed(
      a_manager(),
      commit_args(artifact_id),
      new FakeApprovalGate(true),
    );
    expect(result.already_committed).toBe(false);
    expect(result.formula_id).toMatch(/^[a-f0-9]{24}$/);

    const formula = await formulas.get_formula(a_manager(), result.formula_id);
    expect(formula.status).toBe("confirmed");
    expect(formula.formulaName).toBe("Test serum");

    const artifact = await repository.get_artifact(a_manager(), artifact_id);
    expect(artifact.status).toBe("confirmed");
    expect(artifact.confirmedFormulaId).toBe(result.formula_id);

    const logs = await formulas.list_version_logs(a_manager(), result.formula_id);
    expect(logs.some((log) => log.action === "confirm")).toBe(true);
  });

  it("is idempotent: a replay returns the same formula without duplicating it", async () => {
    const artifact_id = await persist_draft();
    const first = await service().commit_confirmed(
      a_manager(),
      commit_args(artifact_id),
      new FakeApprovalGate(true),
    );
    const second = await service().commit_confirmed(
      a_manager(),
      commit_args(artifact_id),
      new FakeApprovalGate(true),
    );
    expect(second.already_committed).toBe(true);
    expect(second.formula_id).toBe(first.formula_id);
    expect(await db.collection("formulas").countDocuments({ tenantId: TENANT_A })).toBe(1);
  });

  it("rejects a commit with no covering approval and creates no formula", async () => {
    const artifact_id = await persist_draft();
    await expect(
      service().commit_confirmed(a_manager(), commit_args(artifact_id), new FakeApprovalGate(false)),
    ).rejects.toBeInstanceOf(FormulaCommitNotApprovedError);
    expect(await db.collection("formulas").countDocuments({ tenantId: TENANT_A })).toBe(0);
  });

  it("denies a caller lacking formula:confirm before checking approval", async () => {
    const artifact_id = await persist_draft();
    const gate = new FakeApprovalGate(true);
    await expect(
      service().commit_confirmed(a_user(), commit_args(artifact_id), gate),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(gate.queries).toHaveLength(0);
  });

  it("throws when the formula repository is not injected", async () => {
    const partial = new FormulaArtifactService(evidence_provider, undefined, repository);
    await expect(
      partial.commit_confirmed(
        a_manager(),
        commit_args("507f1f77bcf86cd79943f001"),
        new FakeApprovalGate(true),
      ),
    ).rejects.toThrow(/FormulaRepository/);
  });
});
