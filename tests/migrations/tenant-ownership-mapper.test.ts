import { describe, expect, it } from "vitest";

import {
  resolve_tenant_ownership,
  is_valid_object_id,
} from "../../apps/ai/server/services/migrations/tenant-ownership-mapper";

const tenant_a = "507f1f77bcf86cd799439031";
const tenant_b = "507f1f77bcf86cd799439032";

describe("resolve_tenant_ownership", () => {
  it("resolves a direct organization match", () => {
    expect(
      resolve_tenant_ownership({
        direct_tenant_id: tenant_a,
        parent_tenant_id: null,
        unique_actor_tenant_id: null,
      }),
    ).toEqual({ kind: "resolved", tenant_id: tenant_a });
  });

  it("resolves a parent match (Formula/ChatThread parents)", () => {
    expect(
      resolve_tenant_ownership({
        direct_tenant_id: null,
        parent_tenant_id: tenant_b,
        unique_actor_tenant_id: null,
      }),
    ).toEqual({ kind: "resolved", tenant_id: tenant_b });
  });

  it("resolves a user-only unique match", () => {
    expect(
      resolve_tenant_ownership({
        direct_tenant_id: null,
        parent_tenant_id: null,
        unique_actor_tenant_id: tenant_a,
      }),
    ).toEqual({ kind: "resolved", tenant_id: tenant_a });
  });

  it("agreeing sources resolve without quarantine", () => {
    expect(
      resolve_tenant_ownership({
        direct_tenant_id: tenant_a,
        parent_tenant_id: tenant_a,
        unique_actor_tenant_id: tenant_a,
      }),
    ).toEqual({ kind: "resolved", tenant_id: tenant_a });
  });

  it("quarantines conflicting ownership evidence", () => {
    expect(
      resolve_tenant_ownership({
        direct_tenant_id: tenant_a,
        parent_tenant_id: tenant_b,
        unique_actor_tenant_id: tenant_a,
      }),
    ).toEqual({
      kind: "quarantine",
      reason: "CONFLICTING_OWNERS",
      candidates: [tenant_a, tenant_b],
    });
  });

  it("quarantines when nothing resolves (missing parent, orphan)", () => {
    expect(
      resolve_tenant_ownership({
        direct_tenant_id: null,
        parent_tenant_id: null,
        unique_actor_tenant_id: null,
      }),
    ).toEqual({ kind: "quarantine", reason: "NO_OWNER", candidates: [] });
  });

  it("treats malformed ObjectIds as absent evidence", () => {
    expect(is_valid_object_id("not-an-id")).toBe(false);
    expect(
      resolve_tenant_ownership({
        direct_tenant_id: "not-an-id",
        parent_tenant_id: tenant_a,
        unique_actor_tenant_id: null,
      }),
    ).toEqual({ kind: "resolved", tenant_id: tenant_a });
  });

  it("is deterministic under replay (pure function)", () => {
    const evidence = {
      direct_tenant_id: tenant_a,
      parent_tenant_id: tenant_b,
      unique_actor_tenant_id: null,
    };
    expect(resolve_tenant_ownership(evidence)).toEqual(
      resolve_tenant_ownership(evidence),
    );
  });
});
