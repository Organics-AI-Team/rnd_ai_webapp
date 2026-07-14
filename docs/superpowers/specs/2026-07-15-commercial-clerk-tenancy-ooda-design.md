# Commercial Clerk Tenancy and OODA AI Architecture

**Date:** 2026-07-15
**Status:** Design baseline for implementation planning
**Scope:** Clerk authentication, university tenancy and RBAC, tenant AI control plane, OODA orchestration, migration, security, evaluation, and rollout

## 1. Executive decision

R&D AI will move to a commercial multi-tenant architecture with two independent authorization dimensions:

- Platform roles: `super_admin`, `admin`, or no platform role.
- University membership roles: `manager` for professors and `user` for students.

Clerk will be authoritative for identities, sessions, organizations, memberships, and invitations. MongoDB will remain authoritative for application data, tenant lifecycle state, AI configuration, usage, artifacts, approvals, and audit records.

All AI traffic will enter one authenticated tenant-aware gateway and one versioned LangGraph workflow. The workflow will implement a bounded OODA loop:

`Observe -> Orient -> Decide -> Act -> Observe ... -> Finalize`

The model may propose plans and actions, but deterministic application code will authorize tools, inject tenant filters, enforce budgets, decide whether approval is required, validate outputs, and commit side effects. Existing ReAct, fixed pipeline, agent-manager, and legacy LangGraph entry points will not remain as peer production paths.

## 2. Goals

1. Replace custom password and session handling with Clerk.
2. Ensure only platform administrators can create university tenants.
3. Implement the required platform and university role hierarchy without conflating the two scopes.
4. Derive identity, tenant, and authorization context exclusively from verified server state.
5. Enforce tenant isolation on every database, vector, memory, artifact, and AI operation.
6. Let authorized university managers configure AI within non-overridable platform and plan limits.
7. Replace overlapping fixed and ReAct pipelines with a single dynamic, durable, observable OODA orchestrator.
8. Standardize AI input, streaming events, state, evidence, artifacts, approvals, and output contracts.
9. Improve accuracy through evidence requirements, deterministic validation, re-planning, and measured evaluation.
10. Migrate existing users and bcrypt password hashes without a mandatory password reset when the source data is valid.
11. Provide staged rollout, tenant-level rollback, auditability, cost control, and production verification.

## 3. Non-goals

- This design does not introduce unrestricted autonomous agents or an open-ended multi-agent swarm.
- This design does not allow a tenant to override platform safety, security, provider, or commercial-plan ceilings.
- This design does not use Clerk metadata as the primary application database.
- This design does not make frontend route visibility an authorization control.
- This design does not make AI-generated formulas production-ready without human R&D validation.
- This migration does not require extracting the orchestrator into a separately deployed network service. The gateway and contracts will permit later extraction, but the first cutover remains in the current server-side deployment boundary.
- Billing-provider integration is not implemented by this migration. The design supplies entitlements, quota, and usage primitives that a billing system can drive later.

## 4. Current-state findings

### 4.1 Launch-blocking security findings

| ID | Finding | Evidence | Required disposition |
|---|---|---|---|
| SEC-01 | Public signup creates an organization and grants `admin`. | `apps/ai/server/routers/auth.ts:12-97` | Remove legacy signup and require platform provisioning plus Clerk invitations. |
| SEC-02 | Custom bearer-like tokens are stored in `localStorage` and copied into a JavaScript-readable cookie. | `apps/web/lib/auth-context.tsx:57-64`, `90-101` | Replace with Clerk-managed sessions and cookies. |
| SEC-03 | Middleware treats cookie presence as authentication. | `apps/web/middleware.ts:13-28` | Use Clerk server authentication and resource-level authorization. |
| SEC-04 | Middleware explicitly excludes all API routes. | `apps/web/middleware.ts:31-42` | Include `/api` and `/trpc` in Clerk middleware and authorize inside handlers. |
| SEC-05 | Twelve direct API route files contain no verified server authentication call. | `apps/web/app/api/**/route.ts`, excluding tRPC | Consolidate or protect every route before external exposure. |
| SEC-06 | Organization, user, order, and credit routers expose 20 sensitive public procedures. | `apps/ai/server/routers/organizations.ts`, `users.ts`, `orders.ts` | Convert to scoped procedures and explicit public exceptions only. |
| SEC-07 | AI routes trust request-body user and organization identifiers. | `apps/web/app/api/ai/raw-materials-agent/route.ts:296-330`; `enhanced-chat/route.ts:88-110` | Remove authoritative identity fields from public schemas. |
| SEC-08 | Formula tools load and mutate records by ID without tenant ownership checks. | `search-reference-formulas-handler.ts:110-119`; `get-formula-with-comments-handler.ts:67-80`; `confirm-formula-handler.ts:77-113` | Route all reads and writes through scoped repositories. |
| SEC-09 | The indexing route has no platform-admin authorization. | `apps/web/app/api/index-data/route.ts:88` | Move indexing behind a platform operation and job boundary. |
| SEC-10 | Server code and production build configuration accept public AI key variables. | `docker-compose.yml`; AI route and tool constructors | Remove all `NEXT_PUBLIC_*` AI secret fallbacks and rotate any exposed keys. |

### 4.2 Tenant and RBAC findings

| ID | Finding | Impact |
|---|---|---|
| TEN-01 | Existing roles are `admin`, `shipper`, and `shopper`. | Cannot express platform administration separately from professor/student access. |
| TEN-02 | `User` embeds one `organizationId`; no membership entity exists. | Membership lifecycle, invitations, multiple memberships, and role projection are not modeled. |
| TEN-03 | Protected context does not consistently enforce user status or organization status. | Suspended identities or inactive tenants can remain usable. |
| TEN-04 | Several protected ID-based operations omit `organizationId` from the database predicate. | Authenticated IDOR and cross-tenant access remain possible. |
| TEN-05 | `Conversation`, `Feedback`, `AiResponse`, formula comments, and version logs lack complete tenant provenance. | AI history, feedback, and artifacts cannot be safely queried or deleted by tenant. |
| TEN-06 | Admin navigation and page checks are client-side. | Direct requests can bypass intended UI restrictions. |
| TEN-07 | No Clerk webhook, reconciliation, invitation, or tenant-provisioning state exists. | Clerk and MongoDB could drift without detection or repair. |

### 4.3 AI architecture and accuracy findings

| ID | Finding | Impact |
|---|---|---|
| AI-01 | Custom ReAct, fixed enhanced pipelines, legacy LangGraph, agent manager, raw-material, cosmetic, and sales orchestration coexist. | Behavior, safety, schema, cost, and observability vary by route. |
| AI-02 | Active routes silently fall back from one architecture to another. | A failure can bypass policy or produce materially different behavior. |
| AI-03 | Tool handlers connect directly to MongoDB and Qdrant. | Tenant filters and authorization depend on every handler being correct. |
| AI-04 | Some tools never receive execution context. | Formula reference and discussion tools cannot apply tenant policy. |
| AI-05 | Tool results are JSON strings and many boundaries use `any`. | Invalid intermediate state propagates until runtime. |
| AI-06 | Request and response shapes differ across routes. | Clients cannot reliably render errors, citations, artifacts, or approvals. |
| AI-07 | Confidence still falls back to constants such as `0.5`. | Scores are not calibrated evidence of correctness. |
| AI-08 | Formula persistence failures can be non-fatal. | The user may receive a success-looking response for an unsaved result. |
| AI-09 | There are no tenant model, tool, prompt, knowledge, cost, retention, or approval policies. | AI cannot be sold as a governed tenant capability. |
| AI-10 | Current Qdrant access has no tenant partition contract. | Tenant-uploaded knowledge would be unsafe. |
| AI-11 | Existing tests are ad hoc scripts and packages expose no standard test command. | Accuracy and security regressions cannot gate releases. |
| AI-12 | Documentation still describes older ChromaDB, Pinecone, and fixed pipelines. | Implementation decisions based on existing docs can target obsolete behavior. |

### 4.4 Deployment boundary finding

`apps/web/tsconfig.json` imports `apps/ai` server code directly, while `docker-compose.yml` deploys the web runtime and Qdrant but no AI service. The repository therefore has two workspace labels but one effective application runtime in production. The migration will create one logical AI gateway with explicit contracts inside the current server deployment. It will not add a network hop until the tenant and OODA contracts are stable.

## 5. Target architecture

### 5.1 Trust boundaries

1. The browser is untrusted.
2. Clerk validates identity and session state.
3. The server resolves platform and active-university authorization.
4. Tenant repositories enforce database predicates.
5. The AI policy resolver creates an immutable execution context.
6. LangGraph coordinates only actions allowed by that context.
7. Tool adapters inject security filters that are not visible or editable by the model.
8. Deterministic validators and approval gates control commits.

### 5.2 Request path

1. A request reaches Clerk middleware.
2. The route calls Clerk `auth()` and rejects an unauthenticated request with `401`.
3. The authorization resolver maps `clerkUserId` and active `clerkOrganizationId` to internal records.
4. The resolver rejects inactive profiles, inactive tenants, missing memberships, stale membership projections, or insufficient permissions with `403`.
5. Tenant and plan policy are resolved and snapshotted.
6. A quota reservation is created atomically.
7. The versioned request enters the OODA graph.
8. The graph emits typed events and checkpoints.
9. The final usage is reconciled against the reservation.
10. The response contains only the public output contract.

### 5.3 Logical components

| Component | Responsibility |
|---|---|
| Clerk adapter | Authentication, organizations, invitations, memberships, webhook verification. |
| Identity reconciler | Idempotent projection of Clerk state into MongoDB and drift repair. |
| Authorization resolver | Platform role, active tenant, membership role, permission evaluation. |
| Tenant repositories | Mandatory tenant predicates and ownership enforcement. |
| AI policy resolver | Effective policy inheritance and immutable policy snapshot. |
| AI gateway | Request validation, context creation, quota reservation, graph invocation, response streaming. |
| OODA graph | Observe, orient, decide, act, evaluate, clarify, approve, and finalize. |
| Tool gateway | Allowed tool registry, argument validation, context injection, retries, audit, idempotency. |
| Knowledge gateway | Platform and tenant retrieval with strict partitioning and provenance. |
| Artifact service | Typed drafts, formulas, comparisons, reports, revisions, and approval state. |
| Usage ledger | Requests, tokens, tool calls, cost, reservation, adjustment, and limits. |
| Audit service | Actor, tenant, permission, resource, policy version, reason, result, and correlation ID. |
| Evaluation harness | Golden fixtures, security cases, deterministic checks, model grading, and baseline comparison. |

## 6. Identity, tenancy, and RBAC

### 6.1 Role dimensions

Platform roles and university roles are separate fields. A platform administrator is not automatically a university member and does not automatically gain access to private university data.

#### Platform roles

| Role | Capabilities |
|---|---|
| `super_admin` | Create, suspend, and remove platform admins; manage all tenants; define global AI constraints and plans; emergency-disable AI; access platform audit and billing views. |
| `admin` | Create and suspend universities; appoint or remove university managers; assign plans and quotas; inspect non-content support diagnostics. |
| none | No platform console access. |

#### University roles

| Role | Capabilities |
|---|---|
| `manager` | Invite and suspend students; manage allowed AI agents, prompt overlays, tenant knowledge, student allocations, review queues, approvals, and tenant analytics. |
| `user` | Use enabled agents; manage their own threads and drafts; submit artifacts for review; access tenant resources granted to students. |

Privilege rules:

- Only `super_admin` can grant or revoke a platform role.
- `admin` and `super_admin` can create a university.
- Platform `admin` or `super_admin` appoints the first and subsequent university managers.
- A university manager may invite or suspend users but may not promote a user to manager.
- A university user cannot create an organization, change membership roles, configure AI, publish knowledge, or confirm a formula.
- University managers can confirm tenant formulas; students can create drafts and request review.
- Platform access to tenant content requires an explicit support-access grant with tenant, reason, expiration, and audit record.

### 6.2 Permission catalogue

Roles map to named permissions rather than scattered role-string comparisons.

Platform permissions:

- `platform.admins.manage`
- `platform.tenants.create`
- `platform.tenants.read`
- `platform.tenants.update`
- `platform.tenants.suspend`
- `platform.plans.assign`
- `platform.ai.defaults.manage`
- `platform.ai.emergency_disable`
- `platform.audit.read`
- `platform.support_access.request`

University permissions:

- `tenant.members.read`
- `tenant.members.invite_user`
- `tenant.members.suspend_user`
- `tenant.ai.read`
- `tenant.ai.configure`
- `tenant.knowledge.read`
- `tenant.knowledge.manage`
- `tenant.analytics.read`
- `ai.run`
- `ai.feedback.create`
- `formula.read`
- `formula.draft.create`
- `formula.draft.update_own`
- `formula.review.request`
- `formula.comment.create`
- `formula.confirm`

### 6.3 Clerk organization role mapping

Preferred production mapping:

- `org:manager` -> university `manager`
- `org:user` -> university `user`

Clerk custom organization roles require a paid production plan. If the selected Clerk plan does not include custom roles, use this exact compatibility mapping without changing the application permission model:

- `org:admin` -> university `manager`
- `org:member` -> university `user`

The application will never use Clerk's role label directly as a business authorization decision. It maps the role to the internal permission catalogue first.

### 6.4 Membership cardinality

The first commercial release permits one active university membership for a normal user. The schema supports more than one membership so a later release can enable cross-university professors without another data migration. Every tenant request still requires an explicit active Clerk organization.

### 6.5 Core identity models

The exact Prisma syntax belongs in the implementation plan; the required fields and invariants are fixed here.

#### `UserProfile`

- Internal ObjectId primary key
- Unique `clerkUserId`
- Optional unique `legacyAccountId` during migration
- Primary email and display name projection
- Optional `platformRole`
- Status: `active`, `suspended`, `deleted`
- Clerk synchronization timestamp and version
- Created and updated timestamps

#### `Tenant`

- Internal ObjectId primary key
- Unique `clerkOrganizationId`
- Unique stable slug
- Name
- Type fixed to `university` for this release
- Status: `provisioning`, `active`, `suspended`, `repair_required`, `deleted`
- Commercial plan key
- Data residency region
- Provisioning idempotency key
- Created-by platform profile ID
- Activated, suspended, created, and updated timestamps

#### `TenantMembershipProjection`

- Internal ObjectId primary key
- Unique `clerkMembershipId`
- Tenant ID and user profile ID
- University role: `manager` or `user`
- Status: `invited`, `active`, `suspended`, `revoked`
- Clerk synchronization timestamp and version
- Unique compound index on tenant and profile

Clerk is authoritative for membership. This collection is a queryable and auditable projection, not an independent role store.

### 6.6 Server authorization API

The backend will expose these procedure layers:

- `publicProcedure`: health and explicitly public content only.
- `authenticatedProcedure`: valid Clerk session and active profile.
- `tenantMemberProcedure`: valid active tenant and membership.
- `tenantPermissionProcedure(permission)`: active membership plus named permission.
- `platformAdminProcedure`: active `admin` or `super_admin` loaded from the database.
- `superAdminProcedure`: active `super_admin` loaded from the database.

High-impact platform operations always read the current database platform role rather than trusting a potentially stale session claim.

### 6.7 Resource-level enforcement

Every tenant-owned repository method requires a `TenantExecutionContext`. Public callers cannot supply a tenant ID. A resource lookup has the following effective predicate:

```text
_id = requestedResourceId
AND tenantId = context.tenantId
AND resource status is permitted
AND any user-level ownership or sharing rule is satisfied
```

An update or delete that matches zero records returns a generic not-found result so callers cannot enumerate resources in other tenants.

## 7. Clerk flows

### 7.1 Sign-in and sign-up

- Use `ClerkProvider`, Clerk-hosted or prebuilt sign-in components, and Clerk server helpers.
- New commercial users enter through an invitation.
- A Clerk identity with no active membership receives an onboarding/waiting page, not tenant data.
- Normal users have organization creation disabled.
- MFA is required for platform admins and recommended for university managers.
- Existing `/login` and `/signup` custom password forms are removed after cutover.

### 7.2 University provisioning

Provisioning is an idempotent server workflow:

1. Verify `platform.tenants.create`.
2. Validate university name, slug, region, plan, and initial manager email.
3. Create a MongoDB tenant in `provisioning` with an idempotency key.
4. Create the Clerk organization through the Backend API without exposing organization creation UI.
5. Persist the Clerk organization ID.
6. Create default AI profile, entitlements, quotas, and policy version.
7. Invite the initial professor with the manager role.
8. Reconcile organization and invitation events.
9. Mark the tenant `active` only when required resources exist.

If Clerk creation succeeds but MongoDB persistence fails, the workflow records `repair_required`, retains the Clerk resource identifier in the operation log, and lets a reconciler complete or compensate the operation. It must not blindly create a second organization on retry.

### 7.3 Invitation lifecycle

- Platform admins invite managers.
- University managers invite students.
- Invitation role and tenant are fixed server-side from the caller's permission.
- Invitations have an expiration and can be revoked.
- Acceptance activates or creates the membership projection through a signed webhook.
- An invited email cannot select a different tenant or role in the browser.

### 7.4 Webhook processing

- Verify the webhook signature before reading the event.
- Persist Clerk event ID with a unique index for idempotency.
- Handle user, organization, membership, invitation, and deletion events.
- Process events through retryable jobs.
- Move exhausted events to a repair queue with an operator-visible reason.
- Run a scheduled reconciler that compares Clerk resources with internal projections.
- Reject tenant access when an authorization-critical projection is known to be stale or contradictory.

### 7.5 Existing user migration

Use Clerk's export/import strategy:

1. Freeze legacy account mutations for the cutover window.
2. Export accounts, users, organizations, roles, statuses, and bcrypt digests.
3. Validate unique normalized emails and valid bcrypt hash format.
4. Create Clerk users with `externalId = legacy account ID`, `passwordDigest`, and `passwordHasher = bcrypt`.
5. Create Clerk organizations and preserve the internal legacy organization mapping.
6. Map legacy roles using an explicit migration table.
7. Put `shipper`, `shopper`, conflicting, missing, or multi-organization records into a manual review report; never elevate ambiguity to manager.
8. Create memberships and internal projections.
9. Reconcile source and destination counts and identifiers.
10. Test password sign-in for controlled fixtures.
11. Enable Clerk sessions and make legacy auth read-only.
12. Remove legacy password hashes and sessions after the rollback and legal-retention window.

## 8. Tenant data model and migration invariants

### 8.1 Tenant-owned records

Every tenant-owned collection must have a required internal `tenantId`, an index beginning with `tenantId`, and audit timestamps. This includes:

- Products and stock
- Orders and calculations
- Formulas, formula comments, and formula version logs
- Threads and messages
- Conversations and AI responses retained during migration
- Feedback and preference-learning data
- Tenant knowledge sources and ingestion jobs
- AI runs, checkpoints, artifacts, approvals, and usage
- User and product activity logs

IDs that are currently called `organizationId` will be migrated consistently to `tenantId` at repository boundaries. Temporary database compatibility fields may exist during backfill but public contracts will expose neither field as caller-controlled identity.

### 8.2 Platform-global records

The following may remain platform-global when explicitly classified:

- Approved raw-material reference catalog
- Global regulatory references
- Commercial plan definitions
- Provider and model catalogue
- Non-overridable safety policies
- Platform prompt base versions

Global records carry `scope = platform` and do not masquerade as tenant records.

### 8.3 Backfill invariants

- No tenant-owned record is left without a valid active or retained tenant reference.
- Invalid or ambiguous records are quarantined and reported rather than assigned to a default tenant.
- Parent and child records resolve to the same tenant.
- Formula comments and version logs inherit and persist the owning formula tenant.
- Thread messages inherit and persist the owning thread tenant.
- All unique business keys that were previously global become tenant-compound keys where appropriate.
- Backfill scripts are restartable, idempotent, count-verifying, and dry-run capable.

## 9. Tenant AI control plane

### 9.1 Policy inheritance

Effective policy resolves in this order:

`platform hard constraints -> plan entitlements -> tenant settings -> agent deployment -> permitted request preferences`

Each lower layer may narrow an allowance but cannot expand beyond an upper layer. Every AI run snapshots the effective policy and version identifiers so historical behavior can be explained after settings change.

### 9.2 Required models

#### `TenantAIProfile`

- Tenant ID and status
- Commercial plan key
- Monthly request, token, and monetary limits
- Per-user limits
- Maximum concurrent runs
- Default locale
- Data retention days
- Web-search allowance
- Tenant knowledge allowance and storage ceiling
- Review and confidence policy
- Current effective-policy version

#### `AgentDeployment`

- Tenant ID and stable agent key
- Enabled state
- Agent definition version
- Allowed provider and model set
- Temperature and output ceilings within platform bounds
- Allowed tool capability set
- Prompt base version and tenant overlay version
- Required output schema version
- Required approval rules
- Feature flags

#### `PromptVersion`

- Scope: platform or tenant
- Immutable prompt content hash
- Semantic version and status
- Creator and approver
- Evaluation result reference
- Activation and retirement timestamps

#### `KnowledgeSource`

- Tenant ID or platform scope
- Source type and original object reference
- Visibility and allowed roles
- Parsing and ingestion state
- Content hash and source version
- Embedding model and index version
- Provenance, freshness, retention, and deletion state

#### `AIUsageLedger`

- Tenant, user, run, agent, provider, and model
- Operation type
- Reserved and actual requests, tokens, and cost
- Adjustment reason
- Idempotency key
- Timestamp and billing period

#### `AIRun`

- Tenant, actor, thread, and agent
- Request and schema version
- Policy, prompt, agent, and model versions
- Status and current stage
- Budget and usage
- Safe decision summaries and tool audit references
- Error code and correlation ID
- Started, completed, and retained-until timestamps

#### `AIArtifact`

- Tenant, run, owner, type, and schema version
- Immutable revision number
- Structured data and validation result
- Draft, awaiting-review, approved, rejected, or superseded status
- Source evidence references

#### `AIApproval`

- Tenant, run, artifact, and checkpoint reference
- Required permission
- Approver, decision, edits, and reason
- Requested, decided, and expiration timestamps

### 9.3 Control authority

- `super_admin` controls approved providers/models, global tools, hard safety limits, plan definitions, and emergency disable.
- `admin` assigns plans and quotas and can suspend tenant AI.
- `manager` enables plan-allowed agents, configures permitted overlays, manages tenant knowledge, allocates student usage, and sets stricter approval thresholds.
- `user` can invoke only enabled agents and access only permitted tenant and user resources.

### 9.4 Immutable execution context

The server builds a `TenantExecutionContext` containing:

- Internal tenant and profile IDs
- Clerk user, organization, membership, and session identifiers
- Platform role, university role, and resolved permissions
- Run, request, correlation, and thread IDs
- Agent deployment and effective-policy snapshots
- Prompt versions
- Quota reservation
- Locale, residency, and retention rules

Neither model-visible tool arguments nor browser input contain authoritative fields from this context.

### 9.5 Quota enforcement

1. Atomically reserve the maximum allowed cost or token budget before a run.
2. Reject or queue when tenant, user, or concurrency limits are exhausted.
3. Decrement remaining run budget before expensive nodes and tool calls.
4. Reconcile actual usage at completion, cancellation, timeout, or failure.
5. Release unused reservation exactly once.
6. Record every adjustment with an idempotency key.

## 10. Knowledge isolation

### 10.1 Collection strategy

- Platform-approved knowledge is stored in a dedicated platform collection per embedding version.
- Tenant knowledge is stored in a tenant-partitioned collection per embedding version.
- Tenant collections use a keyword `tenant_id` payload index with Qdrant's tenant setting.
- The application may promote a large tenant to a dedicated shard later without changing repository interfaces.

Creating one collection per university is not the default because Qdrant documents the operational overhead of hundreds or thousands of collections. Payload-based tenant partitioning is the supported baseline.

### 10.2 Retrieval contract

- The knowledge gateway receives `TenantExecutionContext`, not a tenant ID argument.
- Tenant filters are injected by trusted code.
- Model-proposed metadata filters are validated and added to the mandatory tenant predicate; they cannot replace it.
- Platform and tenant searches execute separately.
- The merger labels source scope and applies entitlement and visibility rules.
- Direct Qdrant client access from agents and tools is prohibited.
- A caller cannot request an unfiltered cross-tenant query.

### 10.3 Evidence record

Every retrieved observation contains:

- Evidence ID
- Source scope and tenant ID when applicable
- Knowledge source and source version
- Document and chunk identifiers
- Retrieval time and freshness
- Retrieval score and reranking score
- Content hash
- Safe display citation
- Claims or artifact fields supported by the evidence

## 11. OODA orchestration

### 11.1 Why an explicit graph

The existing custom ReAct loop offers dynamic tool calling but lacks durable state, consistent approval, tenant policy, typed intermediate state, and a single execution boundary. A typed LangGraph `StateGraph` supplies explicit conditional transitions, bounded loops, retry policies, checkpoints, streaming, and interrupts while preserving model-driven planning inside controlled nodes.

### 11.2 Graph nodes

| Node | OODA phase | Responsibility |
|---|---|---|
| `ingress` | Observe | Validate request, resolve execution context, create run, reserve quota. |
| `observe` | Observe | Load authorized memory, normalize new evidence, identify gaps, contradictions, freshness, and risk. |
| `orient` | Orient | Produce a structured plan with goal, constraints, evidence needs, candidate capabilities, output schema, risk, and stop criteria. |
| `validate_plan` | Orient | Remove unauthorized actions, enforce policy, validate dependencies and budgets. |
| `decide` | Decide | Select clarify, retrieve, calculate, delegate, draft, approve, retry, or finalize. |
| `action_gate` | Decide | Re-check permission, tenant state, quota, idempotency, and approval requirements immediately before action. |
| `act` | Act | Invoke one permitted tool or a bounded set of independent read-only actions. |
| `evaluate` | Observe | Validate observations and artifacts, score evidence coverage, find contradictions, and select reorientation or completion. |
| `request_clarification` | Decide | Return a typed information request and checkpoint state. |
| `request_approval` | Decide | Interrupt with a typed approval request and durable checkpoint. |
| `finalize` | Act | Validate the public response, reconcile usage, close the run, and emit completion. |
| `fail` | Act | Reconcile usage, persist a safe error, and emit failure. |

### 11.3 State contract

Graph state is JSON-serializable, Zod-validated, and versioned. It includes:

- Request envelope and immutable execution-context reference
- User goal and constraints
- Conversation summary and relevant messages
- Effective policy snapshot
- Structured plan and remaining steps
- Evidence requirements and observations
- Candidate and completed actions
- Draft artifacts and validation reports
- Risk and approval state
- Iteration, latency, token, tool-call, and cost budgets
- Safe decision summaries
- Terminal status and public response

Raw secrets, database clients, provider clients, and full hidden reasoning are never checkpointed.

### 11.4 Dynamic behavior with deterministic limits

The planner can change tools and order after observing evidence. The controller remains bounded by:

- Maximum graph super-steps
- Maximum OODA cycles
- Maximum per-tool and total tool calls
- Maximum token, monetary, and wall-clock budgets
- Capability and role allowlists
- Explicit stop conditions
- Loop detection based on repeated normalized actions
- Required clarification when necessary input is absent
- Required approval for high-impact actions

### 11.5 Specialist subgraphs

Specialists are bounded implementation units, not independent top-level personas:

- Tenant and platform knowledge retrieval
- Formula generation and revision
- Formula calculation and deterministic validation
- Market and regulatory research
- Evidence comparison and contradiction analysis
- Response and artifact composition

Specialists inherit the parent execution context and checkpointer. Per-invocation state is the default; a specialist receives per-thread state only when its contract requires multi-turn memory.

### 11.6 Tool contract

Each tool defines:

- Stable capability name and semantic version
- Zod input and output schemas
- Read, draft-write, approved-write, or external-network effect class
- Required permission
- Allowed agent types
- Timeout and retry policy
- Idempotency strategy
- Cost estimator
- Audit redaction rules

Security fields are not model-visible arguments. The tool executor injects `TenantExecutionContext` separately.

### 11.7 Side effects and approval

- Read-only tools may execute after the action gate.
- Draft writes require an allowed draft capability and idempotency key.
- Confirmation, publishing, membership, indexing, and policy changes require deterministic authorization and an appropriate approval workflow.
- A student-generated formula is always a draft.
- `formula.confirm` requires an active manager and uses an atomic version transition.
- Side effects are isolated in idempotent tasks so checkpoint replay cannot duplicate writes.

### 11.8 No silent architectural fallback

A run records one orchestrator version. Provider fallback may occur only inside that orchestrator and only to a provider/model allowed by the effective tenant policy. It cannot switch to a legacy route or bypass graph policy. Tenant rollback is a deployment decision between runs, not an exception handler inside a run.

## 12. Input, event, and output contracts

### 12.1 Public request envelope

The browser may provide:

- `schemaVersion`
- `requestId` for client retry correlation
- `agentKey`
- Optional opaque `threadId`
- User message
- Authorized uploaded-object references
- Requested locale
- Permitted presentation preferences

The browser may not provide authoritative user, tenant, role, permission, provider, model, tool, prompt, quota, or policy fields.

### 12.2 Upload and ingestion

1. Issue a tenant- and user-bound upload authorization.
2. Validate content length, filename, and declared media type.
3. Store in quarantine.
4. Verify detected MIME type and scan for malware.
5. Parse with resource and timeout limits.
6. Normalize text, tables, and metadata.
7. Classify PII and restricted content.
8. Capture source, uploader, content hash, and consent/provenance.
9. Apply visibility and retention.
10. Chunk and index asynchronously.
11. Expose the source to retrieval only after successful ingestion and policy checks.

### 12.3 Observation contract

An observation contains:

- Observation ID and type
- Tool capability and version
- Success, empty, partial, transient-error, or permanent-error status
- Typed data
- Evidence references
- Freshness and quality signals
- Redacted diagnostics
- Cost and latency

Tools do not return arbitrary JSON strings into graph state.

### 12.4 Streaming events

Stable public event types are:

- `run.started`
- `stage.changed`
- `tool.started`
- `tool.completed`
- `clarification.required`
- `approval.required`
- `artifact.updated`
- `usage.updated`
- `run.completed`
- `run.failed`

Events contain sequence numbers so reconnecting clients can resume without reapplying an older event.

### 12.5 Public response envelope

- Run, thread, status, and schema version
- User-facing answer
- Typed artifacts and artifact versions
- Evidence and display citations
- Groundedness, completeness, uncertainty, and risk signals
- Clarification or approval request when applicable
- Safe next actions
- Usage and latency summary allowed by policy
- Public error code and correlation ID when applicable

The API never returns hidden chain-of-thought. It retains concise decision summaries, policy decisions, actions, observations, and validation outcomes for audit.

## 13. Accuracy and validation

### 13.1 Evidence-first completion

The plan specifies evidence requirements before synthesis. The evaluator compares supported claims and artifact fields to those requirements. A run cannot label itself complete when required evidence is missing; it must retrieve more data, ask for clarification, or return `partial` with explicit limitations.

### 13.2 Quality dimensions

Do not expose one arbitrary confidence number. Track at least:

- Groundedness: proportion of factual claims supported by evidence
- Evidence coverage: proportion of required evidence satisfied
- Source quality and freshness
- Contradiction state
- Deterministic validation pass rate
- Completeness against the user goal
- Risk severity

Any composite score must be calibrated against the approved evaluation set and retain its component values.

### 13.3 Formula validation

Before a formula artifact can enter review:

- Percentages total `100.00%` within a tolerance of `0.01%`.
- Amounts reconcile with batch size and units.
- Every non-water ingredient resolves to an authorized material record or is explicitly labelled external/unverified.
- Usage ranges have source and jurisdiction context.
- Mandatory functional categories are checked for the product type.
- Known incompatibilities and pH constraints are reported.
- Preservative, stability, allergen, and regulatory warnings are surfaced.
- Cost is reproducible from dated source values.
- The artifact states that laboratory, stability, safety, and regulatory review remain required.

The current hardcoded rule set is treated as a starting reference, not the sole regulatory authority.

### 13.4 Retrieval and citation validation

- Citations map to evidence IDs, not model-invented labels.
- The finalizer verifies that cited evidence exists in the run and was authorized.
- Claims without sufficient support are removed, qualified, or marked uncertain.
- Conflicting evidence is surfaced rather than averaged invisibly.
- Freshness-sensitive questions enforce policy-defined maximum source age.

## 14. Failure handling

### 14.1 Fail-closed conditions

The request terminates without data access when any of these are missing or contradictory:

- Verified identity
- Active profile
- Required active tenant
- Active membership
- Required permission
- Active tenant and AI profile
- Valid policy snapshot
- Available quota reservation

### 14.2 Retry and recovery

- Transient database, vector, provider, and network failures use bounded exponential retries with jitter.
- Validation and authorization failures are not retried.
- Provider fallback stays inside the approved model set.
- Graph state checkpoints after meaningful super-steps.
- Resuming a checkpoint uses the same tenant and actor authorization checks again.
- Side effects use idempotency keys and atomic predicates.
- A repeated action detector prevents tool loops.

### 14.3 Partial and clarification outcomes

- Missing required user information produces `clarification_required`.
- Approval produces `awaiting_approval`.
- Budget or time exhaustion produces `partial` when safe evidence exists; otherwise `failed`.
- Empty retrieval causes reorientation before a partial result.
- A persistence failure for a requested write cannot return completed success.

### 14.4 Safe errors

Public errors contain a stable code, safe message, retryability, and correlation ID. Internal logs contain structured diagnostics with secrets, personal data, prompts, and document content redacted by field policy.

## 15. Observability, audit, and operations

### 15.1 Required telemetry

- Request and run rate by tenant, agent, model, and status
- Authentication and authorization denials
- OODA cycle and node counts
- Node and tool latency, error, retry, and timeout rates
- Provider tokens and estimated/actual cost
- Quota reservation and reconciliation drift
- Retrieval result count, score distribution, and empty rate
- Validation and approval outcomes
- Groundedness and evaluation trend
- Webhook lag, retry, and reconciliation drift
- Qdrant and MongoDB capacity and saturation

### 15.2 Audit events

Audit events include actor, tenant, action, permission, target, before/after hash where relevant, reason, policy version, result, source IP/session metadata allowed by policy, and correlation ID. Sensitive tenant content is not copied into generic audit logs.

### 15.3 Retention and deletion

- Tenant policy selects within plan and platform retention bounds.
- Run checkpoints may have shorter retention than approved artifacts.
- Deletion propagates to MongoDB, object storage, vector points, cached summaries, and future retrieval.
- Audit records retain only legally and operationally required metadata.
- Tenant export and deletion jobs are idempotent and produce a completion report.

## 16. Migration sequence

### Phase 0: contain current exposure

- Disable public organization creation.
- Authenticate every direct API route.
- Stop accepting authoritative identity fields.
- Restrict organization, user, credit, order, indexing, and AI-write operations.
- Add temporary tenant checks to formula tools.
- Remove public secret fallbacks and rotate exposed keys.

Exit gate: all P0 routes and mutations have verified server authorization.

### Phase 1: build commercial data foundation

- Add identity, tenant, membership, permission, AI policy, usage, run, artifact, approval, and audit models.
- Add tenant-scoped repositories.
- Backfill tenant ownership and quarantine ambiguous data.
- Add dry-run and verification reports.

Exit gate: every tenant-owned record is attributable and every repository requires context.

### Phase 2: migrate to Clerk

- Configure Clerk, roles, organization-creation restrictions, MFA policy, and email delivery.
- Import users and bcrypt digests.
- Create organizations and memberships.
- Install webhook processing and reconciliation.
- Cut server context to Clerk behind a deployment flag.

Exit gate: source and Clerk/internal reconciliation have no unexplained mismatch, and controlled sign-in/invitation tests pass.

### Phase 3: convert authorization

- Add named permissions and scoped procedures.
- Convert routers, routes, server components, and admin pages.
- Remove identity from public schemas.
- Add support-access workflow.

Exit gate: the complete role matrix and cross-tenant suite pass.

### Phase 4: introduce tenant AI control

- Provision profiles, deployments, prompts, entitlements, quotas, and retention.
- Add policy, tool, knowledge, usage, and artifact gateways.
- Re-index tenant knowledge with partitioning.
- Route every legacy AI entry through the policy gateway during transition.

Exit gate: no model, retrieval, tool, or write can execute without a policy snapshot and tenant context.

### Phase 5: implement OODA

- Add versioned contracts and graph state.
- Implement graph nodes, specialist subgraphs, validators, checkpointing, streaming, and approvals.
- Adapt useful tools and remove their direct client access.
- Add evaluation and graph test harnesses.

Exit gate: contract, graph, deterministic validator, resume, and evaluation gates pass.

### Phase 6: shadow and canary

- Run a read-only legacy/new comparison on approved traffic and golden fixtures.
- Prevent all shadow writes.
- Compare accuracy, safety, latency, and cost.
- Enable the new orchestrator by internal tenant, pilot tenant, and cohort.

Exit gate: commercial release thresholds are sustained for the agreed observation window.

### Phase 7: cut over and remove legacy

- Make OODA the sole production path.
- Retain a tenant-level deployment rollback for the stabilization window.
- Delete legacy auth, duplicate orchestrators, obsolete routes, and misleading docs.
- Remove legacy password and session data after rollback and retention expire.

Exit gate: no production call path imports or invokes retired authentication or orchestrator code.

## 17. Testing strategy

### 17.1 Unit tests

- Permission catalogue and every role mapping
- Effective AI policy inheritance and upper-bound enforcement
- Request, state, plan, observation, artifact, event, and response schemas
- Tenant repository predicate construction
- Qdrant mandatory filter injection
- Quota reservation and reconciliation
- Idempotency and audit redaction
- Formula math, constraints, and transition validators
- OODA routers, loop detection, and stop conditions

### 17.2 Integration tests

- Clerk-authenticated request context
- Signed webhook replay, reordering, and duplicate delivery
- User and organization import fixtures with bcrypt hashes
- Provisioning compensation and repair
- Tenant-scoped MongoDB and Qdrant access
- Tool gateway authorization and output validation
- MongoDB checkpoint save, interrupt, resume, replay, and expiration
- Provider failure and approved fallback
- Upload quarantine, parse, index, delete, and retention

### 17.3 Security tests

- Unauthenticated request for every protected route
- Forged user, tenant, role, thread, formula, and checkpoint IDs
- Cross-tenant read, write, vector search, memory, artifact, and approval attempts
- Horizontal and vertical privilege escalation
- NoSQL/operator injection in model-generated filters
- Prompt injection attempting to reveal prompts, secrets, or other tenants
- SSRF and restricted destination tests for external tools
- Malicious files, decompression bombs, oversized documents, and parser timeouts
- Quota races and duplicate idempotency keys
- Support-access expiration and audit

### 17.4 End-to-end role journeys

1. Super admin creates a platform admin.
2. Platform admin creates a university and invites a professor.
3. Professor accepts, activates the university, configures an allowed agent, and invites a student.
4. Student accepts and runs an enabled agent.
5. Student is denied AI configuration, manager invitation, and formula confirmation.
6. Student creates a formula draft and requests review.
7. Professor reviews, edits or rejects, then confirms an acceptable draft.
8. A second university cannot discover any first-university resource.
9. Suspending the user or tenant immediately denies new requests.
10. Quota exhaustion produces the configured denial or partial behavior.

### 17.5 AI evaluation

The versioned evaluation set covers Thai, English, and mixed-language workflows:

- Exact raw-material lookup
- Semantic ingredient recommendation
- Formula generation and revision
- Batch and cost calculations
- Regulatory and freshness-sensitive research
- Conflicting source handling
- Missing-information clarification
- Citation and provenance correctness
- Prompt injection and unsafe requests
- Professor approval and checkpoint resume

Each release records the dataset version, model, prompts, agent version, policy, and deterministic validator version.

### 17.6 Load and resilience

- Concurrent student usage within one tenant
- Many small tenants using shared Qdrant partitions
- Webhook bursts and event replay
- Provider throttling and timeout
- MongoDB or Qdrant transient unavailability
- Process restart during an OODA cycle and during approval wait
- Tenant disable and emergency AI disable under load

## 18. Commercial release gates

All gates are mandatory:

1. Every protected route returns `401` without a valid Clerk session.
2. Every unauthorized role case returns `403` without reading or mutating the target.
3. All cross-tenant negative tests return no data and perform no side effect.
4. Clerk migration has no unexplained user, organization, or membership mismatch.
5. Every public and graph contract validates for every test fixture.
6. Formula totals are within `0.01%`, and no draft is confirmed without `formula.confirm` from an active manager.
7. At least 95% of evaluated factual claims have valid supporting evidence on the approved commercial evaluation set.
8. End-to-end task success improves by at least 10 percentage points over the recorded legacy baseline.
9. No critical or high-severity unresolved security finding affects the launch path.
10. Quota-race, retry, checkpoint-resume, webhook-replay, rollback, and data-deletion tests pass.
11. Tenant-level canary rollback completes without cross-tenant or data-integrity impact.
12. No production path silently falls back to a retired orchestrator.

## 19. Rollout and rollback

- Feature flags are server-controlled and keyed by tenant, not accepted from the browser.
- Rollout order is development, internal tenant, designated pilot university, small cohort, then general availability.
- Shadow mode is read-only and never exposes shadow output to users.
- A tenant is pinned to one orchestrator version for a run.
- Rollback changes the tenant's next-run deployment version; an in-flight run either completes on its recorded version or is safely cancelled and resumed according to policy.
- Database migrations use expand/backfill/verify/enforce/contract sequencing so old code can run during the stabilization window.
- Clerk remains the identity authority after cutover; rollback does not re-enable public legacy signup.

## 20. Documentation and deprecation map

The implementation must update or retire documentation that conflicts with this design:

- Root README authentication, role, tenancy, and architecture sections
- `docs/database-schema.md`
- `docs/MIGRATION_GUIDE.md`
- `docs/DEPLOYMENT.md`
- `docs/langgraph-integration-roadmap.md`
- AI agent READMEs and management documentation
- Environment-variable examples and secret guidance
- API and event contract references
- Security, incident, tenant provisioning, reconciliation, and rollback runbooks

Legacy endpoints and classes receive an explicit deprecation owner and removal phase in the implementation plan. No stale route remains reachable merely for compatibility.

## 21. Implementation decomposition and dependency order

This document is the umbrella commercial architecture. It is intentionally broader than one safe code-change batch. Implementation planning must split it into the following bounded subprojects while preserving these shared invariants and release gates:

1. **Immediate security containment** — protect the existing routes, stop caller-controlled identity, close public mutations, and remove public secrets. This starts first and does not wait for the new OODA system.
2. **Clerk identity and tenant provisioning** — add Clerk, identity models, organizations, invitations, import, webhooks, and reconciliation. It depends on the new identity schema but not on OODA.
3. **Tenant data and authorization conversion** — backfill tenant ownership, introduce scoped repositories, named permissions, and convert every route. It depends on resolvable Clerk/internal identities and gates external multi-tenant beta.
4. **Tenant AI control plane and knowledge isolation** — add policies, entitlements, quotas, usage, prompt versions, tenant retrieval, and tool capability enforcement. It depends on tenant authorization and is a prerequisite for the production OODA graph.
5. **OODA contracts and orchestrator** — build versioned contracts, LangGraph state, nodes, tools, validators, checkpoints, approvals, and streaming. It may develop against test contexts earlier, but cannot receive production traffic until subproject 4 is enforced.
6. **Evaluation, canary, deprecation, and commercial operations** — establish baselines, shadow comparison, tenant rollout, rollback, deletion, runbooks, and legacy removal. Evaluation fixtures start with subproject 5; cutover waits for all earlier exit gates.

Each subproject receives its own executable task sequence and verification commands. A program-level implementation plan must show their dependencies, migration gates, and rollback points; it must not combine all database, auth, and AI changes into one release or one irreversible migration.

## 22. External platform constraints used by this design

- Clerk recommends authorization close to the protected resource rather than relying only on middleware: <https://clerk.com/docs/reference/nextjs/clerk-middleware>
- Clerk supports backend organization creation: <https://clerk.com/docs/reference/backend/organization/create-organization>
- Clerk supports organization invitations with assigned roles: <https://clerk.com/docs/reference/backend/organization/create-organization-invitation>
- Clerk custom organization roles and permissions require a paid production plan: <https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions>
- Clerk accepts existing bcrypt password digests during user creation: <https://clerk.com/docs/reference/backend/user/create-user>
- LangGraph supplies checkpoint persistence, interrupts, conditional graph routing, and MongoDB checkpointers: <https://docs.langchain.com/oss/javascript/langgraph/persistence>, <https://docs.langchain.com/oss/javascript/langgraph/interrupts>, <https://docs.langchain.com/oss/javascript/langgraph/use-graph-api>
- Qdrant recommends tenant payload partitioning rather than hundreds or thousands of collections: <https://qdrant.tech/documentation/tutorials/multiple-partitions/>

## 23. Final architecture invariants

1. No caller chooses its authoritative tenant or role.
2. No tenant-owned query runs without a tenant predicate.
3. No AI action runs without an effective policy snapshot and quota reservation.
4. No model-visible tool argument can weaken authorization or tenant filtering.
5. No high-impact AI write commits without the required deterministic authorization and approval.
6. No hidden fallback changes execution architecture inside a run.
7. No output is labelled complete when required evidence or deterministic validation is missing.
8. No checkpoint resume bypasses current identity, tenant, or permission checks.
9. No commercial release proceeds without cross-tenant, role, migration, accuracy, and rollback evidence.
10. No legacy password or session path remains after the documented stabilization and retention window.
