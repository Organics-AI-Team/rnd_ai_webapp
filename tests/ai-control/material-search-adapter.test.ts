// tests/ai-control/material-search-adapter.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import {
  TENANT_ROLE_PERMISSIONS,
  type RequestPrincipal,
  type TenantExecutionContext,
} from "../../packages/shared-types/src/auth";
import { build_tenant_execution_context } from "../../apps/ai/server/auth/tenant-execution-context";
import { create_formula_repository } from "../../apps/ai/server/repositories/formula-repository";
import { create_product_repository } from "../../apps/ai/server/repositories/product-repository";
import { create_repository_backed_tool_ports } from "../../apps/ai/server/services/ai-control/tools/repository-adapters";
import type { TrustedToolContext } from "../../apps/ai/server/services/ai-control/tool-definition";

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

/** Trusted per-call context fixture. */
function trusted(tenant_id: string): TrustedToolContext {
  return {
    tenant_id,
    actor_profile_id: "507f1f77bcf86cd79943a003",
    run_id: "run-1",
    correlation_id: "corr-1",
    idempotency_key: "idem-1",
    signal: new AbortController().signal,
  };
}

/** Repository-backed ports with the product repository wired. */
function ports_for(tenant_id: string) {
  return create_repository_backed_tool_ports({
    tenant_context: context_for(tenant_id),
    formula_repository: create_formula_repository(db),
    product_repository: create_product_repository(db),
  });
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("material_search");
  await db.collection("products").insertMany([
    { tenantId: TENANT_A, productCode: "RC1", productName: "Niacinamide PC", INCI_name: "Niacinamide", cas_no: "98-92-0", supplier: "DSM", price: 850, stockQuantity: 10, isActive: true, benefits: ["skin conditioning"], functions: ["skin conditioning"] },
    { tenantId: TENANT_A, productCode: "RC2", productName: "Paraben Blend", INCI_name: "Methylparaben", cas_no: "", supplier: "X", price: 120, stockQuantity: 4, isActive: true, benefits: [], functions: [] },
    { tenantId: TENANT_B, productCode: "RB1", productName: "Foreign Niacinamide", INCI_name: "Niacinamide", cas_no: "98-92-0", supplier: "Y", price: 100, stockQuantity: 9, isActive: true, benefits: [], functions: [] },
  ]);
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

describe("material_search adapter", () => {
  it("returns only the caller's tenant materials with structured filters applied", async () => {
    const out = await ports_for(TENANT_A).material_search.search_materials(
      { query: "niacinamide", max_price: 1000, in_stock_only: true, exclude_inci: ["paraben"] },
      trusted(TENANT_A),
    );
    expect(out.result_count).toBe(1);
    expect(out.materials[0]).toMatchObject({
      rm_code: "RC1",
      name: "Niacinamide PC",
      inci_name: "Niacinamide",
      cas_no: "98-92-0",
      price_thb_per_kg: 850,
      in_stock: true,
    });
    expect(out.materials.map((m) => m.rm_code)).not.toContain("RB1");
  });

  it("fails closed on a trusted-context tenant mismatch", async () => {
    await expect(
      ports_for(TENANT_A).material_search.search_materials({ query: "x" }, trusted(TENANT_B)),
    ).rejects.toMatchObject({ code: "TOOL_INPUT_INVALID" });
  });

  it("stays NOT_WIRED when the product repository is absent", async () => {
    const ports = create_repository_backed_tool_ports({
      tenant_context: context_for(TENANT_A),
      formula_repository: create_formula_repository(db),
    });
    await expect(
      ports.material_search.search_materials({ query: "x" }, trusted(TENANT_A)),
    ).rejects.toMatchObject({ code: "NOT_WIRED" });
  });
});
