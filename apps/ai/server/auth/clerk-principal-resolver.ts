import type { Document, WithId } from "mongodb";
import type { RequestPrincipal, TenantRole } from "@rnd-ai/shared-types";
import {
  PLATFORM_ROLE_PERMISSIONS,
  TENANT_ROLE_PERMISSIONS,
} from "@rnd-ai/shared-types";

import { AuthorizationError } from "./errors";

/**
 * Server-verified Clerk session values consumed by the resolver. These come
 * from await auth() — never from request bodies or query strings.
 */
export interface ClerkAuthState {
  readonly userId: string | null;
  readonly orgId: string | null;
  readonly orgRole?: string | null;
  readonly sessionId?: string | null;
}

/**
 * Reconciliation event recorded when the Clerk session role disagrees with
 * the internal membership projection.
 */
export interface RoleReconciliationEvent {
  readonly clerk_user_id: string;
  readonly clerk_org_id: string;
  readonly clerk_org_role: string | null;
  readonly internal_tenant_role: TenantRole;
  readonly occurred_at: Date;
}

/**
 * Narrow projection-repository ports the resolver depends on. Implemented by
 * the G1.2 repositories in production and by in-memory fakes in tests.
 */
export interface IdentityProjectionRepositories {
  readonly user_profiles: {
    find_active_by_clerk_user_id(
      clerk_user_id: string,
    ): Promise<WithId<Document> | null>;
  };
  readonly tenants: {
    find_active_by_clerk_organization_id(
      clerk_organization_id: string,
    ): Promise<WithId<Document> | null>;
  };
  readonly memberships: {
    find_active_membership(
      tenant_id: string,
      user_profile_id: string,
    ): Promise<WithId<Document> | null>;
  };
  readonly audit: {
    record_role_reconciliation(event: RoleReconciliationEvent): Promise<void>;
  };
}

/**
 * Map a Clerk organization role onto the internal tenant role dimension.
 * Supports the preferred custom roles (org:manager/org:user) and the
 * compatibility mapping (org:admin/org:member). Clerk's label is never a
 * business authorization decision by itself — the internal membership
 * projection remains authoritative.
 *
 * @param clerk_org_role - Raw Clerk role string from the session.
 * @returns Internal tenant role, or null for unknown roles.
 */
export function map_clerk_org_role(
  clerk_org_role: string | null | undefined,
): TenantRole | null {
  switch (clerk_org_role) {
    case "org:manager":
    case "org:admin":
      return "manager";
    case "org:user":
    case "org:member":
      return "user";
    default:
      return null;
  }
}

/**
 * Resolve a verified Clerk session into a database-authoritative
 * RequestPrincipal.
 *
 * Platform-only requests (no active organization) read platformRole from the
 * UserProfile record — never from session claims — and carry no tenant
 * context; a tenant request never fabricates membership from a platform
 * role. Tenant requests require an active tenant projection and an active
 * membership whose internal role agrees with the mapped Clerk role; any
 * mismatch is rejected and recorded for reconciliation.
 *
 * @param auth_state - Server-verified Clerk session values.
 * @param repositories - Identity projection repository ports.
 * @returns Database-authoritative principal.
 * @throws AuthorizationError with stable codes for every rejection case.
 */
export async function resolve_clerk_principal(
  auth_state: ClerkAuthState,
  repositories: IdentityProjectionRepositories,
): Promise<RequestPrincipal> {
  if (!auth_state.userId) {
    throw new AuthorizationError("UNAUTHENTICATED", "Authentication is required.");
  }

  const profile = await repositories.user_profiles.find_active_by_clerk_user_id(
    auth_state.userId,
  );
  if (!profile) {
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "No active user profile exists for this session.",
    );
  }

  const platform_role =
    profile.platformRole === "super_admin" || profile.platformRole === "admin"
      ? profile.platformRole
      : null;

  if (!auth_state.orgId) {
    return {
      auth_provider: "clerk",
      provider_user_id: auth_state.userId,
      internal_user_id: profile._id.toString(),
      active_tenant_id: null,
      platform_role,
      tenant_role: null,
      permissions: platform_role ? PLATFORM_ROLE_PERMISSIONS[platform_role] : [],
      membership_status: null,
    };
  }

  const tenant = await repositories.tenants.find_active_by_clerk_organization_id(
    auth_state.orgId,
  );
  if (!tenant) {
    throw new AuthorizationError(
      "FORBIDDEN",
      "The organization is not an active tenant.",
    );
  }

  const membership = await repositories.memberships.find_active_membership(
    tenant._id.toString(),
    profile._id.toString(),
  );
  if (!membership) {
    throw new AuthorizationError(
      "MEMBERSHIP_INACTIVE",
      "No active membership exists for this tenant.",
    );
  }

  const internal_role: TenantRole =
    membership.tenantRole === "manager" ? "manager" : "user";
  const clerk_role = map_clerk_org_role(auth_state.orgRole);
  if (clerk_role !== internal_role) {
    await repositories.audit.record_role_reconciliation({
      clerk_user_id: auth_state.userId,
      clerk_org_id: auth_state.orgId,
      clerk_org_role: auth_state.orgRole ?? null,
      internal_tenant_role: internal_role,
      occurred_at: new Date(),
    });
    throw new AuthorizationError(
      "FORBIDDEN",
      "Session role does not match the membership projection; reconciliation is pending.",
    );
  }

  return {
    auth_provider: "clerk",
    provider_user_id: auth_state.userId,
    internal_user_id: profile._id.toString(),
    active_tenant_id: tenant._id.toString(),
    platform_role,
    tenant_role: internal_role,
    permissions: TENANT_ROLE_PERMISSIONS[internal_role],
    membership_status: "active",
  };
}
