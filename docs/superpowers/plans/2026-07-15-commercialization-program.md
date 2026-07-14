# Commercialization Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sequence the Clerk, tenant-isolation, AI-control, OODA, and rollout work so each increment is deployable, reversible, and measurably safer than the current system.

**Architecture:** The program establishes one verified request principal and one tenant authorization boundary before replacing custom identity with Clerk. It then converts application data and AI data to mandatory tenant scope, introduces a tenant AI control plane, cuts traffic to one governed agentic-loop gateway (a single model-driven orchestrator node with capability-card context injection, wrapped by a deterministic governor — see docs/superpowers/specs/2026-07-15-agentic-orchestrator-design.md), and removes legacy paths only after evaluation and canary gates pass.

**Tech Stack:** Next.js 16.2.10, React 19.2.7, Clerk Next.js 7.5.18, TypeScript 5.9, tRPC 11, MongoDB/Prisma 6.19, Qdrant, LangGraph 1.4.7, Zod 3.25, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- Platform roles and university roles remain separate; only platform administrators create universities; only super administrators grant platform roles; no request body is an identity source; all resource queries include tenant predicates; proxy is never the sole authorization layer; all AI actions are policy checked and tenant attributed; legacy and OODA execution never mix inside one run; no production cutover occurs without rollback evidence.

---

## Source of truth and plan order

The approved design is in:

- docs/superpowers/specs/2026-07-15-commercial-clerk-tenancy-ooda-design.md

Execute these implementation plans in dependency order:

| Gate | Plan | Depends on | Exit signal |
|---|---|---|---|
| G0 | 2026-07-15-commercial-security-containment.md | none | Patched framework, test harness, protected APIs, server-derived principal |
| G1 | 2026-07-15-clerk-identity-tenant-provisioning.md | G0 | Clerk sessions, platform-created universities, invitations, migrated users |
| G2 | 2026-07-15-tenant-data-authorization.md | G1 | Every private record and operation is tenant scoped and migration is verified |
| G3 | 2026-07-15-tenant-ai-control-plane.md | G2 | Tenant policy, knowledge isolation, quotas, usage ledger, governed tools |
| G4 | 2026-07-15-ooda-agent-orchestration.md | G3 | One governed agentic-loop gateway produces validated, attributable artifacts |
| G5 | 2026-07-15-commercial-evaluation-rollout.md | G4 | Evaluation, canary, rollback, operations, legacy retirement |

G0 and the framework portion of G1 may be developed on separate branches, but G1 must rebase on the patched G0 baseline before merge. G2 through G5 are sequential because each consumes contracts created by the previous gate.

## Reference baseline

- Clerk Next.js quickstart and Core 3 server APIs: https://clerk.com/docs/quickstarts/nextjs
- Clerk user migration and backend API: https://clerk.com/docs/guides/development/migrating/overview
- Next.js 16 upgrade/proxy guidance: https://nextjs.org/docs/app/guides/upgrading/version-16
- LangGraph persistence and MongoDBSaver: https://docs.langchain.com/oss/javascript/langgraph/persistence
- LangGraph interrupts and Command resume: https://docs.langchain.com/oss/javascript/langgraph/interrupts
- Qdrant multitenancy partitioning: https://qdrant.tech/documentation/tutorials/multiple-partitions/
- Prisma MongoDB type mapping: https://docs.prisma.io/docs/orm/reference/prisma-schema-reference

## Program invariants

Every implementation task must preserve these statements:

1. Identity comes from a verified Clerk session, or from the temporary G0 legacy adapter before Clerk cutover; it never comes from JSON, query strings, localStorage, or an unsigned cookie.
2. RequestPrincipal contains auth_provider, provider_user_id (the Clerk user ID after cutover), internal_user_id, nullable active_tenant_id, platform_role, nullable tenant_role, permissions, and nullable membership status. Tenant procedures require every nullable tenant field; platform-only procedures do not fabricate membership.
3. PlatformRole is super_admin or admin; TenantRole is manager or user. Neither enum is converted into the other.
4. Tenant authorization is checked again in the repository filter using both record ID and tenant ID.
5. AIRequestContext is created only from RequestPrincipal plus stored tenant policy and deployment configuration.
6. Every retrieval query includes an is_tenant payload discriminator. Tenant retrieval also requires tenant_id; platform retrieval forbids tenant payloads.
7. Model output can propose a tool call, but deterministic code authorizes, filters, validates, meters, and commits it.
8. Only managers can confirm formula artifacts. Users can create and revise drafts.
9. No hidden reasoning trace is persisted or returned. Decision summaries contain facts, sources, validation results, and action rationales only.
10. A run is either legacy or OODA from ingress through completion. Feature flags are evaluated before the run starts.

## Shared file map

The plans intentionally converge on these ownership boundaries:

- packages/shared-types/src/auth.ts — role, permission, and RequestPrincipal contracts.
- packages/shared-types/src/tenant.ts — tenant, membership, and status contracts.
- packages/shared-types/src/ai/contracts.ts — versioned input, event, artifact, citation, and output contracts.
- packages/shared-types/src/ai/policy.ts — tenant AI policy, deployment, budget, and approval contracts.
- apps/ai/server/auth/ — Clerk-to-internal principal resolution and authorization procedures.
- apps/ai/server/repositories/ — tenant-scoped MongoDB access; route and tool code may not access tenant collections directly after G2.
- apps/ai/server/services/provisioning/ — Clerk organization, membership, invitation, webhook, and reconciliation workflows.
- apps/ai/server/services/ai-control/ — policy compilation, budget reservation, usage ledger, and approvals.
- packages/ai-orchestration/ — current LangGraph OODA graph, state, nodes, tool adapters, and checkpoints.
- apps/web/app/api/ai/runs/ — sole production AI ingress and event stream after G4.
- apps/web/app/platform/ — platform administration.
- apps/web/app/settings/ai/ — university AI administration.
- apps/web/app/ai/ — governed end-user AI experience.

## Branch and merge discipline

### Task 1: Manage gated delivery and release evidence

**Files:**

- Modify: CHANGELOG.md
- Create: docs/commercial/evidence/g0-release.md
- Create: docs/commercial/evidence/g1-release.md
- Create: docs/commercial/evidence/g2-release.md
- Create: docs/commercial/evidence/g3-release.md
- Create: docs/commercial/evidence/g4-release.md
- Create: docs/commercial/evidence/g5-release.md

**Interfaces:**

- Consumes: the exit checks and evidence generated by plans G0 through G5.
- Produces: an ordered, auditable gate decision and rollback record for each deployed tag.

**Execution anchor:**

~~~bash
set -euo pipefail
npm ci
npm run verify:commercial
npm run eval:compare -- --baseline=legacy-frozen --candidate=ooda-current
npm run test:rollback -- --from=commercial-g5 --to=commercial-g4
~~~

- [ ] **Step 1:** Create one branch per gate using the prefix dev/commercial-.
- [ ] **Step 2:** Keep database expansion changes backward compatible until the corresponding cutover task.
- [ ] **Step 3:** Commit after each task using the commit message named in the detailed plan.
- [ ] **Step 4:** Rebase before merging a gate; never merge with ignored TypeScript errors or failed tests.
- [ ] **Step 5:** Tag each deployed gate as commercial-g0 through commercial-g5.
- [ ] **Step 6:** Record deployment ID, schema migration ID, feature-flag state, and rollback command in the release evidence document.

## Definition of done for every gate

- [ ] **Step 7:** Run npm run typecheck and observe exit code 0.
- [ ] **Step 8:** Run npm test and observe all unit and integration tests pass.
- [ ] **Step 9:** Run npm run build:web and observe a successful production build.
- [ ] **Step 10:** Run npm run security:scan and observe zero unapproved public procedures, unguarded private route handlers, or tenant collection access outside repositories.
- [ ] **Step 11:** Update CHANGELOG.md with externally visible behavior and migration notes.
- [ ] **Step 12:** Attach the exact command output to docs/commercial/evidence/gN-release.md.
- [ ] **Step 13:** Exercise the documented rollback in a non-production environment and record the result.

## Program release gates

### G0 — Containment

- [ ] **Step 14:** Next.js is at 16.2.10 and React/React DOM are at 19.2.7.
- [ ] **Step 15:** apps/web/proxy.ts runs Clerk-compatible matchers but all server handlers independently authorize.
- [ ] **Step 16:** All existing private tRPC procedures and route handlers use the temporary principal adapter.
- [ ] **Step 17:** Client-supplied userId and organizationId are rejected at private API boundaries.
- [ ] **Step 18:** Public AI credential fallbacks are absent and all potentially exposed provider keys have documented rotation/revocation evidence.

### G1 — Clerk identity and provisioning

- [ ] **Step 19:** New university creation has no public route and is possible only through a platform admin operation.
- [ ] **Step 20:** A platform admin creates a Clerk organization, internal tenant, and manager invitation idempotently.
- [ ] **Step 21:** Managers invite users but cannot grant manager or platform roles.
- [ ] **Step 22:** Imported bcrypt users can sign in to Clerk and are linked by external_id.
- [ ] **Step 23:** Account and Session are no longer read in production request handling.

### G2 — Tenant data isolation

- [ ] **Step 24:** Tenant-bearing collections have tenantId and compound tenant indexes.
- [ ] **Step 25:** Backfill reports zero orphaned or ambiguous private records before enforcement.
- [ ] **Step 26:** Cross-tenant reads, mutations, ID enumeration, exports, and formula actions fail in integration tests.
- [ ] **Step 27:** Direct tenant collection access outside repository modules is rejected by the scanner.

### G3 — Tenant AI governance

- [ ] **Step 28:** Every AI run resolves a stored tenant AI policy and deployment revision.
- [ ] **Step 29:** Budget is reserved before provider execution and reconciled after completion.
- [ ] **Step 30:** Every tool declares permissions, side-effect class, approval rule, and input/output schemas.
- [ ] **Step 31:** Qdrant tests prove platform and tenant knowledge cannot cross-contaminate.

### G4 — Agentic orchestration

- [ ] **Step 32:** The governed loop exposes exactly one model-driven reasoning node plus deterministic ingress, gate, act, clarify, approve, finalize, and fail nodes; every registered tool ships a capability card whose frontmatter matches its definition, and the run pins the context-pack hashes.
- [ ] **Step 33:** Checkpoint resume is idempotent and preserves tenant, policy, prompt, deployment, and tool versions.
- [ ] **Step 34:** Formula output totals 100 percent within 0.01 and contains evidence/validation metadata.
- [ ] **Step 35:** The web client consumes versioned events from one authenticated AI run API.

### G5 — Commercial release

- [ ] **Step 36:** At least 95 percent of evaluated factual claims carry retrievable evidence.
- [ ] **Step 37:** OODA end-to-end task success exceeds the frozen legacy baseline by at least 10 percentage points.
- [ ] **Step 38:** Cross-tenant security, budget enforcement, approval, deletion, export, and recovery tests all pass.
- [ ] **Step 39:** Canary reaches 100 percent without triggering rollback thresholds.
- [ ] **Step 40:** Legacy routes, fallbacks, client imports, session collections, and unsupported agent entry points are deleted.

## Program rollback map

| Gate | Rollback mechanism | Data compatibility rule |
|---|---|---|
| G0 | Redeploy previous image after blocking hostile headers at ingress | No destructive schema change |
| G1 | CLERK_CUTOVER=false returns ingress to the legacy adapter during the bounded coexistence window | Clerk IDs are additive; Account/Session remain until G5 |
| G2 | TENANT_ENFORCEMENT=shadow records mismatches without authorizing from them | Backfilled tenantId fields remain; no records are unset |
| G3 | Disable a tenant AgentDeployment revision | Usage ledger and policy snapshots remain immutable |
| G4 | Select legacy at run ingress for tenants still in the canary cohort | Existing OODA runs finish on their pinned graph; no mid-run switch |
| G5 | Stop rollout and re-enable the last approved deployment revision | Legacy deletion occurs only after the restore window expires |

## Final program verification

- [ ] **Step 41:** Run npm ci.
- [ ] **Step 42:** Run npm run verify:commercial.
- [ ] **Step 43:** Expected: typecheck, lint, unit, integration, security scan, schema validation, evaluation, Playwright, and production build all exit 0.
- [ ] **Step 44:** Run npm run eval:compare -- --baseline=legacy-frozen --candidate=ooda-current.
- [ ] **Step 45:** Expected: the generated report meets every G5 numerical threshold and contains no unevaluated critical safety case.
- [ ] **Step 46:** Run npm run test:rollback -- --from=commercial-g5 --to=commercial-g4.
- [ ] **Step 47:** Expected: new runs route to the prior approved deployment, pinned in-flight runs resume, and no ledger or artifact is lost.
- [ ] **Step 48:** Commit: git commit -am "docs: record commercial release evidence"
