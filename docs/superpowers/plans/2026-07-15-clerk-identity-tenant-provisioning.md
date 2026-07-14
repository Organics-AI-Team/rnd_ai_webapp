# Clerk Identity and Tenant Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary legacy principal resolver with Clerk and make platform-controlled university provisioning, manager appointment, student invitations, and legacy user import production ready.

**Architecture:** Clerk owns users, sessions, organizations, memberships, invitations, and their lifecycle events. MongoDB stores UserProfile, Tenant, and TenantMembershipProjection as internal authorization and business projections. A single ClerkPrincipalResolver joins the verified session to active internal records. Idempotent provisioning services are the only code allowed to create Clerk organizations or manager memberships.

**Tech Stack:** @clerk/nextjs 7.5.18, Next.js 16.2.10, React 19.2.7, tRPC 11.6, MongoDB/Prisma 6.19, Zod 3.25, Vitest 4.1.10.

## Global Constraints

- Disable end-user organization creation in Clerk; invitations are the normal onboarding path; platform roles are database-authoritative; super_admin alone grants platform roles; admins do not inherit tenant content access; all workflows are idempotent and audited; the legacy resolver remains behind CLERK_CUTOVER only until migration reconciliation passes.

---

## File Structure

- apps/web/proxy.ts and Clerk pages own browser session entry and coarse routing.
- apps/ai/server/auth/clerk-principal-resolver.ts joins Clerk auth state to internal projections.
- apps/ai/server/repositories/*-repository.ts owns UserProfile, Tenant, membership, and invitation persistence.
- apps/ai/server/services/provisioning/ owns idempotent Clerk organization, invitation, webhook, reconciliation, and import workflows.
- apps/ai/server/routers/platform-tenants.ts and tenant-members.ts expose role-appropriate operations.
- apps/web/app/platform and apps/web/app/settings/members own the corresponding administration UI.

### Task 1: Install Clerk and wire invitation-only web authentication

**Files:**

- Modify: apps/web/package.json
- Modify: apps/ai/package.json
- Modify: apps/web/app/layout.tsx
- Modify: apps/web/proxy.ts
- Create: apps/web/app/sign-in/[[...sign-in]]/page.tsx
- Create: apps/web/app/sign-up/[[...sign-up]]/page.tsx
- Create: apps/web/app/onboarding/page.tsx
- Create: apps/web/lib/server/clerk-config.ts
- Modify: .env.example
- Create: tests/auth/clerk-surface.test.ts

**Interfaces:**

- Consumes: Clerk publishable and secret keys and the Next.js 16 request surface.

- Produces: Clerk session UI and coarse route protection; it does not yet switch server authorization.

**Failing test anchor:**

~~~ts
it("protects API and application paths with Clerk", () => {
  const proxy_source = readFileSync("apps/web/proxy.ts", "utf8");
  expect(proxy_source).toContain("clerkMiddleware");
  expect(proxy_source).toContain("auth.protect");
  expect(proxy_source).toContain("/(api|trpc)(.*)");
});
~~~

**Implementation anchor:**

~~~ts
const is_public = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/onboarding",
  "/api/webhooks/clerk",
  "/api/health",
]);

export default clerkMiddleware(
  async (auth, request) => {
    if (!is_public(request)) await auth.protect();
  },
  { frontendApiProxy: { enabled: true } },
);
~~~

- [x] **Step 1:** Write an architecture test asserting ClerkProvider appears inside body in app/layout.tsx, proxy.ts matches /api and /trpc, and the custom /login page is not used as a protected-route destination.
- [x] **Step 2:** Run npm test -- tests/auth/clerk-surface.test.ts.
- [x] **Step 3:** Expected: FAIL because Clerk is not installed.
- [x] **Step 4:** Pin @clerk/nextjs=7.5.18 in apps/web/package.json and @clerk/backend=3.11.5 in apps/ai/package.json; run npm install. Next route code uses @clerk/nextjs/server, while framework-neutral provisioning code uses @clerk/backend.
- [x] **Step 5:** Put ClerkProvider inside the body element. This is compatible with Next cache components and avoids forcing the whole document dynamic.
- [x] **Step 6:** Implement proxy.ts with clerkMiddleware, createRouteMatcher, frontendApiProxy enabled, and await auth.protect() for application, API, and tRPC paths. Leave /sign-in, /sign-up, /api/webhooks/clerk, and health public.
- [x] **Step 7:** Create Clerk SignIn and SignUp catch-all pages. Configure SignUp to support invited users but do not render an OrganizationSwitcher or CreateOrganization component anywhere.
- [x] **Step 8:** Make /onboarding show three explicit states from a server-side principal lookup: invitation pending, membership synchronization pending, or contact support. It must not query tenant business data.
- [x] **Step 9:** Add these names to .env.example without secret values: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, CLERK_WEBHOOK_SIGNING_SECRET, NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in, NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up, CLERK_CUTOVER=false, CLERK_ORG_ROLE_MODE=custom.
- [~] **Step 10 (PENDING_EXTERNAL_DASHBOARD):** In the Clerk Dashboard disable end-user organization creation, require invitations for production sign-up, configure org:manager and org:user when CLERK_ORG_ROLE_MODE=custom, and require MFA for platform-admin accounts. Export the non-secret settings snapshot into G1 release evidence.
- [x] **Step 11:** Run npm test -- tests/auth/clerk-surface.test.ts and npm run build:web.
- [x] **Step 12:** Expected: both PASS; build succeeds because Clerk initialization reads runtime configuration only inside request/provider boundaries.
- [x] **Step 13:** Commit: git add apps/web .env.example package-lock.json && git commit -m "feat: add Clerk authentication surface"

### Task 2: Add internal identity, tenant, and membership models

**Files:**

- Modify: prisma/schema.prisma
- Create: apps/ai/server/repositories/user-profile-repository.ts
- Create: apps/ai/server/repositories/tenant-repository.ts
- Create: apps/ai/server/repositories/membership-repository.ts
- Create: tests/repositories/identity-projections.test.ts
- Create: apps/ai/scripts/bootstrap-super-admin.ts
- Create: apps/ai/scripts/setup-commercial-indexes.ts
- Modify: apps/ai/package.json

**Interfaces:**

- Consumes: Clerk stable IDs and platform bootstrap input.

- Produces: internal records with stable ObjectIds and explicit lifecycle status.

**Failing test anchor:**

~~~ts
it("allows many null external IDs but rejects duplicate present IDs", async () => {
  await tenants.insertMany([{ slug: "a" }, { slug: "b" }]);
  await tenants.insertOne({ slug: "c", clerkOrganizationId: "org_1" });
  await expect(
    tenants.insertOne({ slug: "d", clerkOrganizationId: "org_1" }),
  ).rejects.toMatchObject({ code: 11000 });
});
~~~

**Implementation anchor:**

The Prisma definitions below are the expansion schema. The index setup uses this idempotent pattern for every nullable external identifier:

~~~ts
await db.collection("tenants").createIndex(
  { clerkOrganizationId: 1 },
  {
    name: "uniq_tenant_clerk_org_present",
    unique: true,
    partialFilterExpression: { clerkOrganizationId: { $type: "string" } },
  },
);
~~~

- [x] **Step 1:** Add repository tests for unique Clerk IDs, a unique tenant/profile membership, inactive-record rejection, and a tenant lookup by Clerk organization ID.
- [x] **Step 2:** Run npm test -- tests/repositories/identity-projections.test.ts.
- [x] **Step 3:** Expected: FAIL because the models and repositories do not exist.
- [x] **Step 4:** Add Prisma enums UserProfileStatus(active,suspended,deleted), PlatformRole(super_admin,admin), TenantType(university), TenantStatus(provisioning,active,suspended,repair_required,deleted), TenantRole(manager,user), and MembershipStatus(invited,active,suspended,revoked).
- [x] **Step 5:** Add these exact model fields:

~~~prisma
model UserProfile {
  id                String            @id @default(auto()) @map("_id") @db.ObjectId
  clerkUserId       String            @unique
  legacyAccountId   String?           @db.ObjectId
  primaryEmail      String
  displayName       String
  platformRole      PlatformRole?
  status            UserProfileStatus @default(active)
  clerkSyncVersion  Int               @default(0)
  clerkSyncedAt     DateTime?
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
  memberships       TenantMembershipProjection[]
  createdTenants    Tenant[]          @relation("TenantCreator")
  @@index([primaryEmail])
  @@map("user_profiles")
}

model Tenant {
  id                    String       @id @default(auto()) @map("_id") @db.ObjectId
  clerkOrganizationId   String?
  legacyOrganizationId  String?      @db.ObjectId
  slug                  String       @unique
  name                  String
  type                  TenantType   @default(university)
  status                TenantStatus @default(provisioning)
  planKey               String
  dataResidencyRegion   String
  provisioningKey       String       @unique
  createdByProfileId    String       @db.ObjectId
  activatedAt           DateTime?
  suspendedAt           DateTime?
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt
  createdBy             UserProfile  @relation("TenantCreator", fields: [createdByProfileId], references: [id])
  memberships           TenantMembershipProjection[]
  invitations           TenantInvitationProjection[]
  @@index([status])
  @@map("tenants")
}

model TenantMembershipProjection {
  id                   String           @id @default(auto()) @map("_id") @db.ObjectId
  clerkMembershipId    String?
  tenantId             String           @db.ObjectId
  userProfileId        String           @db.ObjectId
  tenantRole           TenantRole
  status               MembershipStatus @default(invited)
  clerkSyncVersion     Int              @default(0)
  clerkSyncedAt        DateTime?
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt
  tenant               Tenant           @relation(fields: [tenantId], references: [id])
  userProfile          UserProfile      @relation(fields: [userProfileId], references: [id])
  @@unique([tenantId, userProfileId])
  @@index([userProfileId, status])
  @@map("tenant_membership_projections")
}

model TenantInvitationProjection {
  id                 String           @id @default(auto()) @map("_id") @db.ObjectId
  clerkInvitationId  String           @unique
  tenantId           String           @db.ObjectId
  emailNormalized    String
  tenantRole         TenantRole
  status             MembershipStatus @default(invited)
  invitedByProfileId String           @db.ObjectId
  expiresAt          DateTime?
  clerkSyncedAt      DateTime?
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt
  tenant             Tenant           @relation(fields: [tenantId], references: [id])
  @@index([tenantId, emailNormalized, status])
  @@map("tenant_invitation_projections")
}
~~~

- [x] **Step 6:** Generate Prisma client with npx prisma generate.
- [x] **Step 7:** Create apps/ai/scripts/setup-commercial-indexes.ts and add setup:commercial-indexes. It must create partial unique MongoDB indexes for non-null UserProfile.legacyAccountId, Tenant.clerkOrganizationId, Tenant.legacyOrganizationId, and TenantMembershipProjection.clerkMembershipId using partialFilterExpression with the correct BSON type. Test repeated setup and duplicate non-null rejection; never use Prisma @unique on these nullable Mongo fields because multiple provisioning records may be null.
- [x] **Step 8:** Implement repositories with explicit find_active methods; never expose a generic findOne filter to routers.
- [x] **Step 9:** Implement bootstrap-super-admin to succeed only if no active platform role exists, require --clerk-user-id and --email, write one UserProfile with super_admin, and append a platform_audit_events record. A second invocation must exit non-zero.
- [x] **Step 10:** Add bootstrap:super-admin=tsx scripts/bootstrap-super-admin.ts to apps/ai/package.json.
- [x] **Step 11:** Run npm test -- tests/repositories/identity-projections.test.ts.
- [x] **Step 12:** Expected: PASS.
- [x] **Step 13:** Commit: git add prisma apps/ai/server/repositories apps/ai/scripts apps/ai/package.json tests/repositories && git commit -m "feat: add Clerk identity and tenant projections"

### Task 3: Replace the legacy resolver with ClerkPrincipalResolver

**Files:**

- Create: apps/ai/server/auth/clerk-principal-resolver.ts
- Modify: apps/ai/server/auth/authorize.ts
- Modify: apps/ai/server/trpc.ts
- Modify: apps/web/lib/server/with-request-principal.ts
- Create: tests/auth/clerk-principal-resolver.test.ts
- Modify: packages/shared-types/src/auth.ts

**Interfaces:**

- Consumes: await auth() values userId, orgId, orgRole, sessionId plus internal projection repositories.

- Produces: database-authoritative RequestPrincipal for platform-only or tenant requests.

**Failing test anchor:**

~~~ts
it("does not treat a platform admin as a tenant member", async () => {
  const principal = await resolve_clerk_principal(platform_admin_auth, repositories);
  expect(principal.platform_role).toBe("admin");
  expect(principal.active_tenant_id).toBeNull();
  expect(principal.tenant_role).toBeNull();
});
~~~

**Implementation anchor:**

~~~ts
export async function resolve_clerk_principal(
  auth_state: { userId: string | null; orgId: string | null; orgRole?: string | null },
  repositories: IdentityProjectionRepositories,
): Promise<RequestPrincipal> {
  if (!auth_state.userId) throw new AuthenticationError("UNAUTHENTICATED");
  const profile = await repositories.user_profiles.require_active(auth_state.userId);
  if (!auth_state.orgId) return platform_principal(profile);
  const tenant = await repositories.tenants.require_active_by_clerk_org(auth_state.orgId);
  const membership = await repositories.memberships.require_active(tenant.id, profile.id);
  assert_clerk_role_matches(auth_state.orgRole, membership.tenant_role);
  return tenant_principal(profile, tenant, membership, auth_state);
}
~~~

- [x] **Step 1:** Expand Permission to the complete platform and university catalogue from the design specification, using colon-separated TypeScript literals that map one-to-one to dotted policy names.
- [x] **Step 2:** Write failing cases for missing user, inactive profile, no active Clerk organization, organization/projection mismatch, suspended tenant, stale/missing membership, platform-only admin, tenant manager, and tenant user.
- [x] **Step 3:** Assert that a platform-only admin gets active_tenant_id=null and tenant_role=null; a tenant request must never fabricate membership from platform role.
- [x] **Step 4:** Run npm test -- tests/auth/clerk-principal-resolver.test.ts.
- [x] **Step 5:** Expected: FAIL because the resolver does not exist.
- [x] **Step 6:** Implement resolve_clerk_principal(auth_state, repositories). Load UserProfile by userId. If orgId exists, load Tenant by clerkOrganizationId and active membership by tenant/profile. Map Clerk role through one function: org:manager or org:admin to manager; org:user or org:member to user. Reject any Clerk/internal role mismatch and emit a reconciliation audit event.
- [x] **Step 7:** Read platformRole from UserProfile for every high-impact platform request; do not read it from session claims.
- [x] **Step 8:** Add authenticatedProcedure, tenantMemberProcedure, tenantPermissionProcedure(permission), platformAdminProcedure, and superAdminProcedure. Each returns typed TRPCError codes.
- [x] **Step 9:** Change tRPC and direct route context to await Clerk auth. CLERK_CUTOVER=false may call the G0 resolver; true may only call the Clerk resolver. Record resolver_used on every request audit event.
- [x] **Step 10:** Run npm test -- tests/auth/clerk-principal-resolver.test.ts and npm test -- tests/auth.
- [x] **Step 11:** Expected: PASS.
- [x] **Step 12:** Commit: git add apps packages/shared-types tests/auth && git commit -m "feat: resolve server authorization from Clerk sessions"

### Task 4: Build idempotent platform-controlled university provisioning

**Files:**

- Create: apps/ai/server/services/provisioning/provision-university.ts
- Create: apps/ai/server/services/provisioning/provisioning-types.ts
- Create: apps/ai/server/services/audit/platform-audit-service.ts
- Create: apps/ai/server/routers/platform-tenants.ts
- Modify: apps/ai/server/index.ts
- Create: apps/web/app/platform/tenants/page.tsx
- Create: apps/web/app/platform/tenants/new/page.tsx
- Create: apps/web/app/platform/layout.tsx
- Create: tests/provisioning/provision-university.test.ts

**Interfaces:**

- Consumes: platformAdminProcedure principal and CreateUniversityInput(name,slug,region,planKey,initialManagerEmail,idempotencyKey).

- Produces: one Clerk organization, one Tenant, and one manager invitation per idempotency key.

**Failing test anchor:**

~~~ts
it("replays provisioning without duplicate Clerk objects", async () => {
  await expect(
    provision_university(admin, input, fail_after_invitation_ports),
  ).rejects.toThrow("INJECTED_FAILURE");
  const result = await provision_university(admin, input, healthy_ports);
  expect(result.status).toBe("active");
  expect(fake_clerk.created_organizations).toHaveLength(1);
  expect(fake_clerk.created_invitations).toHaveLength(1);
});
~~~

**Implementation anchor:**

~~~ts
export async function provision_university(
  actor: PlatformPrincipal,
  input: CreateUniversityInput,
  ports: ProvisioningPorts,
): Promise<ProvisionUniversityResult> {
  require_permission(actor, "platform:tenants:create");
  const tenant = await ports.tenants.begin_or_load(input, actor.internal_user_id);
  const organization = await ports.clerk.ensure_organization(tenant);
  await ports.tenants.attach_clerk_organization(tenant.id, organization.id);
  const invitation = await ports.clerk.ensure_manager_invitation(organization.id, input);
  await ports.invitations.upsert(tenant.id, invitation, actor.internal_user_id);
  return ports.tenants.activate(tenant.id);
}
~~~

- [x] **Step 1:** Write a fake Clerk client and failing tests for successful provisioning, replay after each step, Clerk organization failure, invitation failure, duplicate slug, and non-platform caller.
- [x] **Step 2:** Run npm test -- tests/provisioning/provision-university.test.ts.
- [x] **Step 3:** Expected: FAIL because the service does not exist.
- [x] **Step 4:** Define CreateUniversityInput with normalized lower-case slug, an allowlisted region, a stored plan key, manager email, and a client-generated UUID idempotency key.
- [x] **Step 5:** Implement this state machine: insert Tenant(provisioning); create Clerk organization with private metadata internal_tenant_id; persist clerkOrganizationId; invite the initial manager with the role returned by one configured mapper (custom: org:manager; built_in: org:admin) and redirect URL; persist TenantInvitationProjection; activate tenant; append audit event. Create TenantMembershipProjection only after Clerk reports an accepted organization membership. Each step checks stored state before calling Clerk again.
- [x] **Step 6:** If a retry cannot prove external state, set Tenant.status=repair_required and return a correlation ID. Never create a second organization.
- [x] **Step 7:** Expose platformTenants.create through platformAdminProcedure and platformTenants.grantPlatformRole through superAdminProcedure only.
- [x] **Step 8:** The platform UI must render server-side role checks, a tenant table, and the exact create input. It must not contain tenant business data or a support impersonation shortcut.
- [x] **Step 9:** Run npm test -- tests/provisioning/provision-university.test.ts.
- [x] **Step 10:** Expected: PASS including replay after every failpoint.
- [x] **Step 11:** Commit: git add apps/ai/server apps/web/app/platform tests/provisioning && git commit -m "feat: provision universities through platform administration"

### Task 5: Add manager invitations and Clerk webhook projections

**Files:**

- Create: apps/ai/server/services/provisioning/invite-tenant-user.ts
- Create: apps/ai/server/services/provisioning/apply-clerk-event.ts
- Create: apps/ai/server/services/provisioning/reconcile-clerk.ts
- Create: apps/ai/server/routers/tenant-members.ts
- Create: apps/web/app/api/webhooks/clerk/route.ts
- Create: apps/web/app/settings/members/page.tsx
- Create: tests/provisioning/clerk-webhooks.test.ts
- Create: tests/provisioning/tenant-invitations.test.ts

**Interfaces:**

- Consumes: signed Clerk events and tenant manager operations.

- Produces: idempotent UserProfile and membership projection lifecycle.

**Failing test anchor:**

~~~ts
it("acknowledges a duplicate webhook without applying it twice", async () => {
  const first = await post_signed_clerk_event(membership_created_event);
  const second = await post_signed_clerk_event(membership_created_event);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(await memberships.count()).toBe(1);
});
~~~

**Implementation anchor:**

~~~ts
export async function POST(request: Request): Promise<Response> {
  const event = await verifyWebhook(request);
  const receipt = await webhook_receipts.claim(event.id, event.type);
  if (receipt.already_processed) return new Response(null, { status: 200 });
  await apply_clerk_event(event);
  await webhook_receipts.complete(event.id);
  return new Response(null, { status: 200 });
}
~~~

- [x] **Step 1:** Write failing webhook tests for duplicate/out-of-order user, organization, invitation, membership create/update/delete events and invalid signatures.
- [x] **Step 2:** Write failing invitation tests proving managers may invite only tenant users and may suspend users, while only platform admins may appoint managers. Also prove the first release rejects a second active or pending university membership for a normal user.
- [x] **Step 3:** Run npm test -- tests/provisioning.
- [x] **Step 4:** Expected: FAIL.
- [x] **Step 5:** Verify the webhook with verifyWebhook(request) and CLERK_WEBHOOK_SIGNING_SECRET before parsing business fields.
- [x] **Step 6:** Store processed Clerk event IDs in clerk_webhook_receipts with unique event ID, type, occurredAt, processedAt, and result. A duplicate returns 200 without reapplying.
- [x] **Step 7:** Apply events with version/occurredAt monotonic checks so an older event cannot overwrite newer projection state. Deletion marks records revoked/deleted; it does not hard-delete business identity.
- [x] **Step 8:** Implement tenantMembers.inviteUser using tenantPermissionProcedure(tenant:members:invite_user) and always pass the user role to Clerk. Implement appointManager in the platform router only.
- [x] **Step 9:** Before invitation, resolve the normalized email to any existing UserProfile/invitation and reject another active or pending university with MULTIPLE_MEMBERSHIPS_DISABLED. If a Clerk webhook reveals multiple active memberships, suspend authorization for that profile, mark reconciliation required, and preserve both projections for repair rather than choosing one.
- [x] **Step 10:** Implement reconcile-clerk --tenant=<tenant-id> that compares Clerk and Mongo identities/memberships, emits a JSON report, repairs safe missing projections, and marks contradictory roles for manual repair.
- [x] **Step 11:** Build the manager member page with list, invite student, and suspend actions only. Hide and server-reject role promotion.
- [x] **Step 12:** Run npm test -- tests/provisioning.
- [x] **Step 13:** Expected: PASS.
- [x] **Step 14:** Commit: git add apps tests/provisioning && git commit -m "feat: synchronize Clerk membership lifecycle"

### Task 6: Import legacy identities without forced password resets

**Files:**

- Create: apps/ai/scripts/migrate-legacy-users-to-clerk.ts
- Create: apps/ai/server/services/provisioning/legacy-import.ts
- Create: tests/provisioning/legacy-import.test.ts
- Create: docs/commercial/runbooks/clerk-migration.md
- Modify: apps/ai/package.json

**Interfaces:**

- Consumes: legacy Account, User, Organization and bcrypt passwordDigest.

- Produces: Clerk users with externalId, linked UserProfiles, migration report, and no automatic university creation.

**Failing test anchor:**

~~~ts
it("imports an existing bcrypt digest and is replay safe", async () => {
  const first = await import_legacy_account(account_fixture, ports);
  const second = await import_legacy_account(account_fixture, ports);
  expect(first.clerk_user_id).toBe(second.clerk_user_id);
  expect(fake_clerk.create_user_calls[0].passwordHasher).toBe("bcrypt");
  expect(fake_clerk.create_user_calls).toHaveLength(1);
});
~~~

**Implementation anchor:**

~~~ts
const clerk_user = await clerk.users.createUser({
  emailAddress: [account.email],
  passwordDigest: account.passwordHash,
  passwordHasher: "bcrypt",
  externalId: account._id.toString(),
});
await user_profiles.link_legacy_identity({
  clerk_user_id: clerk_user.id,
  legacy_account_id: account._id,
});
~~~

- [x] **Step 1:** Write failing tests for valid bcrypt import, duplicate email, invalid digest, missing user, ambiguous organization, replay, and partial Clerk creation.
- [x] **Step 2:** Run npm test -- tests/provisioning/legacy-import.test.ts.
- [x] **Step 3:** Expected: FAIL.
- [x] **Step 4:** Implement dry-run as the default. Require --apply and --report=<path> for writes.
- [x] **Step 5:** For each reconciled account call Clerk createUser with emailAddress, passwordDigest, passwordHasher="bcrypt", and externalId equal to the legacy Account ObjectId. Persist clerkUserId and legacyAccountId in UserProfile.
- [x] **Step 6:** Do not create a university from each legacy organization automatically. Produce legacy_org_resolution with matched_tenant_id or unresolved_reason. A platform admin must approve unresolved mappings.
- [x] **Step 7:** Never print passwordDigest. Report counts and stable record IDs only.
- [x] **Step 8:** Add migrate:clerk=tsx scripts/migrate-legacy-users-to-clerk.ts and document snapshot, dry-run, sampled sign-in, reconciliation, cutover, and rollback commands.
- [x] **Step 9:** Run npm test -- tests/provisioning/legacy-import.test.ts.
- [x] **Step 10:** Expected: PASS.
- [x] **Step 11:** Commit: git add apps/ai scripts tests/provisioning docs/commercial/runbooks && git commit -m "feat: import legacy bcrypt identities into Clerk"

### Task 7: Cut over and remove custom client authentication

**Files:**

- Delete: apps/web/lib/auth-context.tsx
- Delete: apps/ai/lib/auth-context.tsx
- Delete: apps/web/app/login/page.tsx
- Delete: apps/web/app/signup/page.tsx
- Modify: apps/web/app/providers.tsx
- Modify: apps/web/components/auth-guard.tsx
- Modify: apps/web/components/ai/ai_auth_guard.tsx
- Modify: apps/web/components/navigation.tsx
- Modify: apps/ai/server/routers/auth.ts
- Create: tests/e2e/clerk-auth.spec.ts
- Create: docs/commercial/evidence/g1-release.md
- Modify: CHANGELOG.md

**Interfaces:**

- Consumes: reconciled migration report and CLERK_CUTOVER=true.

- Produces: Clerk-only client and server session handling; legacy tables remain read-only until G5.

**Failing test anchor:**

~~~ts
test("invited student cannot create a university or appoint a manager", async ({ page }) => {
  await sign_in_as(page, "student");
  await expect(page.goto("/platform/tenants/new")).toHaveURL(/sign-in|onboarding/);
  const response = await api_as(page, "tenantMembers.appointManager", manager_input);
  expect(response.status()).toBe(403);
});
~~~

**Implementation anchor:**

~~~tsx
export function AuthBoundary({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
~~~

- [x] **Step 1:** Add Playwright test cases for signed-out redirect, invited user sign-up, existing imported user sign-in, platform admin tenant creation, manager student invitation, student denied manager action, and no-membership onboarding.
- [x] **Step 2:** Pin @playwright/test=1.61.1 in root devDependencies, add test:e2e=playwright test, create playwright.config.ts with webServer command npm run dev:web and baseURL http://127.0.0.1:3000, run npm install, and run npx playwright install chromium.
- [x] **Step 3:** Run npm run test:e2e -- tests/e2e/clerk-auth.spec.ts.
- [x] **Step 4:** Expected: FAIL while custom auth UI is active.
- [x] **Step 5:** Replace custom AuthProvider and guards with Clerk SignedIn/SignedOut, UserButton, OrganizationProfile or purpose-built server components. Do not persist tokens in localStorage or JavaScript cookies.
- [x] **Step 6:** Remove login, signup, logout, and me procedures from authRouter. Leave only an explicitly public health procedure or delete the router if empty.
- [~] **Step 7 (PENDING_EXTERNAL_STAGING):** Set CLERK_CUTOVER=true in the staged environment and run reconciliation. Require zero unexplained identity, tenant, or membership mismatches.
- [x] **Step 8:** Run npm run security:scan, npm test, npm run test:e2e -- tests/e2e/clerk-auth.spec.ts, and npm run build:web.
- [x] **Step 9:** Expected: all PASS; scanner finds no localStorage auth token, custom password verification, custom session creation, or public organization creation.
- [x] **Step 10:** Record cutover flag, reconciliation hash, Clerk webhook health, test output, and rollback rehearsal in docs/commercial/evidence/g1-release.md.
- [x] **Step 11:** Update CHANGELOG.md with invitation-only onboarding and the retirement of custom session handling.
- [x] **Step 12:** Commit: git add -A && git commit -m "feat: cut authentication over to Clerk"
