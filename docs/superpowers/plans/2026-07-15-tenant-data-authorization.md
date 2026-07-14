# Tenant Data and Authorization Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every private application and AI record explicit tenant provenance and make cross-tenant access impossible through routes, tools, IDs, logs, exports, or background jobs.

**Architecture:** Add tenantId as an expansion field, backfill it from approved identity/organization mappings, and verify every record before enforcement. TenantExecutionContext is the only repository scope input. Domain repositories inject tenant predicates and ownership rules; routers and AI tools cannot access tenant collections directly. After dual-read verification, tenantId becomes required and legacy organization fields stop authorizing access.

**Tech Stack:** MongoDB, Prisma 6.19, TypeScript 5.9, tRPC 11.6, Clerk-derived RequestPrincipal, Vitest 4.1.10.

## Global Constraints

- No guessing tenant ownership; ambiguous records quarantine; lookups combine _id and tenantId; zero-match mutation returns generic not found; only repositories touch private collections; platform admins need explicit time-bound support grants to tenant content; migrations are idempotent and report hashes/counts.

---

## File Structure

- packages/shared-types/src/tenant.ts and apps/ai/server/auth/tenant-execution-context.ts own trusted scope.
- prisma/schema.prisma records tenant and actor provenance.
- apps/ai/server/services/migrations and apps/ai/scripts own audit, backfill, quarantine, and verification.
- apps/ai/server/repositories owns all private collection access and resource predicates.
- apps/ai/server/routers and legacy tool handlers consume repositories but never raw collections.
- scripts/security/scan-private-boundaries.ts rejects repository bypass.

### Task 1: Define tenant execution and ownership contracts

**Files:**

- Create: packages/shared-types/src/tenant.ts
- Modify: packages/shared-types/src/index.ts
- Create: apps/ai/server/auth/tenant-execution-context.ts
- Create: apps/ai/server/auth/support-access.ts
- Create: apps/ai/server/repositories/support-access-repository.ts
- Create: apps/ai/server/routers/platform-support-access.ts
- Modify: prisma/schema.prisma
- Create: tests/auth/tenant-execution-context.test.ts

**Interfaces:**

- Consumes: RequestPrincipal and optional active SupportAccessGrant.

- Produces: TenantExecutionContext that repositories require.

**Failing test anchor:**

~~~ts
it("rejects a platform admin without membership or support grant", () => {
  expect(() => build_tenant_execution_context(platform_admin, null))
    .toThrowError(expect.objectContaining({ code: "TENANT_MEMBERSHIP_REQUIRED" }));
});
~~~

**Implementation anchor:**

~~~ts
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
~~~

- [x] **Step 1:** Write failing tests for an active member, suspended membership, platform admin without membership, expired support grant, valid support grant, and requested/body tenant mismatch.
- [x] **Step 2:** Run npm test -- tests/auth/tenant-execution-context.test.ts.
- [x] **Step 3:** Expected: FAIL because the context builder does not exist.
- [x] **Step 4:** Define TenantExecutionContext with tenant_id, actor_profile_id, clerk_user_id, clerk_organization_id, membership_id, tenant_role, permissions, access_mode(member|support), support_grant_id, correlation_id, and request_started_at.
- [x] **Step 5:** Define SupportAccessGrant with tenantId, platformProfileId, reason, approvedByProfileId, expiresAt, revokedAt, and audit correlation. It grants only the named diagnostic permissions, never blanket manager role.
- [x] **Step 6:** Add SupportAccessGrant to Prisma with tenantId, platformProfileId, reason, permissions, requestedAt, approvedByProfileId, approvedAt, expiresAt, revokedAt, correlationId unique, and indexes on [tenantId,expiresAt] and [platformProfileId,expiresAt].
- [x] **Step 7:** Expose request through platformAdminProcedure and approve/revoke through superAdminProcedure. Reject self-approval, durations above the platform maximum, content permissions not explicitly requested, and access without an unexpired approved record; audit request, approval, use, expiry, and revocation.
- [x] **Step 8:** Implement build_tenant_execution_context(principal, support_grant). For member mode, require active_tenant_id and active membership. For support mode, require a non-expired, non-revoked grant approved by a different super admin.
- [x] **Step 9:** Freeze the returned context in development/test so code cannot swap tenant_id mid-request.
- [x] **Step 10:** Run npm test -- tests/auth/tenant-execution-context.test.ts.
- [x] **Step 11:** Expected: PASS.
- [x] **Step 12:** Commit: git add packages/shared-types prisma apps/ai/server/auth apps/ai/server/repositories apps/ai/server/routers tests/auth && git commit -m "feat: define tenant execution context"

### Task 2: Expand every private schema with tenant provenance

**Files:**

- Modify: prisma/schema.prisma
- Create: docs/commercial/data/tenant-ownership-map.md
- Create: tests/architecture/tenant-schema.test.ts

**Interfaces:**

- Consumes: current schema and the Tenant model from G1.

- Produces: nullable expansion fields and indexes suitable for safe backfill.

**Failing test anchor:**

~~~ts
it.each(tenant_owned_models)("%s declares tenantId", (model_name) => {
  const model = parse_prisma_model(schema_source, model_name);
  expect(model.fields.get("tenantId")?.native_type).toBe("ObjectId");
});
~~~

**Implementation anchor:**

~~~prisma
model FormulaComment {
  id             String @id @default(auto()) @map("_id") @db.ObjectId
  tenantId       String? @db.ObjectId
  formulaId      String @db.ObjectId
  actorProfileId String? @db.ObjectId
  @@index([tenantId, formulaId, version])
}
~~~

Apply the same tenantId and actor/owner pattern to every model listed in this task before making any field required.

- [x] **Step 1:** Write a schema test that parses schema.prisma and asserts tenantId on Product, StockEntry, Formula, FormulaVersionLog, FormulaComment, Order, CreditTransaction, ProductLog, Conversation, Feedback, AiResponse, ChatThread, ChatMessage, and PriceCalculation.
- [x] **Step 2:** Assert compound tenant indexes for every resource key used by a lookup, including [tenantId,id] conceptually through Mongo _id filtering, [tenantId,formulaId], [tenantId,userProfileId], [tenantId,threadId], [tenantId,createdAt], and [tenantId,status].
- [x] **Step 3:** Run npm test -- tests/architecture/tenant-schema.test.ts.
- [x] **Step 4:** Expected: FAIL and list models without tenantId.
- [x] **Step 5:** Add nullable tenantId String? @db.ObjectId to each listed model during expansion. Keep organizationId temporarily for dual-read comparison; never make tenantId required before Task 4 verifies the backfill.
- [x] **Step 6:** Add actorProfileId to records currently carrying free-form createdBy/userId where attribution is required. Add ownerProfileId to Conversation, ChatThread, Formula draft, Feedback, and AI artifacts that have owner-level rules.
- [x] **Step 7:** Keep RawMaterial platform-global. Mark UserLog scope as platform or tenant and require tenantId only for tenant events. Document Organization, Account, Session, and User as legacy-only.
- [x] **Step 8:** Document each collection, scope, source field, conflict rule, owner rule, and enforcement status in tenant-ownership-map.md. Every row must contain a resolved value.
- [x] **Step 9:** Run npx prisma format && npx prisma validate && npx prisma generate.
- [x] **Step 10:** Run npm test -- tests/architecture/tenant-schema.test.ts.
- [x] **Step 11:** Expected: PASS.
- [x] **Step 12:** Commit: git add prisma docs/commercial/data tests/architecture && git commit -m "feat: add tenant provenance to private schemas"

### Task 3: Build an auditable tenant backfill and quarantine workflow

**Files:**

- Create: apps/ai/scripts/audit-tenant-ownership.ts
- Create: apps/ai/scripts/backfill-tenant-ownership.ts
- Create: apps/ai/scripts/verify-tenant-ownership.ts
- Create: apps/ai/server/services/migrations/tenant-ownership-mapper.ts
- Create: tests/migrations/tenant-ownership-mapper.test.ts
- Modify: apps/ai/package.json
- Create: docs/commercial/runbooks/tenant-backfill.md

**Interfaces:**

- Consumes: Tenant.legacyOrganizationId, UserProfile.legacyAccountId, legacy records, parent resource links.

- Produces: deterministic mapping, quarantine records, before/after reports, and no silently assigned tenant.

**Failing test anchor:**

~~~ts
it("quarantines conflicting ownership evidence", () => {
  expect(resolve_tenant_ownership({
    direct_tenant_id: tenant_a,
    parent_tenant_id: tenant_b,
    unique_actor_tenant_id: tenant_a,
  })).toEqual({
    kind: "quarantine",
    reason: "CONFLICTING_OWNERS",
    candidates: [tenant_a, tenant_b],
  });
});
~~~

**Implementation anchor:**

~~~ts
export function resolve_tenant_ownership(
  evidence: OwnershipEvidence,
): OwnershipResolution {
  const candidates = unique_ids([
    evidence.direct_tenant_id,
    evidence.parent_tenant_id,
    evidence.unique_actor_tenant_id,
  ]);
  if (candidates.length === 1) return { kind: "resolved", tenant_id: candidates[0] };
  return {
    kind: "quarantine",
    reason: candidates.length === 0 ? "NO_OWNER" : "CONFLICTING_OWNERS",
    candidates,
  };
}
~~~

- [x] **Step 1:** Write failing fixtures for direct organization match, parent Formula match, parent ChatThread match, user-only unique match, conflicting parent/user match, missing parent, malformed ObjectId, and replay.
- [x] **Step 2:** Run npm test -- tests/migrations/tenant-ownership-mapper.test.ts.
- [x] **Step 3:** Expected: FAIL.
- [x] **Step 4:** Implement mapping precedence: direct organizationId -> parent tenantId -> uniquely mapped legacy user. If two sources disagree or none resolve, return quarantine with source values and reason; do not choose one.
- [x] **Step 5:** Make audit dry-run scan every listed collection and output JSON counts: total, already_scoped, resolvable, ambiguous, orphaned, malformed, conflicts, by_collection, by_tenant. Include a SHA-256 of sorted record IDs per bucket.
- [x] **Step 6:** Make backfill require --apply --audit-hash=<hash>. Use conditional updates matching _id and tenantId=null so replay cannot overwrite a concurrent assignment. Write migration_receipts for each batch.
- [x] **Step 7:** Make verify repeat the audit and compare per-tenant counts to source mappings. Exit non-zero if ambiguous, orphaned, malformed, conflicts, or changed-after-audit is nonzero.
- [x] **Step 8:** Add npm scripts tenant:audit, tenant:backfill, and tenant:verify.
- [x] **Step 9:** Document backup, dry-run, review, apply, verify, quarantine repair, rollback, and evidence commands with exact flags.
- [x] **Step 10:** Run npm test -- tests/migrations/tenant-ownership-mapper.test.ts.
- [x] **Step 11:** Expected: PASS.
- [x] **Step 12:** Commit: git add apps/ai scripts tests/migrations docs/commercial/runbooks && git commit -m "feat: add verified tenant ownership backfill"

### Task 4: Introduce tenant-scoped domain repositories

**Files:**

- Create: apps/ai/server/repositories/tenant-repository-base.ts
- Create: apps/ai/server/repositories/product-repository.ts
- Create: apps/ai/server/repositories/stock-repository.ts
- Create: apps/ai/server/repositories/order-repository.ts
- Create: apps/ai/server/repositories/formula-repository.ts
- Create: apps/ai/server/repositories/calculation-repository.ts
- Create: apps/ai/server/repositories/conversation-repository.ts
- Create: apps/ai/server/repositories/feedback-repository.ts
- Create: apps/ai/server/repositories/audit-log-repository.ts
- Create: tests/repositories/tenant-repositories.test.ts

**Interfaces:**

- Consumes: TenantExecutionContext and resource IDs/validated domain inputs.

- Produces: the only allowed data-access surface for tenant collections.

**Failing test anchor:**

~~~ts
it("does not reveal a formula from another tenant", async () => {
  await expect(formula_repository.get(tenant_a_context, tenant_b_formula_id))
    .rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });
  await expect(formula_repository.get(tenant_a_context, missing_formula_id))
    .rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });
});
~~~

**Implementation anchor:**

~~~ts
export async function get_formula(
  context: TenantExecutionContext,
  formula_id: string,
): Promise<FormulaDocument> {
  const formula = await formulas.findOne({
    _id: new ObjectId(formula_id),
    tenantId: new ObjectId(context.tenant_id),
  });
  if (!formula) throw new ResourceNotFoundError("FORMULA_NOT_FOUND");
  return formula;
}
~~~

- [ ] **Step 1:** Write table-driven repository tests with tenant A and tenant B records sharing every predictable secondary key. Test get/list/update/delete, nested formula comments/version logs, chat messages, and user-owned thread access.
- [ ] **Step 2:** Assert cross-tenant get/update/delete always returns the same ResourceNotFound shape as a missing ID.
- [ ] **Step 3:** Run npm test -- tests/repositories/tenant-repositories.test.ts.
- [ ] **Step 4:** Expected: FAIL.
- [ ] **Step 5:** Implement a base scope helper that accepts only TenantExecutionContext and returns { tenantId: new ObjectId(context.tenant_id) }. Do not accept tenantId as a method argument.
- [ ] **Step 6:** Implement each get filter as {_id: object_id, ...tenant_scope(context)}. Implement nested filters with both tenantId and parent ID; do not trust a parent relation alone.
- [ ] **Step 7:** Implement create methods that overwrite any tenant/actor fields with context values. Reject inputs containing security fields before database access.
- [ ] **Step 8:** Implement owner rules in repositories: users may update their own drafts/threads; managers with named permissions may view tenant review queues and confirm formulas.
- [ ] **Step 9:** Use transactions where supported for formula plus version/comment audit writes; otherwise use idempotency keys and compensating status so partial writes are visible and repairable.
- [ ] **Step 10:** Run npm test -- tests/repositories/tenant-repositories.test.ts.
- [ ] **Step 11:** Expected: PASS.
- [ ] **Step 12:** Commit: git add apps/ai/server/repositories tests/repositories && git commit -m "feat: add tenant-scoped domain repositories"

### Task 5: Convert tRPC routers to named permissions and repositories

**Files:**

- Modify: apps/ai/server/routers/calculations.ts
- Modify: apps/ai/server/routers/chat-threads.ts
- Modify: apps/ai/server/routers/conversations.ts
- Modify: apps/ai/server/routers/feedback.ts
- Modify: apps/ai/server/routers/formula-comments.ts
- Modify: apps/ai/server/routers/formula-version-logs.ts
- Modify: apps/ai/server/routers/formulas.ts
- Modify: apps/ai/server/routers/orders.ts
- Modify: apps/ai/server/routers/organizations.ts
- Modify: apps/ai/server/routers/products.ts
- Modify: apps/ai/server/routers/raw-materials-conversations.ts
- Modify: apps/ai/server/routers/raw-materials-feedback.ts
- Modify: apps/ai/server/routers/stock.ts
- Modify: apps/ai/server/routers/userLogs.ts
- Modify: apps/ai/server/routers/users.ts
- Create: tests/integration/tenant-router-isolation.test.ts

**Interfaces:**

- Consumes: tenant procedures and domain repositories.

- Produces: router operations with permission and resource-level enforcement.

**Failing test anchor:**

~~~ts
it("denies formula confirmation to a tenant user", async () => {
  const caller = create_caller(student_principal);
  await expect(caller.formulas.confirm({ formula_id: own_draft_id }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
});
~~~

**Implementation anchor:**

~~~ts
confirm: tenantPermissionProcedure("formula:confirm")
  .input(z.object({ formula_id: object_id_schema }))
  .mutation(({ ctx, input }) =>
    ctx.repositories.formulas.confirm(
      ctx.tenant_execution_context,
      input.formula_id,
    ),
  ),
~~~

- [ ] **Step 1:** Build two-tenant caller fixtures and write tests for ID enumeration, list leakage, forged organizationId, formula comment/version leakage, thread/message leakage, confirm as user, invite/AI settings as user, and platform admin without support grant.
- [ ] **Step 2:** Run npm test -- tests/integration/tenant-router-isolation.test.ts.
- [ ] **Step 3:** Expected: FAIL on legacy direct database paths.
- [ ] **Step 4:** Map procedures to exact permissions: reads to domain read permission; draft create/update to formula:draft:create or formula:draft:update_own; review request to formula:review:request; comments to formula:comment:create; confirm/status approval to formula:confirm; tenant members to member permissions; analytics/log reads to tenant:analytics:read.
- [ ] **Step 5:** Replace every db.collection call in these routers with a domain repository call receiving ctx.tenant_execution_context.
- [ ] **Step 6:** Delete organizationId, tenantId, userId, ownerId, createdBy, performedBy, and actor fields from input schemas when server derived. Keep resource IDs and business fields only.
- [ ] **Step 7:** Make organizations router read current Tenant settings only; remove organization creation and arbitrary organization lookup.
- [ ] **Step 8:** Run npm test -- tests/integration/tenant-router-isolation.test.ts.
- [ ] **Step 9:** Expected: PASS.
- [ ] **Step 10:** Commit: git add apps/ai/server/routers tests/integration && git commit -m "refactor: enforce tenant repositories in tRPC routers"

### Task 6: Convert AI tools and direct APIs to tenant repositories

**Files:**

- Modify: apps/ai/agents/react/types.ts
- Modify: apps/ai/agents/react/tool-handlers/generate-formula-handler.ts
- Modify: apps/ai/agents/react/tool-handlers/revise-formula-handler.ts
- Modify: apps/ai/agents/react/tool-handlers/confirm-formula-handler.ts
- Modify: apps/ai/agents/react/tool-handlers/get-formula-with-comments-handler.ts
- Modify: apps/ai/agents/react/tool-handlers/search-reference-formulas-handler.ts
- Modify: apps/ai/agents/react/tool-handlers/mongo-query-handler.ts
- Modify: apps/web/app/api/ai-chat/route.ts
- Modify: apps/web/app/api/ai-chat/refresh/route.ts
- Modify: apps/web/app/api/ai/raw-materials-agent/route.ts
- Modify: apps/web/app/api/ai/raw-materials-agent/langgraph-route.ts
- Modify: apps/web/app/api/agents/[agentId]/chat/route.ts
- Modify: apps/web/app/api/agents/execute/route.ts
- Create: tests/integration/tenant-ai-tool-isolation.test.ts

**Interfaces:**

- Consumes: TenantExecutionContext injected by trusted server code.

- Produces: legacy AI paths that are tenant-safe while waiting for OODA replacement.

**Failing test anchor:**

~~~ts
it("injects tenant scope instead of accepting it from a tool call", async () => {
  await expect(handle_confirm_formula(
    { formula_id: tenant_b_formula_id },
    tenant_a_tool_context,
  )).rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });
});
~~~

**Implementation anchor:**

~~~ts
export interface ToolHandlerContext {
  readonly tenant_execution_context: TenantExecutionContext;
  readonly repositories: TenantRepositories;
}

export async function handle_confirm_formula(
  args: ConfirmFormulaArgs,
  context: ToolHandlerContext,
): Promise<ConfirmFormulaResult> {
  return context.repositories.formulas.confirm(
    context.tenant_execution_context,
    args.formula_id,
  );
}
~~~

- [ ] **Step 1:** Write tests where a model/tool argument supplies tenant B formula ID while execution context is tenant A. Cover search, revise, confirm, comments, persistence, and raw Mongo query.
- [ ] **Step 2:** Run npm test -- tests/integration/tenant-ai-tool-isolation.test.ts.
- [ ] **Step 3:** Expected: FAIL because handlers query by formula ID or collection directly.
- [ ] **Step 4:** Change ToolHandlerContext to require tenant_execution_context and repositories. Security context is not part of model-visible tool schemas.
- [ ] **Step 5:** Replace formula persistence, reference search, revision, comment, and confirmation DB access with FormulaRepository.
- [ ] **Step 6:** Delete or restrict mongo-query-handler to an allowlisted read-only diagnostic repository; it may not accept collection names, raw filters, aggregation stages, or security fields from the model.
- [ ] **Step 7:** Make route handlers build TenantExecutionContext once from RequestPrincipal and pass it through. Delete organization/user fallbacks and all direct collection access.
- [ ] **Step 8:** Run npm test -- tests/integration/tenant-ai-tool-isolation.test.ts.
- [ ] **Step 9:** Expected: PASS.
- [ ] **Step 10:** Commit: git add apps/ai/agents apps/web/app/api tests/integration && git commit -m "fix: tenant-scope legacy AI tools"

### Task 7: Enforce tenant ownership and prevent repository bypass

**Files:**

- Modify: prisma/schema.prisma
- Modify: scripts/security/scan-private-boundaries.ts
- Create: tests/security/tenant-repository-boundary.test.ts
- Create: docs/commercial/evidence/g2-release.md
- Modify: CHANGELOG.md

**Interfaces:**

- Consumes: zero-error tenant verification report and converted call sites.

- Produces: required tenant fields, code-level bypass prevention, and release evidence.

**Failing test anchor:**

~~~ts
it("rejects direct tenant collection access outside repositories", () => {
  const findings = reject_tenant_collection_bypass(
    source("apps/web/app/api/example/route.ts", "db.collection('formulas').findOne({})"),
  );
  expect(findings).toEqual([
    expect.objectContaining({ code: "TENANT_REPOSITORY_BYPASS" }),
  ]);
});
~~~

**Implementation anchor:**

~~~ts
const allowed_tenant_data_paths = [
  "/apps/ai/server/repositories/",
  "/apps/ai/scripts/",
] as const;

export function reject_tenant_collection_bypass(file: SourceFile): SecurityFinding[] {
  if (allowed_tenant_data_paths.some((path) => file.fileName.includes(path))) return [];
  return find_tenant_collection_access(file);
}
~~~

- [ ] **Step 1:** Run npm run tenant:verify against the staged snapshot.
- [ ] **Step 2:** Expected: ambiguous=0, orphaned=0, malformed=0, conflicts=0 for every enforced collection.
- [ ] **Step 3:** Change tenantId from optional to required on all tenant-owned models. Remove authorization use of organizationId; retain legacy fields only where rollback comparison requires them.
- [ ] **Step 4:** Extend the AST scanner to reject db.collection with a tenant-owned collection name outside apps/ai/server/repositories and migration scripts. Reject Prisma tenant model calls outside repositories as well.
- [ ] **Step 5:** Write scanner fixtures for aliased imports, chained db.collection calls, and direct Prisma access.
- [ ] **Step 6:** Run npx prisma validate, npm run security:scan, npm test, npm run typecheck, and npm run build:web.
- [ ] **Step 7:** Expected: all PASS and zero direct tenant collection access outside allowed paths.
- [ ] **Step 8:** Record the backfill audit hash, before/after counts, quarantine resolution, isolation tests, and rollback rehearsal in docs/commercial/evidence/g2-release.md.
- [ ] **Step 9:** Update CHANGELOG.md with tenant isolation behavior and migration requirements.
- [ ] **Step 10:** Commit: git add prisma scripts tests/security docs/commercial CHANGELOG.md && git commit -m "feat: enforce tenant ownership on private data"
