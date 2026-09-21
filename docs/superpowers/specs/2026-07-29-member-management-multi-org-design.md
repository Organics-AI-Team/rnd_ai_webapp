# Member Management + Multi-Org Membership — Design (Plan 3)

**Status:** Reviewed (2-critic adversarial pass applied) · **Date:** 2026-07-29 · **Branch:** `v2/dev`
**Extends:** the Clerk tenancy design (`2026-07-15-commercial-clerk-tenancy-ooda-design.md`). Plans 1–2 (data + generator) are complete and deployed.

---

## 1. Context — what exists today (verified file:line)

- **Join is invitation-only.** Tenant creation invites the initial manager
  (`provision-university.ts:57-102`); managers invite plain users via
  `/settings/members` → `tenantMembers.inviteUser` (`tenant-members.ts:56-72`,
  role hardcoded user-side, `invite-tenant-user.ts:103`); platform admins
  appoint managers via `platformTenants.appointManager`
  (`platform-tenants.ts:139-165`) — **no UI**.
- **Sync**: Clerk webhook (svix-verified, idempotent receipts, monotonic
  clock guard) projects users/memberships/invitations into Mongo
  (`apply-clerk-event.ts`); the DB projection is authoritative for authz
  (`clerk-principal-resolver.ts:100-184`).
- **Single-membership rule (to be lifted)** enforced in three places:
  `invite-tenant-user.ts:84-95`, `appoint-manager.ts:86-97`, and
  `apply-clerk-event.ts:221-238` (second active membership suspends the
  profile + `membership_reconciliation_required` audit).
- **Gaps**: no role change/remove/reactivate/invitation management anywhere;
  suspend is Mongo-side only; `/settings/members` and `/platform` unlinked in
  navigation; no org switcher (`organization_activator.tsx:19-42` auto-picks
  `memberships[0]`, mounted only on `/onboarding`).

## 2. Goals

1. **Complete member lifecycle** (tenant manager): members + invitations
   lists; invite, resend, revoke invitation; suspend, reactivate, remove —
   server-authorized, audited, Clerk-synchronized, fully surfaced in UI.
2. **Manager lifecycle** (platform): tenant detail page wiring the existing
   `appointManager` + new `demoteManager`; per-tenant member view.
3. **Multi-org membership**: users may hold active memberships in multiple
   tenants; org switching in the UI; the three guards lifted safely
   (including the remove→re-invite lifecycle and mid-session loss of the
   active org).
4. Navigation exposes the new surfaces to the roles that may use them.

## 3. Non-goals (explicitly deferred)

- Custom roles beyond manager/user; SCIM; self-serve org creation; billing.
- Platform-role administration UI (`grantPlatformRole` stays API-only; a
  super-admin user-lookup + grant form is a later increment).
- Org-slug-in-URL routing. Cross-org deep links resolve against the active
  org; the only affordance now is a NOT_FOUND hint for multi-membership users
  ("try switching organizations").
- Changing the restricted-signup posture (Clerk allowlist stays as-is).

## 4. Design

### 4.1 Multi-org core (server) — full touch set

- **Lift the three guards.** Remove the cross-tenant checks in
  `invite-tenant-user.ts` and `appoint-manager.ts`; in `apply-clerk-event.ts`
  stop suspending on multi-membership — write an informational
  `membership_multi_org` audit instead and leave `user_profiles.status`
  untouched. The removal footprint is wider than the three sites and must all
  be cleaned in one task: `MultipleMembershipsDisabledError` import + CONFLICT
  mapping in BOTH `platform-tenants.ts:21,158` and `tenant-members.ts:10,67`;
  `appoint-manager.ts:5,74,96`; the `ClerkWebhookDependencies` members
  `count_other_active_memberships` / `suspend_profile_authorization`
  (`apply-clerk-event.ts:52-56`) and their production impls
  (`apps/web/app/api/webhooks/clerk/route.ts:172-186`); fakes/assertions in
  `tests/provisioning/appoint-manager.test.ts`,
  `tests/provisioning/tenant-invitations.test.ts`,
  `tests/provisioning/clerk-webhooks.test.ts:128-136,309`,
  `tests/resilience/webhook-burst.test.ts:75-78`. `AlreadyTenantMemberError`
  survives.
- **Membership revive semantics (BLOCKING fix).** `upsert_membership`
  (webhook `route.ts:128-144` and the reconcile CLI) must key on
  `(tenantId, userProfileId)` — reviving a revoked/suspended projection by
  setting the NEW `clerkMembershipId`, role, `status: "active"` — instead of
  `insertOne` keyed by `clerkMembershipId`. Otherwise remove→re-invite hits
  the unique `uniq_membership_tenant_profile` index (E11000) and the event is
  dropped. The unique index itself is correct and stays.
- **Webhook receipt fault tolerance.** Today the receipt is claimed BEFORE
  apply (`apply-clerk-event.ts:285-291`); a thrown apply leaves
  `already_processed=true` and the svix retry no-ops — the event is lost
  forever. Change to: claim → apply → mark completed; on apply failure mark
  the receipt `failed` (or delete the claim) so svix retries reapply. Return
  5xx on failure so svix actually retries.
- **Per-request tenant context needs no change**: the resolver already
  derives the tenant from the session's active Clerk org and validates the
  matching projection; Clerk natively supports multiple memberships.

### 4.2 Member-management API (tenant scope, `tenantMembers` router)

Thin router → service → Clerk port + projection update, mirroring the
existing invite/suspend pattern; every mutation audited.

| Procedure | Permission | Clerk call | Projection effect |
|---|---|---|---|
| `listInvitations` | `tenant:members:read` | none (projection is source) | — (derive `expired` display state from Clerk's ~30-day invitation TTL: `createdAt` + 30d, since `expiresAt` is not stored) |
| `revokeInvitation` | `tenant:members:invite_user` | `revokeOrganizationInvitation` | invitation → `revoked` |
| `resendInvitation` | `tenant:members:invite_user` | revoke + create (audited as resend) | old → `revoked`, new → `invited` |
| `reactivateUser` | `tenant:members:suspend_user` | none (app-side suspension only) | membership `suspended → active` |
| `removeUser` | `tenant:members:remove_user` (new, manager-only) | `deleteOrganizationMembership` | membership → `revoked` (soft; revived on re-invite per 4.1) |

Rules (server-enforced):
- Tenant managers act on **users only** (same guard as suspend); manager
  lifecycle is platform's (4.3). `reactivateUser` refuses when the target's
  `user_profiles.status` ≠ `active`.
- `inviteUser` maps Clerk's duplicate-pending error to CONFLICT with a human
  message ("already has a pending invitation") instead of a 500.
- `removeUser` ordering: transaction (assert-last-manager-not-applicable for
  users, write projection `revoked`) → Clerk delete → on Clerk failure,
  revert projection + rethrow. The later `organizationMembership.deleted`
  webhook is then a monotonic no-op.

### 4.3 Manager lifecycle (platform scope)

- New page `/platform/tenants/[tenantId]`: tenant metadata, member list
  (new `platformTenants.listMembers`, `platformAdminProcedure`), appoint
  manager form (EXISTING `appointManager`), per-manager "Demote to user".
- New `platformTenants.demoteManager` (`platformAdminProcedure`, idempotent:
  demoting a user-role member is a no-op success): Clerk
  `updateOrganizationMembership` + projection `tenantRole: "user"`, audited.
- **Last-manager invariant** (scoped honestly): enforced for APP-INITIATED
  mutations only (`demoteManager`, `removeUser`, `suspendUser`) via a shared
  `assert_not_last_active_manager(session, tenant_id, user_profile_id)`
  running inside a Mongo transaction (pattern: `ai-rollout-repository.ts`
  `withTransaction`); the Clerk call happens after the transaction commits,
  with revert-on-failure. Clerk-originated events (dashboard removal, member
  leave) CANNOT be blocked — instead the webhook gains a zero-manager
  detector: after applying a revoke/demote, if the tenant has no active
  manager, write a `tenant_zero_managers` audit/alert event for platform
  repair.
- `/platform/tenants` rows link to the detail page.

### 4.4 Clerk ports (additions to `production-member-ports.ts`)

Signatures keyed by what we actually store (the projection holds
`clerkMembershipId` but Clerk's API keys memberships by `(organizationId,
userId)` — `@clerk/backend` `OrganizationApi.d.ts:140-163,200-207`):

- `revoke_invitation(tenant_id, clerk_invitation_id)`
- `remove_membership(tenant_id, user_profile_id)`
- `update_membership_role(tenant_id, user_profile_id, role)`

Each internally resolves `clerkOrganizationId` from `tenants` (existing
helper, `production-member-ports.ts:162-171`) and `clerkUserId` from
`user_profiles`; internal roles translate through the existing
`CLERK_ORG_ROLE_MODE` mapping (`org:manager|org:admin` / `org:user|org:member`
pair) — never hardcode a Clerk role string. Same `CLERK_SECRET_KEY`
precondition and error mapping as the existing port.

### 4.5 UI (web) — full frontend coverage

- **`/settings/members` rebuild**: tabs **Members** (table: name/email, role
  chip, status, per-row actions suspend / reactivate / remove — users only)
  and **Invitations** (pending + expired display state, revoke, resend);
  invite form stays; all actions optimistic-refresh via `invalidate()` and
  surface tRPC error messages (CONFLICT → friendly text).
- **Org switcher**: Clerk's `<OrganizationSwitcher/>` (v7 confirmed
  exported), `hidePersonal`, org-management/leave surfaces hidden via props +
  appearance so member admin stays in-app; mounted in `navigation.tsx` but
  **gated on Clerk-enabled mode** (mirror `app-auth.tsx:38`'s publishable-key
  check — the sidebar renders in legacy mode too and Clerk components throw
  without `ClerkProvider`). Operational note: disable member-initiated leave
  and org-admin member management in the Clerk instance settings; the
  zero-manager detector (4.3) is the backstop for dashboard-side changes.
- **Org-switch cache strategy**: a small client effect watching the active
  `orgId`; on change, `queryClient.clear()` + navigate home — tRPC query keys
  carry no org id and React Query holds 10-min gcTime, so without this,
  org-A rows bleed into org-B views. Covered by a wiring test.
- **Mid-session org loss**: mount the org-context guard (generalized
  activator) in the authenticated layout (not just `/onboarding`); a global
  tRPC error handler routes `MEMBERSHIP_INACTIVE`/resolver-FORBIDDEN to
  `/onboarding`.
- **`organization_activator.tsx` generalized**: auto-activate when exactly
  one membership; with >1 and no active org, render an org-picker prompt
  (never silently `memberships[0]`).
- **Onboarding states extended**: resolver/onboarding distinguish an existing
  projection with `suspended`/`revoked` status from an absent one — new
  explicit states `access_suspended` ("access suspended by your manager —
  contact your administrator") and `membership_removed`, plus a choose-org
  state for multi-membership with no active org.
- **Navigation**: "Members" link (tenant managers), "Platform" link
  (platform roles). Visibility needs a principal source the client can read:
  add a tiny `auth.me` query returning
  `{ tenant_role, platform_role, membership_status }` from the resolved
  `RequestPrincipal` (display-only; server procedures still authorize).
- **Cross-org NOT_FOUND hint**: on tenant-scoped NOT_FOUND for a
  multi-membership user, show "Not found in this organization — you belong
  to N others, try switching." (routing overhaul deferred, §3).

### 4.6 Permissions (shared-types)

- Add `tenant:members:remove_user` to the `Permission` union and to
  `TENANT_ROLE_PERMISSIONS.manager` only (`packages/shared-types/src/auth.ts`).
  Other procedures reuse existing permissions per the 4.2 table.

## 5. Invariants (binding)

1. A tenant retains ≥1 active manager **for app-initiated mutations**
   (transaction-enforced); Clerk-originated violations are detected and
   alerted (`tenant_zero_managers`), never silently absorbed.
2. Projections stay authoritative for authz; Clerk stays authoritative for
   membership existence; every mutation is audited.
3. Managers never mint/alter managers from tenant scope; platform can.
4. No hard deletes of business identity (soft `revoked`; revive on re-join).
5. Webhook handling stays idempotent + monotonic; failed applies are
   retryable (receipt completed only after successful apply); multi-membership
   never mutates `user_profiles.status`.

## 6. Tests

- **Transactional suites use `MongoMemoryReplSet`** (plain
  `MongoMemoryServer` does not support transactions; see
  `tests/integration/ai-rollout.test.ts:9,97` for the pattern).
- Router/service integration: revoke/resend/reactivate/remove happy paths,
  permission denials, acting-on-manager refusals, last-manager invariant
  (incl. concurrent-demote via transaction), reactivate-refused-when-profile-
  suspended, duplicate-invite CONFLICT mapping.
- Webhook: remove → re-invite same user → projection REVIVED active with new
  `clerkMembershipId` (blocking-fix regression); failed apply → receipt
  retryable → svix retry applies; two active memberships → both active,
  profile untouched, `membership_multi_org` audit; zero-manager detector.
- appoint/demote: idempotency, last-manager guard, audit, role mapped via
  `CLERK_ORG_ROLE_MODE`.
- UI wiring tests: members tabs → correct tRPC procedures; switcher gated on
  Clerk mode; org-switch → `queryClient.clear()`; MEMBERSHIP_INACTIVE routes
  to onboarding; onboarding suspended/removed/choose-org states.
- Isolation: manager of tenant A → FORBIDDEN/empty on tenant B.

## 7. Rollout

1. Implement + tests green (phased subagents).
2. **Prod repair step**: find `user_profiles` suspended by the old
   multi-membership rule (correlate `membership_reconciliation_required`
   audits), reactivate or document that none exist.
3. Deploy (image rebuild + `up -d`); no schema migration (projection shape
   unchanged; revive logic is code-side).
4. Clerk instance settings: disable member-initiated leave / org-admin
   member management (operational, documented in runbook).
5. Live verification: invite an allowlisted email into a second org, accept,
   switch orgs (cache cleared), exercise suspend/reactivate/remove/revoke,
   appoint+demote a manager on the tenant detail page, confirm audits.

## 8. Risks

- Lifting the suspension guard: mitigated by the webhook regression suite;
  no other single-membership dependency found in code (verified by
  adversarial review; the removal footprint in 4.1 is the complete set).
- Prebuilt switcher behavior drift: constrained via props/appearance +
  instance settings + zero-manager backstop.
- Transaction/Clerk non-atomicity: transaction-first + revert-on-Clerk-failure
  ordering (4.2/4.3); webhook monotonic no-op absorbs the tail.
