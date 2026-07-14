// ============================================
// PROVIDER-NEUTRAL AUTHORIZATION CONTRACTS (G0.4)
// ============================================
// These contracts outlive the legacy session adapter: G1 swaps the resolver
// implementation for Clerk without changing any consumer of RequestPrincipal.

/**
 * Platform-scope roles. Granted only by super administrators and never
 * derived from any tenant role.
 */
export type PlatformRole = "super_admin" | "admin";

/**
 * University (tenant) roles. Never converted into a platform role.
 */
export type TenantRole = "manager" | "user";

/**
 * Named permissions asserted at every resource boundary.
 */
export type Permission =
  | "tenant:read"
  | "tenant:members:invite"
  | "tenant:settings:write"
  | "formula:draft"
  | "formula:confirm"
  | "ai:run"
  | "platform:tenants:create"
  | "platform:roles:grant";

/**
 * Verified request identity resolved from server state only. No field of this
 * contract may originate from a request body, query string, localStorage, or
 * an unsigned cookie value.
 */
export interface RequestPrincipal {
  auth_provider: "legacy" | "clerk";
  provider_user_id: string;
  internal_user_id: string;
  active_tenant_id: string | null;
  platform_role: PlatformRole | null;
  tenant_role: TenantRole | null;
  permissions: readonly Permission[];
  membership_status: "active" | "suspended" | null;
}

/**
 * Permission catalogue granted per tenant role. Tenant roles never receive
 * platform permissions; only managers may confirm formulas.
 */
export const TENANT_ROLE_PERMISSIONS: Readonly<
  Record<TenantRole, readonly Permission[]>
> = {
  manager: [
    "tenant:read",
    "tenant:members:invite",
    "tenant:settings:write",
    "formula:draft",
    "formula:confirm",
    "ai:run",
  ],
  user: ["tenant:read", "formula:draft", "ai:run"],
};

/**
 * Permission catalogue granted per platform role. Platform roles carry no
 * implicit tenant membership; tenant permissions require a real membership.
 */
export const PLATFORM_ROLE_PERMISSIONS: Readonly<
  Record<PlatformRole, readonly Permission[]>
> = {
  super_admin: ["platform:tenants:create", "platform:roles:grant"],
  admin: ["platform:tenants:create"],
};
