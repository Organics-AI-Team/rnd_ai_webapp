/**
 * G2.7 — tenant repository boundary enforcement (scanner rule).
 *
 * The TENANT_REPOSITORY_BYPASS rule rejects direct access to tenant-owned
 * MongoDB collections and tenant Prisma control-plane models anywhere outside
 * the repository layer, migration scripts, and the documented legacy ReAct tool
 * handlers. These fixtures cover the failing-test anchor plus the aliased/
 * chained/direct shapes the plan calls out, and confirm the production tree is
 * free of bypasses.
 */

import { describe, expect, it } from "vitest";

import {
  collect_production_sources,
  reject_tenant_collection_bypass,
  scan_private_boundaries,
  type SourceFile,
} from "../../scripts/security/scan-private-boundaries";

/**
 * Build an in-memory source file for scanner fixtures.
 *
 * @param path - Repo-relative path controlling which rules apply.
 * @param content - TypeScript source text.
 * @returns SourceFile fixture.
 */
function source(path: string, content: string): SourceFile {
  return { path, content };
}

describe("reject_tenant_collection_bypass (anchor)", () => {
  it("rejects direct tenant collection access outside repositories", () => {
    const findings = reject_tenant_collection_bypass(
      source(
        "apps/web/app/api/example/route.ts",
        "db.collection('formulas').findOne({})",
      ),
    );
    expect(findings).toEqual([
      expect.objectContaining({ code: "TENANT_REPOSITORY_BYPASS" }),
    ]);
    expect(findings[0].line).toBeGreaterThan(0);
  });

  it("allows the same access inside the tenant repository layer", () => {
    expect(
      reject_tenant_collection_bypass(
        source(
          "apps/ai/server/repositories/formula-repository.ts",
          "db.collection('formulas').findOne({})",
        ),
      ),
    ).toEqual([]);
  });

  it("allows migration scripts and the legacy ReAct tool handlers", () => {
    expect(
      reject_tenant_collection_bypass(
        source(
          "apps/ai/scripts/add-timestamps.ts",
          "db.collection('formulas').updateMany({}, {})",
        ),
      ),
    ).toEqual([]);
    expect(
      reject_tenant_collection_bypass(
        source(
          "apps/ai/agents/react/tool-handlers/confirm-formula-handler.ts",
          "db.collection('formulas').findOne(load_filter)",
        ),
      ),
    ).toEqual([]);
  });
});

describe("TENANT_REPOSITORY_BYPASS shapes", () => {
  it("flags an aliased db handle and a chained collection call", () => {
    const findings = scan_private_boundaries([
      source(
        "apps/web/app/api/x/route.ts",
        "const store = client.db(); await store.collection('formula_comments').insertOne(doc);",
      ),
      source(
        "apps/ai/server/services/leak.ts",
        "await (await client_promise).db().collection('feedback').find({}).toArray();",
      ),
    ]);
    expect(findings.map((f) => f.code)).toEqual([
      "TENANT_REPOSITORY_BYPASS",
      "TENANT_REPOSITORY_BYPASS",
    ]);
  });

  it("flags direct Prisma access to a tenant control-plane model", () => {
    const findings = scan_private_boundaries([
      source(
        "apps/web/app/api/runs/route.ts",
        "const run = await prisma.aIRun.findFirst({ where: {} });",
      ),
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ code: "TENANT_REPOSITORY_BYPASS" }),
    ]);
  });

  it("does not flag platform-global or non-tenant collections", () => {
    const findings = scan_private_boundaries([
      source(
        "apps/web/app/api/materials/route.ts",
        "db.collection('raw_materials_myskin').find({}); db.collection('organizations').findOne({});",
      ),
    ]);
    expect(findings).toEqual([]);
  });

  it("does not flag products/orders (sanctioned public client-order ingress)", () => {
    const findings = scan_private_boundaries([
      source(
        "apps/ai/server/routers/orders.ts",
        "db.collection('products').findOne({}); db.collection('orders').insertOne({});",
      ),
    ]);
    expect(
      findings.filter((f) => f.code === "TENANT_REPOSITORY_BYPASS"),
    ).toEqual([]);
  });
});

describe("production tree has zero tenant-repository bypasses", () => {
  it("scans apps/ and packages/ with no TENANT_REPOSITORY_BYPASS findings", () => {
    const findings = scan_private_boundaries(collect_production_sources());
    expect(
      findings.filter((f) => f.code === "TENANT_REPOSITORY_BYPASS"),
    ).toEqual([]);
  });
});
