import { describe, expect, it } from "vitest";

import type {
  Permission,
  RequestPrincipal,
} from "../../packages/shared-types/src/auth";
import {
  require_active_tenant,
  require_permission,
} from "../../apps/ai/server/auth/authorize";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
import { map_legacy_role_to_tenant_role } from "../../apps/ai/server/auth/legacy-principal-resolver";

/**
 * Build a tenant-scoped principal for authorization tests.
 *
 * @param overrides - Principal fields to override for the scenario.
 * @returns A RequestPrincipal representing an active tenant manager by default.
 */
function principal_with(
  overrides: Partial<RequestPrincipal> = {},
): RequestPrincipal {
  return {
    auth_provider: "legacy",
    provider_user_id: "account-1",
    internal_user_id: "user-1",
    active_tenant_id: "org-1",
    platform_role: null,
    tenant_role: "manager",
    permissions: ["tenant:read", "formula:draft", "formula:confirm", "ai:run"],
    membership_status: "active",
    ...overrides,
  };
}

/**
 * Run an authorization assertion and capture its AuthorizationError.
 *
 * @param assertion - Callback expected to throw an AuthorizationError.
 * @returns The thrown AuthorizationError.
 */
function expect_authorization_error(assertion: () => void): AuthorizationError {
  try {
    assertion();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthorizationError);
    return error as AuthorizationError;
  }
  throw new Error("expected the authorization assertion to throw");
}

describe("legacy role mapping", () => {
  it("maps a legacy admin only to tenant manager, never platform admin", () => {
    expect(map_legacy_role_to_tenant_role("admin")).toBe("manager");
  });

  it("maps shipper and shopper to tenant user", () => {
    expect(map_legacy_role_to_tenant_role("shipper")).toBe("user");
    expect(map_legacy_role_to_tenant_role("shopper")).toBe("user");
  });
});

describe("require_permission", () => {
  it("throws UNAUTHENTICATED when no principal is present", () => {
    const error = expect_authorization_error(() =>
      require_permission(null, "ai:run"),
    );
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("throws FORBIDDEN when the permission is missing", () => {
    const student = principal_with({
      tenant_role: "user",
      permissions: ["tenant:read", "formula:draft", "ai:run"],
    });
    const error = expect_authorization_error(() =>
      require_permission(student, "formula:confirm"),
    );
    expect(error.code).toBe("FORBIDDEN");
  });

  it("never accepts a platform permission for a tenant-only principal", () => {
    const platform_permissions: Permission[] = [
      "platform:tenants:create",
      "platform:roles:grant",
    ];
    for (const permission of platform_permissions) {
      const error = expect_authorization_error(() =>
        require_permission(principal_with(), permission),
      );
      expect(error.code).toBe("FORBIDDEN");
    }
  });

  it("passes when the permission is granted", () => {
    expect(() =>
      require_permission(principal_with(), "formula:confirm"),
    ).not.toThrow();
  });
});

describe("require_active_tenant", () => {
  it("throws UNAUTHENTICATED when no principal is present", () => {
    const error = expect_authorization_error(() => require_active_tenant(null));
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("throws FORBIDDEN for a principal without tenant context", () => {
    const platform_only = principal_with({
      active_tenant_id: null,
      tenant_role: null,
      membership_status: null,
    });
    const error = expect_authorization_error(() =>
      require_active_tenant(platform_only),
    );
    expect(error.code).toBe("FORBIDDEN");
  });

  it("throws MEMBERSHIP_INACTIVE for a suspended membership", () => {
    const suspended = principal_with({ membership_status: "suspended" });
    const error = expect_authorization_error(() =>
      require_active_tenant(suspended),
    );
    expect(error.code).toBe("MEMBERSHIP_INACTIVE");
  });

  it("passes for an active tenant membership", () => {
    expect(() => require_active_tenant(principal_with())).not.toThrow();
  });
});
