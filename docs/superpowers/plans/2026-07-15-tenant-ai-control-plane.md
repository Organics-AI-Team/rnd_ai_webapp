# Tenant AI Control Plane and Knowledge Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every model call, prompt, tool, retrieval, quota, cost, approval, and artifact subject to a stored tenant policy and immutable run-time snapshot.

**Architecture:** A policy compiler combines platform hard limits, commercial plan entitlements, tenant settings, agent deployment revision, and permitted request preferences. The AI gateway reserves budget and creates AIRun before provider execution. A declarative tool registry and split platform/tenant knowledge gateway consume TenantAIExecutionContext; model-visible arguments never contain security scope. Usage and approvals are append-only and reconcile idempotently.

**Tech Stack:** MongoDB/Prisma 6.19, @qdrant/js-client-rest 1.18.0, TypeScript 5.9, Zod 3.25, tRPC 11.6, Vitest 4.1.10.

## Global Constraints

- Tenant choices can only narrow platform/plan limits; policy snapshots are immutable; no provider key reaches the client; budget is reserved before execution; all tool calls are allowlisted and schema validated; platform and tenant retrieval are separate queries; tenant payload filters are injected by trusted code; side effects require declared approval and idempotency.

---

## File Structure

- packages/shared-types/src/ai owns policy, deployment, run, event, artifact, usage, and approval contracts.
- apps/ai/server/services/ai-control owns policy compilation, budget accounting, tool governance, and execution context.
- apps/ai/server/services/knowledge owns ingestion, Qdrant partitioning, retrieval, and citations.
- apps/ai/server/repositories owns control-plane persistence.
- apps/ai/server/routers exposes manager and platform settings with named permissions.
- apps/web/app/settings/ai and apps/web/app/platform/ai own the governance UI.

### Task 1: Define AI policy, deployment, run, usage, and approval models

**Files:**

- Create: packages/shared-types/src/ai/policy.ts
- Create: packages/shared-types/src/ai/contracts.ts
- Create: packages/shared-types/src/ai/index.ts
- Modify: packages/shared-types/src/index.ts
- Modify: prisma/schema.prisma
- Create: tests/architecture/ai-control-schema.test.ts

**Interfaces:**

- Consumes: Tenant and UserProfile IDs.

- Produces: persistent control-plane and audit records with immutable version references.

**Failing test anchor:**

~~~ts
it("requires immutable policy and deployment pins on every run", () => {
  const airun = parse_prisma_model(schema_source, "AIRun");
  expect(required_fields(airun)).toEqual(expect.arrayContaining([
    "tenantId", "deploymentId", "orchestratorVersion", "policyVersion",
    "policySnapshot", "promptVersionId", "inputSchemaVersion", "outputSchemaVersion",
  ]));
});
~~~

**Implementation anchor:**

~~~ts
export interface EffectiveAIPolicy {
  readonly tenant_id: string;
  readonly version: number;
  readonly hash: string;
  readonly enabled: boolean;
  readonly provider_models: Readonly<Record<string, readonly string[]>>;
  readonly allowed_tools: readonly string[];
  readonly monthly_request_limit: bigint;
  readonly monthly_token_limit: bigint;
  readonly monthly_cost_limit_microusd: bigint;
  readonly per_user_monthly_request_limit: bigint;
  readonly per_user_monthly_token_limit: bigint;
  readonly per_user_monthly_cost_limit_microusd: bigint;
  readonly per_run_token_limit: bigint;
  readonly per_run_cost_limit_microusd: bigint;
  readonly max_concurrent_runs: number;
  readonly default_locale: string;
  readonly max_iterations: number;
  readonly approval_rules: Readonly<Record<string, "none" | "manager">>;
}
~~~

- [ ] **Step 1:** Write schema tests for tenant indexes, unique policy/deployment revisions, immutable ledger linkage, approval linkage, and required version identifiers on AIRun.
- [ ] **Step 2:** Run npm test -- tests/architecture/ai-control-schema.test.ts.
- [ ] **Step 3:** Expected: FAIL because the models do not exist.
- [ ] **Step 4:** Add enums AIProfileStatus(active,disabled), AgentDeploymentStatus(draft,active,retired), PromptStatus(draft,approved,active,retired), KnowledgeScope(platform,tenant), KnowledgeVisibility(managers,all_members), KnowledgeSourceStatus(pending,quarantined,indexing,ready,failed,deleted), AIRunStatus(queued,running,waiting_clarification,waiting_approval,completed,partial,failed,cancelled), AIUsageEntryType(reservation,actual,release,adjustment), AIApprovalStatus(pending,approved,rejected,expired), and AIArtifactStatus(draft,pending_review,confirmed,rejected,superseded).
- [ ] **Step 5:** Add TenantAIProfile with tenantId unique, status, planKey, policyVersion, allowedProviders, allowedModels, allowedTools, monthlyRequestLimit, monthlyTokenLimit, monthlyCostLimitMicrousd BigInt, perUserMonthlyRequestLimit, perUserMonthlyTokenLimit, perUserMonthlyCostLimitMicrousd BigInt, perRunTokenLimit, perRunCostLimitMicrousd BigInt, maxConcurrentRuns, maxIterations, defaultLocale, retentionDays, allowWebSearch, allowTenantKnowledge, knowledgeStorageLimitBytes, reviewPolicy JSON, qualityPolicy JSON, createdByProfileId, updatedByProfileId, timestamps, and [tenantId,status] index.
- [ ] **Step 6:** Add AgentDeployment with tenantId, agentKey, revision, status, agentDefinitionVersion, orchestratorVersion, promptVersionId, allowedProviders, allowedModels, temperature, maxOutputTokens, modelRouting JSON, toolAllowlist, approvalRules JSON, featureFlags JSON, inputSchemaVersion, outputSchemaVersion, activatedByProfileId, activatedAt, retiredAt, timestamps, @@unique([tenantId,agentKey,revision]) and @@index([tenantId,agentKey,status]).
- [ ] **Step 7:** Add PromptVersion with scope(platform|tenant), required scopeKey (the literal platform or the tenant ObjectId string), nullable tenantId, promptKey, semanticVersion, revision, status, contentHash, content, variables, parentPromptVersionId, evaluationResultId, createdByProfileId, approvedByProfileId, activatedAt, retiredAt, createdAt, and @@unique([scopeKey,promptKey,revision]). Validate that scopeKey and tenantId agree in the repository.
- [ ] **Step 8:** Add KnowledgeSource with scope(platform|tenant), scopeKey, nullable tenantId, sourceType, name, objectKey, visibility, allowedRoles, contentHash, sourceVersion, byteSize, provenance JSON, consentBasis, freshnessDate, retainedUntil, embeddingModel, embeddingVersion, status, errorCode, createdByProfileId, deletedAt, timestamps, plus scope/status and tenant/status indexes. Validate platform scope has no tenantId and tenant scope has the matching scopeKey.
- [ ] **Step 9:** Add AIRun with tenantId, actorProfileId, threadId, agentKey, deploymentId, agentDefinitionVersion, orchestratorVersion, policyVersion, policySnapshot JSON, promptVersionId, inputSchemaVersion, outputSchemaVersion, status, currentStage, correlationId unique, idempotencyKey, requestBudget JSON, usageSummary JSON, safeDecisionSummaries JSON, toolAuditEventIds, provider/model nullable, startedAt/completedAt/retainedUntil, errorCode, timestamps, @@unique([tenantId,idempotencyKey]) and tenant/status/time indexes.
- [ ] **Step 10:** Add AIUsageLedger with tenantId, runId, actorProfileId, agentKey, entryType, operationType, reservationId, requestCount, provider, model, inputTokens, outputTokens, toolCalls, costMicrousd BigInt, adjustmentReason, billingPeriod, occurredAt, idempotencyKey unique, and tenant/billing-period indexes.
- [ ] **Step 11:** Add AIArtifact with tenantId, runId, ownerProfileId, artifactType, schemaVersion, revision, status, content JSON, contentHash, validationResult JSON, sourceEvidenceIds, parentArtifactId, supersededByArtifactId, timestamps and tenant/owner/status indexes.
- [ ] **Step 12:** Add AIApproval with tenantId, runId, artifactId, checkpointId, requestedByProfileId, requiredPermission, status, decidedByProfileId, decisionEdits JSON, decisionReason, requestedAt, expiresAt, decidedAt, idempotencyKey unique, timestamps.
- [ ] **Step 13:** Run npx prisma format && npx prisma validate && npx prisma generate.
- [ ] **Step 14:** Run npm test -- tests/architecture/ai-control-schema.test.ts.
- [ ] **Step 15:** Expected: PASS.
- [ ] **Step 16:** Commit: git add packages/shared-types prisma tests/architecture && git commit -m "feat: add tenant AI control-plane models"

### Task 2: Compile an effective tenant AI policy

**Files:**

- Create: apps/ai/server/services/ai-control/platform-ai-constraints.ts
- Create: apps/ai/server/services/ai-control/plan-entitlements.ts
- Create: apps/ai/server/services/ai-control/policy-compiler.ts
- Create: apps/ai/server/repositories/ai-policy-repository.ts
- Create: tests/ai-control/policy-compiler.test.ts

**Interfaces:**

- Consumes: platform constraints, plan entitlement, TenantAIProfile, AgentDeployment, and safe request preferences.

- Produces: EffectiveAIPolicy with content hash and explainable constraint sources.

**Failing test anchor:**

~~~ts
it("allows tenant policy to narrow but never expand platform policy", () => {
  const policy = compile_effective_policy(expansion_attempt_layers);
  expect(policy.allowed_tools).toEqual(["knowledge.search"]);
  expect(policy.per_run_token_limit).toBe(10_000n);
  expect(policy.approval_rules["formula.confirm"]).toBe("manager");
});
~~~

**Implementation anchor:**

~~~ts
export function compile_effective_policy(layers: PolicyLayers): EffectiveAIPolicy {
  const compiled = {
    enabled: layers.platform.enabled && layers.plan.enabled && layers.tenant.enabled,
    allowed_tools: intersect(layers.platform.tools, layers.plan.tools, layers.tenant.tools),
    per_run_token_limit: min_bigint(
      layers.platform.per_run_tokens,
      layers.plan.per_run_tokens,
      layers.tenant.per_run_tokens,
    ),
    approval_rules: strongest_approval(layers),
  };
  return with_policy_hash(layers.tenant_id, layers.version, compiled);
}
~~~

- [ ] **Step 1:** Write failing tests proving tenant settings cannot enable a forbidden provider/tool, exceed plan quotas/retention/iterations, relax an approval, or select an unapproved deployment. Test deterministic hashing independent of object key order.
- [ ] **Step 2:** Run npm test -- tests/ai-control/policy-compiler.test.ts.
- [ ] **Step 3:** Expected: FAIL.
- [ ] **Step 4:** Define EffectiveAIPolicy with tenant_id, version, hash, enabled, provider_models, allowed_tools, budget limits, max_iterations, retention_days, knowledge scopes, web_search, approval_rules, deployment revision, prompt version, and constraint_trace.
- [ ] **Step 5:** Implement intersection for allowlists, minimum for numeric maxima, maximum for mandatory safety/approval levels, and false-wins for disabled capabilities. Reject an empty provider/model intersection before creating a run.
- [ ] **Step 6:** Restrict request preferences to response language, response detail, and a model alias already in the effective allowlist. Ignore no unknown fields; reject them with POLICY_INPUT_INVALID.
- [ ] **Step 7:** Canonicalize the effective JSON, hash it with SHA-256, and persist the complete snapshot on AIRun. Constraint trace may name which layer constrained a value but must not reveal secrets.
- [ ] **Step 8:** Run npm test -- tests/ai-control/policy-compiler.test.ts.
- [ ] **Step 9:** Expected: PASS.
- [ ] **Step 10:** Commit: git add apps/ai/server/services/ai-control apps/ai/server/repositories tests/ai-control && git commit -m "feat: compile effective tenant AI policy"

### Task 3: Reserve and reconcile tenant AI usage

**Files:**

- Create: apps/ai/server/services/ai-control/usage-ledger.ts
- Create: apps/ai/server/services/ai-control/budget-service.ts
- Create: apps/ai/server/repositories/ai-usage-repository.ts
- Create: tests/ai-control/usage-ledger.test.ts

**Interfaces:**

- Consumes: EffectiveAIPolicy, estimated usage, provider usage, and cost rate card.

- Produces: immutable reservation/actual/release ledger entries and deterministic quota decisions.

**Failing test anchor:**

~~~ts
it("counts concurrent reservations before granting another", async () => {
  const results = await Promise.allSettled([
    reserve_usage(context, half_budget, "reserve_a"),
    reserve_usage(context, half_budget, "reserve_b"),
    reserve_usage(context, half_budget, "reserve_c"),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
});
~~~

**Implementation anchor:**

~~~ts
export async function reserve_usage(
  context: TenantAIExecutionContext,
  estimate: UsageEstimate,
  idempotency_key: string,
): Promise<UsageReservation> {
  return usage_repository.with_transaction(async (session) => {
    const totals = await usage_repository.locked_month_totals(context.tenant_id, session);
    assert_budget_available(totals, estimate, context.policy);
    return usage_repository.insert_reservation(context, estimate, idempotency_key, session);
  });
}
~~~

- [ ] **Step 1:** Write failing tests for within-limit reservation, tenant monthly request/token/cost rejection, per-user request/token/cost rejection, maximum concurrent runs, per-run rejection, concurrent reservations, duplicate idempotency key, provider failure release, actual below estimate, actual above estimate, and replayed completion.
- [ ] **Step 2:** Run npm test -- tests/ai-control/usage-ledger.test.ts.
- [ ] **Step 3:** Expected: FAIL.
- [ ] **Step 4:** Implement reserve_usage in a Mongo transaction: aggregate committed plus open reservations for tenant/month and actor/month, count active/reserved runs, compare request/tokens/cost/concurrency to effective tenant, per-user, and per-run limits, insert reservation with unique tenant/run/reservation idempotency, and return reservation ID.
- [ ] **Step 5:** Store monetary amounts as integer micro-USD in Mongo Long/Prisma BigInt, never binary float or Prisma Decimal (the MongoDB connector does not support Decimal). Pin the rate-card version on each reservation.
- [ ] **Step 6:** Implement reconcile_usage to append actual and release entries exactly once. If actual exceeds reservation, append adjustment only within policy overage tolerance; otherwise mark the run BUDGET_RECONCILIATION_REQUIRED and block further actions.
- [ ] **Step 7:** Add stale reservation expiry job that releases reservations only for terminal/absent runs and records its job idempotency key.
- [ ] **Step 8:** Run npm test -- tests/ai-control/usage-ledger.test.ts.
- [ ] **Step 9:** Expected: PASS including concurrent tests.
- [ ] **Step 10:** Commit: git add apps/ai/server/services/ai-control apps/ai/server/repositories tests/ai-control && git commit -m "feat: enforce tenant AI budgets with a usage ledger"

### Task 4: Replace ad hoc handlers with a governed tool catalogue

**Files:**

- Create: apps/ai/server/services/ai-control/tool-definition.ts
- Create: apps/ai/server/services/ai-control/tool-catalogue.ts
- Create: apps/ai/server/services/ai-control/tool-executor.ts
- Create: apps/ai/server/services/ai-control/tools/formula-tools.ts
- Create: apps/ai/server/services/ai-control/tools/knowledge-tools.ts
- Create: apps/ai/server/services/ai-control/tools/web-search-tools.ts
- Create: tests/ai-control/tool-executor.test.ts

**Interfaces:**

- Consumes: EffectiveAIPolicy, TenantExecutionContext, model-proposed tool name/arguments, approval state.

- Produces: validated ToolResult and an audit event for every attempt.

**Failing test anchor:**

~~~ts
it("rejects a model-supplied tenant field", async () => {
  await expect(executor.execute({
    name: "formula.search",
    arguments: { query: "serum", tenantId: tenant_b },
  }, tenant_a_context)).rejects.toMatchObject({ code: "TOOL_INPUT_INVALID" });
});
~~~

**Implementation anchor:**

~~~ts
export interface ToolDefinition<I, O> {
  readonly name: string;
  readonly version: string;
  readonly input_schema: z.ZodType<I>;
  readonly output_schema: z.ZodType<O>;
  readonly required_permission: Permission;
  readonly side_effect: "read" | "draft_write" | "commit";
  readonly approval_requirement: "none" | "manager";
  execute(args: I, context: TrustedToolContext): Promise<O>;
}
~~~

- [x] **Step 1:** Write failing tests for unknown tool, disabled tool, missing permission, invalid input, injected tenant field, approval required, duplicate side effect, timeout/retry, and successful read/write.
- [x] **Step 2:** Run npm test -- tests/ai-control/tool-executor.test.ts.
- [x] **Step 3:** Expected: FAIL.
- [x] **Step 4:** Define every tool with stable name/version, description, Zod input/output schemas, required_permission, side_effect(read|draft_write|commit), approval_requirement, timeout_ms, retry policy, and execute(args, trusted_context).
- [x] **Step 5:** Tool input schemas must be strict and must not contain tenantId, organizationId, userId, actorId, permissions, provider keys, collection names, or arbitrary Mongo filters.
- [x] **Step 6:** ToolExecutor checks policy allowlist and permission, validates input, evaluates approval, creates a call idempotency key from run/step/tool/arguments hash, injects trusted repositories/context, enforces timeout/retry, validates output, meters usage, and writes an audit event.
- [x] **Step 7:** Register formula search/draft/revise/comment/confirm adapters, knowledge search, and approved web search. Confirm is commit side-effect and requires formula:confirm plus an approved durable approval owned by the active checkpoint. (Adapters delegate to injected ports; production ports fail closed with NOT_WIRED until the gateway/repository wiring tasks land.)
- [x] **Step 8:** Run npm test -- tests/ai-control/tool-executor.test.ts.
- [x] **Step 9:** Expected: PASS.
- [x] **Step 10:** Commit: git add apps/ai/server/services/ai-control tests/ai-control && git commit -m "feat: execute AI tools through tenant policy"

### Task 5: Partition Qdrant platform and tenant knowledge

**Files:**

- Create: apps/ai/server/services/knowledge/knowledge-gateway.ts
- Create: apps/ai/server/services/knowledge/qdrant-collections.ts
- Create: apps/ai/server/services/knowledge/ingestion-service.ts
- Create: apps/ai/server/services/knowledge/upload-authorization.ts
- Create: apps/ai/server/services/knowledge/citation-builder.ts
- Create: apps/ai/server/repositories/knowledge-source-repository.ts
- Create: apps/web/app/api/knowledge/uploads/route.ts
- Modify: apps/ai/services/vector/qdrant-service.ts
- Modify: apps/ai/package.json
- Create: tests/knowledge/knowledge-isolation.test.ts
- Create: tests/knowledge/citation-builder.test.ts

**Interfaces:**

- Consumes: TenantAIExecutionContext, KnowledgeSource, query, embedding version, and allowed scopes.

- Produces: separately retrieved platform/tenant evidence with provenance and enforced filters.

**Failing test anchor:**

~~~ts
it("never returns tenant B evidence to tenant A", async () => {
  const results = await gateway.search(tenant_a_context, {
    query: "niacinamide",
    scope: "both",
  });
  expect(results.some((result) => result.tenant_id === tenant_b)).toBe(false);
  expect(results.every((result) => result.scope === "platform" || result.tenant_id === tenant_a))
    .toBe(true);
});
~~~

**Implementation anchor:**

~~~ts
const tenant_filter = (tenant_id: string): Filter => ({
  must: [
    { key: "tenant_id", match: { value: tenant_id } },
    { key: "is_tenant", match: { value: true } },
  ],
});

const platform_filter: Filter = {
  must: [
    { key: "is_tenant", match: { value: false } },
    { is_empty: { key: "tenant_id" } },
  ],
};
~~~

- [ ] **Step 1:** Start a test Qdrant fixture with platform evidence, tenant A evidence, tenant B evidence, and deliberately mislabeled payloads. Write failing tests for every cross-scope combination.
- [ ] **Step 2:** Run npm test -- tests/knowledge.
- [ ] **Step 3:** Expected: FAIL because current searches accept arbitrary collection/filter options.
- [ ] **Step 4:** Pin @qdrant/js-client-rest=1.18.0 in apps/ai/package.json and update package-lock.json.
- [ ] **Step 5:** Define collection names platform_knowledge_v<embedding_version> and tenant_knowledge_v<embedding_version>. Create keyword payload indexes for tenant_id, is_tenant, source_id, content_hash, and visibility; set tenant_id as the tenant index in tenant collections.
- [ ] **Step 6:** On platform upsert require is_tenant=false and no tenant_id. On tenant upsert require is_tenant=true and tenant_id=context.tenant_id. Reject payloads that do not match the target collection contract.
- [ ] **Step 7:** Remove public collectionName/filter parameters from QdrantService. KnowledgeGateway accepts scope(platform|tenant|both) only after policy checks and builds filters internally.
- [ ] **Step 8:** Run platform and tenant searches separately. Tenant search must include must tenant_id=context.tenant_id and is_tenant=true; platform search must include is_tenant=false. Merge after retrieval with provenance retained and no score comparison assumption across embedding versions.
- [ ] **Step 9:** CitationBuilder returns source_id, source_name, content_hash, locator, excerpt capped at policy length, retrieved_at, scope, and relevance score. It rejects a result not traceable to a ready KnowledgeSource or approved platform source.
- [ ] **Step 10:** Issue a short-lived upload authorization bound to tenant ID, actor profile ID, source ID, object key under the tenant prefix, maximum bytes, allowed detected MIME types, and expiry. The upload route derives tenant/actor from RequestPrincipal and accepts no identity field.
- [ ] **Step 11:** Keep a source quarantined until ingestion verifies detected MIME, size, content hash, tenant storage allowance, malware scan result, parser version, chunker version, embedding version, provenance/consent, and idempotency before Qdrant upsert. A parse/index failure records a safe error and deletes partial points by source_id plus tenant filter.
- [ ] **Step 12:** Run npm test -- tests/knowledge.
- [ ] **Step 13:** Expected: PASS; no tenant B or mislabeled point appears in tenant A results and failed uploads leave no searchable partial points.
- [ ] **Step 14:** Commit: git add apps/ai/server/services/knowledge apps/ai/server/repositories apps/ai/services/vector apps/ai/package.json package-lock.json apps/web/app/api/knowledge tests/knowledge && git commit -m "feat: isolate platform and tenant AI knowledge"

### Task 6: Add tenant AI administration and platform constraints

**Files:**

- Create: apps/ai/server/routers/tenant-ai-settings.ts
- Create: apps/ai/server/routers/platform-ai-settings.ts
- Create: apps/ai/server/routers/knowledge-sources.ts
- Create: apps/web/app/settings/ai/page.tsx
- Create: apps/web/app/settings/ai/knowledge/page.tsx
- Create: apps/web/app/platform/ai/page.tsx
- Create: tests/integration/ai-control-authorization.test.ts

**Interfaces:**

- Consumes: manager/platform permissions and control-plane repositories.

- Produces: controlled settings, deployment activation, knowledge ingestion, and emergency disable surfaces.

**Failing test anchor:**

~~~ts
it("denies AI configuration to a tenant user", async () => {
  const caller = create_caller(student_principal);
  await expect(caller.tenantAiSettings.update({ max_iterations: 5 }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
});
~~~

**Implementation anchor:**

~~~ts
update: tenantPermissionProcedure("tenant:ai:configure")
  .input(tenant_ai_profile_update_schema.strict())
  .mutation(async ({ ctx, input }) => {
    const candidate = await ctx.ai_policy_repository.preview_update(
      ctx.tenant_execution_context,
      input,
    );
    compile_effective_policy(candidate.layers);
    return ctx.ai_policy_repository.save_revision(candidate);
  }),
~~~

- [ ] **Step 1:** Write failing callers proving users cannot configure AI/upload knowledge/activate deployment, managers cannot expand plan limits or edit platform defaults, admins cannot grant platform roles, and super admins can emergency-disable AI.
- [ ] **Step 2:** Run npm test -- tests/integration/ai-control-authorization.test.ts.
- [ ] **Step 3:** Expected: FAIL.
- [ ] **Step 4:** Implement tenant settings reads with tenant:ai:read; updates/deployment activation with tenant:ai:configure; knowledge list/upload/delete with tenant:knowledge permissions; platform constraints/plans/emergency disable with platform permissions.
- [ ] **Step 5:** Validate every write by compiling the prospective policy before persistence. Store revisions rather than editing an active deployment or prompt in place.
- [ ] **Step 6:** Build manager pages for agent enablement, allowed model alias, quotas below plan maximum, prompt overlay, approval rules within platform bounds, knowledge status, and usage. Render stored effective limits and explain locked values.
- [ ] **Step 7:** Build platform page for plans, hard constraints, global prompt bases, emergency disable, and non-content diagnostics. Do not expose tenant conversations or artifacts.
- [ ] **Step 8:** Run npm test -- tests/integration/ai-control-authorization.test.ts and npm run build:web.
- [ ] **Step 9:** Expected: PASS.
- [ ] **Step 10:** Commit: git add apps tests/integration && git commit -m "feat: add tenant AI governance surfaces"

### Task 7: Verify the control plane as a mandatory gateway

**Files:**

- Create: apps/ai/server/services/ai-control/create-ai-execution-context.ts
- Modify: scripts/security/scan-private-boundaries.ts
- Create: tests/security/ai-gateway-boundary.test.ts
- Create: docs/commercial/evidence/g3-release.md
- Modify: CHANGELOG.md

**Interfaces:**

- Consumes: TenantExecutionContext, effective policy, active deployment, budget reservation, and knowledge/tool gateways.

- Produces: TenantAIExecutionContext and scanner enforcement that prevents provider/tool/vector bypass.

**Failing test anchor:**

~~~ts
it("flags provider calls outside approved adapters", () => {
  const findings = scan_ai_boundaries(
    source("apps/web/app/api/example/route.ts", "new OpenAI().responses.create(input)"),
  );
  expect(findings).toEqual([
    expect.objectContaining({ code: "AI_CONTROL_PLANE_BYPASS" }),
  ]);
});
~~~

**Implementation anchor:**

~~~ts
export interface TenantAIExecutionContext {
  readonly tenant: TenantExecutionContext;
  readonly policy: EffectiveAIPolicy;
  readonly deployment: AgentDeploymentSnapshot;
  readonly run_id: string;
  readonly reservation_id: string;
  readonly prompt_version_id: string;
  readonly correlation_id: string;
  readonly signal: AbortSignal;
}
~~~

- [ ] **Step 1:** Define TenantAIExecutionContext as tenant execution, policy snapshot, active deployment, run ID, reservation ID, prompt version, correlation ID, and cancellation signal. Freeze it after creation.
- [ ] **Step 2:** Write a failing boundary test with direct Google/OpenAI/Gemini/Qdrant construction in a route/tool and assert findings.
- [ ] **Step 3:** Extend the scanner so provider SDK calls are allowed only in provider adapters, Qdrant search/upsert only in KnowledgeGateway/ingestion, tool execution only in ToolExecutor, and AIRun creation only in the AI gateway.
- [ ] **Step 4:** Run npm run security:scan.
- [ ] **Step 5:** Expected: PASS with no bypasses or explicitly documented legacy exceptions. Any exception must name its G4 deletion task and cannot be used by the new gateway.
- [ ] **Step 6:** Run npm test, npm run typecheck, npm run security:scan, and npm run build:web.
- [ ] **Step 7:** Expected: all PASS.
- [ ] **Step 8:** Record policy, budget concurrency, tool injection, Qdrant cross-tenant, emergency disable, and rollback results in docs/commercial/evidence/g3-release.md.
- [ ] **Step 9:** Update CHANGELOG.md with tenant AI configuration, usage, and knowledge controls.
- [ ] **Step 10:** Commit: git add apps scripts tests/security docs/commercial CHANGELOG.md && git commit -m "feat: enforce the tenant AI control plane"
