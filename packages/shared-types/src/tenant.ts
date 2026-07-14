// ============================================
// TENANT EXECUTION & OWNERSHIP CONTRACTS (G2.1)
// ============================================

import type { Permission, TenantRole } from "./auth";

/**
 * Immutable per-request tenant scope that repositories require. Built only
 * by build_tenant_execution_context from a verified principal (member mode)
 * or an approved support grant (support mode); frozen so code can never swap
 * tenant_id mid-request.
 */
export interface TenantExecutionContext {
  readonly tenant_id: string;
  readonly actor_profile_id: string;
  readonly clerk_user_id: string;
  readonly clerk_organization_id: string;
  readonly membership_id: string | null;
  readonly tenant_role: TenantRole | null;
  readonly permissions: readonly Permission[];
  readonly access_mode: "member" | "support";
  readonly support_grant_id: string | null;
  readonly correlation_id: string;
  readonly request_started_at: string;
}

/**
 * Approved, time-boxed diagnostic access to one tenant for one platform
 * profile. Grants only the named diagnostic permissions — never a blanket
 * manager role — and must be approved by a different super administrator.
 */
export interface SupportAccessGrantView {
  readonly id: string;
  readonly tenant_id: string;
  readonly platform_profile_id: string;
  readonly permissions: readonly Permission[];
  readonly approved_by_profile_id: string | null;
  readonly approved_at: Date | null;
  readonly expires_at: Date | null;
  readonly revoked_at: Date | null;
  readonly correlation_id: string;
}

/**
 * Diagnostic permissions a support grant may carry. Content-mutating
 * permissions are deliberately excluded.
 */
export const SUPPORT_DIAGNOSTIC_PERMISSIONS: readonly Permission[] = [
  "tenant:ai:read",
  "tenant:members:read",
  "tenant:knowledge:read",
  "tenant:analytics:read",
  "tenant:read",
];

/** Maximum support-grant duration in hours (platform ceiling). */
export const SUPPORT_GRANT_MAX_DURATION_HOURS = 72;
