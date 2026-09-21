import type { RequestPrincipal, TenantRole } from "@rnd-ai/shared-types";
import { TENANT_ROLE_PERMISSIONS } from "@rnd-ai/shared-types";

import { AuthorizationError } from "./errors";

/**
 * Legacy role values stored on the users collection.
 */
export type LegacyUserRole = "admin" | "shipper" | "shopper";

/**
 * Session record fields consumed from the sessions collection. Field names
 * mirror the Prisma Session model so a Prisma-backed store is a direct
 * delegation.
 */
export interface LegacySessionRecord {
  id: string;
  accountId: string;
  token: string;
  expiresAt: Date;
}

/**
 * Account record fields consumed from the accounts collection.
 */
export interface LegacyAccountRecord {
  id: string;
  email: string;
  isActive: boolean;
}

/**
 * User profile record fields consumed from the users collection.
 */
export interface LegacyUserRecord {
  id: string;
  accountId: string;
  organizationId: string;
  name: string;
  email: string;
  role: LegacyUserRole;
  status: "active" | "suspend";
  isActive: boolean;
}

/**
 * Organization record fields consumed from the organizations collection.
 */
export interface LegacyOrganizationRecord {
  id: string;
  isActive: boolean;
}

/**
 * Read-only identity lookups required to resolve a legacy principal. The
 * production adapter delegates to Prisma; tests inject in-memory fakes.
 */
export interface LegacyIdentityStore {
  find_session_by_token(token: string): Promise<LegacySessionRecord | null>;
  find_account_by_id(account_id: string): Promise<LegacyAccountRecord | null>;
  find_user_by_account_id(account_id: string): Promise<LegacyUserRecord | null>;
  find_organization_by_id(
    organization_id: string,
  ): Promise<LegacyOrganizationRecord | null>;
}

/**
 * Map a legacy user role onto the tenant role dimension. Legacy roles can
 * never produce a platform role: legacy "admin" is a university manager,
 * and both "shipper" and "shopper" are university users.
 *
 * @param role - Legacy role value from the users collection.
 * @returns The equivalent tenant role.
 */
export function map_legacy_role_to_tenant_role(role: LegacyUserRole): TenantRole {
  return role === "admin" ? "manager" : "user";
}

/**
 * Resolve a verified legacy session token into a provider-neutral
 * RequestPrincipal using one session query followed by one
 * account/user/organization lookup sequence.
 *
 * Rejections: missing/unknown/expired session, inactive or missing account,
 * missing user profile, and missing organization raise UNAUTHENTICATED;
 * a suspended or inactive user, or an inactive organization, raises
 * MEMBERSHIP_INACTIVE. platform_role is always null for legacy identities.
 *
 * @param token - Opaque session token presented by the caller.
 * @param db - Read-only identity lookups (Prisma adapter or test fake).
 * @param now - Clock injection for expiry checks; defaults to the current time.
 * @returns The resolved provider-neutral principal.
 * @throws AuthorizationError with a stable code for every rejection case.
 */
export async function resolve_legacy_principal(
  token: string,
  db: LegacyIdentityStore,
  now: Date = new Date(),
): Promise<RequestPrincipal> {
  if (!token || token.trim() === "") {
    throw new AuthorizationError("UNAUTHENTICATED", "Missing session token.");
  }

  const session = await db.find_session_by_token(token);
  if (!session || session.expiresAt.getTime() <= now.getTime()) {
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "Session is unknown or expired.",
    );
  }

  const account = await db.find_account_by_id(session.accountId);
  if (!account || !account.isActive) {
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "Account is unknown or inactive.",
    );
  }

  const user = await db.find_user_by_account_id(account.id);
  if (!user) {
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "No user profile exists for this account.",
    );
  }
  if (user.status !== "active" || !user.isActive) {
    throw new AuthorizationError(
      "MEMBERSHIP_INACTIVE",
      "User membership is suspended.",
    );
  }

  const organization = await db.find_organization_by_id(user.organizationId);
  if (!organization) {
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "No organization exists for this membership.",
    );
  }
  if (!organization.isActive) {
    throw new AuthorizationError(
      "MEMBERSHIP_INACTIVE",
      "Organization is inactive.",
    );
  }

  const tenant_role = map_legacy_role_to_tenant_role(user.role);
  return {
    auth_provider: "legacy",
    provider_user_id: account.id,
    internal_user_id: user.id,
    active_tenant_id: organization.id,
    platform_role: null,
    tenant_role,
    permissions: TENANT_ROLE_PERMISSIONS[tenant_role],
    membership_status: "active",
  };
}
