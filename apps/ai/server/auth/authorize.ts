import type { Permission, RequestPrincipal } from "@rnd-ai/shared-types";

import { AuthorizationError } from "./errors";

/**
 * Assert that a verified principal is present and holds a named permission.
 *
 * @param principal - Verified principal, or null/undefined when unauthenticated.
 * @param permission - Named permission the operation requires.
 * @throws AuthorizationError UNAUTHENTICATED when no principal is present.
 * @throws AuthorizationError FORBIDDEN when the permission is not granted.
 */
export function require_permission(
  principal: RequestPrincipal | null | undefined,
  permission: Permission,
): void {
  if (!principal) {
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "Authentication is required.",
    );
  }
  if (!principal.permissions.includes(permission)) {
    throw new AuthorizationError(
      "FORBIDDEN",
      `Missing required permission: ${permission}.`,
    );
  }
}

/**
 * Assert that a verified principal carries an active tenant membership.
 * Platform-only principals are rejected rather than fabricating membership.
 *
 * @param principal - Verified principal, or null/undefined when unauthenticated.
 * @throws AuthorizationError UNAUTHENTICATED when no principal is present.
 * @throws AuthorizationError FORBIDDEN when no tenant context exists.
 * @throws AuthorizationError MEMBERSHIP_INACTIVE when membership is not active.
 */
export function require_active_tenant(
  principal: RequestPrincipal | null | undefined,
): void {
  if (!principal) {
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "Authentication is required.",
    );
  }
  if (principal.active_tenant_id === null || principal.tenant_role === null) {
    throw new AuthorizationError(
      "FORBIDDEN",
      "An active tenant context is required.",
    );
  }
  if (principal.membership_status !== "active") {
    throw new AuthorizationError(
      "MEMBERSHIP_INACTIVE",
      "Tenant membership is not active.",
    );
  }
}
