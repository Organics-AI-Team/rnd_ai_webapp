import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repository_root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const schema_source = readFileSync(join(repository_root, "prisma/schema.prisma"), "utf8");

/**
 * Extract one model block from the Prisma schema.
 *
 * @param source - Full Prisma schema text.
 * @param name - Model name (exact, case-sensitive).
 * @returns Block text between "model X {" and its closing brace.
 * @throws Error when the model is not declared.
 */
function parse_prisma_model(source: string, name: string): string {
  const match = source.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`model not found: ${name}`);
  return match[0];
}

/**
 * Extract one enum block from the Prisma schema.
 *
 * @param name - Enum name (exact, case-sensitive).
 * @returns Block text between "enum X {" and its closing brace.
 * @throws Error when the enum is not declared.
 */
function parse_prisma_enum(name: string): string {
  const match = schema_source.match(new RegExp(`enum ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`enum not found: ${name}`);
  return match[0];
}

/**
 * List field names a model requires (declared without ? optional or [] list
 * markers), so version pins and audit linkage cannot silently become nullable.
 *
 * @param model_source - One model block from parse_prisma_model.
 * @returns Required scalar/enum field names in declaration order.
 */
function required_fields(model_source: string): string[] {
  return model_source
    .split("\n")
    .slice(1, -1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2 && !parts[1].endsWith("?") && !parts[1].endsWith("[]"))
    .map((parts) => parts[0]);
}

describe("AI control-plane schema (G3.1)", () => {
  it.each([
    ["AIProfileStatus", ["active", "disabled"]],
    ["AgentDeploymentStatus", ["draft", "active", "retired"]],
    ["PromptStatus", ["draft", "approved", "active", "retired"]],
    ["KnowledgeScope", ["platform", "tenant"]],
    ["KnowledgeVisibility", ["managers", "all_members"]],
    [
      "KnowledgeSourceStatus",
      ["pending", "quarantined", "indexing", "ready", "failed", "deleted"],
    ],
    [
      "AIRunStatus",
      [
        "queued",
        "running",
        "waiting_clarification",
        "waiting_approval",
        "completed",
        "partial",
        "failed",
        "cancelled",
      ],
    ],
    ["AIUsageEntryType", ["reservation", "actual", "release", "adjustment"]],
    ["AIApprovalStatus", ["pending", "approved", "rejected", "expired"]],
    ["AIArtifactStatus", ["draft", "pending_review", "confirmed", "rejected", "superseded"]],
  ] as const)("enum %s declares its lifecycle values", (name, values) => {
    const block = parse_prisma_enum(name);
    for (const value of values) {
      expect(block).toMatch(new RegExp(`\\b${value}\\b`));
    }
  });

  it("requires immutable policy and deployment pins on every run", () => {
    const airun = parse_prisma_model(schema_source, "AIRun");
    expect(required_fields(airun)).toEqual(
      expect.arrayContaining([
        "tenantId",
        "deploymentId",
        "orchestratorVersion",
        "policyVersion",
        "policySnapshot",
        "promptVersionId",
        "inputSchemaVersion",
        "outputSchemaVersion",
      ]),
    );
  });

  it("makes AIRun idempotent per tenant and traceable by correlation id", () => {
    const airun = parse_prisma_model(schema_source, "AIRun");
    expect(airun).toMatch(/correlationId\s+String\s+@unique/);
    expect(airun).toMatch(/@@unique\(\[tenantId, idempotencyKey\]\)/);
    expect(airun).toMatch(/@@index\(\[tenantId, status, createdAt\]\)/);
    expect(airun).toMatch(/@@index\(\[tenantId, createdAt\]\)/);
  });

  it("keeps one AI profile per tenant with status index and micro-USD BigInt budgets", () => {
    const profile = parse_prisma_model(schema_source, "TenantAIProfile");
    expect(profile).toMatch(/tenantId\s+String\s+@unique/);
    expect(profile).toMatch(/@@index\(\[tenantId, status\]\)/);
    for (const field of [
      "monthlyRequestLimit",
      "monthlyTokenLimit",
      "monthlyCostLimitMicrousd",
      "perUserMonthlyRequestLimit",
      "perUserMonthlyTokenLimit",
      "perUserMonthlyCostLimitMicrousd",
      "perRunTokenLimit",
      "perRunCostLimitMicrousd",
      "knowledgeStorageLimitBytes",
    ]) {
      expect(profile).toMatch(new RegExp(`${field}\\s+BigInt`));
    }
  });

  it("versions agent deployments uniquely per tenant and agent", () => {
    const deployment = parse_prisma_model(schema_source, "AgentDeployment");
    expect(deployment).toMatch(/@@unique\(\[tenantId, agentKey, revision\]\)/);
    expect(deployment).toMatch(/@@index\(\[tenantId, agentKey, status\]\)/);
    expect(required_fields(deployment)).toEqual(
      expect.arrayContaining([
        "orchestratorVersion",
        "promptVersionId",
        "inputSchemaVersion",
        "outputSchemaVersion",
      ]),
    );
  });

  it("versions prompts uniquely per scope key with nullable tenant provenance", () => {
    const prompt = parse_prisma_model(schema_source, "PromptVersion");
    expect(prompt).toMatch(/@@unique\(\[scopeKey, promptKey, revision\]\)/);
    expect(prompt).toMatch(/tenantId\s+String\?\s+@db\.ObjectId/);
    expect(required_fields(prompt)).toEqual(
      expect.arrayContaining(["scope", "scopeKey", "promptKey", "revision", "contentHash"]),
    );
  });

  it("indexes knowledge sources by scope and tenant lifecycle", () => {
    const source = parse_prisma_model(schema_source, "KnowledgeSource");
    expect(source).toMatch(/tenantId\s+String\?\s+@db\.ObjectId/);
    expect(source).toMatch(/@@index\(\[scope, status\]\)/);
    expect(source).toMatch(/@@index\(\[tenantId, status\]\)/);
  });

  it("keeps the usage ledger append-only, run-linked, and idempotent", () => {
    const ledger = parse_prisma_model(schema_source, "AIUsageLedger");
    expect(ledger).toMatch(/idempotencyKey\s+String\s+@unique/);
    expect(ledger).toMatch(/entryType\s+AIUsageEntryType/);
    expect(ledger).toMatch(/costMicrousd\s+BigInt/);
    expect(ledger).toMatch(/@@index\(\[tenantId, billingPeriod\]\)/);
    expect(required_fields(ledger)).toEqual(
      expect.arrayContaining(["tenantId", "runId", "actorProfileId", "billingPeriod"]),
    );
    expect(ledger).not.toMatch(/updatedAt/);
  });

  it("links artifacts to their run and owner with status indexes", () => {
    const artifact = parse_prisma_model(schema_source, "AIArtifact");
    expect(artifact).toMatch(/@@index\(\[tenantId, ownerProfileId, status\]\)/);
    expect(artifact).toMatch(/@@index\(\[tenantId, status\]\)/);
    expect(required_fields(artifact)).toEqual(
      expect.arrayContaining(["tenantId", "runId", "ownerProfileId", "schemaVersion", "contentHash"]),
    );
  });

  it("links approvals to run checkpoints with idempotent decisions", () => {
    const approval = parse_prisma_model(schema_source, "AIApproval");
    expect(approval).toMatch(/idempotencyKey\s+String\s+@unique/);
    expect(approval).toMatch(/status\s+AIApprovalStatus/);
    expect(required_fields(approval)).toEqual(
      expect.arrayContaining([
        "tenantId",
        "runId",
        "checkpointId",
        "requestedByProfileId",
        "requiredPermission",
      ]),
    );
  });
});
