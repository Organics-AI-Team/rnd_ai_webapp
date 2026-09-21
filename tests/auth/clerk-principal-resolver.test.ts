import { describe, expect, it, vi } from "vitest";

import {
  map_clerk_org_role,
  resolve_clerk_principal,
  type ClerkAuthState,
  type IdentityProjectionRepositories,
} from "../../apps/ai/server/auth/clerk-principal-resolver";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";

interface FixtureProfile {
  _id: string;
  clerkUserId: string;
  primaryEmail: string;
  displayName: string;
  platformRole: "super_admin" | "admin" | null;
  status: "active" | "suspended" | "deleted";
}

interface FixtureTenant {
  _id: string;
  clerkOrganizationId: string | null;
  status: "provisioning" | "active" | "suspended" | "deleted";
  slug: string;
}

interface FixtureMembership {
  tenantId: string;
  userProfileId: string;
  tenantRole: "manager" | "user";
  status: "invited" | "active" | "suspended" | "revoked";
}

/**
 * Build in-memory identity projection repositories for resolver tests.
 *
 * @param fixtures - Seeded profiles, tenants, and memberships.
 * @returns Repositories plus a spy capturing reconciliation audit events.
 */
function fake_repositories(fixtures: {
  profiles?: FixtureProfile[];
  tenants?: FixtureTenant[];
  memberships?: FixtureMembership[];
}) {
  const reconciliation_events: unknown[] = [];
  const repositories: IdentityProjectionRepositories = {
    user_profiles: {
      find_active_by_clerk_user_id: async (clerk_user_id) =>
        (fixtures.profiles?.find(
          (p) => p.clerkUserId === clerk_user_id && p.status === "active",
        ) ?? null) as any,
    },
    tenants: {
      find_active_by_clerk_organization_id: async (org_id) =>
        (fixtures.tenants?.find(
          (t) => t.clerkOrganizationId === org_id && t.status === "active",
        ) ?? null) as any,
    },
    memberships: {
      find_active_membership: async (tenant_id, profile_id) =>
        (fixtures.memberships?.find(
          (m) =>
            m.tenantId === tenant_id &&
            m.userProfileId === profile_id &&
            m.status === "active",
        ) ?? null) as any,
    },
    audit: {
      record_role_reconciliation: vi.fn(async (event) => {
        reconciliation_events.push(event);
      }),
    },
  };
  return { repositories, reconciliation_events };
}

const active_profile: FixtureProfile = {
  _id: "507f1f77bcf86cd799439021",
  clerkUserId: "user_1",
  primaryEmail: "u@x.ac.th",
  displayName: "U",
  platformRole: null,
  status: "active",
};

const platform_admin_profile: FixtureProfile = {
  ...active_profile,
  _id: "507f1f77bcf86cd799439022",
  clerkUserId: "user_admin",
  platformRole: "admin",
};

const active_tenant: FixtureTenant = {
  _id: "507f1f77bcf86cd799439031",
  clerkOrganizationId: "org_1",
  status: "active",
  slug: "chula",
};

const manager_membership: FixtureMembership = {
  tenantId: active_tenant._id,
  userProfileId: active_profile._id,
  tenantRole: "manager",
  status: "active",
};

/**
 * Resolve and capture the AuthorizationError for a rejection scenario.
 *
 * @param auth_state - Clerk auth state under test.
 * @param repositories - Projection repositories fixture.
 * @returns The thrown AuthorizationError.
 */
async function expect_rejection(
  auth_state: ClerkAuthState,
  repositories: IdentityProjectionRepositories,
): Promise<AuthorizationError> {
  try {
    await resolve_clerk_principal(auth_state, repositories);
  } catch (error) {
    expect(error).toBeInstanceOf(AuthorizationError);
    return error as AuthorizationError;
  }
  throw new Error("expected resolve_clerk_principal to reject");
}

describe("map_clerk_org_role", () => {
  it("maps custom and compatibility Clerk roles to internal tenant roles", () => {
    expect(map_clerk_org_role("org:manager")).toBe("manager");
    expect(map_clerk_org_role("org:admin")).toBe("manager");
    expect(map_clerk_org_role("org:user")).toBe("user");
    expect(map_clerk_org_role("org:member")).toBe("user");
    expect(map_clerk_org_role("org:something")).toBeNull();
  });
});

describe("resolve_clerk_principal", () => {
  it("rejects a missing Clerk user", async () => {
    const { repositories } = fake_repositories({});
    const error = await expect_rejection(
      { userId: null, orgId: null, orgRole: null, sessionId: null },
      repositories,
    );
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an inactive profile", async () => {
    const { repositories } = fake_repositories({
      profiles: [{ ...active_profile, status: "suspended" }],
    });
    const error = await expect_rejection(
      { userId: "user_1", orgId: null, orgRole: null, sessionId: "sess_1" },
      repositories,
    );
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("returns a platform-only principal without an active organization", async () => {
    const { repositories } = fake_repositories({
      profiles: [platform_admin_profile],
    });
    const principal = await resolve_clerk_principal(
      { userId: "user_admin", orgId: null, orgRole: null, sessionId: "sess_1" },
      repositories,
    );
    expect(principal.platform_role).toBe("admin");
    expect(principal.active_tenant_id).toBeNull();
    expect(principal.tenant_role).toBeNull();
    expect(principal.membership_status).toBeNull();
    expect(principal.permissions).toContain("platform:tenants:create");
    expect(principal.permissions).not.toContain("formula:confirm");
  });

  it("does not treat a platform admin as a tenant member", async () => {
    const { repositories } = fake_repositories({
      profiles: [platform_admin_profile],
      tenants: [active_tenant],
      memberships: [],
    });
    // Platform admin with an orgId but no membership projection: the tenant
    // request must never fabricate membership from the platform role.
    const error = await expect_rejection(
      {
        userId: "user_admin",
        orgId: "org_1",
        orgRole: "org:admin",
        sessionId: "sess_1",
      },
      repositories,
    );
    expect(error.code).toBe("MEMBERSHIP_INACTIVE");
  });

  it("rejects an organization without an internal tenant projection", async () => {
    const { repositories } = fake_repositories({
      profiles: [active_profile],
      tenants: [],
    });
    const error = await expect_rejection(
      { userId: "user_1", orgId: "org_unknown", orgRole: "org:user", sessionId: "s" },
      repositories,
    );
    expect(error.code).toBe("FORBIDDEN");
  });

  it("rejects a suspended tenant", async () => {
    const { repositories } = fake_repositories({
      profiles: [active_profile],
      tenants: [{ ...active_tenant, status: "suspended" }],
      memberships: [manager_membership],
    });
    const error = await expect_rejection(
      { userId: "user_1", orgId: "org_1", orgRole: "org:manager", sessionId: "s" },
      repositories,
    );
    expect(error.code).toBe("FORBIDDEN");
  });

  it("rejects a stale or missing membership", async () => {
    const { repositories } = fake_repositories({
      profiles: [active_profile],
      tenants: [active_tenant],
      memberships: [{ ...manager_membership, status: "revoked" }],
    });
    const error = await expect_rejection(
      { userId: "user_1", orgId: "org_1", orgRole: "org:manager", sessionId: "s" },
      repositories,
    );
    expect(error.code).toBe("MEMBERSHIP_INACTIVE");
  });

  it("rejects a Clerk/internal role mismatch and records reconciliation", async () => {
    const { repositories, reconciliation_events } = fake_repositories({
      profiles: [active_profile],
      tenants: [active_tenant],
      memberships: [{ ...manager_membership, tenantRole: "user" }],
    });
    const error = await expect_rejection(
      { userId: "user_1", orgId: "org_1", orgRole: "org:manager", sessionId: "s" },
      repositories,
    );
    expect(error.code).toBe("FORBIDDEN");
    expect(reconciliation_events).toHaveLength(1);
    expect(reconciliation_events[0]).toMatchObject({
      clerk_user_id: "user_1",
      clerk_org_id: "org_1",
    });
  });

  it("resolves a tenant manager with database-authoritative role", async () => {
    const { repositories } = fake_repositories({
      profiles: [active_profile],
      tenants: [active_tenant],
      memberships: [manager_membership],
    });
    const principal = await resolve_clerk_principal(
      { userId: "user_1", orgId: "org_1", orgRole: "org:manager", sessionId: "s" },
      repositories,
    );
    expect(principal).toMatchObject({
      auth_provider: "clerk",
      provider_user_id: "user_1",
      internal_user_id: active_profile._id,
      active_tenant_id: active_tenant._id,
      platform_role: null,
      tenant_role: "manager",
      membership_status: "active",
    });
    expect(principal.permissions).toContain("formula:confirm");
    expect(principal.permissions).toContain("tenant:members:invite_user");
    expect(principal.permissions).not.toContain("platform:tenants:create");
  });

  it("resolves a tenant user without manager permissions", async () => {
    const { repositories } = fake_repositories({
      profiles: [active_profile],
      tenants: [active_tenant],
      memberships: [{ ...manager_membership, tenantRole: "user" }],
    });
    const principal = await resolve_clerk_principal(
      { userId: "user_1", orgId: "org_1", orgRole: "org:user", sessionId: "s" },
      repositories,
    );
    expect(principal.tenant_role).toBe("user");
    expect(principal.permissions).toContain("formula:draft:create");
    expect(principal.permissions).toContain("ai:run");
    expect(principal.permissions).not.toContain("formula:confirm");
    expect(principal.permissions).not.toContain("tenant:members:invite_user");
  });
});
