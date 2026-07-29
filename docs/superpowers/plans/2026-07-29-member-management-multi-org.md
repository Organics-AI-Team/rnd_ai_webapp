# Member Management, Invitations & Multi-Org Membership (Plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the tenant member lifecycle (invite/resend/revoke invitations; suspend/reactivate/remove members), give platform admins a tenant detail page with appoint/demote manager, and lift the single-membership rule so users may belong to multiple universities — with safe remove→re-invite revive semantics, retryable webhook receipts, an org switcher whose switches clear the query cache, and onboarding states for suspended/removed/choose-org.

**Architecture:** Server work follows the existing thin-router → service → ports pattern: services own guard logic and are tested against fake ports; one new contracts file (`member-admin-ports.ts`) declares the shared `MemberAdminPorts` surface that `production-member-ports.ts` implements over MongoDB + an injectable narrow Clerk view. The webhook projection is re-keyed to `(tenantId, userProfileId)` with revive semantics (the unique `uniq_membership_tenant_profile` index stays), and the receipt lifecycle becomes claim → apply → complete with failed applies marked retryable (5xx so svix retries). App-initiated manager mutations enforce the last-manager invariant inside a Mongo transaction (ai-rollout `in_transaction` pattern, plus a tenant-document touch to force write conflicts instead of snapshot write-skew); Clerk calls run after commit with revert-on-failure. The frontend gates every Clerk component on the publishable-key check (`app-auth.tsx:38` pattern) because the sidebar and layout also render in legacy mode.

**Tech Stack:** TypeScript, tRPC v11, zod, `@clerk/backend` 3.11.5 (`updateOrganizationMembership` / `deleteOrganizationMembership` keyed by `(organizationId, userId)`; `revokeOrganizationInvitation` by `(organizationId, invitationId)`), `@clerk/nextjs` 7.5.18 (`<OrganizationSwitcher/>`), MongoDB driver 6.21 (transactions), `vitest` + `MongoMemoryReplSet` (plain `MongoMemoryServer` cannot run transactions), Next.js App Router, React Query v5 (`QueryCache`/`MutationCache` onError).

**Spec:** `docs/superpowers/specs/2026-07-29-member-management-multi-org-design.md` — adversarially reviewed; every design decision in it is binding.

**Load-bearing rules (from the spec — do not re-litigate while implementing):**
1. **Revive semantics (BLOCKING fix):** `upsert_membership` keys on `(tenantId, userProfileId)`, never inserts a second row per pair; remove→re-invite revives the revoked row under the NEW `clerkMembershipId`. The unique index is correct and stays.
2. **Receipt fault tolerance:** claim → apply → complete. A failed apply marks the receipt `failed` and returns 5xx so the svix retry reapplies; `already_processed` must treat `failed` receipts as reclaimable.
3. **Ordering for destructive mutations:** Mongo transaction first (projection write + last-manager assert where applicable), Clerk call after commit, revert projection on Clerk failure. The later Clerk webhook is then a monotonic no-op.
4. **Role strings ONLY via the `CLERK_ORG_ROLE_MODE` mapping** (`manager_clerk_role()` / new `user_clerk_role()`); never hardcode `org:*` literals in new code.
5. **Invariant scoping:** last-manager is enforced for APP-INITIATED mutations only; Clerk-originated violations are detected by the zero-manager webhook detector (`tenant_zero_managers` audit), never blocked.
6. **Multi-membership never mutates `user_profiles.status`** — informational `membership_multi_org` audit only. `AlreadyTenantMemberError` survives; `MultipleMembershipsDisabledError` dies everywhere in one task.
7. **Org-switch cache clearing:** tRPC query keys carry no org id and gcTime is 10 min — on active-org change, `queryClient.clear()` + navigate home.
8. Repo rule: read `CHANGELOG.md` before editing; Task 14 appends the rollout entry (single writer, so parallel tasks never conflict on it).

---

## File Structure

```
packages/shared-types/src/auth.ts                     # MODIFY (T1): + "tenant:members:remove_user" (union + manager set)

apps/ai/server/services/provisioning/
  member-admin-ports.ts                               # NEW (T2): MemberAdminPorts contract + typed domain errors
  production-member-ports.ts                          # MODIFY (T2 rewrite, T3/T5 trims): admin ports impl, injectable Clerk view,
                                                      #   duplicate-invite mapping, transaction runner, invariant touch
  production-ports.ts                                 # MODIFY (T2): + user_clerk_role()
  invite-tenant-user.ts                               # MODIFY (T3 guard lift, T5 invite-only): MultipleMembershipsDisabledError removed
  appoint-manager.ts                                  # MODIFY (T3): cross-tenant guard removed; AlreadyTenantMemberError stays
  apply-clerk-event.ts                                # MODIFY (T3, T12): retryable receipts, membership_multi_org, zero-manager detector
  reconcile-clerk.ts                                  # MODIFY (T3): repair insert re-keyed to (tenantId,userProfileId) revive upsert
  manage-invitations.ts                               # NEW (T4): revoke/resend + expiry display derivation
  manage-members.ts                                   # NEW (T5, T6): suspend/reactivate/remove + assert_not_last_active_manager
  demote-manager.ts                                   # NEW (T6): platform demote with transaction + revert
  list-tenant-members.ts                              # NEW (T6): shared member-list join (tenant + platform routers)

apps/ai/server/routers/
  tenant-members.ts                                   # MODIFY (T3→T4→T5→T6, sequential): full member/invitation surface
  platform-tenants.ts                                 # MODIFY (T3, T6): guard-lift cleanup; + listMembers, demoteManager
  member-admin-errors.ts                              # NEW (T4): domain error → TRPCError mapper
  auth.ts                                             # MODIFY (T7): + me (display-only principal view)

apps/web/app/api/webhooks/clerk/route.ts              # MODIFY (T3, T12): revive upsert, claim/fail/complete, detector impls
apps/web/lib/server/onboarding-state.ts               # NEW (T8): pure classify_onboarding_state
apps/web/lib/membership_error_routing.ts              # NEW (T8): MEMBERSHIP_INACTIVE → /onboarding routing
apps/web/app/onboarding/page.tsx                      # MODIFY (T8): access_suspended / membership_removed / choose_organization
apps/web/components/organization_activator.tsx        # MODIFY (T8): auto-activate only when exactly 1; explicit picker for >1
apps/web/app/providers.tsx                            # MODIFY (T8): QueryCache/MutationCache onError → membership routing
apps/web/components/conditional-layout.tsx            # MODIFY (T8, T13, sequential): mount activator + NOT_FOUND hint (Clerk-gated)
apps/web/app/settings/members/page.tsx                # MODIFY (T9): Members/Invitations tabs, full lifecycle actions
apps/web/components/org_switcher_panel.tsx            # NEW (T10): <OrganizationSwitcher/> + org-switch cache clear
apps/web/components/navigation.tsx                    # MODIFY (T10): auth.me-gated Members/Platform links, switcher mount
apps/web/app/platform/tenants/page.tsx                # MODIFY (T11): rows link to detail
apps/web/app/platform/tenants/[tenantId]/page.tsx     # NEW (T11): metadata + members + appoint + demote
apps/web/components/cross_org_not_found_hint.tsx      # NEW (T13): NOT_FOUND hint for multi-membership users

apps/ai/scripts/repair-multi-org-suspensions.ts       # NEW (T14): prod repair of rule-suspended profiles (dry-run default)
apps/ai/package.json                                  # MODIFY (T14): repair:multi-org-suspensions script

tests/auth/member-remove-permission.test.ts           # NEW (T1)
tests/integration/member-admin-ports.test.ts          # NEW (T2, MongoMemoryReplSet)
tests/provisioning/clerk-webhooks.test.ts             # REWRITE (T3), EXTEND (T12)
tests/provisioning/tenant-invitations.test.ts         # REWRITE (T3), TRIM (T5)
tests/provisioning/appoint-manager.test.ts            # REWRITE (T3)
tests/resilience/webhook-burst.test.ts                # MODIFY (T3, T12): deps surface changes
tests/provisioning/helpers/fake-member-admin-ports.ts # NEW (T4): shared fake MemberAdminPorts + principals
tests/provisioning/manage-invitations.test.ts         # NEW (T4)
tests/provisioning/manage-members.test.ts             # NEW (T5)
tests/provisioning/demote-manager.test.ts             # NEW (T6)
tests/integration/last-manager-invariant.test.ts      # NEW (T6, MongoMemoryReplSet, concurrent demote)
tests/auth/auth-me.test.ts                            # NEW (T7)
tests/web/onboarding-state.test.ts                    # NEW (T8)
tests/web/membership-error-routing.test.ts            # NEW (T8)
tests/web/onboarding-ui-wiring.test.ts                # NEW (T8)
tests/web/member-management-ui-wiring.test.ts         # NEW (T9)
tests/web/org-switch-ui-wiring.test.ts                # NEW (T10)
tests/web/platform-tenant-detail-wiring.test.ts       # NEW (T11)
tests/web/cross-org-hint-wiring.test.ts               # NEW (T13)
```

**Config convention:** no new required env vars. Optional: `CLERK_INVITATION_TTL_DAYS` (default 30 — Clerk's invitation TTL, used only for the *expired* display state since `expiresAt` is not stored). Existing `CLERK_ORG_ROLE_MODE`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_CUTOVER` semantics unchanged. No schema migration and no new indexes (`uniq_membership_tenant_profile` already exists and is load-bearing for revive).

---

## Execution phases (parallel dispatch map)

Tasks in the same phase touch **disjoint file sets** and may run in parallel. Tasks that share a file are ordered by the arrows below and MUST be sequential.

| Phase | Tasks | Prerequisites |
|---|---|---|
| A | 1, 2, 7, 8 | — |
| B | 3, 10, 13 | 3 after 2 (production-member-ports.ts); 10 after 7 (auth.me); 13 after 8 (conditional-layout.tsx) |
| C | 4, 12 | 4 after 2+3 (ports + tenant-members.ts); 12 after 3 (webhook files) |
| D | 5 | after 1 (permission), 3 (invite-tenant-user.ts), 4 (tenant-members.ts, fake helper) |
| E | 6, 9 | 6 after 5 (manage-members.ts, tenant-members.ts, platform-tenants.ts); 9 after 4+5 (page references the procedures) |
| F | 11 | after 6 (listMembers/demoteManager) |
| G | 14 | after all — operator-supervised |

Shared-file sequences: `tenant-members.ts` 3→4→5→6 · `production-member-ports.ts` 2→3→5 · `invite-tenant-user.ts` + `tenant-invitations.test.ts` 3→5 · `manage-members.ts` 5→6 · `platform-tenants.ts` 3→6 · webhook quartet (`apply-clerk-event.ts`, `route.ts`, `clerk-webhooks.test.ts`, `webhook-burst.test.ts`) 3→12 · `conditional-layout.tsx` 8→13. The helper `tests/provisioning/helpers/fake-member-admin-ports.ts` is created in 4 and read-only afterwards.

---

## Task 1: `tenant:members:remove_user` permission (shared-types)

Removal is a distinct, manager-only capability (spec §4.6). Suspend and reactivate reuse `tenant:members:suspend_user`; invitation revoke/resend reuse `tenant:members:invite_user` — this is the only new permission.

**Files:**
- Modify: `packages/shared-types/src/auth.ts`
- Test: `tests/auth/member-remove-permission.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/auth/member-remove-permission.test.ts
import { describe, expect, it } from "vitest";

import {
  TENANT_ROLE_PERMISSIONS,
  type Permission,
} from "../../packages/shared-types/src/auth";

describe("tenant:members:remove_user permission (Plan 3)", () => {
  it("exists in the Permission union and is granted to managers only", () => {
    // The annotation itself is a compile-time assertion that the literal is
    // part of the Permission union.
    const removal: Permission = "tenant:members:remove_user";
    expect(TENANT_ROLE_PERMISSIONS.manager).toContain(removal);
    expect(TENANT_ROLE_PERMISSIONS.user).not.toContain(removal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/auth/member-remove-permission.test.ts`
Expected: FAIL — TypeScript error (`"tenant:members:remove_user"` is not assignable to `Permission`) and/or `toContain` failure.

- [ ] **Step 3: Add the permission**

In `packages/shared-types/src/auth.ts`, make exactly two edits.

Edit 1 — in the `Permission` union (university catalogue block), after `| "tenant:members:suspend_user"`:

```typescript
  | "tenant:members:suspend_user"
  | "tenant:members:remove_user"
```

Edit 2 — in `tenant_manager_permissions`, after `"tenant:members:suspend_user",`:

```typescript
  "tenant:members:suspend_user",
  "tenant:members:remove_user",
```

Do NOT add it to `tenant_user_permissions` or any platform set.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/auth/member-remove-permission.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/auth.ts tests/auth/member-remove-permission.test.ts
git commit -m "feat: add tenant:members:remove_user permission (manager-only)"
```

---

## Task 2: Member-admin contracts + production Clerk/Mongo ports

One contracts file declares the `MemberAdminPorts` surface (and every typed domain error) that Tasks 4–6 services consume; `production-member-ports.ts` implements it over MongoDB plus a **narrow, injectable** Clerk view (`MemberAdminClerkLike`) so a replica-set integration test can exercise the real Mongo code with a recording Clerk fake. Port signatures follow spec §4.4: keyed by what we store — the ports resolve `clerkOrganizationId` from `tenants` and `clerkUserId` from `user_profiles` internally, and role strings go through `CLERK_ORG_ROLE_MODE` only.

**Files:**
- Create: `apps/ai/server/services/provisioning/member-admin-ports.ts`
- Modify: `apps/ai/server/services/provisioning/production-member-ports.ts` (full rewrite — behavior of existing members preserved)
- Modify: `apps/ai/server/services/provisioning/production-ports.ts` (add `user_clerk_role` beside `manager_clerk_role`, line ~53)
- Test: `tests/integration/member-admin-ports.test.ts` (MongoMemoryReplSet — transactions need a replica set)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/member-admin-ports.test.ts
/**
 * Plan 3 Task 2 — production member-admin ports over a real replica set.
 *
 * Transactions require a replica set (plain MongoMemoryServer cannot run
 * withTransaction; see tests/integration/ai-rollout.test.ts for the
 * pattern). The Clerk backend is a narrow injected recording fake, so no
 * CLERK_SECRET_KEY is needed.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  create_production_member_admin_ports,
  type MemberAdminClerkLike,
} from "../../apps/ai/server/services/provisioning/production-member-ports";
import { DuplicatePendingInvitationError } from "../../apps/ai/server/services/provisioning/member-admin-ports";

let repl: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;

const TENANT = new ObjectId("507f1f77bcf86cd799439031");
const PROFILE = new ObjectId("507f1f77bcf86cd799439001");

/**
 * Build a recording narrow Clerk fake.
 *
 * @param overrides - Optional error injections per method.
 * @returns Fake clerk view plus the recorded call list.
 */
function recording_clerk(
  overrides: {
    revoke_error?: Error & { status?: number };
    invitation_error?: Error & { errors?: Array<{ code: string }> };
  } = {},
) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const clerk: MemberAdminClerkLike = {
    organizations: {
      async createOrganizationInvitation(params) {
        calls.push({ method: "createOrganizationInvitation", params });
        if (overrides.invitation_error) throw overrides.invitation_error;
        return { id: "inv_created", emailAddress: params.emailAddress, role: params.role };
      },
      async getOrganizationInvitationList() {
        return { data: [] };
      },
      async revokeOrganizationInvitation(params) {
        calls.push({ method: "revokeOrganizationInvitation", params });
        if (overrides.revoke_error) throw overrides.revoke_error;
        return {};
      },
      async updateOrganizationMembership(params) {
        calls.push({ method: "updateOrganizationMembership", params });
        return {};
      },
      async deleteOrganizationMembership(params) {
        calls.push({ method: "deleteOrganizationMembership", params });
        return {};
      },
    },
  };
  return { clerk, calls };
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(repl.getUri());
  await client.connect();
  db = client.db("test_member_admin_ports");
}, 60_000);

afterAll(async () => {
  await client.close();
  await repl.stop();
});

beforeEach(async () => {
  delete process.env.CLERK_ORG_ROLE_MODE;
  await Promise.all([
    db.collection("tenants").deleteMany({}),
    db.collection("user_profiles").deleteMany({}),
    db.collection("tenant_membership_projections").deleteMany({}),
    db.collection("tenant_invitation_projections").deleteMany({}),
    db.collection("platform_audit_events").deleteMany({}),
  ]);
  await db.collection("tenants").insertOne({
    _id: TENANT,
    clerkOrganizationId: "org_test",
    status: "active",
  });
  await db.collection("user_profiles").insertOne({
    _id: PROFILE,
    clerkUserId: "user_test",
    primaryEmail: "member@x.ac.th",
    status: "active",
  });
  await db.collection("tenant_membership_projections").insertOne({
    clerkMembershipId: "orgmem_1",
    tenantId: TENANT.toHexString(),
    userProfileId: PROFILE.toHexString(),
    tenantRole: "manager",
    status: "active",
    clerkSyncedAt: new Date(0),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe("clerk member-admin calls", () => {
  it("removes a membership by resolved organization and user ids", async () => {
    const world = recording_clerk();
    const ports = create_production_member_admin_ports(db, world.clerk);
    await ports.clerk.remove_membership(TENANT.toHexString(), PROFILE.toHexString());
    expect(world.calls).toEqual([
      {
        method: "deleteOrganizationMembership",
        params: { organizationId: "org_test", userId: "user_test" },
      },
    ]);
  });

  it("maps internal roles through CLERK_ORG_ROLE_MODE on role updates", async () => {
    const world = recording_clerk();
    const ports = create_production_member_admin_ports(db, world.clerk);
    await ports.clerk.update_membership_role(TENANT.toHexString(), PROFILE.toHexString(), "user");
    process.env.CLERK_ORG_ROLE_MODE = "built_in";
    await ports.clerk.update_membership_role(TENANT.toHexString(), PROFILE.toHexString(), "manager");
    expect(world.calls[0]!.params.role).toBe("org:user");
    expect(world.calls[1]!.params.role).toBe("org:admin");
  });

  it("revokes an invitation against the tenant's organization and tolerates 4xx", async () => {
    const tolerated = Object.assign(new Error("already revoked"), { status: 400 });
    const world = recording_clerk({ revoke_error: tolerated });
    const ports = create_production_member_admin_ports(db, world.clerk);
    await expect(
      ports.clerk.revoke_invitation(TENANT.toHexString(), "inv_1"),
    ).resolves.toBeUndefined();
    expect(world.calls[0]).toEqual({
      method: "revokeOrganizationInvitation",
      params: { organizationId: "org_test", invitationId: "inv_1" },
    });
  });

  it("translates Clerk duplicate-pending rejections into the typed CONFLICT error", async () => {
    const duplicate = Object.assign(new Error("duplicate"), {
      errors: [{ code: "duplicate_record" }],
    });
    const world = recording_clerk({ invitation_error: duplicate });
    const ports = create_production_member_admin_ports(db, world.clerk);
    await expect(
      ports.clerk.create_user_invitation("org_test", "member@x.ac.th"),
    ).rejects.toBeInstanceOf(DuplicatePendingInvitationError);
  });
});

describe("membership projections", () => {
  it("finds, updates status/role, and counts active managers", async () => {
    const ports = create_production_member_admin_ports(db, recording_clerk().clerk);
    const found = await ports.memberships.find_membership(
      TENANT.toHexString(),
      PROFILE.toHexString(),
    );
    expect(found).toEqual({ tenant_role: "manager", status: "active" });
    expect(await ports.memberships.count_active_managers(TENANT.toHexString())).toBe(1);
    await ports.memberships.set_membership_status(
      TENANT.toHexString(),
      PROFILE.toHexString(),
      "suspended",
    );
    expect(await ports.memberships.count_active_managers(TENANT.toHexString())).toBe(0);
    await ports.memberships.set_membership_role(
      TENANT.toHexString(),
      PROFILE.toHexString(),
      "user",
    );
    expect(
      await ports.memberships.find_membership(TENANT.toHexString(), PROFILE.toHexString()),
    ).toEqual({ tenant_role: "user", status: "suspended" });
  });

  it("rolls a transactional write back when the operation throws", async () => {
    const ports = create_production_member_admin_ports(db, recording_clerk().clerk);
    await expect(
      ports.transactions.run(async (session) => {
        await ports.memberships.set_membership_status(
          TENANT.toHexString(),
          PROFILE.toHexString(),
          "revoked",
          session,
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const membership = await ports.memberships.find_membership(
      TENANT.toHexString(),
      PROFILE.toHexString(),
    );
    expect(membership?.status).toBe("active");
  });
});

describe("invitation projections", () => {
  it("finds by clerk id within the tenant and marks status", async () => {
    await db.collection("tenant_invitation_projections").insertOne({
      clerkInvitationId: "inv_9",
      tenantId: TENANT.toHexString(),
      emailNormalized: "pending@x.ac.th",
      tenantRole: "user",
      status: "invited",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date(),
    });
    const ports = create_production_member_admin_ports(db, recording_clerk().clerk);
    const found = await ports.invitations.find_by_clerk_id(TENANT.toHexString(), "inv_9");
    expect(found).toMatchObject({
      clerk_invitation_id: "inv_9",
      email: "pending@x.ac.th",
      tenant_role: "user",
      status: "invited",
    });
    expect(await ports.invitations.find_by_clerk_id("other_tenant", "inv_9")).toBeNull();
    await ports.invitations.mark_status(TENANT.toHexString(), "inv_9", "revoked");
    expect(
      (await ports.invitations.find_by_clerk_id(TENANT.toHexString(), "inv_9"))?.status,
    ).toBe("revoked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/integration/member-admin-ports.test.ts`
Expected: FAIL — `create_production_member_admin_ports` / `MemberAdminClerkLike` / `DuplicatePendingInvitationError` are not exported.

- [ ] **Step 3: Create the contracts file**

```typescript
// apps/ai/server/services/provisioning/member-admin-ports.ts
import type { ClientSession } from "mongodb";

import type { ManagerInvitation } from "./provisioning-types";

/**
 * Member-administration contracts (Plan 3).
 *
 * One port surface shared by the tenant member lifecycle
 * (suspend/reactivate/remove), invitation management (revoke/resend), and
 * the platform manager lifecycle (demote). Fakes implement it in tests;
 * create_production_member_admin_ports implements it over MongoDB + Clerk.
 */

/** Membership projection view consumed by member-admin services. */
export interface MembershipView {
  readonly tenant_role: "manager" | "user";
  readonly status: "active" | "suspended" | "revoked";
}

/** Invitation projection view consumed by invitation services. */
export interface InvitationView {
  readonly clerk_invitation_id: string;
  readonly email: string;
  readonly tenant_role: "manager" | "user";
  readonly status: string;
  readonly created_at: Date;
}

/** Raised when the target membership/profile does not exist in this tenant. */
export class MemberNotFoundError extends Error {
  readonly code = "MEMBER_NOT_FOUND";

  constructor(user_profile_id: string) {
    super(
      `MEMBER_NOT_FOUND: no membership for profile ${user_profile_id} in this university.`,
    );
    this.name = "MemberNotFoundError";
  }
}

/** Raised when a tenant manager targets a manager; manager lifecycle is platform-scope. */
export class ManagerActionForbiddenError extends Error {
  readonly code = "MANAGER_ACTION_FORBIDDEN";

  constructor() {
    super(
      "MANAGER_ACTION_FORBIDDEN: tenant managers act on users only; manager lifecycle is a platform operation.",
    );
    this.name = "ManagerActionForbiddenError";
  }
}

/** Raised when reactivation targets a membership whose user profile is not active. */
export class ProfileInactiveError extends Error {
  readonly code = "PROFILE_INACTIVE";

  constructor(user_profile_id: string, profile_status: string) {
    super(
      `PROFILE_INACTIVE: profile ${user_profile_id} is ${profile_status}; the profile must be active before its membership can be reactivated.`,
    );
    this.name = "ProfileInactiveError";
  }
}

/** Raised when a mutation would leave the tenant without an active manager. */
export class LastManagerError extends Error {
  readonly code = "LAST_MANAGER";

  constructor(tenant_id: string) {
    super(
      `LAST_MANAGER: tenant ${tenant_id} must retain at least one active manager.`,
    );
    this.name = "LastManagerError";
  }
}

/** Raised when the invitation does not exist in this tenant. */
export class InvitationNotFoundError extends Error {
  readonly code = "INVITATION_NOT_FOUND";

  constructor(clerk_invitation_id: string) {
    super(
      `INVITATION_NOT_FOUND: no invitation ${clerk_invitation_id} exists in this university.`,
    );
    this.name = "InvitationNotFoundError";
  }
}

/** Raised when revoke/resend targets an invitation that is not pending. */
export class InvitationNotPendingError extends Error {
  readonly code = "INVITATION_NOT_PENDING";

  constructor(clerk_invitation_id: string, status: string) {
    super(
      `INVITATION_NOT_PENDING: invitation ${clerk_invitation_id} is ${status}; only pending invitations can be revoked or resent.`,
    );
    this.name = "InvitationNotPendingError";
  }
}

/** Raised when Clerk rejects an invitation because one is already pending. */
export class DuplicatePendingInvitationError extends Error {
  readonly code = "DUPLICATE_PENDING_INVITATION";

  constructor(email: string) {
    super(
      `DUPLICATE_PENDING_INVITATION: ${email} already has a pending invitation for this university.`,
    );
    this.name = "DuplicatePendingInvitationError";
  }
}

/** Ports for member administration; fakes in tests, MongoDB/Clerk in production. */
export interface MemberAdminPorts {
  readonly memberships: {
    find_membership(
      tenant_id: string,
      user_profile_id: string,
      session?: ClientSession,
    ): Promise<MembershipView | null>;
    set_membership_status(
      tenant_id: string,
      user_profile_id: string,
      status: MembershipView["status"],
      session?: ClientSession,
    ): Promise<void>;
    set_membership_role(
      tenant_id: string,
      user_profile_id: string,
      role: MembershipView["tenant_role"],
      session?: ClientSession,
    ): Promise<void>;
    count_active_managers(tenant_id: string, session?: ClientSession): Promise<number>;
    /**
     * Write-conflict guard for the last-manager invariant: touch the tenant
     * document inside the transaction so two racing demotions conflict on
     * the same document instead of committing snapshot write-skew.
     */
    touch_tenant_for_invariant(tenant_id: string, session?: ClientSession): Promise<void>;
  };
  readonly profiles: {
    find_profile_status(user_profile_id: string): Promise<string | null>;
  };
  readonly invitations: {
    find_by_clerk_id(
      tenant_id: string,
      clerk_invitation_id: string,
    ): Promise<InvitationView | null>;
    mark_status(
      tenant_id: string,
      clerk_invitation_id: string,
      status: "invited" | "revoked",
    ): Promise<void>;
    upsert(
      tenant_id: string,
      invitation: ManagerInvitation,
      invited_by_profile_id: string,
    ): Promise<void>;
  };
  readonly clerk: {
    create_user_invitation(
      clerk_organization_id: string,
      email: string,
    ): Promise<ManagerInvitation>;
    revoke_invitation(tenant_id: string, clerk_invitation_id: string): Promise<void>;
    remove_membership(tenant_id: string, user_profile_id: string): Promise<void>;
    update_membership_role(
      tenant_id: string,
      user_profile_id: string,
      role: MembershipView["tenant_role"],
    ): Promise<void>;
  };
  readonly tenants: {
    clerk_organization_id_for(tenant_id: string): Promise<string | null>;
  };
  readonly transactions: {
    run<T>(operation: (session: ClientSession | undefined) => Promise<T>): Promise<T>;
  };
  readonly audit: {
    record(event: Record<string, unknown> & { action: string }): Promise<void>;
  };
}
```

- [ ] **Step 4: Add `user_clerk_role` to production-ports.ts**

In `apps/ai/server/services/provisioning/production-ports.ts`, directly below `manager_clerk_role` (line ~55), add:

```typescript
/**
 * Clerk role string for a plain university user under the configured role
 * mode (org:user custom, org:member built-in). Counterpart of
 * manager_clerk_role — new code must never hardcode org:* literals.
 *
 * @returns Clerk role string for tenant users.
 */
export function user_clerk_role(): "org:user" | "org:member" {
  return process.env.CLERK_ORG_ROLE_MODE === "built_in" ? "org:member" : "org:user";
}
```

- [ ] **Step 5: Rewrite production-member-ports.ts**

Replace the entire file. Behavior of the existing members is preserved; the Clerk client becomes injectable; `create_user_invitation` gains the duplicate-pending mapping; the new admin factory is added.

```typescript
// apps/ai/server/services/provisioning/production-member-ports.ts
import { ObjectId, type ClientSession, type Db } from "mongodb";
import { TRPCError } from "@trpc/server";
import { createClerkClient } from "@clerk/backend";

import { manager_clerk_role, user_clerk_role } from "./production-ports";
import type { TenantMemberPorts } from "./invite-tenant-user";
import type { AppointManagerPorts } from "./appoint-manager";
import type { ManagerInvitation } from "./provisioning-types";
import {
  DuplicatePendingInvitationError,
  MemberNotFoundError,
  type MemberAdminPorts,
  type MembershipView,
} from "./member-admin-ports";

/**
 * Narrow Clerk backend surface used by member administration. Injectable in
 * tests; the default adapter wraps the real client (explicit adaptation, one
 * boundary — same pattern as platform-tenants.ts request_clerk_client).
 */
export interface MemberAdminClerkLike {
  organizations: {
    createOrganizationInvitation(params: {
      organizationId: string;
      emailAddress: string;
      role: string;
      redirectUrl?: string;
    }): Promise<{ id: string; emailAddress: string; role: string }>;
    getOrganizationInvitationList(params: {
      organizationId: string;
      status?: string[];
    }): Promise<{
      data: Array<{ id: string; emailAddress: string; role: string; status: string }>;
    }>;
    revokeOrganizationInvitation(params: {
      organizationId: string;
      invitationId: string;
    }): Promise<unknown>;
    updateOrganizationMembership(params: {
      organizationId: string;
      userId: string;
      role: string;
    }): Promise<unknown>;
    deleteOrganizationMembership(params: {
      organizationId: string;
      userId: string;
    }): Promise<unknown>;
  };
}

/**
 * Build the default Clerk backend adapter from the private secret.
 *
 * @returns Narrow Clerk view over the real backend client.
 * @throws TRPCError PRECONDITION_FAILED when Clerk is not configured.
 */
function default_clerk_backend(): MemberAdminClerkLike {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Clerk is not configured on this deployment.",
    });
  }
  const clerk = createClerkClient({ secretKey: secret });
  return {
    organizations: {
      createOrganizationInvitation: (params) =>
        clerk.organizations.createOrganizationInvitation(params),
      getOrganizationInvitationList: async (params) => {
        const response = await clerk.organizations.getOrganizationInvitationList({
          organizationId: params.organizationId,
          status: params.status as never,
        });
        return {
          data: response.data.map((invitation) => ({
            id: invitation.id,
            emailAddress: invitation.emailAddress,
            role: String(invitation.role),
            status: String(invitation.status),
          })),
        };
      },
      revokeOrganizationInvitation: (params) =>
        clerk.organizations.revokeOrganizationInvitation(params),
      updateOrganizationMembership: (params) =>
        clerk.organizations.updateOrganizationMembership(params),
      deleteOrganizationMembership: (params) =>
        clerk.organizations.deleteOrganizationMembership(params),
    },
  };
}

/**
 * Invitation redirect target: invited users land on our onboarding page,
 * not Clerk's default hosted page. Undefined when the app origin is not
 * configured (Clerk then uses its instance default).
 *
 * @returns Absolute onboarding URL, or undefined without NEXT_PUBLIC_APP_URL.
 */
function invitation_redirect_url(): string | undefined {
  return process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/onboarding`
    : undefined;
}

/**
 * Map a Clerk invitation role onto the internal projection role. Manager
 * roles differ by CLERK_ORG_ROLE_MODE (org:manager custom, org:admin
 * built-in); everything else projects as a tenant user.
 *
 * @param clerk_role - Role string returned by Clerk for the invitation.
 * @returns Internal tenant role for the invitation projection.
 */
function projection_role(clerk_role: string): "manager" | "user" {
  return clerk_role === "org:manager" || clerk_role === "org:admin"
    ? "manager"
    : "user";
}

/**
 * Narrow a stored projection status onto the typed membership view.
 *
 * @param value - Raw status value from the projection document.
 * @returns Typed status (unknown labels degrade to "active" — the stored
 *          vocabulary is exactly these three).
 */
function membership_status_of(value: unknown): MembershipView["status"] {
  return value === "suspended" || value === "revoked" ? value : "active";
}

/**
 * Resolve the Clerk organization id for a tenant or fail loudly.
 *
 * @param db - Database handle.
 * @param tenant_id - Internal tenant id.
 * @returns Clerk organization id.
 * @throws Error when the tenant has no Clerk organization.
 */
async function required_clerk_org_id(db: Db, tenant_id: string): Promise<string> {
  if (!ObjectId.isValid(tenant_id)) {
    throw new Error("The tenant has no Clerk organization; provisioning is incomplete.");
  }
  const tenant = await db
    .collection("tenants")
    .findOne({ _id: new ObjectId(tenant_id) });
  if (!tenant?.clerkOrganizationId) {
    throw new Error("The tenant has no Clerk organization; provisioning is incomplete.");
  }
  return String(tenant.clerkOrganizationId);
}

/**
 * Resolve the Clerk user id for an internal profile.
 *
 * @param db - Database handle.
 * @param user_profile_id - Internal profile id.
 * @returns Clerk user id.
 * @throws MemberNotFoundError when the profile has no Clerk identity.
 */
async function required_clerk_user_id(db: Db, user_profile_id: string): Promise<string> {
  if (!ObjectId.isValid(user_profile_id)) {
    throw new MemberNotFoundError(user_profile_id);
  }
  const profile = await db
    .collection("user_profiles")
    .findOne({ _id: new ObjectId(user_profile_id) }, { projection: { clerkUserId: 1 } });
  if (!profile?.clerkUserId) {
    throw new MemberNotFoundError(user_profile_id);
  }
  return String(profile.clerkUserId);
}

/**
 * Translate Clerk's duplicate-pending-invitation rejection into the typed
 * domain error; any other failure is returned untouched for rethrow.
 *
 * @param error - Error thrown by createOrganizationInvitation.
 * @param email - Invited email, for the human-readable message.
 * @returns The typed duplicate error, or the original error.
 */
function translate_duplicate_invitation_error(error: unknown, email: string): unknown {
  const clerk_error = error as { errors?: Array<{ code?: string }> } | null;
  const duplicate = clerk_error?.errors?.some(
    (entry) => typeof entry?.code === "string" && entry.code.includes("duplicate"),
  );
  return duplicate ? new DuplicatePendingInvitationError(email) : error;
}

/**
 * Build production member-management ports over MongoDB and Clerk. Shared by
 * the tenant members router (invite/suspend) and the platform tenants router
 * (manager appointment) so both paths project invitations identically.
 *
 * @param db - Connected database handle.
 * @param clerk_like - Narrow Clerk view; injected in tests, real otherwise.
 * @returns Ports satisfying both member management and manager appointment.
 * @throws TRPCError PRECONDITION_FAILED when Clerk is not configured and no
 *         clerk_like override is provided.
 */
export function create_production_member_ports(
  db: Db,
  clerk_like?: MemberAdminClerkLike,
): TenantMemberPorts & AppointManagerPorts {
  const clerk = clerk_like ?? default_clerk_backend();

  return {
    memberships: {
      async find_memberships_by_email(email) {
        const profile = await db
          .collection("user_profiles")
          .findOne({ primaryEmail: email });
        if (!profile) return [];
        const memberships = await db
          .collection("tenant_membership_projections")
          .find({ userProfileId: profile._id.toString() })
          .toArray();
        return memberships.map((m) => ({
          tenant_id: String(m.tenantId),
          status: String(m.status),
        }));
      },
      async suspend_membership(tenant_id, user_profile_id) {
        await db.collection("tenant_membership_projections").updateOne(
          { tenantId: tenant_id, userProfileId: user_profile_id },
          { $set: { status: "suspended", updatedAt: new Date() } },
        );
      },
    },
    invitations: {
      async find_invitations_by_email(email) {
        const invitations = await db
          .collection("tenant_invitation_projections")
          .find({ emailNormalized: email })
          .toArray();
        return invitations.map((invitation) => ({
          tenant_id: String(invitation.tenantId),
          status: String(invitation.status),
        }));
      },
      async upsert(tenant_id, invitation, invited_by_profile_id) {
        const now = new Date();
        await db.collection("tenant_invitation_projections").updateOne(
          { clerkInvitationId: invitation.id },
          {
            $setOnInsert: {
              clerkInvitationId: invitation.id,
              tenantId: tenant_id,
              emailNormalized: invitation.email,
              tenantRole: projection_role(invitation.role),
              status: "invited",
              invitedByProfileId: invited_by_profile_id,
              expiresAt: null,
              clerkSyncedAt: null,
              createdAt: now,
            },
            $set: { updatedAt: now },
          },
          { upsert: true },
        );
      },
    },
    clerk: {
      async create_user_invitation(clerk_organization_id, email) {
        try {
          const created = await clerk.organizations.createOrganizationInvitation({
            organizationId: clerk_organization_id,
            emailAddress: email,
            role: user_clerk_role(),
            redirectUrl: invitation_redirect_url(),
          });
          return {
            id: created.id,
            email: created.emailAddress.toLowerCase(),
            role: created.role,
          };
        } catch (error) {
          throw translate_duplicate_invitation_error(error, email);
        }
      },
      async create_manager_invitation(
        clerk_organization_id,
        email,
      ): Promise<ManagerInvitation> {
        // Idempotent over pending invitations: replaying an appointment
        // returns the existing pending invitation instead of minting another.
        const pending = await clerk.organizations.getOrganizationInvitationList({
          organizationId: clerk_organization_id,
          status: ["pending"],
        });
        const existing = pending.data.find(
          (invitation) => invitation.emailAddress.toLowerCase() === email,
        );
        if (existing) {
          return {
            id: existing.id,
            email: existing.emailAddress.toLowerCase(),
            role: String(existing.role),
          };
        }
        const created = await clerk.organizations.createOrganizationInvitation({
          organizationId: clerk_organization_id,
          emailAddress: email,
          role: manager_clerk_role(),
          redirectUrl: invitation_redirect_url(),
        });
        return {
          id: created.id,
          email: created.emailAddress.toLowerCase(),
          role: created.role,
        };
      },
    },
    tenants: {
      async clerk_organization_id_for(tenant_id) {
        if (!ObjectId.isValid(tenant_id)) return null;
        // TODO(G2.6): move into a tenant repository
        const tenant = await db
          .collection("tenants")
          .findOne({ _id: new ObjectId(tenant_id) });
        return tenant?.clerkOrganizationId ?? null;
      },
    },
    audit: {
      async record(event) {
        await db.collection("platform_audit_events").insertOne({ ...event });
      },
    },
  };
}

/**
 * Build production member-administration ports (Plan 3) over MongoDB + Clerk.
 * Reuses the base member ports for the shared invitation/tenant/audit
 * surfaces; adds membership lifecycle writes, invitation lookups, Clerk
 * membership administration, and a Mongo-transaction runner (pattern:
 * ai-rollout-repository in_transaction).
 *
 * @param db - Connected database handle.
 * @param clerk_like - Narrow Clerk view; injected in tests, real otherwise.
 * @returns Ports satisfying MemberAdminPorts.
 * @throws TRPCError PRECONDITION_FAILED when Clerk is not configured and no
 *         clerk_like override is provided.
 */
export function create_production_member_admin_ports(
  db: Db,
  clerk_like?: MemberAdminClerkLike,
): MemberAdminPorts {
  const clerk = clerk_like ?? default_clerk_backend();
  const base = create_production_member_ports(db, clerk);
  const memberships = db.collection("tenant_membership_projections");

  return {
    memberships: {
      async find_membership(tenant_id, user_profile_id, session) {
        const membership = await memberships.findOne(
          { tenantId: tenant_id, userProfileId: user_profile_id },
          { session },
        );
        if (!membership) return null;
        return {
          tenant_role: membership.tenantRole === "manager" ? "manager" : "user",
          status: membership_status_of(membership.status),
        };
      },
      async set_membership_status(tenant_id, user_profile_id, status, session) {
        console.info({
          boundary: "member-admin-ports",
          event: "membership.status.set",
          tenant_id,
          user_profile_id,
          status,
        });
        await memberships.updateOne(
          { tenantId: tenant_id, userProfileId: user_profile_id },
          { $set: { status, updatedAt: new Date() } },
          { session },
        );
      },
      async set_membership_role(tenant_id, user_profile_id, role, session) {
        console.info({
          boundary: "member-admin-ports",
          event: "membership.role.set",
          tenant_id,
          user_profile_id,
          role,
        });
        await memberships.updateOne(
          { tenantId: tenant_id, userProfileId: user_profile_id },
          { $set: { tenantRole: role, updatedAt: new Date() } },
          { session },
        );
      },
      async count_active_managers(tenant_id, session) {
        return memberships.countDocuments(
          { tenantId: tenant_id, tenantRole: "manager", status: "active" },
          { session },
        );
      },
      async touch_tenant_for_invariant(tenant_id, session) {
        if (!ObjectId.isValid(tenant_id)) return;
        // Both of two racing last-manager transactions write this same
        // tenant document, forcing a Mongo write conflict so one aborts and
        // retries instead of both committing snapshot write-skew.
        await db.collection("tenants").updateOne(
          { _id: new ObjectId(tenant_id) },
          { $set: { managerInvariantCheckedAt: new Date() } },
          { session },
        );
      },
    },
    profiles: {
      async find_profile_status(user_profile_id) {
        if (!ObjectId.isValid(user_profile_id)) return null;
        const profile = await db
          .collection("user_profiles")
          .findOne(
            { _id: new ObjectId(user_profile_id) },
            { projection: { status: 1 } },
          );
        return profile ? String(profile.status) : null;
      },
    },
    invitations: {
      async find_by_clerk_id(tenant_id, clerk_invitation_id) {
        const invitation = await db
          .collection("tenant_invitation_projections")
          .findOne({ tenantId: tenant_id, clerkInvitationId: clerk_invitation_id });
        if (!invitation) return null;
        return {
          clerk_invitation_id: String(invitation.clerkInvitationId),
          email: String(invitation.emailNormalized),
          tenant_role: invitation.tenantRole === "manager" ? "manager" : "user",
          status: String(invitation.status),
          created_at:
            invitation.createdAt instanceof Date ? invitation.createdAt : new Date(0),
        };
      },
      async mark_status(tenant_id, clerk_invitation_id, status) {
        await db.collection("tenant_invitation_projections").updateOne(
          { tenantId: tenant_id, clerkInvitationId: clerk_invitation_id },
          { $set: { status, updatedAt: new Date() } },
        );
      },
      upsert: base.invitations.upsert,
    },
    clerk: {
      create_user_invitation: base.clerk.create_user_invitation,
      async revoke_invitation(tenant_id, clerk_invitation_id) {
        const organization_id = await required_clerk_org_id(db, tenant_id);
        try {
          await clerk.organizations.revokeOrganizationInvitation({
            organizationId: organization_id,
            invitationId: clerk_invitation_id,
          });
        } catch (error) {
          const status = (error as { status?: number } | null)?.status;
          if (typeof status === "number" && status >= 400 && status < 500) {
            // Already revoked/expired on Clerk's side; projection revocation
            // is the goal, so a 4xx is tolerated as success.
            console.warn({
              boundary: "member-admin-ports",
              event: "invitation.revoke.tolerated",
              clerk_invitation_id,
              status,
            });
            return;
          }
          throw error;
        }
      },
      async remove_membership(tenant_id, user_profile_id) {
        const organization_id = await required_clerk_org_id(db, tenant_id);
        const user_id = await required_clerk_user_id(db, user_profile_id);
        console.info({
          boundary: "member-admin-ports",
          event: "membership.remove.clerk",
          tenant_id,
          user_profile_id,
        });
        await clerk.organizations.deleteOrganizationMembership({
          organizationId: organization_id,
          userId: user_id,
        });
      },
      async update_membership_role(tenant_id, user_profile_id, role) {
        const organization_id = await required_clerk_org_id(db, tenant_id);
        const user_id = await required_clerk_user_id(db, user_profile_id);
        console.info({
          boundary: "member-admin-ports",
          event: "membership.role.clerk",
          tenant_id,
          user_profile_id,
          role,
        });
        await clerk.organizations.updateOrganizationMembership({
          organizationId: organization_id,
          userId: user_id,
          role: role === "manager" ? manager_clerk_role() : user_clerk_role(),
        });
      },
    },
    tenants: base.tenants,
    transactions: {
      async run<T>(
        operation: (session: ClientSession | undefined) => Promise<T>,
      ): Promise<T> {
        // Mirrors ai-rollout-repository's in_transaction: one session per
        // call, always ended; withTransaction retries transient aborts.
        const session = db.client.startSession();
        try {
          let value: T | undefined;
          await session.withTransaction(async () => {
            value = await operation(session);
          });
          return value as T;
        } finally {
          await session.endSession();
        }
      },
    },
    audit: base.audit,
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- tests/integration/member-admin-ports.test.ts`
Expected: PASS (8 tests). Then confirm nothing existing broke:

Run: `npm run test -- tests/provisioning/tenant-invitations.test.ts tests/provisioning/appoint-manager.test.ts tests/provisioning/provision-university.test.ts`
Expected: PASS (existing behavior preserved).

- [ ] **Step 7: Commit**

```bash
git add apps/ai/server/services/provisioning/member-admin-ports.ts \
        apps/ai/server/services/provisioning/production-member-ports.ts \
        apps/ai/server/services/provisioning/production-ports.ts \
        tests/integration/member-admin-ports.test.ts
git commit -m "feat: member-admin ports — Clerk membership/invitation admin, transactions, duplicate-invite mapping"
```

---
## Task 3: Webhook core — single-membership guard lift + revive semantics + retryable receipts

The complete removal footprint of `MultipleMembershipsDisabledError` lands in ONE task (spec §4.1 — verified complete set): `invite-tenant-user.ts`, `appoint-manager.ts`, `platform-tenants.ts`, `tenant-members.ts`, the `ClerkWebhookDependencies` members `count_other_active_memberships`/`suspend_profile_authorization` and their production impls, the reconcile CLI insert path, and all four affected test files. Simultaneously: `upsert_membership` is re-keyed to `(tenantId, userProfileId)` with revive semantics (BLOCKING fix — remove→re-invite otherwise dies on `uniq_membership_tenant_profile` E11000 and the event is lost), and the receipt lifecycle becomes claim → apply → complete with `fail()` + 5xx so svix retries reapply. Multi-membership writes the informational `membership_multi_org` audit and never touches `user_profiles.status`.

**Files:**
- Modify: `apps/ai/server/services/provisioning/apply-clerk-event.ts` (full replacement below)
- Modify: `apps/web/app/api/webhooks/clerk/route.ts` (full replacement below)
- Modify: `apps/ai/server/services/provisioning/invite-tenant-user.ts` (full replacement below)
- Modify: `apps/ai/server/services/provisioning/appoint-manager.ts` (full replacement below)
- Modify: `apps/ai/server/services/provisioning/production-member-ports.ts` (remove `find_invitations_by_email` — now an excess property)
- Modify: `apps/ai/server/services/provisioning/reconcile-clerk.ts` (revive-keyed repair upsert)
- Modify: `apps/ai/server/routers/platform-tenants.ts`, `apps/ai/server/routers/tenant-members.ts` (drop dead import + CONFLICT mapping)
- Tests: rewrite `tests/provisioning/clerk-webhooks.test.ts`, `tests/provisioning/tenant-invitations.test.ts`, `tests/provisioning/appoint-manager.test.ts`; modify `tests/resilience/webhook-burst.test.ts`

- [ ] **Step 1: Rewrite the webhook test file (failing tests first)**

Replace `tests/provisioning/clerk-webhooks.test.ts` entirely:

```typescript
// tests/provisioning/clerk-webhooks.test.ts
import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  handle_clerk_webhook,
  type ClerkWebhookDependencies,
} from "../../apps/ai/server/services/provisioning/apply-clerk-event";

const SIGNING_SECRET = `whsec_${Buffer.from("test-signing-secret-32-bytes!!").toString("base64")}`;
process.env.CLERK_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET;

/**
 * Sign a webhook payload with the documented svix v1 scheme.
 *
 * @param options - Message ID, timestamp, and payload to sign.
 * @returns Signed Request ready for the handler.
 */
function signed_request(options: {
  payload: unknown;
  message_id?: string;
  timestamp?: Date;
  corrupt_signature?: boolean;
}): Request {
  const message_id = options.message_id ?? `msg_${randomUUID()}`;
  const timestamp = Math.floor((options.timestamp ?? new Date()).getTime() / 1000);
  const body = JSON.stringify(options.payload);
  const secret_bytes = Buffer.from(SIGNING_SECRET.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", secret_bytes)
    .update(`${message_id}.${timestamp}.${body}`)
    .digest("base64");
  return new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": message_id,
      "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${options.corrupt_signature ? "AAAA" : signature}`,
    },
    body,
  });
}

interface StoredMembership {
  clerkMembershipId: string;
  tenantId: string;
  userProfileId: string;
  tenantRole: string;
  status: string;
  clerkSyncedAt: Date;
}

/**
 * In-memory membership map key mirroring the production revive keying:
 * one row per (tenant, profile) pair — NEVER per Clerk membership id.
 */
function pair_key(tenant_id: string, user_profile_id: string): string {
  return `${tenant_id}:${user_profile_id}`;
}

/**
 * Build an in-memory webhook world (receipts + projections + audit) with the
 * Plan 3 dependency surface: retryable receipts, revive-keyed memberships,
 * count_active_memberships (no profile suspension port exists any more).
 */
function fake_world() {
  const receipts = new Map<string, { completed: boolean; failed: boolean }>();
  const profiles = new Map<string, any>();
  const memberships = new Map<string, StoredMembership>();
  const invitations = new Map<string, any>();
  const audit_events: any[] = [];

  const deps: ClerkWebhookDependencies = {
    receipts: {
      async claim(event_id, _event_type) {
        const existing = receipts.get(event_id);
        if (existing && !existing.failed) return { already_processed: true };
        receipts.set(event_id, { completed: false, failed: false });
        return { already_processed: false };
      },
      async complete(event_id) {
        receipts.set(event_id, { completed: true, failed: false });
      },
      async fail(event_id) {
        receipts.set(event_id, { completed: false, failed: true });
      },
    },
    projections: {
      async upsert_user_profile(clerk_user, occurred_at) {
        const existing = profiles.get(clerk_user.id);
        if (existing && existing.clerkSyncedAt > occurred_at) return "stale";
        profiles.set(clerk_user.id, {
          clerkUserId: clerk_user.id,
          primaryEmail: clerk_user.primary_email,
          displayName: clerk_user.display_name,
          status: existing?.status ?? "active",
          clerkSyncedAt: occurred_at,
        });
        return "applied";
      },
      async mark_user_deleted(clerk_user_id, occurred_at) {
        const existing = profiles.get(clerk_user_id);
        if (existing && existing.clerkSyncedAt > occurred_at) return "stale";
        if (existing) {
          existing.status = "deleted";
          existing.clerkSyncedAt = occurred_at;
        }
        return "applied";
      },
      async find_tenant_id_by_clerk_org(clerk_org_id) {
        return clerk_org_id === "org_known" ? "tenant_1" : null;
      },
      async find_profile_id_by_clerk_user(clerk_user_id) {
        return profiles.has(clerk_user_id) ? `profile_${clerk_user_id}` : null;
      },
      async upsert_membership(membership, occurred_at) {
        const key = pair_key(membership.tenant_id, membership.user_profile_id);
        const existing = memberships.get(key);
        if (existing && existing.clerkSyncedAt > occurred_at) return "stale";
        memberships.set(key, {
          clerkMembershipId: membership.clerk_membership_id,
          tenantId: membership.tenant_id,
          userProfileId: membership.user_profile_id,
          tenantRole: membership.tenant_role,
          status: membership.status,
          clerkSyncedAt: occurred_at,
        });
        return "applied";
      },
      async revoke_membership(clerk_membership_id, occurred_at) {
        const existing = [...memberships.values()].find(
          (m) => m.clerkMembershipId === clerk_membership_id,
        );
        if (existing && existing.clerkSyncedAt > occurred_at) return "stale";
        if (existing) {
          existing.status = "revoked";
          existing.clerkSyncedAt = occurred_at;
        }
        return "applied";
      },
      async update_invitation_status(clerk_invitation_id, status, occurred_at) {
        invitations.set(clerk_invitation_id, { status, clerkSyncedAt: occurred_at });
        return "applied";
      },
      async count_active_memberships(user_profile_id) {
        return [...memberships.values()].filter(
          (m) => m.userProfileId === user_profile_id && m.status === "active",
        ).length;
      },
    },
    audit: {
      async record(event) {
        audit_events.push(event);
      },
    },
  };

  return { deps, receipts, profiles, memberships, invitations, audit_events };
}

const membership_created_payload = (overrides: Record<string, unknown> = {}) => ({
  type: "organizationMembership.created",
  data: {
    id: "orgmem_1",
    organization: { id: "org_known" },
    public_user_data: { user_id: "user_1" },
    role: "org:member",
    created_at: Date.parse("2026-07-15T00:00:00Z"),
    updated_at: Date.parse("2026-07-15T00:00:00Z"),
    ...overrides,
  },
});

describe("handle_clerk_webhook", () => {
  it("rejects an invalid signature without touching projections", async () => {
    const world = fake_world();
    const response = await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload(), corrupt_signature: true }),
      world.deps,
    );
    expect(response.status).toBe(400);
    expect(world.memberships.size).toBe(0);
    expect(world.receipts.size).toBe(0);
  });

  it("acknowledges a duplicate webhook without applying it twice", async () => {
    const world = fake_world();
    world.profiles.set("user_1", {
      clerkUserId: "user_1",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    const message_id = "msg_dup_1";
    const first = await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload(), message_id }),
      world.deps,
    );
    const second = await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload(), message_id }),
      world.deps,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(world.memberships.size).toBe(1);
  });

  it("applies user create then ignores an out-of-order older update", async () => {
    const world = fake_world();
    const newer = {
      type: "user.updated",
      data: {
        id: "user_2",
        email_addresses: [{ email_address: "new@x.ac.th" }],
        first_name: "New",
        last_name: "Name",
        updated_at: Date.parse("2026-07-15T10:00:00Z"),
      },
    };
    const older = {
      ...newer,
      data: {
        ...newer.data,
        email_addresses: [{ email_address: "old@x.ac.th" }],
        updated_at: Date.parse("2026-07-15T09:00:00Z"),
      },
    };
    await handle_clerk_webhook(signed_request({ payload: newer }), world.deps);
    const response = await handle_clerk_webhook(
      signed_request({ payload: older }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(world.profiles.get("user_2")?.primaryEmail).toBe("new@x.ac.th");
  });

  it("soft-deletes on user.deleted instead of removing identity", async () => {
    const world = fake_world();
    world.profiles.set("user_3", {
      clerkUserId: "user_3",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    const response = await handle_clerk_webhook(
      signed_request({
        payload: { type: "user.deleted", data: { id: "user_3", deleted: true } },
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(world.profiles.get("user_3")?.status).toBe("deleted");
    expect(world.profiles.has("user_3")).toBe(true);
  });

  it("revokes membership on organizationMembership.deleted", async () => {
    const world = fake_world();
    world.profiles.set("user_1", {
      clerkUserId: "user_1",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload() }),
      world.deps,
    );
    const response = await handle_clerk_webhook(
      signed_request({
        payload: {
          type: "organizationMembership.deleted",
          data: {
            id: "orgmem_1",
            organization: { id: "org_known" },
            public_user_data: { user_id: "user_1" },
            updated_at: Date.parse("2026-07-15T01:00:00Z"),
          },
        },
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(world.memberships.get("tenant_1:profile_user_1")?.status).toBe("revoked");
  });

  it("keeps both memberships active and records membership_multi_org — never mutating the profile", async () => {
    const world = fake_world();
    world.profiles.set("user_multi", {
      clerkUserId: "user_multi",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    world.memberships.set("tenant_other:profile_user_multi", {
      clerkMembershipId: "orgmem_existing",
      tenantId: "tenant_other",
      userProfileId: "profile_user_multi",
      tenantRole: "user",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    const response = await handle_clerk_webhook(
      signed_request({
        payload: membership_created_payload({
          id: "orgmem_second",
          public_user_data: { user_id: "user_multi" },
        }),
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(world.profiles.get("user_multi")?.status).toBe("active");
    expect(world.memberships.get("tenant_other:profile_user_multi")?.status).toBe("active");
    expect(world.memberships.get("tenant_1:profile_user_multi")?.status).toBe("active");
    const multi_audit = world.audit_events.find((e) => e.action === "membership_multi_org");
    expect(multi_audit).toMatchObject({
      userProfileId: "profile_user_multi",
      clerkMembershipId: "orgmem_second",
      activeMembershipCount: 2,
    });
    expect(
      world.audit_events.some((e) => e.action === "membership_reconciliation_required"),
    ).toBe(false);
  });

  it("revives the same (tenant, profile) projection under a NEW clerkMembershipId after remove→re-invite", async () => {
    const world = fake_world();
    world.profiles.set("user_1", {
      clerkUserId: "user_1",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload() }),
      world.deps,
    );
    await handle_clerk_webhook(
      signed_request({
        payload: {
          type: "organizationMembership.deleted",
          data: {
            id: "orgmem_1",
            organization: { id: "org_known" },
            public_user_data: { user_id: "user_1" },
            updated_at: Date.parse("2026-07-15T01:00:00Z"),
          },
        },
      }),
      world.deps,
    );
    const response = await handle_clerk_webhook(
      signed_request({
        payload: membership_created_payload({
          id: "orgmem_2",
          created_at: Date.parse("2026-07-15T02:00:00Z"),
          updated_at: Date.parse("2026-07-15T02:00:00Z"),
        }),
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    // The blocking-fix regression: ONE row per pair, revived active under
    // the new Clerk membership id — no second insert, no lost event.
    expect(world.memberships.size).toBe(1);
    const revived = world.memberships.get("tenant_1:profile_user_1");
    expect(revived).toMatchObject({
      clerkMembershipId: "orgmem_2",
      status: "active",
    });
  });

  it("returns 5xx on a failed apply and reapplies on the svix retry", async () => {
    const world = fake_world();
    world.profiles.set("user_1", {
      clerkUserId: "user_1",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    let failures_remaining = 1;
    const flaky_deps: ClerkWebhookDependencies = {
      ...world.deps,
      projections: {
        ...world.deps.projections,
        async upsert_membership(membership, occurred_at) {
          if (failures_remaining > 0) {
            failures_remaining -= 1;
            throw new Error("transient projection outage");
          }
          return world.deps.projections.upsert_membership(membership, occurred_at);
        },
      },
    };
    const message_id = "msg_retry_1";
    const first = await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload(), message_id }),
      flaky_deps,
    );
    expect(first.status).toBe(500);
    expect(world.memberships.size).toBe(0);
    expect(world.receipts.get(message_id)).toEqual({ completed: false, failed: true });
    const second = await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload(), message_id }),
      flaky_deps,
    );
    expect(second.status).toBe(200);
    expect(world.memberships.size).toBe(1);
    expect(world.receipts.get(message_id)).toEqual({ completed: true, failed: false });
  });

  it("marks invitation accepted on organizationInvitation.accepted", async () => {
    const world = fake_world();
    const response = await handle_clerk_webhook(
      signed_request({
        payload: {
          type: "organizationInvitation.accepted",
          data: {
            id: "inv_1",
            organization_id: "org_known",
            updated_at: Date.parse("2026-07-15T02:00:00Z"),
          },
        },
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(world.invitations.get("inv_1")?.status).toBe("active");
  });
});
```

- [ ] **Step 2: Run to verify the new webhook tests fail**

Run: `npm run test -- tests/provisioning/clerk-webhooks.test.ts`
Expected: FAIL — type errors (`fail` / `count_active_memberships` missing from `ClerkWebhookDependencies`, `count_other_active_memberships`/`suspend_profile_authorization` required) plus assertion failures.

- [ ] **Step 3: Rewrite `apply-clerk-event.ts`**

Replace the entire file:

```typescript
// apps/ai/server/services/provisioning/apply-clerk-event.ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Clerk webhook synchronization (G1.5, multi-org semantics from Plan 3).
 *
 * Verifies the svix signature before parsing business fields, claims an
 * idempotency receipt per event ID, and applies projection updates with
 * monotonic occurredAt checks so an older event can never overwrite newer
 * state. Deletions mark records revoked/deleted — business identity is never
 * hard-deleted. A failed apply marks the receipt failed and answers 5xx so
 * the svix retry reapplies (receipts complete only after a successful apply).
 */

/** Result of applying one projection change. */
export type ApplyOutcome = "applied" | "stale";

/** Normalized membership change consumed by the projection port. */
export interface MembershipChange {
  readonly clerk_membership_id: string;
  readonly tenant_id: string;
  readonly user_profile_id: string;
  readonly tenant_role: "manager" | "user";
  readonly status: "active";
}

/** Ports the webhook handler depends on; fakes in tests, MongoDB in production. */
export interface ClerkWebhookDependencies {
  readonly receipts: {
    claim(event_id: string, event_type: string): Promise<{ already_processed: boolean }>;
    complete(event_id: string): Promise<void>;
    /** Mark a claimed receipt failed so a redelivery of the same event id reclaims it. */
    fail(event_id: string): Promise<void>;
  };
  readonly projections: {
    upsert_user_profile(
      clerk_user: { id: string; primary_email: string; display_name: string },
      occurred_at: Date,
    ): Promise<ApplyOutcome>;
    mark_user_deleted(clerk_user_id: string, occurred_at: Date): Promise<ApplyOutcome>;
    find_tenant_id_by_clerk_org(clerk_org_id: string): Promise<string | null>;
    find_profile_id_by_clerk_user(clerk_user_id: string): Promise<string | null>;
    /**
     * Upsert keyed by (tenant_id, user_profile_id) — NOT clerk_membership_id.
     * Remove→re-invite mints a NEW Clerk membership id for the same pair and
     * the projection carries a unique (tenantId, userProfileId) index, so
     * the implementation must revive the existing row: set the new
     * clerkMembershipId, role, and status under the monotonic clock guard.
     */
    upsert_membership(
      membership: MembershipChange,
      occurred_at: Date,
    ): Promise<ApplyOutcome>;
    revoke_membership(
      clerk_membership_id: string,
      occurred_at: Date,
    ): Promise<ApplyOutcome>;
    update_invitation_status(
      clerk_invitation_id: string,
      status: "active" | "revoked",
      occurred_at: Date,
    ): Promise<ApplyOutcome>;
    /** Active memberships across ALL tenants for one profile (multi-org audit). */
    count_active_memberships(user_profile_id: string): Promise<number>;
  };
  readonly audit: {
    record(event: Record<string, unknown> & { action: string }): Promise<void>;
  };
}

const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verify a Clerk (svix v1) webhook signature and return the parsed event.
 * The signed content is `${svix-id}.${svix-timestamp}.${body}` HMAC-SHA256
 * keyed with the base64 secret after the whsec_ prefix.
 *
 * @param request - Incoming webhook request.
 * @param signing_secret - CLERK_WEBHOOK_SIGNING_SECRET value.
 * @returns Parsed event payload plus the svix message ID.
 * @throws Error when headers, timestamp tolerance, or signature fail.
 */
export async function verify_clerk_webhook_request(
  request: Request,
  signing_secret: string,
): Promise<{ event_id: string; payload: any }> {
  const svix_id = request.headers.get("svix-id");
  const svix_timestamp = request.headers.get("svix-timestamp");
  const svix_signature = request.headers.get("svix-signature");
  if (!svix_id || !svix_timestamp || !svix_signature) {
    throw new Error("missing svix headers");
  }

  const timestamp_seconds = Number(svix_timestamp);
  const now_seconds = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(timestamp_seconds) ||
    Math.abs(now_seconds - timestamp_seconds) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw new Error("webhook timestamp outside tolerance");
  }

  const body = await request.text();
  const secret_bytes = Buffer.from(
    signing_secret.replace(/^whsec_/, ""),
    "base64",
  );
  const expected = createHmac("sha256", secret_bytes)
    .update(`${svix_id}.${svix_timestamp}.${body}`)
    .digest();

  const provided_signatures = svix_signature
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .filter(Boolean);
  const valid = provided_signatures.some((candidate) => {
    const candidate_bytes = Buffer.from(candidate, "base64");
    return (
      candidate_bytes.length === expected.length &&
      timingSafeEqual(candidate_bytes, expected)
    );
  });
  if (!valid) {
    throw new Error("invalid webhook signature");
  }

  return { event_id: svix_id, payload: JSON.parse(body) };
}

/**
 * Extract the event occurrence time with a fallback to now.
 *
 * @param data - Clerk event data object.
 * @returns Occurrence timestamp.
 */
function occurred_at_of(data: any): Date {
  const millis = data?.updated_at ?? data?.created_at;
  return typeof millis === "number" ? new Date(millis) : new Date();
}

/**
 * Map a Clerk organization role string to the internal tenant role.
 *
 * @param role - Clerk role string.
 * @returns Internal tenant role (defaults to user for unknown labels).
 */
function role_of(role: unknown): "manager" | "user" {
  return role === "org:manager" || role === "org:admin" ? "manager" : "user";
}

/**
 * Apply one verified Clerk event to the internal projections.
 *
 * @param payload - Verified Clerk event payload ({ type, data }).
 * @param deps - Projection and audit ports.
 */
export async function apply_clerk_event(
  payload: { type: string; data: any },
  deps: ClerkWebhookDependencies,
): Promise<void> {
  const { type, data } = payload;
  const occurred_at = occurred_at_of(data);

  switch (type) {
    case "user.created":
    case "user.updated": {
      await deps.projections.upsert_user_profile(
        {
          id: String(data.id),
          primary_email: String(
            data.email_addresses?.[0]?.email_address ?? "",
          ).toLowerCase(),
          display_name: [data.first_name, data.last_name]
            .filter(Boolean)
            .join(" "),
        },
        occurred_at,
      );
      return;
    }
    case "user.deleted": {
      await deps.projections.mark_user_deleted(String(data.id), occurred_at);
      return;
    }
    case "organizationInvitation.accepted": {
      await deps.projections.update_invitation_status(
        String(data.id),
        "active",
        occurred_at,
      );
      return;
    }
    case "organizationInvitation.revoked": {
      await deps.projections.update_invitation_status(
        String(data.id),
        "revoked",
        occurred_at,
      );
      return;
    }
    case "organizationMembership.created":
    case "organizationMembership.updated": {
      const clerk_org_id = String(data.organization?.id ?? "");
      const clerk_user_id = String(data.public_user_data?.user_id ?? "");
      const tenant_id =
        await deps.projections.find_tenant_id_by_clerk_org(clerk_org_id);
      const user_profile_id =
        await deps.projections.find_profile_id_by_clerk_user(clerk_user_id);
      if (!tenant_id || !user_profile_id) {
        await deps.audit.record({
          action: "membership_projection_deferred",
          clerkMembershipId: String(data.id),
          clerkOrganizationId: clerk_org_id,
          clerkUserId: clerk_user_id,
          occurred_at,
        });
        return;
      }
      const outcome = await deps.projections.upsert_membership(
        {
          clerk_membership_id: String(data.id),
          tenant_id,
          user_profile_id,
          tenant_role: role_of(data.role),
          status: "active",
        },
        occurred_at,
      );
      if (outcome === "applied") {
        const active_memberships =
          await deps.projections.count_active_memberships(user_profile_id);
        if (active_memberships > 1) {
          // Multi-org membership is permitted (Plan 3). Record an
          // informational audit; user_profiles.status is NEVER mutated here.
          await deps.audit.record({
            action: "membership_multi_org",
            userProfileId: user_profile_id,
            clerkMembershipId: String(data.id),
            activeMembershipCount: active_memberships,
            occurred_at,
          });
        }
      }
      return;
    }
    case "organizationMembership.deleted": {
      await deps.projections.revoke_membership(String(data.id), occurred_at);
      return;
    }
    default: {
      await deps.audit.record({
        action: "clerk_event_ignored",
        eventType: type,
        occurred_at,
      });
    }
  }
}

/**
 * Framework-neutral webhook entry: verify, claim the idempotency receipt,
 * apply, complete. A duplicate event returns 200 without reapplying; a
 * FAILED apply releases the claim (receipt marked failed) and answers 5xx so
 * svix retries reapply the event instead of losing it forever.
 *
 * @param request - Incoming webhook request.
 * @param deps - Receipt/projection/audit ports.
 * @returns 200 on success or duplicate; 400 on verification failure; 500 on
 *          a failed apply (retryable).
 */
export async function handle_clerk_webhook(
  request: Request,
  deps: ClerkWebhookDependencies,
): Promise<Response> {
  const signing_secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim();
  if (!signing_secret) {
    return new Response("webhook signing secret is not configured", {
      status: 503,
    });
  }

  let event_id: string;
  let payload: any;
  try {
    ({ event_id, payload } = await verify_clerk_webhook_request(
      request,
      signing_secret,
    ));
  } catch {
    return new Response("invalid webhook", { status: 400 });
  }

  const receipt = await deps.receipts.claim(event_id, String(payload?.type ?? ""));
  if (receipt.already_processed) {
    return new Response(null, { status: 200 });
  }
  try {
    await apply_clerk_event(payload, deps);
  } catch (error) {
    console.error({
      boundary: "clerk-webhook",
      event: "apply.failed",
      event_id,
      event_type: String(payload?.type ?? ""),
      error: error instanceof Error ? error.message : String(error),
    });
    await deps.receipts.fail(event_id);
    return new Response("event apply failed", { status: 500 });
  }
  await deps.receipts.complete(event_id);
  return new Response(null, { status: 200 });
}
```

- [ ] **Step 4: Rewrite the production webhook route**

Replace `apps/web/app/api/webhooks/clerk/route.ts` entirely:

```typescript
// apps/web/app/api/webhooks/clerk/route.ts
import type { Db } from "mongodb";
import client_promise from "@rnd-ai/shared-database";

import {
  handle_clerk_webhook,
  type ApplyOutcome,
  type ClerkWebhookDependencies,
} from "@/server/services/provisioning/apply-clerk-event";

export const dynamic = "force-dynamic";

/**
 * Monotonic guarded update: applies only when the stored clerkSyncedAt is
 * absent or older than the event occurrence.
 *
 * @param db - Database handle.
 * @param collection - Target collection name.
 * @param filter - Record selector.
 * @param set - Fields to apply.
 * @param occurred_at - Event occurrence time.
 * @returns applied when the write matched; stale otherwise.
 */
async function monotonic_update(
  db: Db,
  collection: string,
  filter: Record<string, unknown>,
  set: Record<string, unknown>,
  occurred_at: Date,
): Promise<ApplyOutcome> {
  const result = await db.collection(collection).updateOne(
    {
      ...filter,
      $or: [
        { clerkSyncedAt: null },
        { clerkSyncedAt: { $exists: false } },
        { clerkSyncedAt: { $lt: occurred_at } },
      ],
    },
    { $set: { ...set, clerkSyncedAt: occurred_at, updatedAt: new Date() } },
  );
  return result.matchedCount > 0 ? "applied" : "stale";
}

/**
 * Build the production webhook dependencies over MongoDB projections.
 *
 * @param db - Connected database handle.
 * @returns Dependencies for handle_clerk_webhook.
 */
function production_deps(db: Db): ClerkWebhookDependencies {
  return {
    receipts: {
      async claim(event_id, event_type) {
        const result = await db.collection("clerk_webhook_receipts").updateOne(
          { eventId: event_id },
          {
            $setOnInsert: {
              eventId: event_id,
              type: event_type,
              occurredAt: new Date(),
              processedAt: null,
              result: "claimed",
            },
          },
          { upsert: true },
        );
        if (result.upsertedCount > 0) return { already_processed: false };
        // A previously FAILED apply is reclaimable: the svix retry must
        // reapply instead of no-opping against a dead claim.
        const reclaimed = await db
          .collection("clerk_webhook_receipts")
          .findOneAndUpdate(
            { eventId: event_id, result: "failed" },
            { $set: { result: "claimed", occurredAt: new Date() } },
          );
        return { already_processed: reclaimed === null };
      },
      async complete(event_id) {
        await db.collection("clerk_webhook_receipts").updateOne(
          { eventId: event_id },
          { $set: { processedAt: new Date(), result: "processed" } },
        );
      },
      async fail(event_id) {
        console.error({
          boundary: "clerk-webhook",
          event: "receipt.failed",
          event_id,
        });
        await db.collection("clerk_webhook_receipts").updateOne(
          { eventId: event_id },
          { $set: { result: "failed", processedAt: new Date() } },
        );
      },
    },
    projections: {
      async upsert_user_profile(clerk_user, occurred_at) {
        const existing = await db
          .collection("user_profiles")
          .findOne({ clerkUserId: clerk_user.id });
        if (!existing) {
          await db.collection("user_profiles").insertOne({
            clerkUserId: clerk_user.id,
            legacyAccountId: null,
            primaryEmail: clerk_user.primary_email,
            displayName: clerk_user.display_name,
            platformRole: null,
            status: "active",
            clerkSyncVersion: 0,
            clerkSyncedAt: occurred_at,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          return "applied";
        }
        return monotonic_update(
          db,
          "user_profiles",
          { clerkUserId: clerk_user.id },
          {
            primaryEmail: clerk_user.primary_email,
            displayName: clerk_user.display_name,
          },
          occurred_at,
        );
      },
      async mark_user_deleted(clerk_user_id, occurred_at) {
        return monotonic_update(
          db,
          "user_profiles",
          { clerkUserId: clerk_user_id },
          { status: "deleted" },
          occurred_at,
        );
      },
      async find_tenant_id_by_clerk_org(clerk_org_id) {
        const tenant = await db
          .collection("tenants")
          .findOne({ clerkOrganizationId: clerk_org_id });
        return tenant ? tenant._id.toString() : null;
      },
      async find_profile_id_by_clerk_user(clerk_user_id) {
        const profile = await db
          .collection("user_profiles")
          .findOne({ clerkUserId: clerk_user_id });
        return profile ? profile._id.toString() : null;
      },
      async upsert_membership(membership, occurred_at) {
        // Revive keying (Plan 3 BLOCKING fix): one projection row per
        // (tenantId, userProfileId) — the unique index forbids a second row,
        // and remove→re-invite mints a NEW clerkMembershipId for the SAME
        // pair. Insert when absent; otherwise revive/update the existing row
        // under the monotonic clock guard, adopting the new Clerk id.
        const existing = await db
          .collection("tenant_membership_projections")
          .findOne({
            tenantId: membership.tenant_id,
            userProfileId: membership.user_profile_id,
          });
        if (!existing) {
          await db.collection("tenant_membership_projections").insertOne({
            clerkMembershipId: membership.clerk_membership_id,
            tenantId: membership.tenant_id,
            userProfileId: membership.user_profile_id,
            tenantRole: membership.tenant_role,
            status: membership.status,
            clerkSyncVersion: 0,
            clerkSyncedAt: occurred_at,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          return "applied";
        }
        return monotonic_update(
          db,
          "tenant_membership_projections",
          {
            tenantId: membership.tenant_id,
            userProfileId: membership.user_profile_id,
          },
          {
            clerkMembershipId: membership.clerk_membership_id,
            tenantRole: membership.tenant_role,
            status: membership.status,
          },
          occurred_at,
        );
      },
      async revoke_membership(clerk_membership_id, occurred_at) {
        return monotonic_update(
          db,
          "tenant_membership_projections",
          { clerkMembershipId: clerk_membership_id },
          { status: "revoked" },
          occurred_at,
        );
      },
      async update_invitation_status(clerk_invitation_id, status, occurred_at) {
        return monotonic_update(
          db,
          "tenant_invitation_projections",
          { clerkInvitationId: clerk_invitation_id },
          { status },
          occurred_at,
        );
      },
      async count_active_memberships(user_profile_id) {
        return db.collection("tenant_membership_projections").countDocuments({
          userProfileId: user_profile_id,
          status: "active",
        });
      },
    },
    audit: {
      async record(event) {
        await db.collection("platform_audit_events").insertOne({ ...event });
      },
    },
  };
}

/**
 * Clerk webhook ingress. Signature-verified before any parsing; duplicate
 * events acknowledge 200 without reapplying; failed applies answer 500 so
 * svix retries (receipts complete only after a successful apply).
 *
 * @param request - Incoming webhook request.
 * @returns 200 on success/duplicate, 400 on invalid signature, 500 retryable.
 */
export async function POST(request: Request): Promise<Response> {
  const client = await client_promise;
  return handle_clerk_webhook(request, production_deps(client.db()));
}
```

- [ ] **Step 5: Run the webhook + burst tests**

Run: `npm run test -- tests/provisioning/clerk-webhooks.test.ts`
Expected: PASS (9 tests).

Run: `npm run test -- tests/resilience/webhook-burst.test.ts`
Expected: FAIL with type errors — the burst fake still implements the removed deps. Fix it now: in `tests/resilience/webhook-burst.test.ts`, inside the `deps` literal, (a) add to `receipts` after `complete`:

```typescript
      async fail(event_id) {
        receipts.delete(event_id);
      },
```

and (b) replace the two removed projection fakes

```typescript
      async count_other_active_memberships() {
        return 0;
      },
      async suspend_profile_authorization() {},
```

with:

```typescript
      async count_active_memberships() {
        return 0;
      },
```

Run: `npm run test -- tests/resilience/webhook-burst.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Rewrite the invite/appoint tests (failing first)**

Replace `tests/provisioning/tenant-invitations.test.ts` entirely:

```typescript
// tests/provisioning/tenant-invitations.test.ts
import { describe, expect, it } from "vitest";

import {
  invite_tenant_user,
  suspend_tenant_user,
  type TenantMemberPorts,
} from "../../apps/ai/server/services/provisioning/invite-tenant-user";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
import { TENANT_ROLE_PERMISSIONS } from "../../packages/shared-types/src/auth";
import type { RequestPrincipal } from "../../packages/shared-types/src/auth";

const manager: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_mgr",
  internal_user_id: "507f1f77bcf86cd799439001",
  active_tenant_id: "507f1f77bcf86cd799439031",
  platform_role: null,
  tenant_role: "manager",
  permissions: TENANT_ROLE_PERMISSIONS.manager,
  membership_status: "active",
};

const student: RequestPrincipal = {
  ...manager,
  tenant_role: "user",
  permissions: TENANT_ROLE_PERMISSIONS.user,
};

/**
 * Build in-memory member-management ports. Plan 3 removed the cross-tenant
 * email lookups from this contract — compiling this fake without them is
 * itself the guard-lift regression assertion.
 */
function fake_ports() {
  const clerk_invitations: Array<{ email: string; role: string; org: string }> = [];
  const projections: any[] = [];
  const suspensions: Array<{ tenant_id: string; profile_id: string }> = [];
  const audit_events: any[] = [];

  const ports: TenantMemberPorts = {
    memberships: {
      async suspend_membership(tenant_id, user_profile_id) {
        suspensions.push({ tenant_id, profile_id: user_profile_id });
      },
    },
    invitations: {
      async upsert(tenant_id, invitation, invited_by_profile_id) {
        projections.push({ tenant_id, invitation, invited_by_profile_id });
      },
    },
    clerk: {
      async create_user_invitation(clerk_organization_id, email) {
        const invitation = {
          id: `inv_${clerk_invitations.length + 1}`,
          email,
          role: "org:member",
        };
        clerk_invitations.push({ email, role: "org:member", org: clerk_organization_id });
        return invitation;
      },
    },
    tenants: {
      async clerk_organization_id_for(tenant_id) {
        return `org_for_${tenant_id}`;
      },
    },
    audit: {
      async record(event) {
        audit_events.push(event);
      },
    },
  };

  return { ports, clerk_invitations, projections, suspensions, audit_events };
}

describe("invite_tenant_user (multi-org permitted)", () => {
  it("lets a manager invite a tenant user with the user role only", async () => {
    const world = fake_ports();
    const result = await invite_tenant_user(
      manager,
      { email: "Student@Chula.ac.th" },
      world.ports,
    );
    expect(result.invitation_id).toBe("inv_1");
    expect(world.clerk_invitations[0]).toMatchObject({
      email: "student@chula.ac.th",
      role: "org:member",
    });
    expect(world.projections).toHaveLength(1);
    expect(world.audit_events).toHaveLength(1);
  });

  it("rejects a tenant user caller", async () => {
    const world = fake_ports();
    await expect(
      invite_tenant_user(student, { email: "x@chula.ac.th" }, world.ports),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(world.clerk_invitations).toHaveLength(0);
  });

  it("invites an email that already belongs to another university (guard lifted)", async () => {
    const world = fake_ports();
    await expect(
      invite_tenant_user(manager, { email: "second-org@x.ac.th" }, world.ports),
    ).resolves.toMatchObject({ invitation_id: "inv_1" });
    expect(world.clerk_invitations).toHaveLength(1);
  });
});

describe("suspend_tenant_user", () => {
  it("lets a manager suspend a tenant user", async () => {
    const world = fake_ports();
    await suspend_tenant_user(
      manager,
      { user_profile_id: "507f1f77bcf86cd799439099" },
      world.ports,
    );
    expect(world.suspensions).toHaveLength(1);
    expect(world.audit_events.some((e) => e.action === "suspend_tenant_user")).toBe(
      true,
    );
  });

  it("rejects a tenant user caller", async () => {
    const world = fake_ports();
    await expect(
      suspend_tenant_user(
        student,
        { user_profile_id: "507f1f77bcf86cd799439099" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
```

Replace `tests/provisioning/appoint-manager.test.ts` entirely:

```typescript
// tests/provisioning/appoint-manager.test.ts
import { describe, expect, it } from "vitest";

import {
  appoint_manager,
  AlreadyTenantMemberError,
  type AppointManagerPorts,
} from "../../apps/ai/server/services/provisioning/appoint-manager";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
import { TENANT_ROLE_PERMISSIONS } from "../../packages/shared-types/src/auth";
import type { RequestPrincipal } from "../../packages/shared-types/src/auth";

const TENANT = "507f1f77bcf86cd799439031";
const OTHER_TENANT = "507f1f77bcf86cd799439099";

const platform_admin: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_platform",
  internal_user_id: "507f1f77bcf86cd799439001",
  active_tenant_id: null,
  platform_role: "admin",
  tenant_role: null,
  permissions: [],
  membership_status: null,
};

const tenant_manager: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_mgr",
  internal_user_id: "507f1f77bcf86cd799439002",
  active_tenant_id: TENANT,
  platform_role: null,
  tenant_role: "manager",
  permissions: TENANT_ROLE_PERMISSIONS.manager,
  membership_status: "active",
};

/**
 * Build in-memory appointment ports.
 *
 * @param seed - Existing memberships by normalized email and optional Clerk
 *               organization / pending invitation overrides.
 */
function fake_ports(seed: {
  memberships_by_email?: Record<string, Array<{ tenant_id: string; status: string }>>;
  clerk_organization_id?: string | null;
  pending_invitation?: { id: string; email: string; role: string };
} = {}) {
  const clerk_invitations: Array<{ email: string; role: string; org: string }> = [];
  const projections: any[] = [];
  const audit_events: any[] = [];

  const ports: AppointManagerPorts = {
    memberships: {
      async find_memberships_by_email(email) {
        return (seed.memberships_by_email?.[email] ?? []) as any;
      },
    },
    invitations: {
      async upsert(tenant_id, invitation, invited_by_profile_id) {
        projections.push({ tenant_id, invitation, invited_by_profile_id });
      },
    },
    clerk: {
      async create_manager_invitation(clerk_organization_id, email) {
        if (seed.pending_invitation && seed.pending_invitation.email === email) {
          return seed.pending_invitation;
        }
        const invitation = {
          id: `inv_${clerk_invitations.length + 1}`,
          email,
          role: "org:manager",
        };
        clerk_invitations.push({ email, role: "org:manager", org: clerk_organization_id });
        return invitation;
      },
    },
    tenants: {
      async clerk_organization_id_for(tenant_id) {
        if (seed.clerk_organization_id === null) return null;
        return seed.clerk_organization_id ?? `org_for_${tenant_id}`;
      },
    },
    audit: {
      async record(event) {
        audit_events.push(event);
      },
    },
  };

  return { ports, clerk_invitations, projections, audit_events };
}

describe("appoint_manager", () => {
  it("lets a platform admin appoint a manager with the manager role", async () => {
    const world = fake_ports();
    const result = await appoint_manager(
      platform_admin,
      { tenant_id: TENANT, email: "Dean@Chula.ac.th" },
      world.ports,
    );
    expect(result.invitation_id).toBe("inv_1");
    expect(result.role).toBe("org:manager");
    expect(world.clerk_invitations[0]).toMatchObject({
      email: "dean@chula.ac.th",
      role: "org:manager",
      org: `org_for_${TENANT}`,
    });
    expect(world.projections).toHaveLength(1);
    expect(world.audit_events[0]).toMatchObject({
      action: "appoint_manager",
      tenantId: TENANT,
      emailNormalized: "dean@chula.ac.th",
    });
  });

  it("replays onto the existing pending invitation without minting another", async () => {
    const world = fake_ports({
      pending_invitation: { id: "inv_existing", email: "dean@chula.ac.th", role: "org:manager" },
    });
    const result = await appoint_manager(
      platform_admin,
      { tenant_id: TENANT, email: "dean@chula.ac.th" },
      world.ports,
    );
    expect(result.invitation_id).toBe("inv_existing");
    expect(world.clerk_invitations).toHaveLength(0);
  });

  it("rejects a caller without a platform role before any lookup", async () => {
    const world = fake_ports();
    await expect(
      appoint_manager(
        tenant_manager,
        { tenant_id: TENANT, email: "dean@chula.ac.th" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(world.clerk_invitations).toHaveLength(0);
    expect(world.projections).toHaveLength(0);
  });

  it("appoints an email that already belongs to another university (guard lifted)", async () => {
    const world = fake_ports({
      memberships_by_email: {
        "dean@chula.ac.th": [{ tenant_id: OTHER_TENANT, status: "active" }],
      },
    });
    const result = await appoint_manager(
      platform_admin,
      { tenant_id: TENANT, email: "dean@chula.ac.th" },
      world.ports,
    );
    expect(result.invitation_id).toBe("inv_1");
  });

  it("rejects an email that is already an active member of this university", async () => {
    const world = fake_ports({
      memberships_by_email: {
        "dean@chula.ac.th": [{ tenant_id: TENANT, status: "active" }],
      },
    });
    await expect(
      appoint_manager(
        platform_admin,
        { tenant_id: TENANT, email: "dean@chula.ac.th" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(AlreadyTenantMemberError);
    expect(world.clerk_invitations).toHaveLength(0);
  });

  it("fails when the tenant has no Clerk organization", async () => {
    const world = fake_ports({ clerk_organization_id: null });
    await expect(
      appoint_manager(
        platform_admin,
        { tenant_id: TENANT, email: "dean@chula.ac.th" },
        world.ports,
      ),
    ).rejects.toThrow(/no Clerk organization/);
    expect(world.projections).toHaveLength(0);
  });
});
```

Run: `npm run test -- tests/provisioning/tenant-invitations.test.ts tests/provisioning/appoint-manager.test.ts`
Expected: FAIL — services still import/throw `MultipleMembershipsDisabledError` and the port interfaces still demand the email lookups.

- [ ] **Step 7: Rewrite the two services and clean every dependent site**

Replace `apps/ai/server/services/provisioning/invite-tenant-user.ts` entirely:

```typescript
// apps/ai/server/services/provisioning/invite-tenant-user.ts
import { z } from "zod";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_active_tenant, require_permission } from "../../auth/authorize";
import type { ManagerInvitation } from "./provisioning-types";

const invite_input_schema = z
  .object({ email: z.string().trim().toLowerCase().email() })
  .strict();

const suspend_input_schema = z
  .object({ user_profile_id: z.string().min(1) })
  .strict();

/** Ports for tenant member management; fakes in tests, MongoDB/Clerk in production. */
export interface TenantMemberPorts {
  readonly memberships: {
    suspend_membership(tenant_id: string, user_profile_id: string): Promise<void>;
  };
  readonly invitations: {
    upsert(
      tenant_id: string,
      invitation: ManagerInvitation,
      invited_by_profile_id: string,
    ): Promise<void>;
  };
  readonly clerk: {
    create_user_invitation(
      clerk_organization_id: string,
      email: string,
    ): Promise<ManagerInvitation>;
  };
  readonly tenants: {
    clerk_organization_id_for(tenant_id: string): Promise<string | null>;
  };
  readonly audit: {
    record(event: Record<string, unknown> & { action: string }): Promise<void>;
  };
}

/**
 * Invite a student (tenant user) into the manager's university. Managers can
 * only ever grant the user role through this path — manager appointments are
 * a platform operation. Multi-org membership is permitted (Plan 3): an email
 * holding memberships elsewhere is invited normally; Clerk's own
 * duplicate-pending rejection is translated by the production port.
 *
 * @param actor - Verified tenant principal (requires tenant:members:invite_user).
 * @param raw_input - Invitation input ({ email }).
 * @param ports - Member-management ports.
 * @returns Created invitation ID.
 * @throws AuthorizationError when the caller lacks the permission.
 * @throws DuplicatePendingInvitationError (from the port) when already pending.
 */
export async function invite_tenant_user(
  actor: RequestPrincipal,
  raw_input: { email: string },
  ports: TenantMemberPorts,
): Promise<{ invitation_id: string }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:invite_user");
  const input = invite_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({ boundary: "tenant-members", event: "invite.start", tenant_id });

  const clerk_organization_id =
    await ports.tenants.clerk_organization_id_for(tenant_id);
  if (!clerk_organization_id) {
    throw new Error("The tenant has no Clerk organization; provisioning is incomplete.");
  }

  // The user role is always passed to Clerk; this path can never mint a manager.
  const invitation = await ports.clerk.create_user_invitation(
    clerk_organization_id,
    input.email,
  );
  await ports.invitations.upsert(tenant_id, invitation, actor.internal_user_id);
  await ports.audit.record({
    action: "invite_tenant_user",
    tenantId: tenant_id,
    emailNormalized: input.email,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "tenant-members",
    event: "invite.done",
    tenant_id,
    invitation_id: invitation.id,
  });
  return { invitation_id: invitation.id };
}

/**
 * Suspend a tenant user's membership in the manager's university. The
 * projection is suspended immediately; Clerk-side revocation is reconciled
 * by webhooks/reconcile-clerk.
 *
 * @param actor - Verified tenant principal (requires tenant:members:suspend_user).
 * @param raw_input - Suspension input ({ user_profile_id }).
 * @param ports - Member-management ports.
 */
export async function suspend_tenant_user(
  actor: RequestPrincipal,
  raw_input: { user_profile_id: string },
  ports: TenantMemberPorts,
): Promise<{ success: true }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:suspend_user");
  const input = suspend_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;

  await ports.memberships.suspend_membership(tenant_id, input.user_profile_id);
  await ports.audit.record({
    action: "suspend_tenant_user",
    tenantId: tenant_id,
    userProfileId: input.user_profile_id,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  return { success: true };
}
```

Replace `apps/ai/server/services/provisioning/appoint-manager.ts` entirely:

```typescript
// apps/ai/server/services/provisioning/appoint-manager.ts
import { z } from "zod";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_platform_admin } from "../../auth/authorize";
import type { ManagerInvitation } from "./provisioning-types";

/**
 * Raised when the appointee already holds an active membership in the target
 * university. Appointment is an invitation flow; role changes for existing
 * members go through platformTenants.demoteManager / reconciliation, not a
 * silent re-invite.
 */
export class AlreadyTenantMemberError extends Error {
  readonly code = "ALREADY_TENANT_MEMBER";

  constructor(email: string) {
    super(
      `ALREADY_TENANT_MEMBER: ${email} already holds an active membership in this university.`,
    );
    this.name = "AlreadyTenantMemberError";
  }
}

const appoint_input_schema = z
  .object({
    tenant_id: z.string().min(1),
    email: z.string().trim().toLowerCase().email(),
  })
  .strict();

/** Ports for platform manager appointment; fakes in tests, MongoDB/Clerk in production. */
export interface AppointManagerPorts {
  readonly memberships: {
    find_memberships_by_email(
      email: string,
    ): Promise<Array<{ tenant_id: string; status: string }>>;
  };
  readonly invitations: {
    upsert(
      tenant_id: string,
      invitation: ManagerInvitation,
      invited_by_profile_id: string,
    ): Promise<void>;
  };
  readonly clerk: {
    create_manager_invitation(
      clerk_organization_id: string,
      email: string,
    ): Promise<ManagerInvitation>;
  };
  readonly tenants: {
    clerk_organization_id_for(tenant_id: string): Promise<string | null>;
  };
  readonly audit: {
    record(event: Record<string, unknown> & { action: string }): Promise<void>;
  };
}

/**
 * Appoint a university manager. Platform-only by plan: tenant managers can
 * never mint managers (their invite path always passes the user role), so
 * this operation asserts a platform role even though the router also gates
 * it. Multi-org membership is permitted (Plan 3): memberships at OTHER
 * universities no longer block appointment — only an existing active
 * membership in THIS university does. The Clerk port stays idempotent over
 * pending invitations.
 *
 * @param actor - Verified principal; must hold a platform role.
 * @param raw_input - Appointment input ({ tenant_id, email }).
 * @param ports - Appointment ports (memberships, invitations, Clerk, tenants, audit).
 * @returns Created or reused invitation ID and its Clerk manager role.
 * @throws AuthorizationError when the actor holds no platform role.
 * @throws AlreadyTenantMemberError when the email is already an active member here.
 * @throws Error when the tenant has no Clerk organization.
 */
export async function appoint_manager(
  actor: RequestPrincipal,
  raw_input: { tenant_id: string; email: string },
  ports: AppointManagerPorts,
): Promise<{ invitation_id: string; role: string }> {
  require_platform_admin(actor);
  const input = appoint_input_schema.parse(raw_input);

  const memberships = await ports.memberships.find_memberships_by_email(input.email);
  const already_member = memberships.some(
    (record) =>
      record.tenant_id === input.tenant_id && record.status === "active",
  );
  if (already_member) {
    throw new AlreadyTenantMemberError(input.email);
  }

  const clerk_organization_id =
    await ports.tenants.clerk_organization_id_for(input.tenant_id);
  if (!clerk_organization_id) {
    throw new Error(
      "The tenant has no Clerk organization; provisioning is incomplete.",
    );
  }

  const invitation = await ports.clerk.create_manager_invitation(
    clerk_organization_id,
    input.email,
  );
  await ports.invitations.upsert(
    input.tenant_id,
    invitation,
    actor.internal_user_id,
  );
  await ports.audit.record({
    action: "appoint_manager",
    tenantId: input.tenant_id,
    emailNormalized: input.email,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "platform-tenants",
    event: "manager.appointed",
    tenant_id: input.tenant_id,
    invitation_id: invitation.id,
  });
  return { invitation_id: invitation.id, role: invitation.role };
}
```

Now clean the dependent sites:

**(a) `apps/ai/server/routers/platform-tenants.ts`** — delete the import line

```typescript
import { MultipleMembershipsDisabledError } from "../services/provisioning/invite-tenant-user";
```

and in `appointManager`'s catch, replace

```typescript
        if (
          error instanceof MultipleMembershipsDisabledError ||
          error instanceof AlreadyTenantMemberError
        ) {
```

with

```typescript
        if (error instanceof AlreadyTenantMemberError) {
```

**(b) `apps/ai/server/routers/tenant-members.ts`** — replace the invite import block

```typescript
import {
  invite_tenant_user,
  suspend_tenant_user,
  MultipleMembershipsDisabledError,
} from "../services/provisioning/invite-tenant-user";
```

with

```typescript
import {
  invite_tenant_user,
  suspend_tenant_user,
} from "../services/provisioning/invite-tenant-user";
```

delete the now-unused `import { TRPCError } from "@trpc/server";` line, and replace the `inviteUser` mutation body's try/catch with a direct call:

```typescript
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      return invite_tenant_user(
        ctx.principal,
        { email: input.email ?? "" },
        create_production_member_ports(client.db()),
      );
    }),
```

(Task 4 reinstates a catch for the duplicate-pending CONFLICT mapping.)

**(c) `apps/ai/server/services/provisioning/production-member-ports.ts`** — delete the whole `find_invitations_by_email` method from the `invitations` literal of `create_production_member_ports` (it is now an excess property against the trimmed interfaces):

```typescript
      async find_invitations_by_email(email) {
        const invitations = await db
          .collection("tenant_invitation_projections")
          .find({ emailNormalized: email })
          .toArray();
        return invitations.map((invitation) => ({
          tenant_id: String(invitation.tenantId),
          status: String(invitation.status),
        }));
      },
```

**(d) `apps/ai/server/services/provisioning/reconcile-clerk.ts`** — in `reconcile_tenant`, replace the missing-projection `insertOne` block

```typescript
      // Safe repair: Clerk is authoritative for membership existence.
      await db.collection("tenant_membership_projections").insertOne({
        clerkMembershipId: membership.id,
        tenantId: tenant_id,
        userProfileId: profile._id.toString(),
        tenantRole: role,
        status: "active",
        clerkSyncVersion: 0,
        clerkSyncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
```

with the revive-keyed upsert:

```typescript
      // Safe repair: Clerk is authoritative for membership existence. Keyed
      // by (tenantId, userProfileId) with revive semantics — a revoked
      // projection for the same pair is revived under the new Clerk
      // membership id instead of violating uniq_membership_tenant_profile.
      await db.collection("tenant_membership_projections").updateOne(
        { tenantId: tenant_id, userProfileId: profile._id.toString() },
        {
          $set: {
            clerkMembershipId: membership.id,
            tenantRole: role,
            status: "active",
            clerkSyncedAt: new Date(),
            updatedAt: new Date(),
          },
          $setOnInsert: {
            clerkSyncVersion: 0,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
```

and change that finding's `detail` to `` `Created or revived projection with role ${role}.` ``.

- [ ] **Step 8: Run the rewritten service tests + full suite**

Run: `npm run test -- tests/provisioning/tenant-invitations.test.ts tests/provisioning/appoint-manager.test.ts`
Expected: PASS (5 + 6 tests).

Run: `npm run test`
Expected: PASS across the board — this catches any remaining reference to the removed symbols (`rtk grep "MultipleMembershipsDisabledError|count_other_active_memberships|suspend_profile_authorization|find_invitations_by_email" apps tests packages` must return NO hits outside `.next` build artifacts).

- [ ] **Step 9: Commit**

```bash
git add apps/ai/server/services/provisioning/apply-clerk-event.ts \
        apps/ai/server/services/provisioning/invite-tenant-user.ts \
        apps/ai/server/services/provisioning/appoint-manager.ts \
        apps/ai/server/services/provisioning/production-member-ports.ts \
        apps/ai/server/services/provisioning/reconcile-clerk.ts \
        apps/ai/server/routers/platform-tenants.ts \
        apps/ai/server/routers/tenant-members.ts \
        apps/web/app/api/webhooks/clerk/route.ts \
        tests/provisioning/clerk-webhooks.test.ts \
        tests/provisioning/tenant-invitations.test.ts \
        tests/provisioning/appoint-manager.test.ts \
        tests/resilience/webhook-burst.test.ts
git commit -m "feat: lift single-membership rule — revive-keyed projections, retryable webhook receipts, multi-org audit"
```

---
## Task 4: Invitations trio — `listInvitations`, `revokeInvitation`, `resendInvitation` (+ duplicate-invite CONFLICT)

Spec §4.2 table: `listInvitations` reads the projection (source of truth) and derives the *expired* display state (`createdAt` + TTL, default 30 days — `expiresAt` is not stored); `revokeInvitation` calls Clerk then marks the projection; `resendInvitation` is revoke + create, audited as a resend. Tenant managers act on **user** invitations only. `inviteUser` maps Clerk's duplicate-pending error (translated by the Task 2 port) to CONFLICT with a human message. This task also creates the shared error mapper and the shared fake-ports helper reused by Tasks 5–6.

**Files:**
- Create: `apps/ai/server/services/provisioning/manage-invitations.ts`
- Create: `apps/ai/server/routers/member-admin-errors.ts`
- Create: `tests/provisioning/helpers/fake-member-admin-ports.ts`
- Modify: `apps/ai/server/routers/tenant-members.ts`
- Test: `tests/provisioning/manage-invitations.test.ts`

- [ ] **Step 1: Create the shared fake-ports test helper**

```typescript
// tests/provisioning/helpers/fake-member-admin-ports.ts
/**
 * Shared in-memory MemberAdminPorts fake + principal fixtures for the Plan 3
 * member-admin service tests (Tasks 4-6). Created in Task 4; read-only for
 * later tasks.
 */
import type {
  InvitationView,
  MemberAdminPorts,
  MembershipView,
} from "../../../apps/ai/server/services/provisioning/member-admin-ports";
import type { ManagerInvitation } from "../../../apps/ai/server/services/provisioning/provisioning-types";
import { TENANT_ROLE_PERMISSIONS } from "../../../packages/shared-types/src/auth";
import type { RequestPrincipal } from "../../../packages/shared-types/src/auth";

export const TENANT = "507f1f77bcf86cd799439031";
export const OTHER_TENANT = "507f1f77bcf86cd799439099";

/** Tenant manager principal fixture for TENANT. */
export const manager_principal: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_mgr",
  internal_user_id: "507f1f77bcf86cd799439001",
  active_tenant_id: TENANT,
  platform_role: null,
  tenant_role: "manager",
  permissions: TENANT_ROLE_PERMISSIONS.manager,
  membership_status: "active",
};

/** Tenant user (student) principal fixture for TENANT. */
export const student_principal: RequestPrincipal = {
  ...manager_principal,
  provider_user_id: "user_student",
  internal_user_id: "507f1f77bcf86cd799439002",
  tenant_role: "user",
  permissions: TENANT_ROLE_PERMISSIONS.user,
};

/** Platform admin principal fixture (no tenant context). */
export const platform_admin_principal: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_platform",
  internal_user_id: "507f1f77bcf86cd799439003",
  active_tenant_id: null,
  platform_role: "admin",
  tenant_role: null,
  permissions: [],
  membership_status: null,
};

/** Mutable world exposed alongside the fake ports. */
export interface FakeMemberAdminWorld {
  ports: MemberAdminPorts;
  memberships: Map<string, { tenant_role: MembershipView["tenant_role"]; status: MembershipView["status"] }>;
  profiles: Map<string, string>;
  invitations: Map<string, InvitationView & { tenant_id: string }>;
  clerk_calls: Array<{ method: string; args: unknown[] }>;
  audit_events: Array<Record<string, unknown> & { action: string }>;
  upserted_invitations: Array<{
    tenant_id: string;
    invitation: ManagerInvitation;
    invited_by_profile_id: string;
  }>;
  fail_clerk: {
    remove_membership?: boolean;
    update_membership_role?: boolean;
    revoke_invitation?: boolean;
  };
}

/**
 * Membership map key mirroring the production (tenantId, userProfileId) keying.
 *
 * @param tenant_id - Internal tenant id.
 * @param user_profile_id - Internal profile id.
 * @returns Composite map key.
 */
export function membership_key(tenant_id: string, user_profile_id: string): string {
  return `${tenant_id}:${user_profile_id}`;
}

/**
 * Build the in-memory member-admin world.
 *
 * @returns Fake ports plus every observable side-effect store.
 */
export function fake_member_admin_world(): FakeMemberAdminWorld {
  const memberships: FakeMemberAdminWorld["memberships"] = new Map();
  const profiles = new Map<string, string>();
  const invitations: FakeMemberAdminWorld["invitations"] = new Map();
  const clerk_calls: FakeMemberAdminWorld["clerk_calls"] = [];
  const audit_events: FakeMemberAdminWorld["audit_events"] = [];
  const upserted_invitations: FakeMemberAdminWorld["upserted_invitations"] = [];
  const fail_clerk: FakeMemberAdminWorld["fail_clerk"] = {};
  let invitation_sequence = 0;

  const ports: MemberAdminPorts = {
    memberships: {
      async find_membership(tenant_id, user_profile_id) {
        return memberships.get(membership_key(tenant_id, user_profile_id)) ?? null;
      },
      async set_membership_status(tenant_id, user_profile_id, status) {
        const key = membership_key(tenant_id, user_profile_id);
        const existing = memberships.get(key);
        if (existing) memberships.set(key, { ...existing, status });
      },
      async set_membership_role(tenant_id, user_profile_id, role) {
        const key = membership_key(tenant_id, user_profile_id);
        const existing = memberships.get(key);
        if (existing) memberships.set(key, { ...existing, tenant_role: role });
      },
      async count_active_managers(tenant_id) {
        return [...memberships.entries()].filter(
          ([key, value]) =>
            key.startsWith(`${tenant_id}:`) &&
            value.tenant_role === "manager" &&
            value.status === "active",
        ).length;
      },
      async touch_tenant_for_invariant() {},
    },
    profiles: {
      async find_profile_status(user_profile_id) {
        return profiles.get(user_profile_id) ?? null;
      },
    },
    invitations: {
      async find_by_clerk_id(tenant_id, clerk_invitation_id) {
        const invitation = invitations.get(clerk_invitation_id);
        return invitation && invitation.tenant_id === tenant_id ? invitation : null;
      },
      async mark_status(tenant_id, clerk_invitation_id, status) {
        const invitation = invitations.get(clerk_invitation_id);
        if (invitation && invitation.tenant_id === tenant_id) {
          invitations.set(clerk_invitation_id, { ...invitation, status });
        }
      },
      async upsert(tenant_id, invitation, invited_by_profile_id) {
        upserted_invitations.push({ tenant_id, invitation, invited_by_profile_id });
      },
    },
    clerk: {
      async create_user_invitation(clerk_organization_id, email) {
        clerk_calls.push({
          method: "create_user_invitation",
          args: [clerk_organization_id, email],
        });
        invitation_sequence += 1;
        return { id: `inv_new_${invitation_sequence}`, email, role: "org:user" };
      },
      async revoke_invitation(tenant_id, clerk_invitation_id) {
        if (fail_clerk.revoke_invitation) throw new Error("clerk revoke failed");
        clerk_calls.push({
          method: "revoke_invitation",
          args: [tenant_id, clerk_invitation_id],
        });
      },
      async remove_membership(tenant_id, user_profile_id) {
        if (fail_clerk.remove_membership) throw new Error("clerk remove failed");
        clerk_calls.push({
          method: "remove_membership",
          args: [tenant_id, user_profile_id],
        });
      },
      async update_membership_role(tenant_id, user_profile_id, role) {
        if (fail_clerk.update_membership_role) {
          throw new Error("clerk role update failed");
        }
        clerk_calls.push({
          method: "update_membership_role",
          args: [tenant_id, user_profile_id, role],
        });
      },
    },
    tenants: {
      async clerk_organization_id_for(tenant_id) {
        return `org_for_${tenant_id}`;
      },
    },
    transactions: {
      async run(operation) {
        return operation(undefined);
      },
    },
    audit: {
      async record(event) {
        audit_events.push(event);
      },
    },
  };

  return {
    ports,
    memberships,
    profiles,
    invitations,
    clerk_calls,
    audit_events,
    upserted_invitations,
    fail_clerk,
  };
}
```

- [ ] **Step 2: Write the failing service tests**

```typescript
// tests/provisioning/manage-invitations.test.ts
import { afterEach, describe, expect, it } from "vitest";

import {
  derive_invitation_display,
  invitation_ttl_days,
  resend_tenant_invitation,
  revoke_tenant_invitation,
} from "../../apps/ai/server/services/provisioning/manage-invitations";
import {
  InvitationNotFoundError,
  InvitationNotPendingError,
  ManagerActionForbiddenError,
} from "../../apps/ai/server/services/provisioning/member-admin-ports";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
import {
  TENANT,
  fake_member_admin_world,
  manager_principal,
  student_principal,
} from "./helpers/fake-member-admin-ports";

const NOW = new Date("2026-07-29T00:00:00Z");

/** Seed one pending user invitation into the fake world. */
function seed_invitation(
  world: ReturnType<typeof fake_member_admin_world>,
  overrides: Partial<{
    clerk_invitation_id: string;
    tenant_role: "manager" | "user";
    status: string;
    created_at: Date;
  }> = {},
) {
  const id = overrides.clerk_invitation_id ?? "inv_1";
  world.invitations.set(id, {
    tenant_id: TENANT,
    clerk_invitation_id: id,
    email: "pending@x.ac.th",
    tenant_role: overrides.tenant_role ?? "user",
    status: overrides.status ?? "invited",
    created_at: overrides.created_at ?? NOW,
  });
  return id;
}

afterEach(() => {
  delete process.env.CLERK_INVITATION_TTL_DAYS;
});

describe("revoke_tenant_invitation", () => {
  it("revokes a pending user invitation via Clerk and marks the projection", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world);
    const result = await revoke_tenant_invitation(
      manager_principal,
      { clerk_invitation_id: "inv_1" },
      world.ports,
    );
    expect(result).toEqual({ success: true });
    expect(world.clerk_calls).toEqual([
      { method: "revoke_invitation", args: [TENANT, "inv_1"] },
    ]);
    expect(world.invitations.get("inv_1")?.status).toBe("revoked");
    expect(world.audit_events[0]).toMatchObject({
      action: "revoke_tenant_invitation",
      tenantId: TENANT,
      clerkInvitationId: "inv_1",
    });
  });

  it("is idempotent over an already-revoked invitation (no Clerk call)", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world, { status: "revoked" });
    await expect(
      revoke_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).resolves.toEqual({ success: true });
    expect(world.clerk_calls).toHaveLength(0);
  });

  it("refuses a manager invitation — manager lifecycle is platform-scope", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world, { tenant_role: "manager" });
    await expect(
      revoke_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(ManagerActionForbiddenError);
  });

  it("rejects an unknown invitation with NOT_FOUND semantics", async () => {
    const world = fake_member_admin_world();
    await expect(
      revoke_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_missing" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it("rejects an accepted invitation as not pending", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world, { status: "active" });
    await expect(
      revoke_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(InvitationNotPendingError);
  });

  it("rejects a tenant user caller", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world);
    await expect(
      revoke_tenant_invitation(
        student_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("resend_tenant_invitation", () => {
  it("revokes the old invitation, mints a replacement, and audits the resend", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world);
    const result = await resend_tenant_invitation(
      manager_principal,
      { clerk_invitation_id: "inv_1" },
      world.ports,
    );
    expect(result).toEqual({ invitation_id: "inv_new_1" });
    expect(world.clerk_calls).toEqual([
      { method: "revoke_invitation", args: [TENANT, "inv_1"] },
      { method: "create_user_invitation", args: [`org_for_${TENANT}`, "pending@x.ac.th"] },
    ]);
    expect(world.invitations.get("inv_1")?.status).toBe("revoked");
    expect(world.upserted_invitations[0]).toMatchObject({
      tenant_id: TENANT,
      invitation: { id: "inv_new_1", email: "pending@x.ac.th" },
    });
    expect(world.audit_events[0]).toMatchObject({
      action: "resend_tenant_invitation",
      revokedClerkInvitationId: "inv_1",
      clerkInvitationId: "inv_new_1",
    });
  });

  it("rejects resending a non-pending invitation", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world, { status: "revoked" });
    await expect(
      resend_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(InvitationNotPendingError);
  });

  it("refuses manager invitations", async () => {
    const world = fake_member_admin_world();
    seed_invitation(world, { tenant_role: "manager" });
    await expect(
      resend_tenant_invitation(
        manager_principal,
        { clerk_invitation_id: "inv_1" },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(ManagerActionForbiddenError);
  });
});

describe("expired display derivation", () => {
  it("marks a pending invitation expired after the TTL and not before", () => {
    const invitation = {
      clerk_invitation_id: "inv_1",
      email: "pending@x.ac.th",
      tenant_role: "user" as const,
      status: "invited",
      created_at: new Date("2026-06-28T00:00:00Z"), // 31 days before NOW
    };
    expect(derive_invitation_display(invitation, NOW, 30)).toEqual({ is_expired: true });
    expect(
      derive_invitation_display(
        { ...invitation, created_at: new Date("2026-07-01T00:00:00Z") },
        NOW,
        30,
      ),
    ).toEqual({ is_expired: false });
    expect(
      derive_invitation_display({ ...invitation, status: "revoked" }, NOW, 30),
    ).toEqual({ is_expired: false });
  });

  it("reads the TTL from CLERK_INVITATION_TTL_DAYS with a 30-day default", () => {
    expect(invitation_ttl_days()).toBe(30);
    process.env.CLERK_INVITATION_TTL_DAYS = "45";
    expect(invitation_ttl_days()).toBe(45);
    process.env.CLERK_INVITATION_TTL_DAYS = "not-a-number";
    expect(invitation_ttl_days()).toBe(30);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- tests/provisioning/manage-invitations.test.ts`
Expected: FAIL — `manage-invitations.ts` does not exist.

- [ ] **Step 4: Implement the invitation services**

```typescript
// apps/ai/server/services/provisioning/manage-invitations.ts
import { z } from "zod";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_active_tenant, require_permission } from "../../auth/authorize";
import {
  InvitationNotFoundError,
  InvitationNotPendingError,
  ManagerActionForbiddenError,
  type InvitationView,
  type MemberAdminPorts,
} from "./member-admin-ports";

const invitation_input_schema = z
  .object({ clerk_invitation_id: z.string().min(1) })
  .strict();

const DEFAULT_INVITATION_TTL_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Clerk invitation TTL in days used ONLY for the expired display state
 * (Clerk defaults to 30 days; expiresAt is not stored on the projection).
 *
 * @returns CLERK_INVITATION_TTL_DAYS when a positive number, else 30.
 */
export function invitation_ttl_days(): number {
  const raw = Number(process.env.CLERK_INVITATION_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INVITATION_TTL_DAYS;
}

/**
 * Derive the display-only expiry state of an invitation projection.
 *
 * @param invitation - Invitation projection view.
 * @param now - Reference time (injected for determinism).
 * @param ttl_days - Invitation TTL in days (see invitation_ttl_days).
 * @returns is_expired true only for a pending invitation past its TTL.
 */
export function derive_invitation_display(
  invitation: InvitationView,
  now: Date,
  ttl_days: number,
): { is_expired: boolean } {
  if (invitation.status !== "invited") return { is_expired: false };
  const expires_at =
    invitation.created_at.getTime() + ttl_days * MILLISECONDS_PER_DAY;
  return { is_expired: now.getTime() > expires_at };
}

/**
 * Load a USER invitation in the caller's tenant or raise the typed error.
 * Manager invitations are platform-scope and are refused here.
 *
 * @param ports - Member-admin ports.
 * @param tenant_id - Caller's tenant.
 * @param clerk_invitation_id - Target invitation id.
 * @returns Invitation view.
 * @throws InvitationNotFoundError / ManagerActionForbiddenError.
 */
async function required_user_invitation(
  ports: MemberAdminPorts,
  tenant_id: string,
  clerk_invitation_id: string,
): Promise<InvitationView> {
  const invitation = await ports.invitations.find_by_clerk_id(
    tenant_id,
    clerk_invitation_id,
  );
  if (!invitation) throw new InvitationNotFoundError(clerk_invitation_id);
  if (invitation.tenant_role === "manager") throw new ManagerActionForbiddenError();
  return invitation;
}

/**
 * Revoke a pending user invitation: Clerk first (tolerant of already-dead
 * invitations at the port), then the projection, then the audit trail.
 * Idempotent over already-revoked invitations.
 *
 * @param actor - Verified tenant principal (requires tenant:members:invite_user).
 * @param raw_input - ({ clerk_invitation_id }).
 * @param ports - Member-admin ports.
 * @returns Success marker.
 * @throws AuthorizationError, InvitationNotFoundError,
 *         ManagerActionForbiddenError, InvitationNotPendingError.
 */
export async function revoke_tenant_invitation(
  actor: RequestPrincipal,
  raw_input: { clerk_invitation_id: string },
  ports: MemberAdminPorts,
): Promise<{ success: true }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:invite_user");
  const input = invitation_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({
    boundary: "manage-invitations",
    event: "invitation.revoke.start",
    tenant_id,
    clerk_invitation_id: input.clerk_invitation_id,
  });

  const invitation = await required_user_invitation(
    ports,
    tenant_id,
    input.clerk_invitation_id,
  );
  if (invitation.status === "revoked") return { success: true };
  if (invitation.status !== "invited") {
    throw new InvitationNotPendingError(input.clerk_invitation_id, invitation.status);
  }

  await ports.clerk.revoke_invitation(tenant_id, input.clerk_invitation_id);
  await ports.invitations.mark_status(tenant_id, input.clerk_invitation_id, "revoked");
  await ports.audit.record({
    action: "revoke_tenant_invitation",
    tenantId: tenant_id,
    clerkInvitationId: input.clerk_invitation_id,
    emailNormalized: invitation.email,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "manage-invitations",
    event: "invitation.revoke.done",
    tenant_id,
    clerk_invitation_id: input.clerk_invitation_id,
  });
  return { success: true };
}

/**
 * Resend a pending user invitation: revoke the old one (Clerk + projection),
 * mint a replacement with the SAME email and the user role, project it, and
 * audit the pair as one resend.
 *
 * @param actor - Verified tenant principal (requires tenant:members:invite_user).
 * @param raw_input - ({ clerk_invitation_id }) of the invitation to replace.
 * @param ports - Member-admin ports.
 * @returns Replacement invitation ID.
 * @throws AuthorizationError, InvitationNotFoundError,
 *         ManagerActionForbiddenError, InvitationNotPendingError, and Error
 *         when the tenant has no Clerk organization.
 */
export async function resend_tenant_invitation(
  actor: RequestPrincipal,
  raw_input: { clerk_invitation_id: string },
  ports: MemberAdminPorts,
): Promise<{ invitation_id: string }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:invite_user");
  const input = invitation_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({
    boundary: "manage-invitations",
    event: "invitation.resend.start",
    tenant_id,
    clerk_invitation_id: input.clerk_invitation_id,
  });

  const invitation = await required_user_invitation(
    ports,
    tenant_id,
    input.clerk_invitation_id,
  );
  if (invitation.status !== "invited") {
    throw new InvitationNotPendingError(input.clerk_invitation_id, invitation.status);
  }

  const clerk_organization_id =
    await ports.tenants.clerk_organization_id_for(tenant_id);
  if (!clerk_organization_id) {
    throw new Error("The tenant has no Clerk organization; provisioning is incomplete.");
  }

  await ports.clerk.revoke_invitation(tenant_id, input.clerk_invitation_id);
  await ports.invitations.mark_status(tenant_id, input.clerk_invitation_id, "revoked");
  const replacement = await ports.clerk.create_user_invitation(
    clerk_organization_id,
    invitation.email,
  );
  await ports.invitations.upsert(tenant_id, replacement, actor.internal_user_id);
  await ports.audit.record({
    action: "resend_tenant_invitation",
    tenantId: tenant_id,
    revokedClerkInvitationId: input.clerk_invitation_id,
    clerkInvitationId: replacement.id,
    emailNormalized: invitation.email,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "manage-invitations",
    event: "invitation.resend.done",
    tenant_id,
    clerk_invitation_id: replacement.id,
  });
  return { invitation_id: replacement.id };
}
```

- [ ] **Step 5: Create the router-side error mapper**

```typescript
// apps/ai/server/routers/member-admin-errors.ts
import { TRPCError } from "@trpc/server";

import {
  DuplicatePendingInvitationError,
  InvitationNotFoundError,
  InvitationNotPendingError,
  LastManagerError,
  ManagerActionForbiddenError,
  MemberNotFoundError,
  ProfileInactiveError,
} from "../services/provisioning/member-admin-ports";

/**
 * Translate a typed member-admin domain failure into the equivalent tRPC
 * transport error. Unknown errors are rethrown untouched so unexpected
 * failures still surface as 500s.
 *
 * @param error - Error thrown by a member-admin service call.
 * @returns Never returns; always throws.
 * @throws TRPCError for typed domain failures, otherwise the original error.
 */
export function throw_member_admin_error(error: unknown): never {
  if (
    error instanceof MemberNotFoundError ||
    error instanceof InvitationNotFoundError
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof ManagerActionForbiddenError) {
    throw new TRPCError({ code: "FORBIDDEN", message: error.message });
  }
  if (
    error instanceof ProfileInactiveError ||
    error instanceof InvitationNotPendingError ||
    error instanceof DuplicatePendingInvitationError ||
    error instanceof LastManagerError
  ) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw error;
}
```

- [ ] **Step 6: Wire the router**

Replace `apps/ai/server/routers/tenant-members.ts` entirely (state after Task 4 — `list`/`suspendUser` unchanged from Task 3; new invitation procedures; `inviteUser` regains a catch):

```typescript
// apps/ai/server/routers/tenant-members.ts
import { z } from "zod";
import { ObjectId } from "mongodb";
import client_promise from "@rnd-ai/shared-database";

import { router, tenantProcedure } from "../trpc";
import {
  invite_tenant_user,
  suspend_tenant_user,
} from "../services/provisioning/invite-tenant-user";
import {
  derive_invitation_display,
  invitation_ttl_days,
  resend_tenant_invitation,
  revoke_tenant_invitation,
} from "../services/provisioning/manage-invitations";
import {
  create_production_member_admin_ports,
  create_production_member_ports,
} from "../services/provisioning/production-member-ports";
import { throw_member_admin_error } from "./member-admin-errors";

/**
 * University member administration. Managers list, invite students, manage
 * invitations, and suspend users; manager appointment/demotion is a platform
 * operation and is rejected here by construction (the invite path always
 * passes the user role).
 */
export const tenantMembersRouter = router({
  /**
   * List membership projections for the caller's university.
   */
  list: tenantProcedure("tenant:members:read").query(async ({ ctx }) => {
    const client = await client_promise;
    const db = client.db();
    // Identity-domain projection read, scoped by the verified tenant context.
    const memberships = await db
      .collection("tenant_membership_projections")
      .find({ tenantId: ctx.tenant_context.tenant_id })
      .sort({ createdAt: -1 })
      .toArray();
    const profile_ids = memberships
      .map((m) => String(m.userProfileId))
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));
    const profiles = await db
      .collection("user_profiles")
      .find({ _id: { $in: profile_ids } })
      .project({ primaryEmail: 1, displayName: 1, status: 1 })
      .toArray();
    const profile_map = new Map(profiles.map((p) => [p._id.toString(), p]));
    return memberships.map((membership) => ({
      _id: membership._id.toString(),
      userProfileId: String(membership.userProfileId),
      tenantRole: membership.tenantRole,
      status: membership.status,
      email: profile_map.get(String(membership.userProfileId))?.primaryEmail ?? "",
      displayName:
        profile_map.get(String(membership.userProfileId))?.displayName ?? "",
    }));
  }),

  /**
   * List invitation projections for the caller's university with the derived
   * expired display state (projection is the source; Clerk's ~TTL applied to
   * createdAt because expiresAt is not stored).
   */
  listInvitations: tenantProcedure("tenant:members:read").query(async ({ ctx }) => {
    const client = await client_promise;
    const db = client.db();
    const ttl_days = invitation_ttl_days();
    const now = new Date();
    const invitations = await db
      .collection("tenant_invitation_projections")
      .find({ tenantId: ctx.tenant_context.tenant_id })
      .sort({ createdAt: -1 })
      .toArray();
    return invitations.map((invitation) => {
      const view = {
        clerk_invitation_id: String(invitation.clerkInvitationId),
        email: String(invitation.emailNormalized),
        tenant_role:
          invitation.tenantRole === "manager"
            ? ("manager" as const)
            : ("user" as const),
        status: String(invitation.status),
        created_at:
          invitation.createdAt instanceof Date ? invitation.createdAt : new Date(0),
      };
      return {
        _id: invitation._id.toString(),
        clerkInvitationId: view.clerk_invitation_id,
        email: view.email,
        tenantRole: view.tenant_role,
        status: view.status,
        createdAt: view.created_at,
        isExpired: derive_invitation_display(view, now, ttl_days).is_expired,
      };
    });
  }),

  /**
   * Invite a student into the caller's university (user role only). Clerk's
   * duplicate-pending rejection surfaces as CONFLICT with a human message.
   */
  inviteUser: tenantProcedure("tenant:members:invite_user")
    .input(z.object({ email: z.string().email() }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await invite_tenant_user(
          ctx.principal,
          { email: input.email ?? "" },
          create_production_member_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),

  /**
   * Revoke a pending user invitation (Clerk + projection, audited).
   */
  revokeInvitation: tenantProcedure("tenant:members:invite_user")
    .input(z.object({ clerk_invitation_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await revoke_tenant_invitation(
          ctx.principal,
          input,
          create_production_member_admin_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),

  /**
   * Resend a pending user invitation (revoke + create, audited as a resend).
   */
  resendInvitation: tenantProcedure("tenant:members:invite_user")
    .input(z.object({ clerk_invitation_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await resend_tenant_invitation(
          ctx.principal,
          input,
          create_production_member_admin_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),

  /**
   * Suspend a user's membership in the caller's university.
   */
  suspendUser: tenantProcedure("tenant:members:suspend_user")
    .input(z.object({ user_profile_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      return suspend_tenant_user(
        ctx.principal,
        { user_profile_id: input.user_profile_id ?? "" },
        create_production_member_ports(client.db()),
      );
    }),
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -- tests/provisioning/manage-invitations.test.ts`
Expected: PASS (11 tests). Then `npm run test -- tests/provisioning` — all provisioning suites PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/ai/server/services/provisioning/manage-invitations.ts \
        apps/ai/server/routers/member-admin-errors.ts \
        apps/ai/server/routers/tenant-members.ts \
        tests/provisioning/helpers/fake-member-admin-ports.ts \
        tests/provisioning/manage-invitations.test.ts
git commit -m "feat: tenant invitation management — list, revoke, resend with duplicate-invite CONFLICT"
```

---

## Task 5: Member lifecycle — guarded suspend (relocated), reactivate, remove

Suspend moves from `invite-tenant-user.ts` into the new `manage-members.ts` and gains the spec §4.2 target guard ("tenant managers act on users only" — the old implementation never checked). Reactivate is app-side only (no Clerk call) and refuses when the target's `user_profiles.status ≠ active`. Remove follows the binding ordering: transaction (projection → `revoked`) → Clerk `deleteOrganizationMembership` → revert + rethrow on Clerk failure; the later `organizationMembership.deleted` webhook is a monotonic no-op. The last-manager invariant is structurally not applicable here because manager targets are refused outright (spec: "assert-last-manager-not-applicable for users").

**Files:**
- Create: `apps/ai/server/services/provisioning/manage-members.ts`
- Modify: `apps/ai/server/services/provisioning/invite-tenant-user.ts` (becomes invite-only)
- Modify: `apps/ai/server/services/provisioning/production-member-ports.ts` (drop `suspend_membership` — excess after the interface trim)
- Modify: `apps/ai/server/routers/tenant-members.ts` (suspend swaps service + ports; add `reactivateUser`, `removeUser`)
- Modify: `tests/provisioning/tenant-invitations.test.ts` (drop relocated suspend coverage)
- Test: `tests/provisioning/manage-members.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/provisioning/manage-members.test.ts
import { describe, expect, it } from "vitest";

import {
  reactivate_tenant_user,
  remove_tenant_user,
  suspend_tenant_user,
} from "../../apps/ai/server/services/provisioning/manage-members";
import {
  ManagerActionForbiddenError,
  MemberNotFoundError,
  ProfileInactiveError,
} from "../../apps/ai/server/services/provisioning/member-admin-ports";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
import {
  TENANT,
  fake_member_admin_world,
  manager_principal,
  membership_key,
  student_principal,
} from "./helpers/fake-member-admin-ports";

const TARGET = "507f1f77bcf86cd799439055";

/** Seed one target membership + profile status into the fake world. */
function seed_target(
  world: ReturnType<typeof fake_member_admin_world>,
  overrides: Partial<{
    tenant_role: "manager" | "user";
    status: "active" | "suspended" | "revoked";
    profile_status: string;
  }> = {},
) {
  world.memberships.set(membership_key(TENANT, TARGET), {
    tenant_role: overrides.tenant_role ?? "user",
    status: overrides.status ?? "active",
  });
  world.profiles.set(TARGET, overrides.profile_status ?? "active");
}

describe("suspend_tenant_user (relocated with target guard)", () => {
  it("suspends an active user and audits", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    await expect(
      suspend_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("suspended");
    expect(world.audit_events[0]).toMatchObject({
      action: "suspend_tenant_user",
      tenantId: TENANT,
      userProfileId: TARGET,
    });
  });

  it("refuses a manager target — manager lifecycle is platform-scope", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { tenant_role: "manager" });
    await expect(
      suspend_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(ManagerActionForbiddenError);
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("active");
  });

  it("is idempotent over an already-suspended membership", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "suspended" });
    await expect(
      suspend_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.audit_events).toHaveLength(0);
  });

  it("treats a revoked membership as not found", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "revoked" });
    await expect(
      suspend_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it("rejects a tenant user caller", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    await expect(
      suspend_tenant_user(student_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("reactivate_tenant_user", () => {
  it("reactivates a suspended user whose profile is active", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "suspended" });
    await expect(
      reactivate_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("active");
    expect(world.audit_events[0]).toMatchObject({ action: "reactivate_tenant_user" });
    expect(world.clerk_calls).toHaveLength(0); // app-side suspension only
  });

  it("refuses when the user profile itself is not active", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "suspended", profile_status: "suspended" });
    await expect(
      reactivate_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(ProfileInactiveError);
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("suspended");
  });

  it("is idempotent over an already-active membership", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    await expect(
      reactivate_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.audit_events).toHaveLength(0);
  });

  it("treats a revoked membership as not found (re-invite is the path back)", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "revoked" });
    await expect(
      reactivate_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it("refuses a manager target", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { tenant_role: "manager", status: "suspended" });
    await expect(
      reactivate_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(ManagerActionForbiddenError);
  });
});

describe("remove_tenant_user", () => {
  it("revokes the projection first, then removes the Clerk membership, and audits", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    await expect(
      remove_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("revoked");
    expect(world.clerk_calls).toEqual([
      { method: "remove_membership", args: [TENANT, TARGET] },
    ]);
    expect(world.audit_events[0]).toMatchObject({
      action: "remove_tenant_user",
      tenantId: TENANT,
      userProfileId: TARGET,
    });
  });

  it("reverts the projection and rethrows when the Clerk removal fails", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    world.fail_clerk.remove_membership = true;
    await expect(
      remove_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toThrow("clerk remove failed");
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.status).toBe("active");
    expect(
      world.audit_events.some((e) => e.action === "remove_tenant_user_reverted"),
    ).toBe(true);
  });

  it("refuses a manager target", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { tenant_role: "manager" });
    await expect(
      remove_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(ManagerActionForbiddenError);
  });

  it("is idempotent over an already-revoked membership (no Clerk call)", async () => {
    const world = fake_member_admin_world();
    seed_target(world, { status: "revoked" });
    await expect(
      remove_tenant_user(manager_principal, { user_profile_id: TARGET }, world.ports),
    ).resolves.toEqual({ success: true });
    expect(world.clerk_calls).toHaveLength(0);
  });

  it("rejects a caller without tenant:members:remove_user", async () => {
    const world = fake_member_admin_world();
    seed_target(world);
    await expect(
      remove_tenant_user(student_principal, { user_profile_id: TARGET }, world.ports),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/provisioning/manage-members.test.ts`
Expected: FAIL — `manage-members.ts` does not exist.

- [ ] **Step 3: Implement the member lifecycle service**

```typescript
// apps/ai/server/services/provisioning/manage-members.ts
import { z } from "zod";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_active_tenant, require_permission } from "../../auth/authorize";
import {
  ManagerActionForbiddenError,
  MemberNotFoundError,
  ProfileInactiveError,
  type MemberAdminPorts,
  type MembershipView,
} from "./member-admin-ports";

const member_input_schema = z
  .object({ user_profile_id: z.string().min(1) })
  .strict();

/**
 * Load a membership in the caller's tenant and refuse manager targets:
 * tenant managers act on users only (spec §4.2); manager lifecycle is a
 * platform operation.
 *
 * @param ports - Member-admin ports.
 * @param tenant_id - Caller's tenant.
 * @param user_profile_id - Target profile id.
 * @returns Membership view of a user-role target.
 * @throws MemberNotFoundError / ManagerActionForbiddenError.
 */
async function required_user_target(
  ports: MemberAdminPorts,
  tenant_id: string,
  user_profile_id: string,
): Promise<MembershipView> {
  const membership = await ports.memberships.find_membership(tenant_id, user_profile_id);
  if (!membership) throw new MemberNotFoundError(user_profile_id);
  if (membership.tenant_role === "manager") throw new ManagerActionForbiddenError();
  return membership;
}

/**
 * Suspend a tenant user's membership (app-side; Clerk keeps the membership —
 * the projection is authoritative for authz). Idempotent over suspended
 * memberships; revoked memberships read as not found.
 *
 * @param actor - Verified tenant principal (requires tenant:members:suspend_user).
 * @param raw_input - ({ user_profile_id }).
 * @param ports - Member-admin ports.
 * @returns Success marker.
 * @throws AuthorizationError, MemberNotFoundError, ManagerActionForbiddenError.
 */
export async function suspend_tenant_user(
  actor: RequestPrincipal,
  raw_input: { user_profile_id: string },
  ports: MemberAdminPorts,
): Promise<{ success: true }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:suspend_user");
  const input = member_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({
    boundary: "manage-members",
    event: "suspend.start",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });

  const membership = await required_user_target(ports, tenant_id, input.user_profile_id);
  if (membership.status === "suspended") return { success: true };
  if (membership.status === "revoked") throw new MemberNotFoundError(input.user_profile_id);

  await ports.memberships.set_membership_status(
    tenant_id,
    input.user_profile_id,
    "suspended",
  );
  await ports.audit.record({
    action: "suspend_tenant_user",
    tenantId: tenant_id,
    userProfileId: input.user_profile_id,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "manage-members",
    event: "suspend.done",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });
  return { success: true };
}

/**
 * Reactivate a suspended tenant user (app-side suspension only — no Clerk
 * call). Refuses when the target's user profile is itself not active, and
 * treats revoked memberships as not found (re-invite is the path back).
 *
 * @param actor - Verified tenant principal (requires tenant:members:suspend_user).
 * @param raw_input - ({ user_profile_id }).
 * @param ports - Member-admin ports.
 * @returns Success marker.
 * @throws AuthorizationError, MemberNotFoundError,
 *         ManagerActionForbiddenError, ProfileInactiveError.
 */
export async function reactivate_tenant_user(
  actor: RequestPrincipal,
  raw_input: { user_profile_id: string },
  ports: MemberAdminPorts,
): Promise<{ success: true }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:suspend_user");
  const input = member_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({
    boundary: "manage-members",
    event: "reactivate.start",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });

  const membership = await required_user_target(ports, tenant_id, input.user_profile_id);
  if (membership.status === "active") return { success: true };
  if (membership.status === "revoked") throw new MemberNotFoundError(input.user_profile_id);

  const profile_status = await ports.profiles.find_profile_status(input.user_profile_id);
  if (profile_status !== "active") {
    throw new ProfileInactiveError(input.user_profile_id, profile_status ?? "missing");
  }

  await ports.memberships.set_membership_status(
    tenant_id,
    input.user_profile_id,
    "active",
  );
  await ports.audit.record({
    action: "reactivate_tenant_user",
    tenantId: tenant_id,
    userProfileId: input.user_profile_id,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "manage-members",
    event: "reactivate.done",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });
  return { success: true };
}

/**
 * Remove a tenant user: soft-revoke the projection inside a transaction,
 * then delete the Clerk membership, reverting the projection if Clerk fails
 * (spec §4.2 ordering — the later organizationMembership.deleted webhook is
 * a monotonic no-op). Re-inviting later revives the same projection row.
 * The target is guaranteed a plain user by required_user_target, so the
 * last-manager invariant is structurally not applicable on this path.
 *
 * @param actor - Verified tenant principal (requires tenant:members:remove_user).
 * @param raw_input - ({ user_profile_id }).
 * @param ports - Member-admin ports.
 * @returns Success marker.
 * @throws AuthorizationError, MemberNotFoundError,
 *         ManagerActionForbiddenError, and the Clerk error on revert.
 */
export async function remove_tenant_user(
  actor: RequestPrincipal,
  raw_input: { user_profile_id: string },
  ports: MemberAdminPorts,
): Promise<{ success: true }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:remove_user");
  const input = member_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({
    boundary: "manage-members",
    event: "remove.start",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });

  const membership = await required_user_target(ports, tenant_id, input.user_profile_id);
  if (membership.status === "revoked") return { success: true };
  const previous_status = membership.status;

  await ports.transactions.run(async (session) => {
    await ports.memberships.set_membership_status(
      tenant_id,
      input.user_profile_id,
      "revoked",
      session,
    );
  });
  try {
    await ports.clerk.remove_membership(tenant_id, input.user_profile_id);
  } catch (error) {
    await ports.memberships.set_membership_status(
      tenant_id,
      input.user_profile_id,
      previous_status,
    );
    await ports.audit.record({
      action: "remove_tenant_user_reverted",
      tenantId: tenant_id,
      userProfileId: input.user_profile_id,
      actorProfileId: actor.internal_user_id,
      occurred_at: new Date(),
    });
    console.error({
      boundary: "manage-members",
      event: "remove.reverted",
      tenant_id,
      user_profile_id: input.user_profile_id,
    });
    throw error;
  }
  await ports.audit.record({
    action: "remove_tenant_user",
    tenantId: tenant_id,
    userProfileId: input.user_profile_id,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "manage-members",
    event: "remove.done",
    tenant_id,
    user_profile_id: input.user_profile_id,
  });
  return { success: true };
}
```

- [ ] **Step 4: Shrink invite-tenant-user.ts to invite-only**

Replace `apps/ai/server/services/provisioning/invite-tenant-user.ts` entirely (delete `suspend_tenant_user`, `suspend_input_schema`, and the `memberships` port group — the relocated suspend now lives in `manage-members.ts`):

```typescript
// apps/ai/server/services/provisioning/invite-tenant-user.ts
import { z } from "zod";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_active_tenant, require_permission } from "../../auth/authorize";
import type { ManagerInvitation } from "./provisioning-types";

const invite_input_schema = z
  .object({ email: z.string().trim().toLowerCase().email() })
  .strict();

/** Ports for the tenant invite path; fakes in tests, MongoDB/Clerk in production. */
export interface TenantMemberPorts {
  readonly invitations: {
    upsert(
      tenant_id: string,
      invitation: ManagerInvitation,
      invited_by_profile_id: string,
    ): Promise<void>;
  };
  readonly clerk: {
    create_user_invitation(
      clerk_organization_id: string,
      email: string,
    ): Promise<ManagerInvitation>;
  };
  readonly tenants: {
    clerk_organization_id_for(tenant_id: string): Promise<string | null>;
  };
  readonly audit: {
    record(event: Record<string, unknown> & { action: string }): Promise<void>;
  };
}

/**
 * Invite a student (tenant user) into the manager's university. Managers can
 * only ever grant the user role through this path — manager appointments are
 * a platform operation. Multi-org membership is permitted (Plan 3): an email
 * holding memberships elsewhere is invited normally; Clerk's own
 * duplicate-pending rejection is translated by the production port.
 *
 * @param actor - Verified tenant principal (requires tenant:members:invite_user).
 * @param raw_input - Invitation input ({ email }).
 * @param ports - Member-management ports.
 * @returns Created invitation ID.
 * @throws AuthorizationError when the caller lacks the permission.
 * @throws DuplicatePendingInvitationError (from the port) when already pending.
 */
export async function invite_tenant_user(
  actor: RequestPrincipal,
  raw_input: { email: string },
  ports: TenantMemberPorts,
): Promise<{ invitation_id: string }> {
  require_active_tenant(actor);
  require_permission(actor, "tenant:members:invite_user");
  const input = invite_input_schema.parse(raw_input);
  const tenant_id = actor.active_tenant_id as string;
  console.info({ boundary: "tenant-members", event: "invite.start", tenant_id });

  const clerk_organization_id =
    await ports.tenants.clerk_organization_id_for(tenant_id);
  if (!clerk_organization_id) {
    throw new Error("The tenant has no Clerk organization; provisioning is incomplete.");
  }

  // The user role is always passed to Clerk; this path can never mint a manager.
  const invitation = await ports.clerk.create_user_invitation(
    clerk_organization_id,
    input.email,
  );
  await ports.invitations.upsert(tenant_id, invitation, actor.internal_user_id);
  await ports.audit.record({
    action: "invite_tenant_user",
    tenantId: tenant_id,
    emailNormalized: input.email,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "tenant-members",
    event: "invite.done",
    tenant_id,
    invitation_id: invitation.id,
  });
  return { invitation_id: invitation.id };
}
```

In `apps/ai/server/services/provisioning/production-member-ports.ts`, delete the now-excess `suspend_membership` method from the `memberships` literal of `create_production_member_ports`:

```typescript
      async suspend_membership(tenant_id, user_profile_id) {
        await db.collection("tenant_membership_projections").updateOne(
          { tenantId: tenant_id, userProfileId: user_profile_id },
          { $set: { status: "suspended", updatedAt: new Date() } },
        );
      },
```

In `tests/provisioning/tenant-invitations.test.ts`: delete the `suspend_tenant_user` import, the `memberships` group and `suspensions` array from the fake, and the whole `describe("suspend_tenant_user", …)` block (that coverage now lives in `manage-members.test.ts`, with the new target guard).

- [ ] **Step 5: Wire the router**

In `apps/ai/server/routers/tenant-members.ts`:

(a) replace the invite-service import block with

```typescript
import { invite_tenant_user } from "../services/provisioning/invite-tenant-user";
import {
  reactivate_tenant_user,
  remove_tenant_user,
  suspend_tenant_user,
} from "../services/provisioning/manage-members";
```

(b) replace the whole `suspendUser` procedure with the trio (suspend now runs on the admin ports and maps typed errors; reactivate/remove are new):

```typescript
  /**
   * Suspend a user's membership in the caller's university (users only —
   * manager lifecycle is platform-scope and refused by the service).
   */
  suspendUser: tenantProcedure("tenant:members:suspend_user")
    .input(z.object({ user_profile_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await suspend_tenant_user(
          ctx.principal,
          input,
          create_production_member_admin_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),

  /**
   * Reactivate a suspended user's membership (app-side; refused when the
   * user profile itself is not active).
   */
  reactivateUser: tenantProcedure("tenant:members:suspend_user")
    .input(z.object({ user_profile_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await reactivate_tenant_user(
          ctx.principal,
          input,
          create_production_member_admin_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),

  /**
   * Remove a user from the caller's university (manager-only permission;
   * soft revoke + Clerk removal with revert-on-failure; re-invite revives).
   */
  removeUser: tenantProcedure("tenant:members:remove_user")
    .input(z.object({ user_profile_id: z.string().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await remove_tenant_user(
          ctx.principal,
          input,
          create_production_member_admin_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- tests/provisioning/manage-members.test.ts tests/provisioning/tenant-invitations.test.ts`
Expected: PASS (15 + 3 tests).

Run: `npm run test`
Expected: full suite PASS (catches any leftover `suspend_tenant_user` import from the old location).

- [ ] **Step 7: Commit**

```bash
git add apps/ai/server/services/provisioning/manage-members.ts \
        apps/ai/server/services/provisioning/invite-tenant-user.ts \
        apps/ai/server/services/provisioning/production-member-ports.ts \
        apps/ai/server/routers/tenant-members.ts \
        tests/provisioning/manage-members.test.ts \
        tests/provisioning/tenant-invitations.test.ts
git commit -m "feat: member lifecycle — guarded suspend, reactivate, remove with Clerk revert ordering"
```

---
## Task 6: Last-manager invariant + `demoteManager` + `listMembers` (platform scope)

Spec §4.3: `demoteManager` is `platformAdminProcedure`, idempotent over user-role members, and runs `assert_not_last_active_manager` inside a Mongo transaction; the Clerk role update happens after commit with revert-on-failure. The invariant helper touches the tenant document inside the transaction — two racing demotions then write-conflict on the same document instead of both committing snapshot write-skew. `listMembers` reuses the member-list join extracted into a shared service (DRY with `tenantMembers.list`).

**Files:**
- Modify: `apps/ai/server/services/provisioning/manage-members.ts` (add `assert_not_last_active_manager`)
- Create: `apps/ai/server/services/provisioning/demote-manager.ts`
- Create: `apps/ai/server/services/provisioning/list-tenant-members.ts`
- Modify: `apps/ai/server/routers/platform-tenants.ts` (+ `listMembers`, `demoteManager`)
- Modify: `apps/ai/server/routers/tenant-members.ts` (`list` delegates to the shared join)
- Tests: `tests/provisioning/demote-manager.test.ts`, `tests/integration/last-manager-invariant.test.ts` (MongoMemoryReplSet)

- [ ] **Step 1: Write the failing fake-ports demote tests**

```typescript
// tests/provisioning/demote-manager.test.ts
import { describe, expect, it } from "vitest";

import { demote_manager } from "../../apps/ai/server/services/provisioning/demote-manager";
import {
  LastManagerError,
  MemberNotFoundError,
} from "../../apps/ai/server/services/provisioning/member-admin-ports";
import { AuthorizationError } from "../../apps/ai/server/auth/errors";
import {
  TENANT,
  fake_member_admin_world,
  manager_principal,
  membership_key,
  platform_admin_principal,
} from "./helpers/fake-member-admin-ports";

const TARGET = "507f1f77bcf86cd799439055";
const OTHER_MANAGER = "507f1f77bcf86cd799439056";

describe("demote_manager", () => {
  it("demotes a manager to user, updates Clerk after the transaction, and audits", async () => {
    const world = fake_member_admin_world();
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "manager",
      status: "active",
    });
    world.memberships.set(membership_key(TENANT, OTHER_MANAGER), {
      tenant_role: "manager",
      status: "active",
    });
    const result = await demote_manager(
      platform_admin_principal,
      { tenant_id: TENANT, user_profile_id: TARGET },
      world.ports,
    );
    expect(result).toEqual({ success: true, changed: true });
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.tenant_role).toBe("user");
    expect(world.clerk_calls).toEqual([
      { method: "update_membership_role", args: [TENANT, TARGET, "user"] },
    ]);
    expect(world.audit_events[0]).toMatchObject({
      action: "demote_manager",
      tenantId: TENANT,
      userProfileId: TARGET,
    });
  });

  it("is idempotent over a user-role member (no Clerk call, no audit)", async () => {
    const world = fake_member_admin_world();
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "user",
      status: "active",
    });
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).resolves.toEqual({ success: true, changed: false });
    expect(world.clerk_calls).toHaveLength(0);
    expect(world.audit_events).toHaveLength(0);
  });

  it("refuses to demote the last active manager", async () => {
    const world = fake_member_admin_world();
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "manager",
      status: "active",
    });
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(LastManagerError);
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.tenant_role).toBe("manager");
    expect(world.clerk_calls).toHaveLength(0);
  });

  it("reverts the projection role and rethrows when the Clerk update fails", async () => {
    const world = fake_member_admin_world();
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "manager",
      status: "active",
    });
    world.memberships.set(membership_key(TENANT, OTHER_MANAGER), {
      tenant_role: "manager",
      status: "active",
    });
    world.fail_clerk.update_membership_role = true;
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).rejects.toThrow("clerk role update failed");
    expect(world.memberships.get(membership_key(TENANT, TARGET))?.tenant_role).toBe("manager");
    expect(
      world.audit_events.some((e) => e.action === "demote_manager_reverted"),
    ).toBe(true);
  });

  it("treats missing and revoked memberships as not found", async () => {
    const world = fake_member_admin_world();
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "manager",
      status: "revoked",
    });
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it("rejects a caller without a platform role", async () => {
    const world = fake_member_admin_world();
    world.memberships.set(membership_key(TENANT, TARGET), {
      tenant_role: "manager",
      status: "active",
    });
    await expect(
      demote_manager(
        manager_principal,
        { tenant_id: TENANT, user_profile_id: TARGET },
        world.ports,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
```

- [ ] **Step 2: Write the failing replica-set invariant test**

```typescript
// tests/integration/last-manager-invariant.test.ts
/**
 * Plan 3 Task 6 — last-manager invariant over real Mongo transactions.
 *
 * Uses MongoMemoryReplSet (transactions are unavailable on a plain
 * MongoMemoryServer) and the PRODUCTION member-admin ports with a passing
 * Clerk fake, so the transaction + tenant-touch write-conflict guard is
 * exercised for real, including the concurrent-demote race.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { demote_manager } from "../../apps/ai/server/services/provisioning/demote-manager";
import { LastManagerError } from "../../apps/ai/server/services/provisioning/member-admin-ports";
import {
  create_production_member_admin_ports,
  type MemberAdminClerkLike,
} from "../../apps/ai/server/services/provisioning/production-member-ports";
import { platform_admin_principal } from "../provisioning/helpers/fake-member-admin-ports";

let repl: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;

const TENANT = new ObjectId("507f1f77bcf86cd7994390b1");
const MANAGER_A = new ObjectId("507f1f77bcf86cd7994390c1");
const MANAGER_B = new ObjectId("507f1f77bcf86cd7994390c2");

/** Clerk fake whose admin calls always succeed. */
function passing_clerk(): MemberAdminClerkLike {
  return {
    organizations: {
      async createOrganizationInvitation(params) {
        return { id: "inv_x", emailAddress: params.emailAddress, role: params.role };
      },
      async getOrganizationInvitationList() {
        return { data: [] };
      },
      async revokeOrganizationInvitation() {
        return {};
      },
      async updateOrganizationMembership() {
        return {};
      },
      async deleteOrganizationMembership() {
        return {};
      },
    },
  };
}

/** Seed one active tenant with two active managers. */
async function seed_two_managers(): Promise<void> {
  await db.collection("tenants").insertOne({
    _id: TENANT,
    clerkOrganizationId: "org_invariant",
    status: "active",
  });
  await db.collection("user_profiles").insertMany([
    { _id: MANAGER_A, clerkUserId: "user_a", status: "active" },
    { _id: MANAGER_B, clerkUserId: "user_b", status: "active" },
  ]);
  await db.collection("tenant_membership_projections").insertMany([
    {
      clerkMembershipId: "orgmem_a",
      tenantId: TENANT.toHexString(),
      userProfileId: MANAGER_A.toHexString(),
      tenantRole: "manager",
      status: "active",
      clerkSyncedAt: new Date(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      clerkMembershipId: "orgmem_b",
      tenantId: TENANT.toHexString(),
      userProfileId: MANAGER_B.toHexString(),
      tenantRole: "manager",
      status: "active",
      clerkSyncedAt: new Date(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
}

/** Count active managers in the seeded tenant. */
async function active_manager_count(): Promise<number> {
  return db.collection("tenant_membership_projections").countDocuments({
    tenantId: TENANT.toHexString(),
    tenantRole: "manager",
    status: "active",
  });
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(repl.getUri());
  await client.connect();
  db = client.db("test_last_manager");
}, 60_000);

afterAll(async () => {
  await client.close();
  await repl.stop();
});

beforeEach(async () => {
  await Promise.all([
    db.collection("tenants").deleteMany({}),
    db.collection("user_profiles").deleteMany({}),
    db.collection("tenant_membership_projections").deleteMany({}),
    db.collection("platform_audit_events").deleteMany({}),
  ]);
  await seed_two_managers();
});

describe("last-manager invariant (transactional)", () => {
  it("allows demoting down to one manager and refuses the last one", async () => {
    const ports = create_production_member_admin_ports(db, passing_clerk());
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT.toHexString(), user_profile_id: MANAGER_B.toHexString() },
        ports,
      ),
    ).resolves.toEqual({ success: true, changed: true });
    await expect(
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT.toHexString(), user_profile_id: MANAGER_A.toHexString() },
        ports,
      ),
    ).rejects.toBeInstanceOf(LastManagerError);
    expect(await active_manager_count()).toBe(1);
  });

  it("serializes concurrent demotions of the two last managers — exactly one wins", async () => {
    const ports = create_production_member_admin_ports(db, passing_clerk());
    const results = await Promise.allSettled([
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT.toHexString(), user_profile_id: MANAGER_A.toHexString() },
        ports,
      ),
      demote_manager(
        platform_admin_principal,
        { tenant_id: TENANT.toHexString(), user_profile_id: MANAGER_B.toHexString() },
        ports,
      ),
    ]);
    const fulfilled = results.filter((entry) => entry.status === "fulfilled");
    const rejected = results.filter(
      (entry): entry is PromiseRejectedResult => entry.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(LastManagerError);
    // The write-conflict guard (tenant-document touch) prevents write-skew:
    // one active manager must remain, never zero.
    expect(await active_manager_count()).toBe(1);
  }, 30_000);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- tests/provisioning/demote-manager.test.ts tests/integration/last-manager-invariant.test.ts`
Expected: FAIL — `demote-manager.ts` and `assert_not_last_active_manager` do not exist.

- [ ] **Step 4: Add the invariant helper to manage-members.ts**

In `apps/ai/server/services/provisioning/manage-members.ts`: add `import type { ClientSession } from "mongodb";` at the top, add `LastManagerError` to the `./member-admin-ports` import list, and append at the end of the file:

```typescript
/**
 * Assert (inside a transaction) that demoting/suspending/removing the given
 * member cannot leave the tenant without an active manager. No-op for
 * non-manager or non-active targets. Enforced for APP-INITIATED mutations
 * only (spec §4.3) — Clerk-originated violations are detected by the
 * zero-manager webhook detector instead.
 *
 * @param ports - Member-admin ports.
 * @param tenant_id - Tenant whose invariant is protected.
 * @param user_profile_id - Member being mutated.
 * @param session - Transaction session the caller is running in. Required
 *                  rationale: the count is only trustworthy inside the same
 *                  transaction as the mutation.
 * @throws LastManagerError when the target is the last active manager.
 */
export async function assert_not_last_active_manager(
  ports: MemberAdminPorts,
  tenant_id: string,
  user_profile_id: string,
  session: ClientSession | undefined,
): Promise<void> {
  const membership = await ports.memberships.find_membership(
    tenant_id,
    user_profile_id,
    session,
  );
  if (
    !membership ||
    membership.tenant_role !== "manager" ||
    membership.status !== "active"
  ) {
    return;
  }
  // Write-conflict guard: both of two racing transactions write the same
  // tenant document, so Mongo aborts one (withTransaction retries it, and
  // the retry re-reads a one-manager count) instead of committing write-skew.
  await ports.memberships.touch_tenant_for_invariant(tenant_id, session);
  const active_managers = await ports.memberships.count_active_managers(
    tenant_id,
    session,
  );
  if (active_managers <= 1) {
    throw new LastManagerError(tenant_id);
  }
}
```

- [ ] **Step 5: Create the demote service**

```typescript
// apps/ai/server/services/provisioning/demote-manager.ts
import { z } from "zod";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_platform_admin } from "../../auth/authorize";
import {
  MemberNotFoundError,
  type MemberAdminPorts,
} from "./member-admin-ports";
import { assert_not_last_active_manager } from "./manage-members";

const demote_input_schema = z
  .object({
    tenant_id: z.string().min(1),
    user_profile_id: z.string().min(1),
  })
  .strict();

/**
 * Demote a university manager to the user role (platform scope). Idempotent:
 * demoting a user-role member is a no-op success. Ordering (spec §4.3):
 * transaction (last-manager assert + projection role write) → Clerk role
 * update after commit → revert the projection and rethrow on Clerk failure.
 * The role string is mapped through CLERK_ORG_ROLE_MODE by the port.
 *
 * @param actor - Verified principal; must hold a platform role.
 * @param raw_input - ({ tenant_id, user_profile_id }).
 * @param ports - Member-admin ports.
 * @returns changed=false for the idempotent no-op, true otherwise.
 * @throws AuthorizationError, MemberNotFoundError, LastManagerError, and
 *         the Clerk error on revert.
 */
export async function demote_manager(
  actor: RequestPrincipal,
  raw_input: { tenant_id: string; user_profile_id: string },
  ports: MemberAdminPorts,
): Promise<{ success: true; changed: boolean }> {
  require_platform_admin(actor);
  const input = demote_input_schema.parse(raw_input);
  console.info({
    boundary: "platform-tenants",
    event: "demote.start",
    tenant_id: input.tenant_id,
    user_profile_id: input.user_profile_id,
  });

  const membership = await ports.memberships.find_membership(
    input.tenant_id,
    input.user_profile_id,
  );
  if (!membership || membership.status === "revoked") {
    throw new MemberNotFoundError(input.user_profile_id);
  }
  if (membership.tenant_role === "user") {
    // Idempotent: demoting a user-role member is a no-op success.
    return { success: true, changed: false };
  }

  await ports.transactions.run(async (session) => {
    await assert_not_last_active_manager(
      ports,
      input.tenant_id,
      input.user_profile_id,
      session,
    );
    await ports.memberships.set_membership_role(
      input.tenant_id,
      input.user_profile_id,
      "user",
      session,
    );
  });
  try {
    await ports.clerk.update_membership_role(
      input.tenant_id,
      input.user_profile_id,
      "user",
    );
  } catch (error) {
    await ports.memberships.set_membership_role(
      input.tenant_id,
      input.user_profile_id,
      "manager",
    );
    await ports.audit.record({
      action: "demote_manager_reverted",
      tenantId: input.tenant_id,
      userProfileId: input.user_profile_id,
      actorProfileId: actor.internal_user_id,
      occurred_at: new Date(),
    });
    console.error({
      boundary: "platform-tenants",
      event: "demote.reverted",
      tenant_id: input.tenant_id,
      user_profile_id: input.user_profile_id,
    });
    throw error;
  }
  await ports.audit.record({
    action: "demote_manager",
    tenantId: input.tenant_id,
    userProfileId: input.user_profile_id,
    actorProfileId: actor.internal_user_id,
    occurred_at: new Date(),
  });
  console.info({
    boundary: "platform-tenants",
    event: "manager.demoted",
    tenant_id: input.tenant_id,
    user_profile_id: input.user_profile_id,
  });
  return { success: true, changed: true };
}
```

- [ ] **Step 6: Extract the shared member-list join**

```typescript
// apps/ai/server/services/provisioning/list-tenant-members.ts
import { ObjectId, type Db } from "mongodb";

/** One member row: membership projection joined with its user profile. */
export interface TenantMemberRow {
  _id: string;
  userProfileId: string;
  tenantRole: string;
  status: string;
  email: string;
  displayName: string;
  profileStatus: string;
}

/**
 * List membership projections for one university joined with profile
 * identity fields. Shared by the tenant members router (own tenant) and the
 * platform tenant detail view (any tenant, platform-authorized) — the
 * CALLER is responsible for authorization; this is a pure projection read.
 *
 * @param db - Connected database handle.
 * @param tenant_id - Tenant whose members are listed (pre-authorized).
 * @returns Member rows sorted by newest membership first.
 */
export async function list_tenant_members(
  db: Db,
  tenant_id: string,
): Promise<TenantMemberRow[]> {
  console.info({ boundary: "list-tenant-members", event: "list.start", tenant_id });
  const memberships = await db
    .collection("tenant_membership_projections")
    .find({ tenantId: tenant_id })
    .sort({ createdAt: -1 })
    .toArray();
  const profile_ids = memberships
    .map((m) => String(m.userProfileId))
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  const profiles = await db
    .collection("user_profiles")
    .find({ _id: { $in: profile_ids } })
    .project({ primaryEmail: 1, displayName: 1, status: 1 })
    .toArray();
  const profile_map = new Map(profiles.map((p) => [p._id.toString(), p]));
  const rows = memberships.map((membership) => ({
    _id: membership._id.toString(),
    userProfileId: String(membership.userProfileId),
    tenantRole: String(membership.tenantRole),
    status: String(membership.status),
    email: profile_map.get(String(membership.userProfileId))?.primaryEmail ?? "",
    displayName:
      profile_map.get(String(membership.userProfileId))?.displayName ?? "",
    profileStatus: String(
      profile_map.get(String(membership.userProfileId))?.status ?? "",
    ),
  }));
  console.info({
    boundary: "list-tenant-members",
    event: "list.done",
    tenant_id,
    count: rows.length,
  });
  return rows;
}
```

In `apps/ai/server/routers/tenant-members.ts`: add `import { list_tenant_members } from "../services/provisioning/list-tenant-members";`, delete the `import { ObjectId } from "mongodb";` line, and replace the entire `list` query body with:

```typescript
  list: tenantProcedure("tenant:members:read").query(async ({ ctx }) => {
    const client = await client_promise;
    // Identity-domain projection read, scoped by the verified tenant context.
    return list_tenant_members(client.db(), ctx.tenant_context.tenant_id);
  }),
```

- [ ] **Step 7: Add the platform procedures**

In `apps/ai/server/routers/platform-tenants.ts`, add the imports:

```typescript
import { demote_manager } from "../services/provisioning/demote-manager";
import { list_tenant_members } from "../services/provisioning/list-tenant-members";
import { create_production_member_admin_ports } from "../services/provisioning/production-member-ports";
import { throw_member_admin_error } from "./member-admin-errors";
```

and append two procedures to `platformTenantsRouter` after `appointManager`:

```typescript
  /**
   * Per-tenant member list for the platform tenant detail page. Platform
   * roles only; tenant metadata + membership rows, never business data.
   */
  listMembers: platformAdminProcedure
    .input(z.object({ tenant_id: z.string().min(1) }).strict())
    .query(async ({ input }) => {
      const client = await client_promise;
      return list_tenant_members(client.db(), input.tenant_id);
    }),

  /**
   * Demote a university manager to user (platform-only, idempotent, audited;
   * last-manager invariant enforced transactionally with Clerk-after-commit
   * and revert-on-failure).
   */
  demoteManager: platformAdminProcedure
    .input(
      z
        .object({
          tenant_id: z.string().min(1),
          user_profile_id: z.string().min(1),
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      try {
        return await demote_manager(
          ctx.principal,
          input,
          create_production_member_admin_ports(client.db()),
        );
      } catch (error) {
        throw_member_admin_error(error);
      }
    }),
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -- tests/provisioning/demote-manager.test.ts tests/integration/last-manager-invariant.test.ts`
Expected: PASS (6 + 2 tests; the replica-set suite takes ~30-60 s to boot).

Run: `npm run test`
Expected: full suite PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/ai/server/services/provisioning/manage-members.ts \
        apps/ai/server/services/provisioning/demote-manager.ts \
        apps/ai/server/services/provisioning/list-tenant-members.ts \
        apps/ai/server/routers/platform-tenants.ts \
        apps/ai/server/routers/tenant-members.ts \
        tests/provisioning/demote-manager.test.ts \
        tests/integration/last-manager-invariant.test.ts
git commit -m "feat: platform manager lifecycle — demoteManager, listMembers, transactional last-manager invariant"
```

---

## Task 7: `auth.me` — display-only principal view

Navigation needs a principal source the client can read (spec §4.5): `{ tenant_role, platform_role, membership_status }` from the resolved `RequestPrincipal`. It is deliberately a `publicProcedure` (permitted ONLY in `auth.ts` by `tests/auth/trpc-procedures.test.ts`) returning nulls for anonymous/inactive sessions, so the sidebar renders without special-casing auth failures. Display-only — server procedures still authorize every real operation.

**Files:**
- Modify: `apps/ai/server/routers/auth.ts`
- Test: `tests/auth/auth-me.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/auth/auth-me.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { principal_display_view } from "../../apps/ai/server/routers/auth";
import { TENANT_ROLE_PERMISSIONS } from "../../packages/shared-types/src/auth";
import type { RequestPrincipal } from "../../packages/shared-types/src/auth";

const manager: RequestPrincipal = {
  auth_provider: "clerk",
  provider_user_id: "user_mgr",
  internal_user_id: "507f1f77bcf86cd799439001",
  active_tenant_id: "507f1f77bcf86cd799439031",
  platform_role: null,
  tenant_role: "manager",
  permissions: TENANT_ROLE_PERMISSIONS.manager,
  membership_status: "active",
};

describe("principal_display_view", () => {
  it("returns nulls for an anonymous session", () => {
    expect(principal_display_view(null)).toEqual({
      tenant_role: null,
      platform_role: null,
      membership_status: null,
    });
  });

  it("projects exactly the three display fields for a resolved principal", () => {
    expect(principal_display_view(manager)).toEqual({
      tenant_role: "manager",
      platform_role: null,
      membership_status: "active",
    });
  });
});

describe("auth.me wiring", () => {
  it("exposes me as a public display-only query on the auth router", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/ai/server/routers/auth.ts"),
      "utf8",
    );
    expect(source).toMatch(/me:\s*publicProcedure\.query/);
    expect(source).toContain("principal_display_view(ctx.principal)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/auth/auth-me.test.ts`
Expected: FAIL — `principal_display_view` is not exported.

- [ ] **Step 3: Implement**

Replace `apps/ai/server/routers/auth.ts` entirely:

```typescript
// apps/ai/server/routers/auth.ts
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { router, publicProcedure } from "../trpc";

/** Display-only principal fields consumed by navigation visibility. */
export interface PrincipalDisplayView {
  tenant_role: RequestPrincipal["tenant_role"];
  platform_role: RequestPrincipal["platform_role"];
  membership_status: RequestPrincipal["membership_status"];
}

/**
 * Project a resolved principal onto the three display-only fields the
 * sidebar needs (link visibility). Anonymous/unresolved sessions project as
 * all-null instead of erroring so the navigation never special-cases auth
 * failures. NEVER used for authorization — server procedures authorize.
 *
 * @param principal - Resolved principal, or null when unauthenticated.
 * @returns Display view with nulls for missing dimensions.
 */
export function principal_display_view(
  principal: RequestPrincipal | null,
): PrincipalDisplayView {
  return {
    tenant_role: principal?.tenant_role ?? null,
    platform_role: principal?.platform_role ?? null,
    membership_status: principal?.membership_status ?? null,
  };
}

/**
 * Auth router after the Clerk cutover (G1.7).
 *
 * Clerk owns sign-in, sign-up, sessions, and sign-out; the custom login,
 * signup, logout procedures are retired. Only an explicitly public health
 * probe and the display-only principal view remain. Legacy Account/Session
 * collections stay read-only until their G5 retirement.
 */
export const authRouter = router({
  /**
   * Liveness probe. Deliberately public and side-effect free.
   */
  health: publicProcedure.query(() => ({ ok: true })),

  /**
   * Display-only principal view for navigation visibility (Plan 3).
   * Deliberately public: anonymous or inactive sessions receive nulls.
   */
  me: publicProcedure.query(({ ctx }) => principal_display_view(ctx.principal)),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/auth/auth-me.test.ts tests/auth/trpc-procedures.test.ts`
Expected: PASS — including the architecture test that pins `publicProcedure` to `auth.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/ai/server/routers/auth.ts tests/auth/auth-me.test.ts
git commit -m "feat: auth.me display-only principal view for navigation visibility"
```

---
## Task 8: Onboarding states + generalized activator + membership-loss routing

Spec §4.5: onboarding distinguishes an existing projection with `suspended`/`revoked` status from an absent one (`access_suspended`, `membership_removed`), plus a choose-org state for multi-membership sessions with no active org. The activator auto-activates ONLY a sole membership and renders an explicit picker for >1 (never silently `memberships[0]`), and moves from `/onboarding`-only into the authenticated layout so mid-session org loss lands there too. A global tRPC error handler routes `MEMBERSHIP_INACTIVE`/resolver-FORBIDDEN to `/onboarding`.

**Files:**
- Create: `apps/web/lib/server/onboarding-state.ts`
- Create: `apps/web/lib/membership_error_routing.ts`
- Modify: `apps/web/app/onboarding/page.tsx` (full rewrite)
- Modify: `apps/web/components/organization_activator.tsx` (full rewrite)
- Modify: `apps/web/app/providers.tsx` (full rewrite — adds Query/Mutation caches)
- Modify: `apps/web/components/conditional-layout.tsx` (full rewrite — mounts the guard)
- Tests: `tests/web/onboarding-state.test.ts`, `tests/web/membership-error-routing.test.ts`, `tests/web/onboarding-ui-wiring.test.ts`

- [ ] **Step 1: Write the failing pure-logic tests**

```typescript
// tests/web/onboarding-state.test.ts
import { describe, expect, it } from "vitest";

import {
  classify_onboarding_state,
  type MembershipResolution,
  type OnboardingLookups,
} from "../../apps/web/lib/server/onboarding-state";

/**
 * Build lookups with overridable outcomes.
 *
 * @param overrides - Resolution / projection-status / membership-count seeds.
 */
function lookups(
  overrides: Partial<{
    resolution: MembershipResolution;
    projection_status: "active" | "suspended" | "revoked" | null;
    active_memberships: number;
  }> = {},
): OnboardingLookups {
  return {
    async resolve_membership() {
      return overrides.resolution ?? { kind: "ready" };
    },
    async find_projection_status() {
      return overrides.projection_status ?? null;
    },
    async count_active_memberships() {
      return overrides.active_memberships ?? 0;
    },
  };
}

const signed_in = { clerk_enabled: true, user_id: "user_1", org_id: "org_1" };

describe("classify_onboarding_state", () => {
  it("returns clerk_disabled / unauthenticated for missing prerequisites", async () => {
    await expect(
      classify_onboarding_state(
        { clerk_enabled: false, user_id: null, org_id: null },
        lookups(),
      ),
    ).resolves.toBe("clerk_disabled");
    await expect(
      classify_onboarding_state(
        { clerk_enabled: true, user_id: null, org_id: null },
        lookups(),
      ),
    ).resolves.toBe("unauthenticated");
  });

  it("offers choose_organization for multi-membership sessions with no active org", async () => {
    await expect(
      classify_onboarding_state(
        { ...signed_in, org_id: null },
        lookups({ active_memberships: 2 }),
      ),
    ).resolves.toBe("choose_organization");
  });

  it("keeps invitation_pending for zero or one memberships with no active org", async () => {
    await expect(
      classify_onboarding_state(
        { ...signed_in, org_id: null },
        lookups({ active_memberships: 0 }),
      ),
    ).resolves.toBe("invitation_pending");
    // Exactly one membership: the activator auto-activates it momentarily.
    await expect(
      classify_onboarding_state(
        { ...signed_in, org_id: null },
        lookups({ active_memberships: 1 }),
      ),
    ).resolves.toBe("invitation_pending");
  });

  it("returns ready on a resolved active membership", async () => {
    await expect(
      classify_onboarding_state(signed_in, lookups()),
    ).resolves.toBe("ready");
  });

  it("maps a FORBIDDEN resolution to reconciliation_required", async () => {
    await expect(
      classify_onboarding_state(
        signed_in,
        lookups({ resolution: { kind: "rejected", code: "FORBIDDEN" } }),
      ),
    ).resolves.toBe("reconciliation_required");
  });

  it("distinguishes suspended / removed / still-syncing memberships", async () => {
    const rejected: MembershipResolution = {
      kind: "rejected",
      code: "MEMBERSHIP_INACTIVE",
    };
    await expect(
      classify_onboarding_state(
        signed_in,
        lookups({ resolution: rejected, projection_status: "suspended" }),
      ),
    ).resolves.toBe("access_suspended");
    await expect(
      classify_onboarding_state(
        signed_in,
        lookups({ resolution: rejected, projection_status: "revoked" }),
      ),
    ).resolves.toBe("membership_removed");
    await expect(
      classify_onboarding_state(
        signed_in,
        lookups({ resolution: rejected, projection_status: null }),
      ),
    ).resolves.toBe("membership_sync_pending");
  });

  it("treats an UNAUTHENTICATED resolution as sync pending (profile not projected)", async () => {
    await expect(
      classify_onboarding_state(
        signed_in,
        lookups({ resolution: { kind: "rejected", code: "UNAUTHENTICATED" } }),
      ),
    ).resolves.toBe("membership_sync_pending");
  });
});
```

```typescript
// tests/web/membership-error-routing.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MEMBERSHIP_INACTIVE_MESSAGES,
  is_membership_inactive_error,
} from "../../apps/web/lib/membership_error_routing";

describe("is_membership_inactive_error", () => {
  it("matches FORBIDDEN errors carrying a known membership-loss message", () => {
    expect(
      is_membership_inactive_error({
        message: "Membership is not active.",
        data: { code: "FORBIDDEN" },
      }),
    ).toBe(true);
  });

  it("ignores other FORBIDDEN errors, other codes, and non-errors", () => {
    expect(
      is_membership_inactive_error({
        message: "Missing required permission: formula:confirm.",
        data: { code: "FORBIDDEN" },
      }),
    ).toBe(false);
    expect(
      is_membership_inactive_error({
        message: "Membership is not active.",
        data: { code: "NOT_FOUND" },
      }),
    ).toBe(false);
    expect(is_membership_inactive_error(null)).toBe(false);
    expect(is_membership_inactive_error(undefined)).toBe(false);
  });

  it("covers every message in the closed set", () => {
    for (const message of MEMBERSHIP_INACTIVE_MESSAGES) {
      expect(
        is_membership_inactive_error({
          message: `prefix ${message} suffix`,
          data: { code: "FORBIDDEN" },
        }),
      ).toBe(true);
    }
  });
});

describe("providers wiring", () => {
  it("routes query and mutation cache errors through route_membership_error", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/web/app/providers.tsx"),
      "utf8",
    );
    expect(source).toContain("new QueryCache({");
    expect(source).toContain("new MutationCache({");
    expect(source).toContain("route_membership_error");
  });
});
```

```typescript
// tests/web/onboarding-ui-wiring.test.ts
/**
 * Plan 3 — static wiring for the onboarding states, the generalized
 * organization activator, and its authenticated-layout mount (pattern:
 * tests/web/formulate-ui-wiring.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("onboarding states", () => {
  it("classifies through the pure state machine and renders the new states", () => {
    const page = source("apps/web/app/onboarding/page.tsx");
    expect(page).toContain("classify_onboarding_state");
    expect(page).toContain("access_suspended");
    expect(page).toContain("membership_removed");
    expect(page).toContain("choose_organization");
  });
});

describe("organization activator", () => {
  it("auto-activates only a sole membership and renders a picker otherwise", () => {
    const activator = source("apps/web/components/organization_activator.tsx");
    expect(activator).toContain("memberships.length !== 1");
    expect(activator).toContain("Select an organization to continue");
    expect(activator).toContain("setActive");
  });

  it("is mounted in the authenticated layout, gated on Clerk mode", () => {
    const layout = source("apps/web/components/conditional-layout.tsx");
    expect(layout).toContain("clerk_enabled");
    expect(layout).toContain("<OrganizationActivator />");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/web/onboarding-state.test.ts tests/web/membership-error-routing.test.ts tests/web/onboarding-ui-wiring.test.ts`
Expected: FAIL — the two new libs do not exist; wiring assertions unmet.

- [ ] **Step 3: Create the pure onboarding state machine**

```typescript
// apps/web/lib/server/onboarding-state.ts
/**
 * Onboarding state classification (Plan 3).
 *
 * Pure decision logic, dependency-free by design: the onboarding page adapts
 * the Clerk session, the principal resolver, and the identity projections
 * into these lookups, so every branch is unit-testable with fakes.
 */

/** All onboarding states the page can render. */
export type OnboardingState =
  | "clerk_disabled"
  | "unauthenticated"
  | "invitation_pending"
  | "choose_organization"
  | "membership_sync_pending"
  | "access_suspended"
  | "membership_removed"
  | "reconciliation_required"
  | "ready";

/** Outcome of running the Clerk principal resolver, without exceptions. */
export type MembershipResolution =
  | { kind: "ready" }
  | {
      kind: "rejected";
      code: "UNAUTHENTICATED" | "MEMBERSHIP_INACTIVE" | "FORBIDDEN";
    };

/** Server-verified session snapshot the classification runs against. */
export interface OnboardingSnapshot {
  clerk_enabled: boolean;
  user_id: string | null;
  org_id: string | null;
}

/** Lazy lookups; only the branches that need them are ever invoked. */
export interface OnboardingLookups {
  /** Run the principal resolver for the (user, active org) pair. */
  resolve_membership(): Promise<MembershipResolution>;
  /** Direct membership projection status for the (user, active org) pair. */
  find_projection_status(): Promise<"active" | "suspended" | "revoked" | null>;
  /** Active memberships across ALL tenants for the user. */
  count_active_memberships(): Promise<number>;
}

/**
 * Classify the onboarding state. A projection that EXISTS with
 * suspended/revoked status is distinguished from an absent one (webhook
 * lag): suspension and removal get explicit states instead of the generic
 * "synchronization pending" (spec §4.5).
 *
 * @param snapshot - Server-verified session snapshot.
 * @param lookups - Lazy resolution/projection lookups.
 * @returns Onboarding state for the current request.
 */
export async function classify_onboarding_state(
  snapshot: OnboardingSnapshot,
  lookups: OnboardingLookups,
): Promise<OnboardingState> {
  if (!snapshot.clerk_enabled) return "clerk_disabled";
  if (!snapshot.user_id) return "unauthenticated";
  if (!snapshot.org_id) {
    const active_memberships = await lookups.count_active_memberships();
    // >=2: the user must pick explicitly (activator renders the picker);
    // exactly 1 is auto-activated by the activator moments later.
    return active_memberships >= 2 ? "choose_organization" : "invitation_pending";
  }
  const resolution = await lookups.resolve_membership();
  if (resolution.kind === "ready") return "ready";
  if (resolution.code === "FORBIDDEN") return "reconciliation_required";
  if (resolution.code === "MEMBERSHIP_INACTIVE") {
    const status = await lookups.find_projection_status();
    if (status === "suspended") return "access_suspended";
    if (status === "revoked") return "membership_removed";
    return "membership_sync_pending";
  }
  // UNAUTHENTICATED: the user profile itself is not projected yet.
  return "membership_sync_pending";
}
```

- [ ] **Step 4: Create the membership-loss routing lib**

```typescript
// apps/web/lib/membership_error_routing.ts
/**
 * Client-side routing for membership-loss errors (Plan 3).
 *
 * When the active organization's membership disappears mid-session
 * (suspended, removed, or the tenant deactivated), tenant procedures reject
 * with FORBIDDEN whose messages come from a small closed set produced by the
 * authenticated middleware (apps/ai/server/trpc.ts) and the Clerk principal
 * resolver. Those requests route the user to /onboarding, which explains
 * the exact state.
 */

/** Server messages that identify a lost/inactive membership (closed set). */
export const MEMBERSHIP_INACTIVE_MESSAGES: readonly string[] = [
  "Membership is not active.",
  "No active membership exists for this tenant.",
  "The organization is not an active tenant.",
  "Session role does not match the membership projection",
];

/**
 * Decide whether a tRPC client error represents membership loss.
 *
 * @param error - Unknown error from the query/mutation cache. tRPC client
 *                errors carry `data.code` and a server `message`.
 * @returns True only for FORBIDDEN errors with a known membership message.
 */
export function is_membership_inactive_error(error: unknown): boolean {
  const candidate = error as
    | { message?: unknown; data?: { code?: unknown } }
    | null
    | undefined;
  if (!candidate || candidate.data?.code !== "FORBIDDEN") return false;
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return MEMBERSHIP_INACTIVE_MESSAGES.some((known) => message.includes(known));
}

/**
 * Route a membership-loss error to /onboarding. No-op on the server, for
 * non-membership errors, and when already on /onboarding (loop guard).
 *
 * @param error - Unknown error from the query/mutation cache.
 */
export function route_membership_error(error: unknown): void {
  if (typeof window === "undefined") return;
  if (!is_membership_inactive_error(error)) return;
  if (window.location.pathname.startsWith("/onboarding")) return;
  console.warn({
    boundary: "membership-error-routing",
    event: "redirect.onboarding",
  });
  window.location.assign("/onboarding");
}
```

- [ ] **Step 5: Rewrite providers.tsx (caches wired)**

Replace `apps/web/app/providers.tsx` entirely:

```tsx
// apps/web/app/providers.tsx
"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { AppAuthProvider } from "@/lib/app-auth";
import { route_membership_error } from "@/lib/membership_error_routing";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Mid-session membership loss (suspended / removed / tenant
        // deactivated) routes to /onboarding, which explains the state.
        queryCache: new QueryCache({
          onError: (error) => route_membership_error(error),
        }),
        mutationCache: new MutationCache({
          onError: (error) => route_membership_error(error),
        }),
        defaultOptions: {
          queries: {
            // Serve cached data for a minute before background refresh —
            // console data does not change second-to-second, and staleTime 0
            // was refetching every query on each navigation/focus.
            staleTime: 60_000,
            // Keep unused query caches for 10 minutes so back-navigation
            // renders instantly from cache instead of a cross-region fetch.
            gcTime: 10 * 60_000,
            // Focus-driven refetches caused visible reload flashes on tab
            // switches; explicit invalidation covers mutations instead.
            refetchOnWindowFocus: false,
            // One retry keeps transient network blips invisible without
            // tripling the latency of genuine failures.
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AppAuthProvider>{children}</AppAuthProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
```

- [ ] **Step 6: Rewrite the organization activator (sole-membership auto + explicit picker)**

Replace `apps/web/components/organization_activator.tsx` entirely:

```tsx
// apps/web/components/organization_activator.tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrganizationList } from "@clerk/nextjs";

/**
 * Organization context guard (Plan 3).
 *
 * Clerk sessions start with no active organization. With exactly ONE
 * membership the sole organization is activated automatically; with more
 * than one the user chooses explicitly — memberships[0] is never assumed.
 * Mounted in the authenticated layout (conditional-layout.tsx) so
 * mid-session organization loss also lands here, not just /onboarding.
 * Clerk-only: the mount site gates on the publishable key because the
 * legacy flow has no ClerkProvider and these hooks would throw.
 */
export function OrganizationActivator() {
  const router = useRouter();
  const { orgId, isLoaded: auth_loaded } = useAuth();
  const { isLoaded: list_loaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { pageSize: 20 },
  });
  const activating = useRef(false);
  const memberships = userMemberships?.data ?? [];

  useEffect(() => {
    if (!auth_loaded || !list_loaded || orgId || activating.current) return;
    if (memberships.length !== 1 || !setActive) return; // >1 → explicit picker below
    activating.current = true;
    console.info("[organization-activator] activating sole membership");
    void setActive({ organization: memberships[0].organization.id })
      .then(() => router.refresh())
      .catch((error) => {
        activating.current = false;
        console.error("[organization-activator] activation failed", error);
      });
  }, [auth_loaded, list_loaded, orgId, memberships, setActive, router]);

  /**
   * Activate one explicitly chosen organization and refresh server state.
   *
   * @param organization_id - Clerk organization id chosen by the user.
   */
  const choose = (organization_id: string) => {
    if (!setActive || activating.current) return;
    activating.current = true;
    console.info("[organization-activator] activating chosen organization");
    void setActive({ organization: organization_id })
      .then(() => router.refresh())
      .catch((error) => {
        activating.current = false;
        console.error("[organization-activator] activation failed", error);
      });
  };

  if (!auth_loaded || !list_loaded || orgId || memberships.length <= 1) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
      <div className="w-full max-w-sm space-y-3 rounded border bg-white p-5 shadow">
        <h2 className="text-base font-semibold">Select an organization to continue</h2>
        <p className="text-xs text-muted-foreground">
          Your account belongs to more than one university.
        </p>
        <div className="space-y-1.5">
          {memberships.map((membership) => (
            <button
              key={membership.organization.id}
              type="button"
              className="w-full rounded border px-3 py-2 text-left text-sm hover:bg-gray-50"
              onClick={() => choose(membership.organization.id)}
            >
              {membership.organization.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Mount the guard in the authenticated layout**

Replace `apps/web/components/conditional-layout.tsx` entirely:

```tsx
// apps/web/components/conditional-layout.tsx
"use client";

import { usePathname } from "next/navigation";
import { Navigation } from "./navigation";
import { AdminNavigation } from "./admin-navigation";
import { OrganizationActivator } from "./organization_activator";

// Clerk components render only when the deployment configures Clerk — the
// legacy flow has no ClerkProvider and Clerk hooks would throw (same
// build-time check as app-auth.tsx).
const clerk_enabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Pages that should not have the navigation sidebar
  const publicPages = ["/login", "/signup"];
  const isPublicPage = publicPages.includes(pathname);

  // Check if current route is an admin route
  const isAdminRoute = pathname.startsWith("/admin");

  // AI pages need full height without padding for proper viewport sizing
  const aiPages = ["/ai/raw-materials-ai", "/ai/sales-rnd-ai"];
  const isAIPage = aiPages.includes(pathname);

  if (isPublicPage) {
    return <>{children}</>;
  }

  // Org-context guard: auto-activates a sole membership; renders an explicit
  // picker for multi-membership sessions with no active organization.
  const org_guard = clerk_enabled ? <OrganizationActivator /> : null;

  // If it's an admin route, use AdminNavigation
  if (isAdminRoute) {
    return (
      <>
        {org_guard}
        <AdminNavigation>
          <main className="p-6">{children}</main>
        </AdminNavigation>
      </>
    );
  }

  return (
    <>
      {org_guard}
      <Navigation>
        <main className={isAIPage ? "h-full" : "p-6"}>{children}</main>
      </Navigation>
    </>
  );
}
```

- [ ] **Step 8: Rewrite the onboarding page over the state machine**

Replace `apps/web/app/onboarding/page.tsx` entirely:

```tsx
// apps/web/app/onboarding/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import client_promise from "@rnd-ai/shared-database";

import { is_clerk_enabled } from "@/lib/server/clerk-config";
import {
  classify_onboarding_state,
  type MembershipResolution,
  type OnboardingState,
} from "@/lib/server/onboarding-state";
import { AuthorizationError } from "@/server/auth/errors";
import { resolve_clerk_principal } from "@/server/auth/clerk-principal-resolver";
import { create_identity_projection_repositories } from "@/server/auth/identity-repositories";

export const dynamic = "force-dynamic";

/**
 * Lazily connect and return the database handle (never touched when Clerk
 * is disabled — the classification short-circuits first).
 *
 * @returns Connected database handle.
 */
async function database() {
  return (await client_promise).db();
}

/**
 * Determine the onboarding state from the server-side Clerk session and the
 * internal identity projections. A Clerk organization on the session is not
 * enough — the database-authoritative membership projection decides whether
 * the user is onboarded, suspended, removed, still synchronizing, or must
 * choose among several organizations. Never queries tenant business data.
 *
 * @returns Onboarding state for the current request.
 */
async function resolve_onboarding_state(): Promise<OnboardingState> {
  const clerk_enabled = is_clerk_enabled();
  const auth_state = clerk_enabled ? await auth() : null;
  const snapshot = {
    clerk_enabled,
    user_id: auth_state?.userId ?? null,
    org_id: auth_state?.orgId ?? null,
  };

  return classify_onboarding_state(snapshot, {
    async resolve_membership(): Promise<MembershipResolution> {
      try {
        const principal = await resolve_clerk_principal(
          {
            userId: auth_state?.userId ?? null,
            orgId: auth_state?.orgId ?? null,
            orgRole: auth_state?.orgRole ?? null,
            sessionId: auth_state?.sessionId ?? null,
          },
          create_identity_projection_repositories(await database()),
        );
        console.info({
          boundary: "onboarding",
          event: "membership.resolved",
          membership_status: principal.membership_status,
        });
        return principal.membership_status === "active"
          ? { kind: "ready" }
          : { kind: "rejected", code: "MEMBERSHIP_INACTIVE" };
      } catch (error) {
        if (error instanceof AuthorizationError) {
          console.info({
            boundary: "onboarding",
            event: "membership.unresolved",
            code: error.code,
          });
          const code =
            error.code === "MEMBERSHIP_INACTIVE" || error.code === "FORBIDDEN"
              ? error.code
              : "UNAUTHENTICATED";
          return { kind: "rejected", code };
        }
        throw error;
      }
    },
    async find_projection_status() {
      const db = await database();
      const profile = await db
        .collection("user_profiles")
        .findOne({ clerkUserId: snapshot.user_id });
      const tenant = await db
        .collection("tenants")
        .findOne({ clerkOrganizationId: snapshot.org_id });
      if (!profile || !tenant) return null;
      const membership = await db
        .collection("tenant_membership_projections")
        .findOne({
          tenantId: tenant._id.toString(),
          userProfileId: profile._id.toString(),
        });
      const status = membership ? String(membership.status) : null;
      return status === "active" || status === "suspended" || status === "revoked"
        ? status
        : null;
    },
    async count_active_memberships() {
      const db = await database();
      const profile = await db
        .collection("user_profiles")
        .findOne({ clerkUserId: snapshot.user_id });
      if (!profile) return 0;
      return db.collection("tenant_membership_projections").countDocuments({
        userProfileId: profile._id.toString(),
        status: "active",
      });
    },
  });
}

/**
 * Onboarding status page. Explicit states from server-side principal
 * resolution — including Plan 3's suspended / removed / choose-organization
 * states. The org-context guard (organization activator + picker) is
 * mounted globally by the authenticated layout, not by this page.
 *
 * @returns Onboarding status view.
 */
export default async function OnboardingPage() {
  const state = await resolve_onboarding_state();

  const content: Record<OnboardingState, { title: string; body: string }> = {
    clerk_disabled: {
      title: "Onboarding is not available yet",
      body: "This deployment has not enabled the sign-in system. Contact your administrator.",
    },
    unauthenticated: {
      title: "Please sign in first",
      body: "Sign in with your invited account to continue onboarding.",
    },
    invitation_pending: {
      title: "Invitation pending",
      body: "Your account is not a member of a university yet. Ask your university manager to send you an invitation, then follow the link in the invitation email.",
    },
    choose_organization: {
      title: "Choose your organization",
      body: "Your account belongs to more than one university. Pick the one you want to work in from the selector, or use the organization switcher in the sidebar.",
    },
    membership_sync_pending: {
      title: "Membership synchronization pending",
      body: "Your university membership is being synchronized. This usually completes within a minute — refresh this page. If it persists, contact support.",
    },
    access_suspended: {
      title: "Access suspended",
      body: "Your access was suspended by your university manager — contact your administrator to restore it.",
    },
    membership_removed: {
      title: "Membership removed",
      body: "You are no longer a member of this university. If this is unexpected, ask your university manager for a new invitation — accepting it restores your access.",
    },
    reconciliation_required: {
      title: "Account needs attention",
      body: "Your membership requires review by an administrator before you can continue. Please contact support at your university administration.",
    },
    ready: {
      title: "You're all set",
      body: "Your university membership is active. Continue into the application.",
    },
  };

  const { title, body } = content[state];

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        {state === "unauthenticated" && (
          <Link className="underline" href="/sign-in">
            Go to sign-in
          </Link>
        )}
        {state === "ready" && (
          <Link className="underline" href="/dashboard">
            Go to dashboard
          </Link>
        )}
        <p className="text-xs text-muted-foreground">
          Need help? Contact support at your university administration.
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -- tests/web/onboarding-state.test.ts tests/web/membership-error-routing.test.ts tests/web/onboarding-ui-wiring.test.ts`
Expected: PASS (7 + 4 + 3 tests).

Browser check (repo rule): `npm run dev -w apps/web` and load `/onboarding` in Clerk mode — no hydration errors; legacy mode (unset key) still renders without Clerk throws.

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib/server/onboarding-state.ts \
        apps/web/lib/membership_error_routing.ts \
        apps/web/app/onboarding/page.tsx \
        apps/web/components/organization_activator.tsx \
        apps/web/app/providers.tsx \
        apps/web/components/conditional-layout.tsx \
        tests/web/onboarding-state.test.ts \
        tests/web/membership-error-routing.test.ts \
        tests/web/onboarding-ui-wiring.test.ts
git commit -m "feat: onboarding suspended/removed/choose-org states, org picker activator, membership-loss routing"
```

---

## Task 9: `/settings/members` rebuild — Members / Invitations tabs

Spec §4.5: tabs **Members** (name/email, role chip, status, per-row suspend / reactivate / remove — users only) and **Invitations** (pending + expired display state, revoke, resend); the invite form stays; every action optimistically refreshes via `invalidate()` and surfaces tRPC error messages (the CONFLICT texts are already human-readable from the services).

**Files:**
- Modify: `apps/web/app/settings/members/page.tsx` (full rewrite)
- Test: `tests/web/member-management-ui-wiring.test.ts`

- [ ] **Step 1: Write the failing wiring test**

```typescript
// tests/web/member-management-ui-wiring.test.ts
/**
 * Plan 3 — static wiring for the members page tabs (pattern:
 * tests/web/formulate-ui-wiring.test.ts). Pins every action to the
 * tenantMembers router procedures.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("members page wiring", () => {
  const page = () => source("apps/web/app/settings/members/page.tsx");

  it("drives every member/invitation action through the tenantMembers router", () => {
    const content = page();
    expect(content).toContain("trpc.tenantMembers.list.useQuery");
    expect(content).toContain("trpc.tenantMembers.listInvitations.useQuery");
    expect(content).toContain("trpc.tenantMembers.inviteUser.useMutation");
    expect(content).toContain("trpc.tenantMembers.suspendUser.useMutation");
    expect(content).toContain("trpc.tenantMembers.reactivateUser.useMutation");
    expect(content).toContain("trpc.tenantMembers.removeUser.useMutation");
    expect(content).toContain("trpc.tenantMembers.revokeInvitation.useMutation");
    expect(content).toContain("trpc.tenantMembers.resendInvitation.useMutation");
  });

  it("renders the expired display state and confirms destructive removal", () => {
    const content = page();
    expect(content).toContain("isExpired");
    expect(content).toContain("window.confirm");
  });

  it("offers row actions on user-role members only (manager lifecycle is platform-scope)", () => {
    expect(page()).toContain('member.tenantRole === "user"');
  });
});
```

Run: `npm run test -- tests/web/member-management-ui-wiring.test.ts`
Expected: FAIL — the current page has neither tabs nor the new procedures.

- [ ] **Step 2: Rewrite the page**

Replace `apps/web/app/settings/members/page.tsx` entirely:

```tsx
// apps/web/app/settings/members/page.tsx
"use client";

import { useState } from "react";

import { trpc } from "@/lib/trpc-client";

type MembersTab = "members" | "invitations";

/**
 * University member administration for managers (Plan 3): Members tab
 * (suspend / reactivate / remove — users only) and Invitations tab (revoke /
 * resend with the derived expired display state). Manager lifecycle is a
 * platform operation and deliberately absent; the server refuses manager
 * targets anyway.
 *
 * @returns Member management page.
 */
export default function MembersPage() {
  const [tab, setTab] = useState<MembersTab>("members");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const members = trpc.tenantMembers.list.useQuery();
  const invitations = trpc.tenantMembers.listInvitations.useQuery();

  /** Refresh both tabs after any mutation (optimistic refresh via invalidate). */
  const refresh = () => {
    void utils.tenantMembers.list.invalidate();
    void utils.tenantMembers.listInvitations.invalidate();
  };
  /** Surface the server's human-readable error text (CONFLICT messages etc.). */
  const on_error = (error: { message: string }) => setMessage(error.message);

  const invite = trpc.tenantMembers.inviteUser.useMutation({
    onSuccess: () => {
      setMessage("Invitation sent.");
      setEmail("");
      refresh();
    },
    onError: on_error,
  });
  const suspend = trpc.tenantMembers.suspendUser.useMutation({
    onSuccess: refresh,
    onError: on_error,
  });
  const reactivate = trpc.tenantMembers.reactivateUser.useMutation({
    onSuccess: refresh,
    onError: on_error,
  });
  const remove = trpc.tenantMembers.removeUser.useMutation({
    onSuccess: refresh,
    onError: on_error,
  });
  const revoke = trpc.tenantMembers.revokeInvitation.useMutation({
    onSuccess: refresh,
    onError: on_error,
  });
  const resend = trpc.tenantMembers.resendInvitation.useMutation({
    onSuccess: () => {
      setMessage("Invitation resent.");
      refresh();
    },
    onError: on_error,
  });

  /**
   * Remove a member after explicit confirmation (soft revoke; re-inviting
   * later restores the same account).
   *
   * @param user_profile_id - Target profile id.
   * @param display - Name/email shown in the confirmation prompt.
   */
  const confirm_remove = (user_profile_id: string, display: string) => {
    if (window.confirm(`Remove ${display} from this university?`)) {
      setMessage(null);
      remove.mutate({ user_profile_id });
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-lg font-semibold">University members</h1>

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          invite.mutate({ email });
        }}
      >
        <label className="block flex-1 text-sm">
          Invite student by email
          <input
            type="email"
            className="mt-1 w-full rounded border px-2 py-1"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={invite.isPending}
          className="rounded border px-4 py-1.5 text-sm"
        >
          {invite.isPending ? "Inviting…" : "Invite"}
        </button>
      </form>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <div className="flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setTab("members")}
          className={`px-3 py-1.5 text-sm ${tab === "members" ? "border-b-2 border-gray-900 font-medium" : "text-gray-500"}`}
        >
          Members
        </button>
        <button
          type="button"
          onClick={() => setTab("invitations")}
          className={`px-3 py-1.5 text-sm ${tab === "invitations" ? "border-b-2 border-gray-900 font-medium" : "text-gray-500"}`}
        >
          Invitations
        </button>
      </div>

      {tab === "members" && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {(members.data ?? []).map((member) => (
              <tr key={member._id} className="border-b">
                <td className="py-2 pr-4">{member.displayName}</td>
                <td className="py-2 pr-4">{member.email}</td>
                <td className="py-2 pr-4">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                    {member.tenantRole}
                  </span>
                </td>
                <td className="py-2 pr-4">{member.status}</td>
                <td className="py-2 pr-4 text-right">
                  {member.tenantRole === "user" && member.status === "active" && (
                    <span className="inline-flex gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => {
                          setMessage(null);
                          suspend.mutate({ user_profile_id: member.userProfileId });
                        }}
                      >
                        Suspend
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs text-red-600"
                        onClick={() =>
                          confirm_remove(
                            member.userProfileId,
                            member.displayName || member.email,
                          )
                        }
                      >
                        Remove
                      </button>
                    </span>
                  )}
                  {member.tenantRole === "user" && member.status === "suspended" && (
                    <span className="inline-flex gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        title={
                          member.profileStatus !== "active"
                            ? "The user's account is not active; reactivation is blocked."
                            : undefined
                        }
                        disabled={member.profileStatus !== "active"}
                        onClick={() => {
                          setMessage(null);
                          reactivate.mutate({ user_profile_id: member.userProfileId });
                        }}
                      >
                        Reactivate
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs text-red-600"
                        onClick={() =>
                          confirm_remove(
                            member.userProfileId,
                            member.displayName || member.email,
                          )
                        }
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {members.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-muted-foreground">
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {tab === "invitations" && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Sent</th>
              <th className="py-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {(invitations.data ?? []).map((invitation) => (
              <tr key={invitation._id} className="border-b">
                <td className="py-2 pr-4">{invitation.email}</td>
                <td className="py-2 pr-4">{invitation.tenantRole}</td>
                <td className="py-2 pr-4">
                  {invitation.status}
                  {invitation.isExpired && (
                    <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      expired
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {invitation.createdAt
                    ? new Date(invitation.createdAt).toISOString().slice(0, 10)
                    : ""}
                </td>
                <td className="py-2 pr-4 text-right">
                  {invitation.status === "invited" && invitation.tenantRole === "user" && (
                    <span className="inline-flex gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => {
                          setMessage(null);
                          resend.mutate({
                            clerk_invitation_id: invitation.clerkInvitationId,
                          });
                        }}
                      >
                        Resend
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs text-red-600"
                        onClick={() => {
                          setMessage(null);
                          revoke.mutate({
                            clerk_invitation_id: invitation.clerkInvitationId,
                          });
                        }}
                      >
                        Revoke
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {invitations.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-muted-foreground">
                  No invitations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

Note: `member.profileStatus` exists because Task 6's `list_tenant_members` join added it to `tenantMembers.list` rows.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm run test -- tests/web/member-management-ui-wiring.test.ts`
Expected: PASS (3 tests).

Browser check (repo rule): as a manager, open `/settings/members` — both tabs render, invite still works, suspend→reactivate round-trips, remove asks for confirmation, revoke/resend appear on pending invitations only.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/settings/members/page.tsx tests/web/member-management-ui-wiring.test.ts
git commit -m "feat: members page — members/invitations tabs with full lifecycle actions"
```

---
## Task 10: Org switcher + role-gated nav links + org-switch cache clear

Spec §4.5: Clerk's `<OrganizationSwitcher/>` (exported by `@clerk/nextjs` 7.5.18) with `hidePersonal` and the management/create surfaces hidden via appearance, mounted in `navigation.tsx` but **gated on Clerk mode** — the sidebar also renders in legacy mode where Clerk components throw without `ClerkProvider` (mirror `app-auth.tsx:38`). tRPC query keys carry no org id and React Query holds a 10-minute gcTime, so an orgId watcher clears the whole query cache and navigates home on switch. Nav gains "Members" (tenant managers) and "Platform" (platform roles) links driven by `auth.me` (display-only).

**Files:**
- Create: `apps/web/components/org_switcher_panel.tsx`
- Modify: `apps/web/components/navigation.tsx`
- Test: `tests/web/org-switch-ui-wiring.test.ts`

- [ ] **Step 1: Write the failing wiring test**

```typescript
// tests/web/org-switch-ui-wiring.test.ts
/**
 * Plan 3 — static wiring for the org switcher, the org-switch cache guard,
 * and the role-gated navigation links (pattern:
 * tests/web/formulate-ui-wiring.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("org switcher panel", () => {
  it("wraps OrganizationSwitcher with the cache-clearing switch guard", () => {
    const panel = source("apps/web/components/org_switcher_panel.tsx");
    expect(panel).toContain("<OrganizationSwitcher");
    expect(panel).toContain("hidePersonal");
    expect(panel).toContain("queryClient.clear()");
    // First-render guard: never clear on mount, only on a real switch.
    expect(panel).toContain("previous_org.current === undefined");
    // In-app member admin: Clerk's own manage/create surfaces are hidden.
    expect(panel).toContain("organizationSwitcherPopoverActionButton__manageOrganization");
    expect(panel).toContain("organizationSwitcherPopoverActionButton__createOrganization");
  });
});

describe("navigation", () => {
  it("gates the switcher on Clerk mode and the links on auth.me roles", () => {
    const nav = source("apps/web/components/navigation.tsx");
    expect(nav).toContain("clerk_enabled &&");
    expect(nav).toContain("<OrgSwitcherPanel");
    expect(nav).toContain("trpc.auth.me.useQuery");
    expect(nav).toContain('"/settings/members"');
    expect(nav).toContain('"/platform/tenants"');
    expect(nav).toContain("is_tenant_manager");
    expect(nav).toContain("has_platform_role");
  });
});
```

Run: `npm run test -- tests/web/org-switch-ui-wiring.test.ts`
Expected: FAIL — the panel does not exist and navigation has none of the wiring.

- [ ] **Step 2: Create the switcher panel with the cache guard**

```tsx
// apps/web/components/org_switcher_panel.tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { OrganizationSwitcher, useAuth as useClerkAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Organization switcher plus the org-switch cache guard (Plan 3).
 *
 * tRPC query keys carry no organization id and React Query holds a
 * 10-minute gcTime, so without an explicit clear, tenant-A rows would bleed
 * into tenant-B views after switching. This component watches the active
 * orgId; on a REAL change (never the first render) it clears the entire
 * query cache and navigates home, and the server re-resolves the principal
 * from the new active organization.
 *
 * Clerk-only: the parent must gate rendering on the publishable key —
 * Clerk hooks throw outside ClerkProvider (app-auth.tsx pattern).
 */
export function OrgSwitcherPanel() {
  const { orgId } = useClerkAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const previous_org = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const current = orgId ?? null;
    if (previous_org.current === undefined) {
      previous_org.current = current; // first render: record only, never clear
      return;
    }
    if (previous_org.current !== current) {
      previous_org.current = current;
      console.info({
        boundary: "org-switcher",
        event: "org.switched",
        cache_cleared: true,
      });
      queryClient.clear();
      router.push("/");
      router.refresh();
    }
  }, [orgId, queryClient, router]);

  return (
    <OrganizationSwitcher
      hidePersonal
      afterSelectOrganizationUrl="/"
      appearance={{
        elements: {
          // Member admin stays in-app (/settings/members) and organizations
          // are platform-provisioned; hide Clerk's own management surfaces.
          // Instance-level settings additionally disable member-initiated
          // leave (Task 14); the zero-manager detector is the backstop.
          organizationSwitcherPopoverActionButton__manageOrganization: {
            display: "none",
          },
          organizationSwitcherPopoverActionButton__createOrganization: {
            display: "none",
          },
        },
      }}
    />
  );
}
```

- [ ] **Step 3: Wire navigation.tsx**

Four precise edits to `apps/web/components/navigation.tsx`:

**(a)** Replace the lucide import (line 5) to add the two icons:

```tsx
import { Package, LogOut, Menu, X, ChevronLeft, ChevronRight, BoxIcon, Beaker, ChevronDown, Plus, Database, Sparkles, MessageSquare, Users, Shield } from "lucide-react";
```

**(b)** After `import { trpc } from "@/lib/trpc-client";` add:

```tsx
import { OrgSwitcherPanel } from "@/components/org_switcher_panel";

// Clerk components render only when the deployment configures Clerk — the
// sidebar also renders in the legacy flow, where Clerk components throw
// without ClerkProvider (same build-time check as app-auth.tsx).
const clerk_enabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
```

**(c)** Directly below the two `chatThreads.list` queries (after the `sales_rnd_threads` declaration), add:

```tsx
  // Display-only role view for link visibility; the server still authorizes
  // every procedure behind these pages (auth.me is never an authz source).
  const me = trpc.auth.me.useQuery(undefined, {
    enabled: !!user,
    refetchOnWindowFocus: false,
  });
  const is_tenant_manager = me.data?.tenant_role === "manager";
  const has_platform_role = Boolean(me.data?.platform_role);
```

and replace the closing of the `navigationItems` array — the last two entries

```tsx
    { type: "link", href: "/ai/raw-materials-ai", label: "Stock Materials AI", icon: Database },
    { type: "link", href: "/ai/sales-rnd-ai", label: "Sales Formulation AI", icon: Sparkles },
  ];
```

with

```tsx
    { type: "link", href: "/ai/raw-materials-ai", label: "Stock Materials AI", icon: Database },
    { type: "link", href: "/ai/sales-rnd-ai", label: "Sales Formulation AI", icon: Sparkles },
    ...(is_tenant_manager || has_platform_role
      ? [{ type: "separator" }, { type: "section-title", label: "ADMINISTRATION" }]
      : []),
    ...(is_tenant_manager
      ? [{ type: "link", href: "/settings/members", label: "Members", icon: Users }]
      : []),
    ...(has_platform_role
      ? [{ type: "link", href: "/platform/tenants", label: "Platform", icon: Shield }]
      : []),
  ];
```

**(d)** Between the closing `</nav>` tag and the `{/* User */}` block, add the switcher mount:

```tsx
        {/* Org switcher: Clerk mode only — the sidebar also renders in the
            legacy flow where Clerk components would throw. Collapsed sidebar
            hides it (the popover needs horizontal room). */}
        {clerk_enabled && !isSidebarCollapsed && (
          <div className="px-2 py-2 border-t border-gray-200">
            <OrgSwitcherPanel />
          </div>
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/web/org-switch-ui-wiring.test.ts`
Expected: PASS (2 tests).

Browser check (repo rule): in Clerk mode with a two-org test user — switcher lists both orgs, no personal workspace, no manage/create actions; switching lands on `/` with freshly loaded (not stale) tenant data. In legacy mode (no publishable key at build) the sidebar renders without errors and without the switcher.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/org_switcher_panel.tsx \
        apps/web/components/navigation.tsx \
        tests/web/org-switch-ui-wiring.test.ts
git commit -m "feat: org switcher with cache-clearing switch guard and role-gated nav links"
```

---

## Task 11: Platform tenant detail page — members, appoint, demote

Spec §4.3: `/platform/tenants/[tenantId]` shows tenant metadata, the member list (`platformTenants.listMembers`), the appoint-manager form (EXISTING `appointManager`), and per-manager "Demote to user" (`platformTenants.demoteManager`). `/platform/tenants` rows link to it. The `/platform` layout already gates rendering server-side; every query/mutation is `platformAdminProcedure`-authorized regardless.

**Files:**
- Create: `apps/web/app/platform/tenants/[tenantId]/page.tsx`
- Modify: `apps/web/app/platform/tenants/page.tsx` (slug cell links to detail)
- Test: `tests/web/platform-tenant-detail-wiring.test.ts`

- [ ] **Step 1: Write the failing wiring test**

```typescript
// tests/web/platform-tenant-detail-wiring.test.ts
/**
 * Plan 3 — static wiring for the platform tenant detail page (pattern:
 * tests/web/formulate-ui-wiring.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("platform tenant detail wiring", () => {
  it("drives members/appoint/demote through the platformTenants router", () => {
    const page = source("apps/web/app/platform/tenants/[tenantId]/page.tsx");
    expect(page).toContain("trpc.platformTenants.listMembers.useQuery");
    expect(page).toContain("trpc.platformTenants.appointManager.useMutation");
    expect(page).toContain("trpc.platformTenants.demoteManager.useMutation");
    expect(page).toContain('member.tenantRole === "manager"');
    expect(page).toContain("window.confirm");
  });

  it("links tenant rows to the detail page", () => {
    const list = source("apps/web/app/platform/tenants/page.tsx");
    expect(list).toContain("/platform/tenants/${tenant._id}");
  });
});
```

Run: `npm run test -- tests/web/platform-tenant-detail-wiring.test.ts`
Expected: FAIL — the detail page does not exist and the list has no row links.

- [ ] **Step 2: Create the detail page**

```tsx
// apps/web/app/platform/tenants/[tenantId]/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { trpc } from "@/lib/trpc-client";

/**
 * Platform tenant detail (Plan 3): tenant metadata, member list, appoint-
 * manager form, and per-manager demotion. The surrounding /platform layout
 * gates rendering server-side; every query/mutation here is additionally
 * authorized by platformAdminProcedure. Shows tenant lifecycle metadata and
 * identity rows only — never tenant business data.
 *
 * @returns Tenant detail administration page.
 */
export default function PlatformTenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const tenant_id = params.tenantId;
  const [managerEmail, setManagerEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const tenants = trpc.platformTenants.list.useQuery();
  const members = trpc.platformTenants.listMembers.useQuery({ tenant_id });
  const tenant = tenants.data?.find((entry: any) => entry._id === tenant_id);

  /** Refresh the member list after any mutation. */
  const refresh = () =>
    void utils.platformTenants.listMembers.invalidate({ tenant_id });

  const appoint = trpc.platformTenants.appointManager.useMutation({
    onSuccess: () => {
      setMessage("Manager invitation sent.");
      setManagerEmail("");
      refresh();
    },
    onError: (error) => setMessage(error.message),
  });
  const demote = trpc.platformTenants.demoteManager.useMutation({
    onSuccess: () => {
      setMessage("Manager demoted to user.");
      refresh();
    },
    onError: (error) => setMessage(error.message),
  });

  /**
   * Demote one manager after explicit confirmation (last-manager demotions
   * are refused server-side with a CONFLICT message).
   *
   * @param user_profile_id - Target profile id.
   * @param display - Name/email shown in the confirmation prompt.
   */
  const confirm_demote = (user_profile_id: string, display: string) => {
    if (window.confirm(`Demote ${display} to user?`)) {
      setMessage(null);
      demote.mutate({ tenant_id, user_profile_id });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm underline" href="/platform/tenants">
          ← Universities
        </Link>
        <h2 className="mt-2 text-base font-semibold">
          {tenant ? tenant.name : "University"}
        </h2>
      </div>

      {tenant && (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Slug</dt>
            <dd className="font-mono">{tenant.slug}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd>{tenant.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Plan</dt>
            <dd>{tenant.planKey}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Region</dt>
            <dd>{tenant.dataResidencyRegion}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Clerk organization</dt>
            <dd className="font-mono">{tenant.clerkOrganizationId ?? "—"}</dd>
          </div>
        </dl>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          appoint.mutate({ tenant_id, email: managerEmail });
        }}
      >
        <label className="block flex-1 text-sm">
          Appoint manager by email
          <input
            type="email"
            className="mt-1 w-full rounded border px-2 py-1"
            value={managerEmail}
            onChange={(event) => setManagerEmail(event.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={appoint.isPending}
          className="rounded border px-4 py-1.5 text-sm"
        >
          {appoint.isPending ? "Appointing…" : "Appoint"}
        </button>
      </form>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Email</th>
            <th className="py-2 pr-4">Role</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4" />
          </tr>
        </thead>
        <tbody>
          {(members.data ?? []).map((member) => (
            <tr key={member._id} className="border-b">
              <td className="py-2 pr-4">{member.displayName}</td>
              <td className="py-2 pr-4">{member.email}</td>
              <td className="py-2 pr-4">{member.tenantRole}</td>
              <td className="py-2 pr-4">{member.status}</td>
              <td className="py-2 pr-4 text-right">
                {member.tenantRole === "manager" && member.status === "active" && (
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() =>
                      confirm_demote(
                        member.userProfileId,
                        member.displayName || member.email,
                      )
                    }
                  >
                    Demote to user
                  </button>
                )}
              </td>
            </tr>
          ))}
          {members.data?.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-muted-foreground">
                No members yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Link the tenant table rows**

In `apps/web/app/platform/tenants/page.tsx`, replace the slug cell

```tsx
              <td className="py-2 pr-4 font-mono">{tenant.slug}</td>
```

with

```tsx
              <td className="py-2 pr-4 font-mono">
                <Link className="underline" href={`/platform/tenants/${tenant._id}`}>
                  {tenant.slug}
                </Link>
              </td>
```

(`Link` is already imported at the top of that file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/web/platform-tenant-detail-wiring.test.ts`
Expected: PASS (2 tests).

Browser check (repo rule): as a platform admin, `/platform/tenants` → click a slug → metadata + members render; appoint sends a manager invitation; demoting the sole manager surfaces the CONFLICT message inline ("must retain at least one active manager").

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/platform/tenants/[tenantId]/page.tsx" \
        apps/web/app/platform/tenants/page.tsx \
        tests/web/platform-tenant-detail-wiring.test.ts
git commit -m "feat: platform tenant detail page — members, appoint, demote"
```

---

## Task 12: Zero-manager detector (webhook)

Spec §4.3: Clerk-originated events (dashboard removal, member leave, dashboard demote) CANNOT be blocked — after applying a revoke or a role change, if the tenant has no active manager, the webhook writes a `tenant_zero_managers` audit/alert event for platform repair. Requires two new projection deps: a tenant lookup by Clerk membership id (the deleted payload carries only the membership id) and an active-manager count.

**Files:**
- Modify: `apps/ai/server/services/provisioning/apply-clerk-event.ts`
- Modify: `apps/web/app/api/webhooks/clerk/route.ts`
- Modify: `tests/provisioning/clerk-webhooks.test.ts` (extend fake + new describe)
- Modify: `tests/resilience/webhook-burst.test.ts` (two new fake methods)

- [ ] **Step 1: Extend the webhook tests (failing first)**

In `tests/provisioning/clerk-webhooks.test.ts`, add two methods to the `projections` literal of `fake_world`, directly after `count_active_memberships`:

```typescript
      async find_membership_tenant_id(clerk_membership_id) {
        const existing = [...memberships.values()].find(
          (m) => m.clerkMembershipId === clerk_membership_id,
        );
        return existing ? existing.tenantId : null;
      },
      async count_active_managers(tenant_id) {
        return [...memberships.values()].filter(
          (m) =>
            m.tenantId === tenant_id &&
            m.tenantRole === "manager" &&
            m.status === "active",
        ).length;
      },
```

and append a new describe block at the end of the file:

```typescript
describe("zero-manager detector", () => {
  it("audits tenant_zero_managers when the last manager membership is deleted", async () => {
    const world = fake_world();
    world.profiles.set("user_mgr", {
      clerkUserId: "user_mgr",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    await handle_clerk_webhook(
      signed_request({
        payload: membership_created_payload({
          id: "orgmem_mgr",
          public_user_data: { user_id: "user_mgr" },
          role: "org:admin",
        }),
      }),
      world.deps,
    );
    const response = await handle_clerk_webhook(
      signed_request({
        payload: {
          type: "organizationMembership.deleted",
          data: {
            id: "orgmem_mgr",
            organization: { id: "org_known" },
            public_user_data: { user_id: "user_mgr" },
            updated_at: Date.parse("2026-07-15T01:00:00Z"),
          },
        },
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(
      world.audit_events.find((e) => e.action === "tenant_zero_managers"),
    ).toMatchObject({ tenantId: "tenant_1", trigger: "membership_deleted" });
  });

  it("audits tenant_zero_managers when a dashboard update demotes the last manager", async () => {
    const world = fake_world();
    world.profiles.set("user_mgr", {
      clerkUserId: "user_mgr",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    await handle_clerk_webhook(
      signed_request({
        payload: membership_created_payload({
          id: "orgmem_mgr",
          public_user_data: { user_id: "user_mgr" },
          role: "org:admin",
        }),
      }),
      world.deps,
    );
    const response = await handle_clerk_webhook(
      signed_request({
        payload: {
          type: "organizationMembership.updated",
          data: {
            id: "orgmem_mgr",
            organization: { id: "org_known" },
            public_user_data: { user_id: "user_mgr" },
            role: "org:member",
            updated_at: Date.parse("2026-07-15T01:00:00Z"),
          },
        },
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(
      world.audit_events.find((e) => e.action === "tenant_zero_managers"),
    ).toMatchObject({ tenantId: "tenant_1", trigger: "membership_role_change" });
  });

  it("stays silent while another active manager remains", async () => {
    const world = fake_world();
    world.profiles.set("user_mgr_a", {
      clerkUserId: "user_mgr_a",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    world.profiles.set("user_mgr_b", {
      clerkUserId: "user_mgr_b",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    await handle_clerk_webhook(
      signed_request({
        payload: membership_created_payload({
          id: "orgmem_a",
          public_user_data: { user_id: "user_mgr_a" },
          role: "org:admin",
        }),
      }),
      world.deps,
    );
    await handle_clerk_webhook(
      signed_request({
        payload: membership_created_payload({
          id: "orgmem_b",
          public_user_data: { user_id: "user_mgr_b" },
          role: "org:admin",
        }),
      }),
      world.deps,
    );
    await handle_clerk_webhook(
      signed_request({
        payload: {
          type: "organizationMembership.deleted",
          data: {
            id: "orgmem_a",
            organization: { id: "org_known" },
            public_user_data: { user_id: "user_mgr_a" },
            updated_at: Date.parse("2026-07-15T01:00:00Z"),
          },
        },
      }),
      world.deps,
    );
    expect(
      world.audit_events.some((e) => e.action === "tenant_zero_managers"),
    ).toBe(false);
  });
});
```

In `tests/resilience/webhook-burst.test.ts`, add to the `projections` fake after `count_active_memberships`:

```typescript
      async find_membership_tenant_id() {
        return null;
      },
      async count_active_managers() {
        return 1;
      },
```

Run: `npm run test -- tests/provisioning/clerk-webhooks.test.ts`
Expected: FAIL — the deps interface has no such members and no detector runs.

- [ ] **Step 2: Extend the deps interface and the apply logic**

In `apps/ai/server/services/provisioning/apply-clerk-event.ts`, add to the `projections` member of `ClerkWebhookDependencies`, after `count_active_memberships`:

```typescript
    /** Tenant of a projected membership, by Clerk membership id (deleted events carry only the id). */
    find_membership_tenant_id(clerk_membership_id: string): Promise<string | null>;
    /** Active managers within one tenant (zero-manager detector). */
    count_active_managers(tenant_id: string): Promise<number>;
```

In the `organizationMembership.created` / `updated` case, extend the applied branch — replace

```typescript
      if (outcome === "applied") {
        const active_memberships =
          await deps.projections.count_active_memberships(user_profile_id);
        if (active_memberships > 1) {
          // Multi-org membership is permitted (Plan 3). Record an
          // informational audit; user_profiles.status is NEVER mutated here.
          await deps.audit.record({
            action: "membership_multi_org",
            userProfileId: user_profile_id,
            clerkMembershipId: String(data.id),
            activeMembershipCount: active_memberships,
            occurred_at,
          });
        }
      }
      return;
```

with

```typescript
      if (outcome === "applied") {
        const active_memberships =
          await deps.projections.count_active_memberships(user_profile_id);
        if (active_memberships > 1) {
          // Multi-org membership is permitted (Plan 3). Record an
          // informational audit; user_profiles.status is NEVER mutated here.
          await deps.audit.record({
            action: "membership_multi_org",
            userProfileId: user_profile_id,
            clerkMembershipId: String(data.id),
            activeMembershipCount: active_memberships,
            occurred_at,
          });
        }
        // Zero-manager detector: a dashboard-side demotion cannot be
        // blocked — detect and alert for platform repair instead.
        if (
          role_of(data.role) === "user" &&
          (await deps.projections.count_active_managers(tenant_id)) === 0
        ) {
          await deps.audit.record({
            action: "tenant_zero_managers",
            tenantId: tenant_id,
            trigger: "membership_role_change",
            clerkMembershipId: String(data.id),
            occurred_at,
          });
        }
      }
      return;
```

Replace the whole `organizationMembership.deleted` case with:

```typescript
    case "organizationMembership.deleted": {
      // Resolve the tenant BEFORE revoking (the payload carries only the
      // Clerk membership id, and the row still exists at this point).
      const tenant_id = await deps.projections.find_membership_tenant_id(
        String(data.id),
      );
      const outcome = await deps.projections.revoke_membership(
        String(data.id),
        occurred_at,
      );
      if (outcome === "applied" && tenant_id) {
        const managers = await deps.projections.count_active_managers(tenant_id);
        if (managers === 0) {
          // Clerk-originated removals cannot be blocked; detect and alert
          // for platform repair instead of silently absorbing (spec §4.3).
          await deps.audit.record({
            action: "tenant_zero_managers",
            tenantId: tenant_id,
            trigger: "membership_deleted",
            clerkMembershipId: String(data.id),
            occurred_at,
          });
        }
      }
      return;
    }
```

- [ ] **Step 3: Add the production impls**

In `apps/web/app/api/webhooks/clerk/route.ts`, add to the `projections` literal of `production_deps`, after `count_active_memberships`:

```typescript
      async find_membership_tenant_id(clerk_membership_id) {
        const membership = await db
          .collection("tenant_membership_projections")
          .findOne({ clerkMembershipId: clerk_membership_id });
        return membership ? String(membership.tenantId) : null;
      },
      async count_active_managers(tenant_id) {
        return db.collection("tenant_membership_projections").countDocuments({
          tenantId: tenant_id,
          tenantRole: "manager",
          status: "active",
        });
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/provisioning/clerk-webhooks.test.ts tests/resilience/webhook-burst.test.ts`
Expected: PASS (12 + 1 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ai/server/services/provisioning/apply-clerk-event.ts \
        apps/web/app/api/webhooks/clerk/route.ts \
        tests/provisioning/clerk-webhooks.test.ts \
        tests/resilience/webhook-burst.test.ts
git commit -m "feat: zero-manager detector for Clerk-originated manager loss"
```

---

## Task 13: Cross-org NOT_FOUND hint

Spec §4.5 (routing overhaul deferred per §3): when a tenant-scoped query rejects with NOT_FOUND and the user belongs to more than one organization, show "Not found in this organization — you belong to N others, try switching." Implemented as a dismissible banner that subscribes to the React Query cache (all tenant data flows through client tRPC queries), gated on Clerk mode, mounted once in the authenticated layout.

**Files:**
- Create: `apps/web/components/cross_org_not_found_hint.tsx`
- Modify: `apps/web/components/conditional-layout.tsx`
- Test: `tests/web/cross-org-hint-wiring.test.ts`

- [ ] **Step 1: Write the failing wiring test**

```typescript
// tests/web/cross-org-hint-wiring.test.ts
/**
 * Plan 3 — static wiring for the cross-org NOT_FOUND hint (pattern:
 * tests/web/formulate-ui-wiring.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read a workspace file as UTF-8 source. */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("cross-org NOT_FOUND hint", () => {
  it("watches the query cache for NOT_FOUND and gates on multi-membership", () => {
    const hint = source("apps/web/components/cross_org_not_found_hint.tsx");
    expect(hint).toContain("getQueryCache().subscribe");
    expect(hint).toContain('"NOT_FOUND"');
    expect(hint).toContain("useOrganizationList");
    expect(hint).toContain("Not found in this organization");
  });

  it("is mounted in the authenticated layout, gated on Clerk mode", () => {
    const layout = source("apps/web/components/conditional-layout.tsx");
    expect(layout).toContain("<CrossOrgNotFoundHint />");
    expect(layout).toContain("clerk_enabled");
  });
});
```

Run: `npm run test -- tests/web/cross-org-hint-wiring.test.ts`
Expected: FAIL — the component does not exist.

- [ ] **Step 2: Create the hint component**

```tsx
// apps/web/components/cross_org_not_found_hint.tsx
"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useOrganizationList } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Cross-org NOT_FOUND hint (Plan 3). Cross-org deep links resolve against
 * the ACTIVE organization (slug routing is deferred), so a NOT_FOUND for a
 * multi-membership user often means "right link, wrong org". This banner
 * subscribes to the React Query cache; when any query settles in a
 * NOT_FOUND error and the user belongs to more than one organization, it
 * suggests switching. Dismissible; auto-clears on navigation.
 *
 * Clerk-only: the mount site gates on the publishable key (Clerk hooks
 * throw without ClerkProvider).
 */
export function CrossOrgNotFoundHint() {
  const [visible, set_visible] = useState(false);
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { isLoaded, userMemberships } = useOrganizationList({
    userMemberships: { pageSize: 20 },
  });
  const other_org_count = (userMemberships?.data?.length ?? 0) - 1;

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const candidate = event as {
        type?: string;
        query?: { state?: { error?: { data?: { code?: string } } | null } };
      };
      if (
        candidate.type === "updated" &&
        candidate.query?.state?.error?.data?.code === "NOT_FOUND"
      ) {
        set_visible(true);
      }
    });
    return unsubscribe;
  }, [queryClient]);

  // A navigation resets the hint — it describes the previous view's failure.
  useEffect(() => {
    set_visible(false);
  }, [pathname]);

  if (!visible || !isLoaded || other_org_count < 1) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded border bg-white p-3 text-sm shadow">
      <p>
        Not found in this organization — you belong to {other_org_count} other
        {other_org_count > 1 ? "s" : ""}. Try switching with the organization
        switcher in the sidebar.
      </p>
      <button
        type="button"
        className="mt-2 text-xs underline"
        onClick={() => set_visible(false)}
      >
        Dismiss
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Mount it in the authenticated layout**

In `apps/web/components/conditional-layout.tsx`: add the import

```tsx
import { CrossOrgNotFoundHint } from "./cross_org_not_found_hint";
```

and replace the guard declaration

```tsx
  // Org-context guard: auto-activates a sole membership; renders an explicit
  // picker for multi-membership sessions with no active organization.
  const org_guard = clerk_enabled ? <OrganizationActivator /> : null;
```

with

```tsx
  // Org-context guard: auto-activates a sole membership; renders an explicit
  // picker for multi-membership sessions with no active organization. The
  // cross-org NOT_FOUND hint shares the Clerk gate.
  const org_guard = clerk_enabled ? (
    <>
      <OrganizationActivator />
      <CrossOrgNotFoundHint />
    </>
  ) : null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/web/cross-org-hint-wiring.test.ts tests/web/onboarding-ui-wiring.test.ts`
Expected: PASS (2 + 3 tests — the onboarding wiring test still passes against the edited layout).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/cross_org_not_found_hint.tsx \
        apps/web/components/conditional-layout.tsx \
        tests/web/cross-org-hint-wiring.test.ts
git commit -m "feat: cross-org NOT_FOUND hint for multi-membership users"
```

---
## Task 14: Rollout ops — prod repair, deploy, Clerk instance settings, live verification (operator-supervised)

Spec §7. Cloud mutations are never run unattended — every step below is supervised by the operator. Prod Mongo is IP-firewalled to the droplet (trusted sources only): the repair script runs ON the droplet, in the deployed checkout. There is **no schema migration and no new index** (`uniq_membership_tenant_profile` already exists; revive logic is code-side), so `setup:commercial-indexes` does not need to run.

**Files:**
- Create: `apps/ai/scripts/repair-multi-org-suspensions.ts`
- Modify: `apps/ai/package.json` (one script line)
- Modify: `CHANGELOG.md` (rollout entry — read it first per repo rule)

- [ ] **Step 1: Full-suite gate before any ops**

Run from the worktree root: `npm run test`
Expected: entire suite PASS. If anything fails, STOP — fix before deploying.

- [ ] **Step 2: Create the repair script (dry-run by default)**

```typescript
// apps/ai/scripts/repair-multi-org-suspensions.ts
/**
 * One-time repair (Plan 3 rollout step 2): reactivate user profiles that the
 * RETIRED single-membership rule suspended.
 *
 * Candidates are correlated through membership_reconciliation_required audit
 * events (the only writer of those events was the retired rule); only
 * profiles still in status "suspended" are touched. Dry-run by default;
 * pass --apply to write. Each repair writes a membership_suspension_repaired
 * audit event, so the action is itself auditable and idempotent (a second
 * --apply run finds zero suspended candidates).
 *
 * Usage (on the droplet, in the deployed checkout):
 *   npm run repair:multi-org-suspensions -w apps/ai            # report only
 *   npm run repair:multi-org-suspensions -w apps/ai -- --apply # write
 */

import { ObjectId } from "mongodb";

/** JSON report printed on completion. */
interface RepairReport {
  readonly candidate_profile_ids: string[];
  readonly suspended_now: string[];
  readonly repaired: string[];
  readonly applied: boolean;
}

/**
 * Run the repair: correlate audits → filter still-suspended profiles →
 * (with --apply) reactivate + audit each one → print the JSON report.
 *
 * @throws Error when the database is unreachable.
 */
async function run(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.info({
    boundary: "repair-multi-org-suspensions",
    event: "repair.start",
    apply,
  });
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const client = await client_promise;
  try {
    const db = client.db();
    const events = await db
      .collection("platform_audit_events")
      .find({ action: "membership_reconciliation_required" })
      .project({ userProfileId: 1 })
      .toArray();
    const candidate_profile_ids = [
      ...new Set(
        events
          .map((event) => String(event.userProfileId))
          .filter((id) => ObjectId.isValid(id)),
      ),
    ];
    const suspended = await db
      .collection("user_profiles")
      .find({
        _id: { $in: candidate_profile_ids.map((id) => new ObjectId(id)) },
        status: "suspended",
      })
      .project({ _id: 1 })
      .toArray();
    const suspended_now = suspended.map((profile) => profile._id.toString());

    const repaired: string[] = [];
    if (apply) {
      for (const profile_id of suspended_now) {
        await db.collection("user_profiles").updateOne(
          { _id: new ObjectId(profile_id), status: "suspended" },
          { $set: { status: "active", updatedAt: new Date() } },
        );
        await db.collection("platform_audit_events").insertOne({
          action: "membership_suspension_repaired",
          userProfileId: profile_id,
          reason: "single-membership rule retired (Plan 3)",
          occurred_at: new Date(),
        });
        repaired.push(profile_id);
      }
    }

    const report: RepairReport = {
      candidate_profile_ids,
      suspended_now,
      repaired,
      applied: apply,
    };
    console.info({
      boundary: "repair-multi-org-suspensions",
      event: "repair.done",
      candidates: candidate_profile_ids.length,
      repaired: repaired.length,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error(
    "repair:multi-org-suspensions failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
```

In `apps/ai/package.json`, add to `"scripts"` (next to `"reconcile:clerk"`):

```json
    "repair:multi-org-suspensions": "tsx scripts/repair-multi-org-suspensions.ts",
```

Commit the code:

```bash
git add apps/ai/scripts/repair-multi-org-suspensions.ts apps/ai/package.json
git commit -m "feat: add multi-org suspension repair script (dry-run default)"
```

- [ ] **Step 3: Deploy (droplet, per the existing deploy practice)**

On the rnd-ai-prod droplet, in the deployed checkout:

```bash
git fetch origin && git checkout v2/dev && git pull
docker compose build && docker compose up -d
```

Verify the ACTIVE build actually carries this plan's commits (never trust the phase alone — verify the deployed commit):

```bash
git rev-parse HEAD   # must equal the last Plan 3 commit hash pushed
i=0; until curl -sf https://rndai.erporganics.com/api/trpc/auth.health >/dev/null; do
  i=$((i+1)); [ $i -gt 30 ] && echo "health check timeout" && exit 1; sleep 10;
done; echo "app is up"
```

(darwin note for any laptop-side watcher: macOS has no `timeout` — use the counter loop above.)

- [ ] **Step 4: Prod repair — previously rule-suspended profiles**

On the droplet:

```bash
npm run repair:multi-org-suspensions -w apps/ai
```

Expected: JSON report. Review `suspended_now` WITH the operator — confirm each candidate was suspended by the rule (their audit trail shows `membership_reconciliation_required`) and not by a manager action. Then either:

```bash
npm run repair:multi-org-suspensions -w apps/ai -- --apply
```

Expected: `repaired` lists the same ids; a re-run reports `suspended_now: []`. **Or**, if the first report shows `suspended_now: []`, document "none exist" in the CHANGELOG entry (spec §7.2 allows this outcome) and skip `--apply`.

- [ ] **Step 5: Clerk instance settings (operational, spec §7.4)**

In the Clerk dashboard for the production instance (operator, with screenshots for the changelog):
1. **Organizations settings** → disable members' ability to leave organizations themselves (member-initiated leave), so departures flow through in-app remove.
2. Disable organization-admin member management in Clerk's own UI surfaces (membership limits / admin deletes) so member admin happens only in-app — the switcher already hides the manage/create actions (Task 10), and the zero-manager detector (Task 12) is the backstop for anything Clerk still allows.
3. Confirm the org role pair in use matches `CLERK_ORG_ROLE_MODE` on the deployment (custom `org:manager`/`org:user` vs built-in `org:admin`/`org:member`) — Task 2's role mapping depends on it.

Record the exact toggles changed in the CHANGELOG entry (this is the runbook record).

- [ ] **Step 6: Live verification (spec §7.5)**

In a browser against production, supervised:
1. As a tenant manager: `/settings/members` → invite an allowlisted email; see it under Invitations (pending); **resend** it (old revoked, new pending); **revoke** a spare one.
2. Accept the invitation as the invited user in a second browser; membership appears active; suspend → user's session routes to `/onboarding` showing "Access suspended"; reactivate → access restored.
3. **Remove** the user; then re-invite the SAME email and accept again → access restored, and the `tenant_membership_projections` row for the pair shows the NEW `clerkMembershipId` with `status: "active"` (revive regression, verified via droplet mongosh or the members list).
4. Multi-org: invite that same (allowlisted) user into a SECOND organization; accept; both memberships active; the org switcher lists both; switching clears data (no tenant-A rows in tenant-B views) and lands on home; `platform_audit_events` contains `membership_multi_org`; `user_profiles.status` stayed `active`.
5. As a platform admin: `/platform/tenants` → click a tenant → appoint a manager; demote a non-last manager (succeeds + audit `demote_manager`); attempt to demote the last manager → inline CONFLICT "must retain at least one active manager".
6. Confirm audits exist for every action taken: `invite_tenant_user`, `resend_tenant_invitation`, `revoke_tenant_invitation`, `suspend_tenant_user`, `reactivate_tenant_user`, `remove_tenant_user`, `appoint_manager`, `demote_manager`, `membership_multi_org`.

- [ ] **Step 7: Record + commit the changelog entry**

Read `CHANGELOG.md` first (repo rule), then append the Plan 3 rollout entry: what shipped (tasks 1–13 summary), the repair report numbers (or "none exist"), the Clerk instance toggles changed, and the live-verification outcomes. Then:

```bash
git add CHANGELOG.md
git commit -m "ops: Plan 3 rollout — repair rule-suspended profiles, Clerk instance settings, live verification"
```

---

## Self-Review

**Spec coverage (each binding decision → task):**
- **§4.1 guard lift, complete footprint** (`invite-tenant-user.ts`, `appoint-manager.ts`, `platform-tenants.ts:21,158`, `tenant-members.ts:10,67`, `apply-clerk-event.ts:52-56,221-238` + `route.ts:172-186`, all four test files, `AlreadyTenantMemberError` survives) → Task 3, one task as mandated ✓. **Revive semantics** keyed `(tenantId, userProfileId)` in webhook `upsert_membership` AND the reconcile CLI insert path, unique index untouched → Task 3 (route.ts rewrite + reconcile hunk + revive regression test) ✓. **Receipt fault tolerance** claim → apply → complete, `fail()` + reclaimable `failed` receipts + 5xx → Task 3 (handler + production claim/fail + retry test) ✓. Per-request tenant context: no change, as specified ✓.
- **§4.2 tenantMembers surface**: `listInvitations` (+ expired display from `createdAt` + TTL, env-configurable, default 30) → Task 4; `revokeInvitation` / `resendInvitation` (revoke+create, audited as resend) → Task 4; `reactivateUser` (no Clerk call, refuses profile ≠ active) / `removeUser` (new manager-only permission; transaction → Clerk delete → revert; webhook later a monotonic no-op; "assert-last-manager-not-applicable for users" honored by the manager-target refusal) → Task 5; users-only guard on suspend/reactivate/remove and on invitation actions → Tasks 4–5; duplicate-invite CONFLICT ("already has a pending invitation") → Task 2 (port translation) + Task 4 (mapping) ✓.
- **§4.3 platform**: `/platform/tenants/[tenantId]` with metadata, member list (`listMembers`), appoint form (existing `appointManager`), per-manager demote → Task 11; `demoteManager` idempotent + transactional last-manager assert (ai-rollout `withTransaction` pattern) + Clerk-after-commit + revert → Task 6; Clerk-originated violations → zero-manager detector `tenant_zero_managers` → Task 12; rows link to detail → Task 11 ✓.
- **§4.4 ports**: `revoke_invitation(tenant_id, clerk_invitation_id)`, `remove_membership(tenant_id, user_profile_id)`, `update_membership_role(tenant_id, user_profile_id, role)`; org id resolved from `tenants`, user id from `user_profiles`; roles ONLY via `CLERK_ORG_ROLE_MODE` (`manager_clerk_role`/`user_clerk_role`); same secret precondition/error posture → Task 2 (verified against `OrganizationApi.d.ts:140-163,200-207` param shapes) ✓.
- **§4.5 UI**: members tabs rebuild → Task 9; `<OrganizationSwitcher/>` `hidePersonal` + appearance-hidden manage/create, Clerk-gated in the sidebar → Task 10; org-switch `queryClient.clear()` + navigate home + wiring test → Task 10; mid-session loss → activator in the authenticated layout + tRPC error routing to `/onboarding` → Task 8; activator generalized (sole-membership auto, >1 → picker, never `memberships[0]`) → Task 8; onboarding `access_suspended` / `membership_removed` / choose-org → Task 8; nav links from `auth.me` `{tenant_role, platform_role, membership_status}` display-only → Tasks 7 + 10; cross-org NOT_FOUND hint ("you belong to N others") with routing overhaul deferred → Task 13 ✓.
- **§4.6 permissions**: `tenant:members:remove_user` in the union + manager set only → Task 1; all other procedures reuse the §4.2 permission table (checked per-procedure in Tasks 4–6) ✓.
- **§5 invariants**: (1) transactional last-manager for app-initiated + detector for Clerk-originated → Tasks 6, 12; (2) projections authoritative / Clerk authoritative for existence / every mutation audited → audit calls in every service (Tasks 3–6); (3) tenant scope never touches managers; platform can → target guards (Tasks 4–5) + platform procedures (Task 6); (4) no hard deletes; revive on re-join → Task 3; (5) idempotent + monotonic webhooks, failed applies retryable, multi-membership never mutates `user_profiles.status` → Task 3 ✓.
- **§6 tests**: `MongoMemoryReplSet` for every transactional suite → Tasks 2, 6; revoke/resend/reactivate/remove happy + permission denials + acting-on-manager refusals + reactivate-refused-when-profile-suspended + duplicate-invite CONFLICT → Tasks 2, 4, 5; last-manager incl. CONCURRENT demote → Task 6; webhook revive regression, failed-apply-retryable, both-active + `membership_multi_org` + profile untouched → Task 3; zero-manager detector → Task 12; appoint/demote idempotency + role via `CLERK_ORG_ROLE_MODE` → Tasks 3 (appoint replay), 6, 2; UI wiring: tabs→procedures, switcher gating, cache clear, MEMBERSHIP_INACTIVE→onboarding, onboarding states → Tasks 8–11, 13. Isolation (manager of A → FORBIDDEN/empty on B) is enforced structurally — every tenant procedure scopes by the resolver-verified `ctx.tenant_context.tenant_id`/`actor.active_tenant_id`, and the existing `tests/integration/tenant-router-isolation.test.ts` continues to cover the procedure stack; the new services never accept a caller-supplied tenant id in tenant scope ✓.
- **§7 rollout**: repair step (correlate `membership_reconciliation_required`, reactivate or document none) → Task 14 (script + dry-run/apply); deploy without schema migration → Task 14; Clerk instance settings documented → Task 14; live verification incl. second-org invite, switch-with-cache-clear, lifecycle actions, appoint+demote, audits → Task 14 ✓. **§3 non-goals**: no custom roles, no platform-role UI, no slug routing (only the NOT_FOUND hint), no signup-posture change — nothing in this plan builds them ✓.

**Placeholder scan:** no TBD/TODO/"fill in later"/"similar to Task N" anywhere; every code step carries complete code; every test step has the exact command and expected outcome; Task 14 is explicitly operational with literal commands, and its only variables are operator-verified values (deployed commit hash, repair report contents). The single inherited `TODO(G2.6)` comment inside `create_production_member_ports` is pre-existing code carried over verbatim, not plan work.

**Type consistency (cross-task signature check):**
- `Permission` literal `"tenant:members:remove_user"` (T1) ← `require_permission(actor, "tenant:members:remove_user")` in `remove_tenant_user` (T5) and `tenantProcedure("tenant:members:remove_user")` (T5) ✓.
- `MemberAdminPorts` (T2): `find_membership(tenant_id, user_profile_id, session?) → MembershipView|null`, `set_membership_status(..., status, session?)`, `set_membership_role(..., role, session?)`, `count_active_managers(tenant_id, session?)`, `touch_tenant_for_invariant(tenant_id, session?)`, `profiles.find_profile_status`, `invitations.find_by_clerk_id/mark_status/upsert`, `clerk.create_user_invitation/revoke_invitation/remove_membership/update_membership_role`, `tenants.clerk_organization_id_for`, `transactions.run<T>((session) => …)`, `audit.record` — consumed with exactly these names/arities by `manage-invitations.ts` (T4), `manage-members.ts` (T5/T6), `demote-manager.ts` (T6), and both fakes (T4 helper, T2/T6 integration setups) ✓.
- Error classes defined once in `member-admin-ports.ts` (T2) — `MemberNotFoundError`, `ManagerActionForbiddenError`, `ProfileInactiveError`, `LastManagerError`, `InvitationNotFoundError`, `InvitationNotPendingError`, `DuplicatePendingInvitationError` — and mapped in `member-admin-errors.ts` (T4: NOT_FOUND/FORBIDDEN/CONFLICT) with the same imports in every test ✓.
- `ClerkWebhookDependencies` (T3): `receipts.{claim,complete,fail}`, projections minus `count_other_active_memberships`/`suspend_profile_authorization` plus `count_active_memberships`; T12 adds `find_membership_tenant_id` + `count_active_managers` — both fakes (webhook + burst) updated in the same tasks ✓.
- `TenantMemberPorts` narrowing sequence: T3 removes the email lookups (test fakes updated in T3), T5 removes `memberships` entirely (production literal + `tenant-invitations.test.ts` fake trimmed in T5) — excess-property fallout handled in the same tasks; `AppointManagerPorts` keeps `find_memberships_by_email`, drops `invitations.find_invitations_by_email` (production literal trimmed in T3) ✓.
- `list_tenant_members(db, tenant_id) → TenantMemberRow[]` with `profileStatus` (T6) ← members page reads `member.profileStatus` (T9) and the platform detail page reads the same row shape (T11) ✓.
- `principal_display_view` / `auth.me` returning `{tenant_role, platform_role, membership_status}` (T7) ← `me.data?.tenant_role === "manager"` / `me.data?.platform_role` in navigation (T10) ✓.
- `classify_onboarding_state(snapshot, lookups)` + `MembershipResolution` (T8) — page adapters return exactly `{kind:"ready"}` / `{kind:"rejected",code}` and tests use the same shapes ✓. `derive_invitation_display(view: InvitationView, now, ttl_days)` (T4) ← router builds an `InvitationView`-shaped literal and the page reads the produced `isExpired` field (T9) ✓.

**Known execution watch-points (verify while implementing — facts only, per repo rule):**
1. `findOneAndUpdate` in the receipt reclaim (T3) assumes driver ≥6 semantics (returns the document or `null`; repo pins mongodb 6.21.0). If a `ModifyResult` surfaces instead, compare `reclaimed.value === null`.
2. `db.client.startSession()` (T2 transactions) mirrors `ai-rollout-repository.ts:176` which passes today's replica-set tests — keep the identical pattern; do not "modernize" it.
3. Clerk appearance element keys (`organizationSwitcherPopoverActionButton__manageOrganization` / `__createOrganization`, T10) are Clerk's documented element slugs; if a v7.5 rename hides nothing, fall back to the same constraint via the dashboard settings (Task 14 step 5) — never re-enable Clerk-side member management.
4. The duplicate-invite translation matches error codes containing `"duplicate"` (Clerk emits `duplicate_record`); if production logs show a different code for pending duplicates, widen the match in `translate_duplicate_invitation_error` only — never map generic 4xx to CONFLICT.
5. The concurrent-demote test (T6) relies on `withTransaction` retrying the write-conflicted loser; if it flakes, the tenant-touch MUST stay — investigate timing, never delete the invariant guard or the test.
6. `useOrganizationList` pageSize is 20 (activator + hint); users in more than 20 orgs are out of scope for this release (invitation-only tenancy makes that unreachable today).
7. tRPC v11 query-cache errors in `route_membership_error` carry `data.code` on `TRPCClientError`; if `data` is ever undefined (network failure), the guard already fails closed (no redirect).
