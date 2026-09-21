import { describe, expect, it } from "vitest";

import {
  build_tenant_execution_context,
  TenantContextError,
} from "../../apps/ai/server/auth/tenant-execution-context";
import { TENANT_ROLE_PERMISSIONS } from "../../packages/shared-types/src/auth";
import type { RequestPrincipal } from "../../packages/shared-types/src/auth";
import type { SupportAccessGrantView } from "../../packages/shared-types/src/tenant";

const member: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_1",
  internal_user_id: "507f1f77bcf86cd799439021",
  active_tenant_id: "507f1f77bcf86cd799439031",
  platform_role: null,
  tenant_role: "manager",
  permissions: TENANT_ROLE_PERMISSIONS.manager,
  membership_status: "active",
};

const platform_admin: RequestPrincipal = {
  ...member,
  provider_user_id: "user_admin",
  active_tenant_id: null,
  platform_role: "admin",
  tenant_role: null,
  permissions: ["platform:tenants:read"],
  membership_status: null,
};

const now = new Date("2026-07-15T00:00:00Z");

const valid_grant: SupportAccessGrantView = {
  id: "grant_1",
  tenant_id: "507f1f77bcf86cd799439031",
  platform_profile_id: platform_admin.internal_user_id,
  permissions: ["tenant:ai:read"],
  approved_by_profile_id: "507f1f77bcf86cd799439099",
  approved_at: new Date("2026-07-14T00:00:00Z"),
  expires_at: new Date("2026-07-16T00:00:00Z"),
  revoked_at: null,
  correlation_id: "corr-1",
};

describe("build_tenant_execution_context", () => {
  it("builds a member context with frozen fields", () => {
    const context = build_tenant_execution_context(member, null, {
      clerk_organization_id: "org_1",
      membership_id: "mem_1",
      now,
    });
    expect(context).toMatchObject({
      tenant_id: member.active_tenant_id,
      actor_profile_id: member.internal_user_id,
      access_mode: "member",
      tenant_role: "manager",
      support_grant_id: null,
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(() => {
      (context as any).tenant_id = "other";
    }).toThrow();
  });

  it("rejects a suspended membership", () => {
    expect(() =>
      build_tenant_execution_context(
        { ...member, membership_status: "suspended" },
        null,
        { clerk_organization_id: "org_1", membership_id: "mem_1", now },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "TENANT_MEMBERSHIP_REQUIRED" }),
    );
  });

  it("rejects a platform admin without membership or support grant", () => {
    expect(() =>
      build_tenant_execution_context(platform_admin, null, {
        clerk_organization_id: "org_1",
        membership_id: null,
        now,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TENANT_MEMBERSHIP_REQUIRED" }),
    );
  });

  it("rejects an expired support grant", () => {
    expect(() =>
      build_tenant_execution_context(
        platform_admin,
        { ...valid_grant, expires_at: new Date("2026-07-14T12:00:00Z") },
        { clerk_organization_id: "org_1", membership_id: null, now },
      ),
    ).toThrowError(expect.objectContaining({ code: "SUPPORT_GRANT_INVALID" }));
  });

  it("rejects a self-approved or revoked support grant", () => {
    expect(() =>
      build_tenant_execution_context(
        platform_admin,
        { ...valid_grant, approved_by_profile_id: platform_admin.internal_user_id },
        { clerk_organization_id: "org_1", membership_id: null, now },
      ),
    ).toThrowError(expect.objectContaining({ code: "SUPPORT_GRANT_INVALID" }));
    expect(() =>
      build_tenant_execution_context(
        platform_admin,
        { ...valid_grant, revoked_at: new Date("2026-07-14T13:00:00Z") },
        { clerk_organization_id: "org_1", membership_id: null, now },
      ),
    ).toThrowError(expect.objectContaining({ code: "SUPPORT_GRANT_INVALID" }));
  });

  it("builds a support context restricted to the grant's permissions", () => {
    const context = build_tenant_execution_context(platform_admin, valid_grant, {
      clerk_organization_id: "org_1",
      membership_id: null,
      now,
    });
    expect(context).toMatchObject({
      tenant_id: valid_grant.tenant_id,
      access_mode: "support",
      support_grant_id: "grant_1",
      tenant_role: null,
    });
    expect(context.permissions).toEqual(["tenant:ai:read"]);
  });

  it("rejects a requested tenant that differs from the principal's tenant", () => {
    expect(() =>
      build_tenant_execution_context(member, null, {
        clerk_organization_id: "org_1",
        membership_id: "mem_1",
        requested_tenant_id: "507f1f77bcf86cd799439999",
        now,
      }),
    ).toThrowError(expect.objectContaining({ code: "TENANT_MISMATCH" }));
    expect(TenantContextError).toBeTruthy();
  });
});
