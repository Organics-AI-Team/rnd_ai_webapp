// tests/repositories/product-search-filters.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import {
  TENANT_ROLE_PERMISSIONS,
  type RequestPrincipal,
  type TenantExecutionContext,
} from "../../packages/shared-types/src/auth";
import { build_tenant_execution_context } from "../../apps/ai/server/auth/tenant-execution-context";
import { create_product_repository } from "../../apps/ai/server/repositories/product-repository";

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

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("products_filters");
  await db.collection("products").insertMany([
    { tenantId: TENANT_A, productCode: "RC1", productName: "Niacinamide PC", INCI_name: "Niacinamide", price: 850, stockQuantity: 10, isActive: true },
    { tenantId: TENANT_A, productCode: "RC2", productName: "Cheap Paraben Blend", INCI_name: "Methylparaben, Aqua", price: 120, stockQuantity: 5, isActive: true },
    { tenantId: TENANT_A, productCode: "RC3", productName: "Pricey Retinol", INCI_name: "Retinol", price: 2400, stockQuantity: 0, isActive: true },
    { tenantId: TENANT_A, productCode: "RC4", productName: "Inactive Active", INCI_name: "Bakuchiol", price: 200, stockQuantity: 3, isActive: false },
    { tenantId: TENANT_B, productCode: "RB1", productName: "Foreign Niacinamide", INCI_name: "Niacinamide", price: 100, stockQuantity: 9, isActive: true },
  ]);
});

afterAll(async () => {
  await client.close();
  await server.stop();
});

describe("search_products structured filters", () => {
  const repository = () => create_product_repository(db);

  it("applies max_price, in_stock_only, and active_only within the tenant scope", async () => {
    const { documents, total_count } = await repository().search_products(context_for(TENANT_A), {
      max_price: 1000,
      in_stock_only: true,
      active_only: true,
    });
    const codes = documents.map((doc) => doc.productCode).sort();
    expect(codes).toEqual(["RC1", "RC2"]); // RC3 too pricey+no stock, RC4 inactive, RB1 foreign
    expect(total_count).toBe(2);
  });

  it("excludes materials whose name/INCI matches an exclude term", async () => {
    const { documents } = await repository().search_products(context_for(TENANT_A), {
      exclude_terms: ["paraben"],
      active_only: true,
    });
    const codes = documents.map((doc) => doc.productCode);
    expect(codes).not.toContain("RC2");
    expect(codes).toContain("RC1");
  });

  it("never returns another tenant's products regardless of filters", async () => {
    const { documents } = await repository().search_products(context_for(TENANT_B), {
      search_term: "niacinamide",
    });
    expect(documents.map((doc) => doc.productCode)).toEqual(["RB1"]);
  });
});
