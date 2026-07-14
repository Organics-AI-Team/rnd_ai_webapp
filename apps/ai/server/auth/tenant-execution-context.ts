import { randomUUID } from "node:crypto";
import type { RequestPrincipal } from "@rnd-ai/shared-types";
import type {
  SupportAccessGrantView,
  TenantExecutionContext,
} from "@rnd-ai/shared-types";

/** Stable tenant-context failure codes. */
export type TenantContextErrorCode =
  | "TENANT_MEMBERSHIP_REQUIRED"
  | "SUPPORT_GRANT_INVALID"
  | "TENANT_MISMATCH";

/** Typed tenant-context failure. */
export class TenantContextError extends Error {
  readonly code: TenantContextErrorCode;

  /**
   * Create a typed tenant-context failure.
   *
   * @param code - Stable failure code.
   * @param message - Safe description.
   */
  constructor(code: TenantContextErrorCode, message: string) {
    super(message);
    this.name = "TenantContextError";
    this.code = code;
  }
}

/** Optional builder inputs resolved by the caller. */
export interface TenantContextExtras {
  readonly clerk_organization_id: string;
  readonly membership_id: string | null;
  readonly requested_tenant_id?: string;
  readonly correlation_id?: string;
  readonly now?: Date;
}

/**
 * Build the immutable per-request tenant execution context.
 *
 * Member mode requires an active tenant membership on the principal.
 * Support mode requires a non-expired, non-revoked grant approved by a
 * DIFFERENT profile; the context then carries only the grant's diagnostic
 * permissions. The result is frozen so tenant_id cannot be swapped
 * mid-request.
 *
 * @param principal - Verified request principal.
 * @param support_grant - Approved support grant, or null for member mode.
 * @param extras - Caller-resolved Clerk organization/membership identifiers.
 * @returns Frozen TenantExecutionContext.
 * @throws TenantContextError with a stable code for every rejection.
 */
export function build_tenant_execution_context(
  principal: RequestPrincipal,
  support_grant: SupportAccessGrantView | null,
  extras: TenantContextExtras,
): TenantExecutionContext {
  const now = extras.now ?? new Date();

  if (support_grant) {
    const valid =
      support_grant.platform_profile_id === principal.internal_user_id &&
      support_grant.approved_by_profile_id !== null &&
      support_grant.approved_by_profile_id !== principal.internal_user_id &&
      support_grant.approved_at !== null &&
      support_grant.revoked_at === null &&
      support_grant.expires_at !== null &&
      support_grant.expires_at.getTime() > now.getTime();
    if (!valid) {
      throw new TenantContextError(
        "SUPPORT_GRANT_INVALID",
        "The support grant is expired, revoked, self-approved, or not yours.",
      );
    }
    if (
      extras.requested_tenant_id &&
      extras.requested_tenant_id !== support_grant.tenant_id
    ) {
      throw new TenantContextError(
        "TENANT_MISMATCH",
        "The requested tenant does not match the support grant.",
      );
    }
    return Object.freeze({
      tenant_id: support_grant.tenant_id,
      actor_profile_id: principal.internal_user_id,
      clerk_user_id: principal.provider_user_id,
      clerk_organization_id: extras.clerk_organization_id,
      membership_id: null,
      tenant_role: null,
      permissions: Object.freeze([...support_grant.permissions]),
      access_mode: "support" as const,
      support_grant_id: support_grant.id,
      correlation_id: extras.correlation_id ?? randomUUID(),
      request_started_at: now.toISOString(),
    });
  }

  if (
    principal.active_tenant_id === null ||
    principal.membership_status !== "active"
  ) {
    throw new TenantContextError(
      "TENANT_MEMBERSHIP_REQUIRED",
      "An active tenant membership (or an approved support grant) is required.",
    );
  }
  if (
    extras.requested_tenant_id &&
    extras.requested_tenant_id !== principal.active_tenant_id
  ) {
    throw new TenantContextError(
      "TENANT_MISMATCH",
      "The requested tenant does not match the verified membership.",
    );
  }

  return Object.freeze({
    tenant_id: principal.active_tenant_id,
    actor_profile_id: principal.internal_user_id,
    clerk_user_id: principal.provider_user_id,
    clerk_organization_id: extras.clerk_organization_id,
    membership_id: extras.membership_id,
    tenant_role: principal.tenant_role,
    permissions: Object.freeze([...principal.permissions]),
    access_mode: "member" as const,
    support_grant_id: null,
    correlation_id: extras.correlation_id ?? randomUUID(),
    request_started_at: now.toISOString(),
  });
}
