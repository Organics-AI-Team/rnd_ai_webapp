import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import { tenant_scoped_id_filter } from "../../apps/ai/agents/react/tenant-tool-scope";

const tenant_a = "507f1f77bcf86cd799439031";
const tenant_b = "507f1f77bcf86cd799439032";
const formula_id = "507f1f77bcf86cd799439099";

describe("tenant_scoped_id_filter (G2.6)", () => {
  it("pins a record lookup to the caller's tenant", () => {
    const filter = tenant_scoped_id_filter(formula_id, tenant_a);
    expect(filter).not.toBeNull();
    expect(filter!._id).toBeInstanceOf(ObjectId);
    expect(filter!._id.toString()).toBe(formula_id);
    // Matches both stored tenant encodings (string + ObjectId).
    expect(filter!.tenantId.$in.map(String)).toContain(tenant_a);
    expect(filter!.tenantId.$in.some((v) => v instanceof ObjectId)).toBe(true);
  });

  it("a tenant-B record ID under a tenant-A scope still filters by tenant A", () => {
    // The model supplies the ID; the tenant predicate comes from context.
    // A tenant-A caller querying a tenant-B formula ID gets a filter that can
    // never match the tenant-B record — the isolation guarantee.
    const filter = tenant_scoped_id_filter(formula_id, tenant_a);
    expect(filter!.tenantId.$in.map(String)).not.toContain(tenant_b);
  });

  it("fails closed (null) when no tenant scope is present", () => {
    expect(tenant_scoped_id_filter(formula_id, undefined)).toBeNull();
    expect(tenant_scoped_id_filter(formula_id, "")).toBeNull();
  });

  it("fails closed (null) for a malformed record ID", () => {
    expect(tenant_scoped_id_filter("not-an-id", tenant_a)).toBeNull();
  });
});
