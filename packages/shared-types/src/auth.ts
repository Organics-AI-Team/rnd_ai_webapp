// ============================================
// PROVIDER-NEUTRAL AUTHORIZATION CONTRACTS (G0.4, expanded G1.3)
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
 * Named permissions asserted at every resource boundary. Colon-separated
 * TypeScript literals map one-to-one to the dotted policy names in the
 * design specification (section 6.2), e.g. "platform:tenants:create" is
 * policy name "platform.tenants.create".
 *
 * The G0 transitional names remain until the G2.5 router conversion moves
 * every business procedure onto the fine-grained catalogue.
 */
export type Permission =
  // Platform catalogue (design §6.2)
  | "platform:admins:manage"
  | "platform:tenants:create"
  | "platform:tenants:read"
  | "platform:tenants:update"
  | "platform:tenants:suspend"
  | "platform:plans:assign"
  | "platform:ai:defaults:manage"
  | "platform:ai:emergency_disable"
  | "platform:audit:read"
  | "platform:support_access:request"
  // University catalogue (design §6.2)
  | "tenant:members:read"
  | "tenant:members:invite_user"
  | "tenant:members:suspend_user"
  | "tenant:members:remove_user"
  | "tenant:ai:read"
  | "tenant:ai:configure"
  | "tenant:knowledge:read"
  | "tenant:knowledge:manage"
  | "tenant:analytics:read"
  | "ai:run"
  | "ai:feedback:create"
  | "formula:read"
  | "formula:draft:create"
  | "formula:draft:update_own"
  | "formula:review:request"
  | "formula:comment:create"
  | "formula:confirm"
  // G0 transitional coarse names (removed by G2.5)
  | "tenant:read"
  | "tenant:members:invite"
  | "tenant:settings:write"
  | "formula:draft"
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

const tenant_user_permissions: readonly Permission[] = [
  "tenant:knowledge:read",
  "tenant:analytics:read",
  "ai:run",
  "ai:feedback:create",
  "formula:read",
  "formula:draft:create",
  "formula:draft:update_own",
  "formula:review:request",
  "formula:comment:create",
  // G0 transitional
  "tenant:read",
  "formula:draft",
];

const tenant_manager_permissions: readonly Permission[] = [
  ...tenant_user_permissions,
  "tenant:members:read",
  "tenant:members:invite_user",
  "tenant:members:suspend_user",
  "tenant:members:remove_user",
  "tenant:ai:read",
  "tenant:ai:configure",
  "tenant:knowledge:manage",
  "formula:confirm",
  // G0 transitional
  "tenant:members:invite",
  "tenant:settings:write",
];

/**
 * Permission catalogue granted per tenant role. Tenant roles never receive
 * platform permissions; only managers may confirm formulas.
 */
export const TENANT_ROLE_PERMISSIONS: Readonly<
  Record<TenantRole, readonly Permission[]>
> = {
  manager: tenant_manager_permissions,
  user: tenant_user_permissions,
};

const platform_admin_permissions: readonly Permission[] = [
  "platform:tenants:create",
  "platform:tenants:read",
  "platform:tenants:update",
  "platform:tenants:suspend",
  "platform:plans:assign",
  "platform:ai:defaults:manage",
  "platform:ai:emergency_disable",
  "platform:audit:read",
  "platform:support_access:request",
];

/**
 * Permission catalogue granted per platform role. Platform roles carry no
 * implicit tenant membership; tenant permissions require a real membership.
 * Only super administrators manage platform roles.
 */
export const PLATFORM_ROLE_PERMISSIONS: Readonly<
  Record<PlatformRole, readonly Permission[]>
> = {
  super_admin: [
    ...platform_admin_permissions,
    "platform:admins:manage",
    // G0 transitional
    "platform:roles:grant",
  ],
  admin: platform_admin_permissions,
};
