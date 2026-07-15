# Changelog

## [2026-07-15] feat: Durable run-job queue with compare-and-set leases (G4.9a)

### Summary

- Added the `AIRunJob` Prisma model (`ai_run_jobs`) and
  `apps/ai/server/services/ai-gateway/run-job-queue.ts`: the durable work queue
  that drives a governed run forward independently of any serverless request.
  `enqueue` is idempotent on `[runId, command]` (unique index + `$setOnInsert`),
  so a retried gateway call never double-schedules. `claim` is a single
  `findOneAndUpdate` compare-and-set over available-or-expired jobs, so two
  workers can never own the same job and a crashed worker's expired lease is
  reclaimable on the next claim (attempts increment each claim). `heartbeat`,
  `complete`, and `release` (with a backoff before re-availability) are all
  owner-gated. The queue is deliberately platform-level, not tenant-scoped — the
  worker rebuilds the tenant context from the pinned AIRun after claiming.
- Context: the `@langchain/langgraph` upgrade this task nominally required is
  already in place — the orchestration package resolves nested langgraph 1.4.7 /
  core 1.2.2 / langgraph-checkpoint-mongodb 1.4.0 (isolated from apps/ai's legacy
  0.2.74), and the suite already runs on it.

### Verification approach

- `tests/integration/run-job-queue.test.ts` (7) against a real in-memory MongoDB:
  idempotent enqueue, distinct start/resume, single-worker claim, expired-lease
  reclaim, owner-gated heartbeat (with steal-prevention), complete, and
  backoff-gated release.
- Four gates: full suite **577/577** (was 570; +7), typecheck 0 (new file clean
  under apps/ai), security scan 0, production web build pass; Prisma schema valid.

### Remaining (G4.9)

- `event-store` (G4.9b), `run-selector` (G4.9c), real-`MongoDBSaver` durability
  verification (G4.9d, closes G4.7), the `ai-gateway` `create_run` transaction
  (G4.9e), the private `worker.ts` (G4.9f), and the three Next.js routes (G4.9g).

## [2026-07-15] feat: Orchestration-boundary enforcement + G4 evidence (G4.11, core)

### Summary

- Added the **`OODA_GATEWAY_BYPASS`** rule to
  `scripts/security/scan-private-boundaries.ts`: any production caller that drives
  the governed loop graph directly — `compile_agent_loop_graph(...).invoke|stream`,
  `build_agent_loop_graph(...).invoke|stream`, or a local variable bound to one of
  those builders — is rejected, so no route or service can run an agentic loop
  outside the AI gateway that binds policy, budget, and identity. The rule tracks
  builder-derived graphs specifically (two-phase: collect bound vars, then flag
  their invoke/stream), so legacy LangGraph graphs that happen to be named `graph`
  (built from `StateGraph`) are never mistaken for the governed loop. The
  orchestration package, the AI gateway, and test files are exempt.
- Recorded the interim G4 release evidence in
  `docs/commercial/evidence/g4-release.md`: the verified loop topology,
  single-model-node invariant, context-pack pinning, exactly-once checkpoint
  restart, interrupt authorization, deterministic formula validation + commit,
  idempotent event reconnect, and loop-detection — each tied to its test — plus an
  honest pending list for the G4.9 run/event API, the langgraph upgrade, and the
  live-stream UI.

### Verification approach

- `tests/security/ooda-boundary.test.ts` (7): flags a loop graph held in a local
  variable, any variable name, and a direct builder call; exempts the orchestration
  package, the gateway, and tests; and does **not** flag unrelated `.invoke`/
  `.stream` calls (llm, tools, chain, a legacy `this.graph`, a legacy `StateGraph`
  named `graph`, or `streamEvents`).
- `npm run security:scan` stays at **0 violations** on the production tree with the
  new rule live.
- Four gates: full suite **570/570** (was 563; +7), typecheck 0, security scan 0,
  production web build pass.

### Remaining (G4.11, with G4.9)

- The capability-card ↔ tool-definition CI consistency check, the legacy-entry-point
  import rule (needs the gateway to define the boundary), the `agentic-run.spec.ts`
  e2e, and provider-failure/budget-limit evidence exercised through the live run API.

## [2026-07-15] feat: Versioned run-event view reducer (G4.10, core)

### Summary

- Added `apps/web/lib/agent_run_view.ts`: a pure, framework-free reducer that
  folds the server's ordered `AgentRunEventV1` stream into the view state the AI
  UI renders — lifecycle status, stage, evidence observations, tool actions,
  pending clarification/approval interrupts, artifact references, and terminal
  error — **without ever parsing model prose for control state**. `reduce_run_event`
  validates each raw event against the versioned schema and drops any event whose
  `sequence` was already seen, so a reconnect that replays earlier events is
  idempotent ("render each event once"). `apply_typed_run_event` is the exhaustive
  typed transition; interrupts clear when the loop resumes (`action.started`) or
  the run ends.
- This is the deterministic heart of plan Task 10. The live SSE hook
  (`use_agent_run`), the React cards, and the reconnect e2e spec consume the
  run/event API that G4.9 provides, so they land with G4.9; the reducer is
  independently unit-tested now.

### Verification approach

- `tests/web/agent-run-view.test.ts` (9): a full run folds to completed with
  observations/actions/artifact; a reconnect replay of earlier events does not
  double-apply; duplicate observation ids are ignored; approval/clarification
  surface and clear; a terminal failure records the typed error; a malformed event
  is ignored; and the latest artifact version wins.
- Four gates: full suite **563/563** (was 554; +9), typecheck 0 (apps/web reducer
  clean), security scan 0, production web build pass.

## [2026-07-15] feat: Approval-gated formula artifact commit (G4.8d-iii)

### Summary

- Added `FormulaArtifactService.commit_confirmed`: a manager holding
  `formula:confirm`, with an approved AIApproval (checked through an injected
  `FormulaApprovalGate` port — the concrete ai_approvals adapter is wired by the
  gateway), commits a confirmed draft artifact to a real tenant `Formula`. It
  maps the validated `FormulaArtifactV1` into a create payload (no `organizationId`
  — a server-derived security field the tenant repository stamps itself), creates
  and confirms the formula idempotently through the existing `FormulaRepository`
  (`create_formula` → `confirm_formula`, replay-safe by idempotency key), then
  links the formula back onto the artifact via `mark_confirmed`. A replay short-
  circuits on the stored `confirmedFormulaId` and returns the same formula instead
  of duplicating it. Permission is checked before any write, and a missing
  approval raises the typed `FormulaCommitNotApprovedError`.
- Added the `confirmedFormulaId` link field to the `AIArtifact` Prisma model and
  extended `AIArtifactRepository.mark_confirmed` to persist it. All writes flow
  through the scoped repository helpers, so the boundary scanner stays satisfied.

### Verification approach

- `tests/repositories/ai-artifact-repository.test.ts` grew to 10 against a real
  in-memory MongoDB: the happy path (formula confirmed + artifact linked + confirm
  version-log), idempotent replay (one formula, `already_committed`), missing
  approval (rejected, zero formulas), a non-manager denied before the approval
  check, and the missing-repository guard.
- Four gates: full suite **554/554** (was 549; +5), typecheck 0 (new files clean
  under apps/ai), security scan 0, production web build pass; Prisma schema valid.

### Remaining (G4.8)

- Only the concrete raw-material-backed `MaterialEvidenceProvider` and the
  `FormulaApprovalGate` ai_approvals adapter remain — thin read-only adapters that
  plug into the already-built injected interfaces when the AI gateway is wired
  (G4.9). The deterministic artifact system (validate → quality → finalize →
  persist → approval-gated commit) is complete and tested.

## [2026-07-15] feat: Draft formula artifact persistence (G4.8d-ii)

### Summary

- Added `apps/ai/server/repositories/ai-artifact-repository.ts`: a tenant-scoped
  repository over `ai_artifacts` built on the G2 `tenant-repository-base` helpers
  (`persist_draft` forces `status: "draft"` and stamps tenant + owner from the
  execution context; `get_artifact` and `mark_confirmed` are tenant-filtered with
  the canonical `AI_ARTIFACT_NOT_FOUND` shape). All writes flow through
  `insert_scoped_document`/`update_scoped_document`, so the private-boundary
  scanner (G2.7) stays satisfied.
- Extended `FormulaArtifactService` with `persist_draft(context, artifact,
  validation, run_id)`: it stores the validated draft as an AIArtifact with a
  canonical (key-order-independent) content hash, the recorded validation result,
  and the deduplicated cited evidence sources. Callers persist the validation they
  already computed, so the stored record matches what the reviewer saw. The
  repository is an optional constructor dependency, so the loop-facing
  `validate_draft` path is unaffected.

### Verification approach

- `tests/repositories/ai-artifact-repository.test.ts` (5) against a real in-memory
  MongoDB: draft stamped with tenant/owner/draft status; read-back within the
  tenant but `AI_ARTIFACT_NOT_FOUND` across tenants; idempotent confirm;
  `persist_draft` records the hash + collected source ids; and the missing-repo
  guard.
- Four gates: full suite **549/549** (was 544; +5), typecheck 0 (new files clean
  under apps/ai too), security scan 0 (new writes go through the repository
  helpers), production web build pass.

### Remaining (G4.8, tracked as G4.8d-iii)

- `commit_confirmed`: a manager with `formula:confirm` and an approved `AIApproval`
  idempotently mapping the artifact into a `Formula` (+ `FormulaVersionLog`) via
  the existing `FormulaRepository`, then `mark_confirmed`. Straddles the
  orchestration `TrustedRuntimeContext` vs app `TenantExecutionContext` boundary,
  so it pairs with G4.9 gateway wiring.

## [2026-07-15] feat: FormulaArtifactService validate_draft adapter (G4.8d-i)

### Summary

- Added `apps/ai/server/services/ai-control/formula-artifact-service.ts`: the
  concrete `ArtifactService` the AI gateway wires into the governed loop's
  `artifacts` port (consumed by the G4.8c finalize node). `validate_draft` parses
  the tool-produced payload with `formula_artifact_v1_schema` (fails closed with
  `ARTIFACT_SCHEMA_INVALID` when it does not match), loads tenant-scoped material
  evidence through an injected `MaterialEvidenceProvider` (the orchestration
  package holds none by design), applies optional tenant/product constraints via
  an injected `FormulaConstraintProvider`, runs `validate_formula_artifact` +
  `compute_formula_quality_dimensions`, and returns the public
  `ArtifactValidationV1` — findings mapped to safe messages, plus the computed
  quality dimensions.
- Exported `formula-finalizer` from the orchestration barrel so hosts can import
  `compute_formula_quality_dimensions`.

### Verification approach

- `tests/ai-control/formula-artifact-service.test.ts` (4): a backed draft
  validates with full evidence coverage; a non-conforming payload fails closed; an
  unbacked material blocks with a safe message and lowered coverage; and injected
  incompatibility constraints block. The barrel import resolves from apps/ai.
- Four gates: full suite **544/544** (was 540; +4), typecheck 0 (new file also
  clean under apps/ai's tsconfig), security scan 0, production web build pass.

### Remaining (G4.8, tracked as G4.8d-ii)

- Persistence: the `MaterialEvidenceProvider` backed by tenant raw-material/
  knowledge data, draft `AIArtifact` persistence, and `commit_confirmed` — a
  manager with `formula:confirm` and an approved `AIApproval` idempotently writing
  `Formula` + `FormulaVersionLog` in one commit.

## [2026-07-15] feat: Authoritative finalize node with artifact validation (G4.8c)

### Summary

- Extracted finalize into `packages/ai-orchestration/src/nodes/finalize.ts` and
  made it the authoritative artifact gate. It recovers any produced tenant
  artifact from the run's observations (newest `tool_result` whose tool is
  registered `produces_artifact`), validates it through the injected
  `ArtifactService` — the orchestration package still holds no material evidence
  — and then:
  - **valid** → completes with a draft `ArtifactReferenceV1` (id = the producing
    observation's content hash) and the adapter-computed `quality_dimensions` +
    validation results in the run output;
  - **blocking, budget remaining** → routes back to the agent as a typed
    `validation_finding` observation (mirroring `route_denial`) so the model can
    revise, without completing or reconciling;
  - **blocking, budget exhausted** → completes honestly with the findings
    surfaced as warnings and no confirmable artifact.
  Answer-only runs (no produced artifact) finalize exactly as before.
- Graph rewire: `finalize` is registered with `ends: ["agent"]` alongside its
  static `finalize → END` edge, so the terminal path returns a plain update while
  the revision path returns a `Command`. `ArtifactValidationV1` gained an optional
  `quality_dimensions`, and `build_output_document` now accepts optional
  `quality_dimensions` / `artifacts` / `validation_results` / `extra_warnings`
  (all backward-compatible defaults, so the fail node is unchanged).

### Verification approach

- `tests/orchestration/finalize-node.test.ts` (5): answer-only completion; valid
  candidate → draft reference + quality passthrough; blocking with budget → routes
  to agent, no completion/reconcile; blocking at budget exhaustion → completes with
  warnings and no artifact; and the missing-proposal invariant.
- `graph-shape.test.ts` updated to lock the plan-mandated `finalize → agent` edge.
- Four gates: full suite **540/540** (was 535; +5), typecheck 0, security scan 0,
  production web build pass.

### Remaining (G4.8, tracked as G4.8d)

- `apps/ai/server/services/ai-control/formula-artifact-service.ts`: the concrete
  `ArtifactService` adapter that loads evidence, runs `validate_formula_artifact` +
  `compute_formula_quality_dimensions`, persists the draft `AIArtifact`, and lets a
  manager with `formula:confirm` + an approved `AIApproval` commit it idempotently
  to `Formula` + version/audit records.

## [2026-07-15] feat: Deterministic formula finalizer / quality dimensions (G4.8b)

### Summary

- Added `packages/ai-orchestration/src/artifacts/formula-finalizer.ts`:
  `compute_formula_quality_dimensions` maps a validated artifact + its material
  evidence to the public `QualityDimensionsV1` contract with no model
  involvement, so a replay reproduces the numbers exactly. Dimensions are
  computed from what is actually measurable — evidence coverage (backed non-water
  materials), source quality (materials with sources), groundedness (backed
  materials + cited claims over all such units), validation rate (structural +
  per-item checks minus blocking findings), completeness (artifact section
  presence), risk severity (blocking → high, warnings → medium/low), with
  contradiction state and source freshness taken from optional loop signals. The
  result is `quality_dimensions_v1_schema.parse`d so an out-of-contract value
  fails closed.
- Added `to_validation_results`: blocking findings map to failed
  `ValidationResultV1` records, warnings to passed-with-detail, for the run
  output's decision summary.

### Verification approach

- `tests/orchestration/formula-finalizer.test.ts` (6): a fully valid artifact
  tops every band; an unbacked material drops coverage and raises risk to high; an
  uncited claim drops groundedness; a below-minimum (warning-only) artifact is low
  risk yet valid; signals surface contradiction/freshness; and findings map to the
  public validation-result shape.
- Four gates: full suite **535/535** (was 529; +6), typecheck 0, security scan 0,
  production web build pass.

### Remaining (G4.8, tracked as G4.8c–G4.8d)

- `nodes/finalize.ts` (extract candidate artifact from observations, blocking
  findings → agent observation bounded by budget, else output + artifact
  reference + these quality dimensions) with the graph rewire, and the `apps/ai`
  `formula-artifact-service.ts` draft persist + manager confirmed commit.

## [2026-07-15] feat: Complete deterministic formula validator checks (G4.8a)

### Summary

- Extended `packages/ai-orchestration/src/artifacts/formula-validator.ts` with the
  remaining deterministic checks the G4.8 plan enumerates, closing the validator
  half of the G4.8 remainder:
  - **amount-from-batch** (unconditional, blocking `AMOUNT_INCONSISTENT_WITH_BATCH`):
    each ingredient's `amount` must equal its `percentage` of the batch, with
    exact decimal.js arithmetic and same-family unit conversion (mass g/kg, volume
    ml/L). A cross-family unit is unverifiable and surfaces as a warning
    (`AMOUNT_UNIT_MISMATCH`) rather than blocking.
  - **constraint-gated** checks that are no-ops unless configured, so pre-existing
    drafts validate unchanged: `INCOMPATIBLE_MATERIALS` (co-present pairs),
    `MISSING_REQUIRED_PHASE`, `PH_OUT_OF_RANGE` (blocking) / `PH_UNSPECIFIED`
    (warning), and dated cost — `COST_MISSING`/`COST_UNDATED` (blocking) with
    `COST_STALE` (warning) computed against a deterministic `as_of_iso`, never a
    wall clock.
- Added two backward-compatible optional schema fields in `formula-schema.ts`
  (`FormulaArtifactV1.target_ph`, `FormulaIngredientV1.cost_as_of`) via `.optional()`
  so existing typed fixtures compile unchanged, plus the `FormulaConstraintsV1`
  contract and a frozen `EMPTY_FORMULA_CONSTRAINTS` default. The validator now
  takes an optional third `constraints` argument.

### Verification approach

- `tests/orchestration/formula-artifact.test.ts` grew 11 → 23: amount consistent
  with a same-unit and a kilogram batch, an inconsistent amount, cross-family unit
  mismatch (warning), incompatible pair, missing required phase, pH out-of/in
  range, undated cost, dated cost within window, and a stale-cost warning.
- Four gates: full suite **529/529** (was 517; +12), typecheck 0, security scan 0,
  production web build pass.

### Remaining (G4.8, tracked as G4.8b–G4.8d)

- `formula-finalizer.ts` (compute quality_dimensions + evidence coverage),
  `nodes/finalize.ts` (extract candidate artifact from observations, blocking
  findings → agent observation bounded by budget, else output + artifact reference)
  with the graph rewire, and the `apps/ai` `formula-artifact-service.ts` draft
  persist + manager confirmed commit.

## [2026-07-15] feat: Deterministic formula artifact validator (G4.8, core)

### Summary

- Added `packages/ai-orchestration/src/artifacts/formula-schema.ts`
  (FormulaArtifactV1 with decimal-string percentages/amounts/costs, evidence
  index types, the validation-finding shape, and the mandatory review statement)
  and `formula-validator.ts`: `validate_formula_artifact` — the sole authority on
  whether a draft may be finalized, using **decimal.js** (never floats) so
  `|total - 100| <= 0.01` and usage-range checks are exact and replay-stable.
  Checks: percentage total within tolerance, unique materials, non-water
  materials evidence-backed (or explicitly external/unverified) and within their
  evidence usage range, availability, cited claims, and the mandatory
  laboratory/stability/safety/regulatory review statement. Blocking findings make
  `valid` false; warnings are surfaced.

### Verification approach

- `tests/orchestration/formula-artifact.test.ts` (11): the 0.01-tolerance anchor
  (99.98→invalid, 99.99/100.00/100.01→valid, 100.02→invalid), duplicate material,
  unbacked-vs-external material, usage above the evidence limit, uncited claim,
  and the required review statement.
- Four gates: full suite **517/517** (was 506; +11), typecheck 0, security scan 0,
  production web build pass.

### Remaining (G4.8, tracked)

- `formula-finalizer.ts` + the `finalize` node rewrite (evidence-coverage checks,
  quality_dimensions, blocking findings returned to the agent as bounded
  observations, optional model-assisted review notes that can't pass a failed
  check), `apps/ai/server/services/ai-control/formula-artifact-service.ts`
  (draft persist + manager-approved idempotent `commit_confirmed`), and the
  remaining deterministic checks (amount-from-batch, incompatibilities/pH,
  required phases, dated-cost completeness).

---

## [2026-07-15] feat: Persist and resume agentic loop checkpoints (G4.7, core)

### Summary

- Replaced the clarification/approval stubs with durable interrupt nodes.
  `request-clarification.ts` interrupts with the bounded questions and re-enters
  the agent with the validated answer as a trusted-user observation.
  `request-approval.ts` idempotently upserts the approval (replay returns the
  same one — exactly once), interrupts with an ApprovalRequestV1, and records the
  `verify_resume`-verified outcome; the interrupt is never wrapped in try/catch.
- The gate now consumes a verified `approval_result` **pinned to the action's
  arguments hash** — an approved result routes straight to `act` (and can never
  be inherited by a different action; the executor also re-checks approval), a
  denied result routes back to the agent with its denial observation. Added the
  `approval_result` state channel and the approval/clarification contracts.
- Extended the `ApprovalService` port with `verify_resume` and `count_for_run`.
- Added `checkpoint.ts`: `build_checkpoint_thread_id` derives the LangGraph thread
  key from INTERNAL tenant+thread IDs only (never a client key), plus a lazy
  `get_mongodb_saver` (dynamic import — a deployment concern, not a module side
  effect) and a re-export of Command/MemorySaver so callers resolve the same
  LangGraph instance the graph uses.
- Added `resume.ts`: `resume_run` re-verifies run existence, tenant ownership,
  caller permission, and pinned-version availability before invoking the graph
  with `Command({ resume })` — it never accepts a client checkpoint blob.
- Added `apps/ai/scripts/setup-langgraph-checkpoints.ts` (deployment step).

### Verification approach

- `tests/orchestration/interrupt-resume.test.ts` (5) against a checkpointer:
  an approval **resumes exactly once across a simulated restart** (a fresh graph
  instance over the same saver) with `count_for_run === 1` and one commit
  execution; a denied resume routes back to the agent with no commit; a
  clarification answer re-enters as a trusted-user observation; and `resume_run`
  rejects cross-tenant/forbidden/version-unavailable/missing resumes.
- Four gates: full suite **506/506** (was 501; +5), typecheck 0, security scan 0,
  production web build pass. Existing 47 orchestration tests unaffected.

### Remaining (G4.7, tracked)

- Real `MongoDBSaver` durability: the only published
  `@langchain/langgraph-checkpoint-mongodb` bumps `@langchain/langgraph-checkpoint`
  to a version incompatible with the pinned `@langchain/langgraph@0.2.74` (a
  `pending_sends` runtime skew), so it is not added to package.json. The
  MemorySaver cases prove the identical durable-resume + exactly-once semantics
  through the same checkpointer interface; production Mongo wiring (a langgraph
  upgrade + the saver dep) lands with the run API (G4.9).

---

## [2026-07-15] feat: Add specialist delegation through the governed loop (G4.6)

### Summary

- Added `packages/ai-orchestration/src/schemas/specialist.ts`: `SpecialistRequestV1`
  (public — no tenant/actor/permission/provider/credential field) and
  `SpecialistResultV1` (tenant_id/parent_run_id/depth stamped from the runtime;
  proposals constrained to read|draft — never commit).
- Added `delegation/delegation-registry.ts`: the three specialists
  (raw_material_research, formulation, sales_rnd) with tool allowlists, iteration
  ceilings, and budget fractions. Registration fails fast if any allowlist
  contains a delegation tool, capping delegation depth at 1 at load time.
- Added `delegation/delegate-tool-factory.ts`: `create_delegation_service` runs a
  specialist as a **recursive invocation of the same compiled loop graph** —
  a fresh child run with inherited tenant/actor, `parent_run_id`+`depth+1`
  lineage, a context pack filtered to the specialist's allowlist, and a budget
  slice reserved from the parent BEFORE dispatch (refused when it rounds to
  nothing). The child runtime's policy is wrapped to deny any out-of-allowlist
  tool at the gate, so even an adversarial child model cannot execute a
  commit-class or delegation tool. `invoke_parallel` runs read-only specialists
  concurrently, reserving all branch budgets up front. The recursive runner and
  the child context-pack builder are injected so the package stays free of
  provider/context-assembly wiring.
- Added the three `cards/tools/delegate.*.md` operator cards (when to delegate,
  budget cost, how to read proposals).

### Verification approach

- `tests/orchestration/delegation.test.ts` (9) runs the REAL graph recursively
  via a scripted model: tenant/lineage inheritance and depth=1; unknown
  specialist, depth-cap (a depth-1 runtime cannot delegate), and
  budget-insufficient rejections; an injected child model that tries
  `formula.confirm` is denied at the gate with zero executor calls (no commit);
  read-only concurrent branches; and non-read-only parallel refusal. Updated the
  capability-card test to treat the delegation cards as a distinct valid
  category (still size-checked).
- Four gates: full suite **501/501** (was 492; +9), typecheck 0 (incl.
  orchestration package), security scan 0, production web build pass.

---

## [2026-07-15] feat: Add tenant AI administration and platform constraints (G3.6)

### Summary

- Added three governance routers wired into `appRouter`:
  - `tenant-ai-settings.ts`: `read` (tenant:ai:read) returns stored settings +
    platform ceilings so locked values render; `update` (tenant:ai:configure)
    is **narrowing-only** — a requested value above the plan/platform ceiling is
    rejected `FORBIDDEN`, the prospective effective policy is compiled fail-closed
    before persistence, and the change is stored as a new revision (policyVersion
    bump), never editing a deployment in place.
  - `knowledge-sources.ts`: `list` (tenant:knowledge:read, metadata only),
    `requestUpload`/`remove` (tenant:knowledge:manage); new sources are created
    quarantined `pending` for the G3.5 ingestion pipeline.
  - `platform-ai-settings.ts`: `getConstraints`/`setDefaults`
    (platformAdminProcedure) and `emergencyDisable` (superAdminProcedure — the
    kill switch is super-admin-only).
- Added three server-rendered pages (`/settings/ai`, `/settings/ai/knowledge`,
  `/platform/ai`) whose server-side caller enforces permissions; each shows an
  access-denied fallback and never exposes tenant conversations or artifacts.

### Verification approach

- `tests/integration/ai-control-authorization.test.ts` (7) against in-memory
  MongoDB, running authorized paths end-to-end: a tenant user is denied AI
  read/configure and knowledge upload but may list; a manager configures within
  the plan but is rejected when expanding `max_iterations` or selecting a
  plan-forbidden model; a manager cannot reach platform surfaces; a platform
  admin reads constraints but cannot emergency-disable; only a super admin can.
- Four gates: full suite **492/492** (was 485; +7), typecheck 0, security scan 0,
  production web build pass (all three new routes in the manifest).

---

## [2026-07-15] feat: Isolate platform and tenant AI knowledge (G3.5, core)

### Summary

- Added the knowledge isolation core under `apps/ai/server/services/knowledge/`:
  - `qdrant-collections.ts`: versioned collection names
    (`platform_knowledge_v<v>` / `tenant_knowledge_v<v>`), the server-authored
    `tenant_filter`/`PLATFORM_FILTER`, the payload-index list, and
    `payload_is_tenant_owned`/`payload_is_platform` validators.
  - `knowledge-gateway.ts`: the single retrieval path. Callers choose only a
    scope (platform | tenant | both) — never a collection or raw filter. The
    gateway embeds the query, searches the platform and tenant collections
    separately with enforced filters, and **re-validates every returned point**
    against the enforced scope, so a mislabeled point in the store can never
    cross a tenant boundary. Results merge with provenance retained and no
    cross-embedding-version score comparison.
  - `citation-builder.ts`: builds auditable citations (source id/name, content
    hash, locator, capped excerpt, retrieved_at, scope, score) and rejects
    fail-closed (`CARD_INVALID`) any evidence not traceable to a ready/active
    source or whose source tenant does not match.
  - `knowledge-source-repository.ts`: tenant-scoped `knowledge_sources` lookup
    powering citation traceability; tenant lookups pin to the caller's tenant,
    platform lookups never leak a tenant source.

### Verification approach

- `tests/knowledge/knowledge-isolation.test.ts` (6) drives the gateway through a
  **deliberately leaky** vector port that ignores the filter and returns every
  seeded point (platform, tenant A, tenant B, and two mislabeled points): a
  tenant-A caller never receives tenant-B or mislabeled evidence in any scope;
  plus the source repository's tenant scoping against in-memory MongoDB.
- `tests/knowledge/citation-builder.test.ts` (4): ready-source citation with a
  capped excerpt; orphaned, non-ready, and tenant-mismatch results all rejected.
- Four gates: full suite **485/485** (was 475; +10), typecheck 0, security scan
  0, production web build pass.

### Remaining (G3.5, tracked)

- Ingestion write-path: `ingestion-service.ts` (MIME/size/hash/malware/parser/
  chunker/embedding verification, quarantine-until-ready, partial-point
  cleanup), `upload-authorization.ts` (short-lived tenant/actor/source/object-key
  scoped grant), `apps/web/app/api/knowledge/uploads/route.ts`, the
  `qdrant-service.ts` public collection/filter parameter removal, and the
  `@qdrant/js-client-rest` pin. These unblock wiring the G3.4
  `knowledge.search` tool port to the gateway.

---

## [2026-07-15] feat: Wire repository-backed governed tool ports (G3.4, partial)

### Summary

- Added `apps/ai/server/services/ai-control/tools/repository-adapters.ts`:
  `create_repository_backed_tool_ports({ tenant_context, formula_repository })`
  builds the governed tool ports for one run over a resolved, frozen
  `TenantExecutionContext`. The `formula.search`, `formula.comment`, and
  `formula.confirm` ports now delegate to the tenant-scoped `FormulaRepository`
  (no more `NOT_WIRED` for these): search lists only the caller's formulas and
  filters deterministically; comment/confirm surface cross-tenant IDs as
  `FORMULA_NOT_FOUND`; confirm targets `current+1` and reads the version back
  from the confirmed document (replay-safe with the executor idempotency key).
  Every adapter re-asserts the trusted tenant matches the bound run context.
- `formula.draft`, `formula.revise`, `knowledge.search`, and `web.search` remain
  fail-closed `NOT_WIRED` here: they depend on the Qdrant formulation/knowledge
  gateway (G3.5) and the approved external web-search adapter. No legacy handler
  is ever imported or called.

### Verification approach

- `tests/ai-control/tool-repository-adapters.test.ts` (7 cases) against an
  in-memory MongoDB: search returns only the caller's tenant rows; comment and
  confirm succeed in-tenant and reject cross-tenant with `FORMULA_NOT_FOUND`;
  confirm bumps to v01; a trusted-context tenant mismatch fails
  `TOOL_INPUT_INVALID`; the four unwired ports fail `NOT_WIRED`.
- Four gates: full suite **475/475** (was 468; +7), typecheck 0, security scan 0,
  production web build pass.

### Remaining (G3.4, tracked → G3.5)

- Wire `formula.draft`/`formula.revise` (Qdrant formulation pipeline),
  `knowledge.search` (partitioned Qdrant gateway), and `web.search` (external
  adapter) once G3.5 lands the knowledge partition.

---

## [2026-07-15] feat: Reserve and reconcile tenant AI usage (G3.3)

### Summary

- Added `usage-ledger.ts`: append-only ledger entry shapes (reservation/actual/
  release/adjustment, all bigint amounts) and the pure `assert_budget_available`
  decision — per-run token/cost ceilings, tenant + per-user monthly request/
  token/cost ceilings, and the concurrency ceiling — throwing a typed
  `UsageBudgetError` carrying the exceeded `dimension`.
- Added `ai-usage-repository.ts`: Mongo-backed ledger with `with_transaction`,
  `locked_month_totals` (signed sum; active runs = reservations minus releases,
  append-only), `insert_reservation` (bumps a shared per-tenant-month counter so
  concurrent reservations conflict and serialize), and the release/expiry
  helpers. Amounts persist as integer strings (micro-USD), never float/Decimal.
- Added `budget-service.ts`: `reserve_usage` (transactional, idempotent replay
  returns the existing reservation), `reconcile_usage` (appends actual + a
  release cancelling the reservation, exactly once; flags the run
  BUDGET_RECONCILIATION_REQUIRED when the actual exceeds the reservation beyond
  tolerance), `release_usage` (provider-failure path), and
  `expire_stale_reservations` (releases only terminal/absent runs, per-run job
  idempotency key).
- Added `BUDGET_EXCEEDED` / `BUDGET_RECONCILIATION_REQUIRED` governance codes.

### Verification approach

- `tests/ai-control/usage-ledger.test.ts` (13 cases) against an in-memory
  repository whose `with_transaction` serializes (mirroring the Mongo write-
  conflict abort): within-limit grant; every rejection dimension (tenant/user
  request-token-cost, per-run token/cost, max concurrency); three concurrent
  half-budget reservations → exactly two granted; duplicate-key replay returns
  the same reservation with one entry; provider-failure release frees budget;
  reconcile below estimate (no flag, net = actual) and above tolerance (run
  flagged); replayed completion is exactly-once; stale-expiry releases only
  terminal runs and is idempotent.
- Four gates: full suite **468/468** (was 455; +13), typecheck 0, security scan
  0, production web build pass. New files clean under the stricter apps/ai target.

---

## [2026-07-15] feat: Compile an effective tenant AI policy (G3.2)

### Summary

- Reconciled `apps/ai/server/services/ai-control/policy-types.ts` to **re-export**
  the canonical `EffectiveAIPolicy`/`AIApprovalRequirement` from
  `@rnd-ai/shared-types` (G3.1) instead of a structural duplicate — the earlier
  "tracked integration TODO" is resolved; the tool catalogue, executor, and
  context assembler now share the one canonical contract.
- Added `policy-compiler.ts`: `compile_effective_policy(layers)` folds four
  ordered layers (platform → plan → tenant → deployment) monotonically —
  enabled = AND (false wins), provider_models/allowed_tools = intersection,
  numeric maxima = minimum (bigint-safe), approval_rules = strongest-of (a
  tenant can never relax an approval). An empty provider/model intersection on
  an enabled policy is rejected (`POLICY_NO_PROVIDER`); request preferences may
  only narrow to locale/detail/model-alias-in-allowlist, any unknown field is
  `POLICY_INPUT_INVALID`. The canonical JSON is SHA-256 hashed (key-order
  independent, reusing `hashing.ts`) and returned with an explainable
  `constraint_trace` naming the constraining layer per field.
- Added `platform-ai-constraints.ts` (provider/tool universe, approval floors,
  env-tunable ceilings with named defaults — no bare literals) and
  `plan-entitlements.ts` (starter/growth/enterprise entitlement catalogue,
  `build_plan_layer` throws `POLICY_UNKNOWN_PLAN`).
- Added `ai-policy-repository.ts`: loads the active `TenantAIProfile` +
  `AgentDeployment`, folds them through the compiler (fail-closed
  `POLICY_DISABLED` when no active profile), and persists the canonical
  snapshot + version + hash on the `AIRun`.
- Added the `POLICY_INPUT_INVALID`/`POLICY_NO_PROVIDER`/`POLICY_UNKNOWN_PLAN`
  governance error codes. All new BigInt values use `BigInt(...)` (not `123n`
  literals) to stay valid under the sub-ES2020 `apps/ai` target.

### Verification approach

- RED first, then GREEN: `tests/ai-control/policy-compiler.test.ts` (18 cases)
  covers each restriction direction, fail-closed disablement, empty-intersection
  rejection, request-preference validation, key-order-independent hashing, the
  constraint trace, the plan builders, and the repository against an in-memory
  MongoDB (compile-from-stored-state + snapshot pinning + fail-closed).
- Four gates: full suite **455/455** (was 437; +18), typecheck 0 (apps/web +
  orchestration), security scan 0, production web build exit 0. New files also
  typecheck clean under the stricter `apps/ai` project.

---

## [2026-07-15] feat: Enforce tenant ownership + repository-bypass scanner (G2.7, G2 complete)

### Summary

- Made `tenantId` **required** on the 14 tenant-owned business Prisma models
  (Product, StockEntry, Formula, FormulaVersionLog, FormulaComment, Order,
  CreditTransaction, ProductLog, Conversation, Feedback, AiResponse, ChatThread,
  ChatMessage, PriceCalculation). `UserLog` stays optional (it has a
  platform/tenant `scope` discriminator); `PromptVersion`/`KnowledgeSource` stay
  optional (platform-scoped rows have no tenant); `RawMaterial` stays
  platform-global. `organizationId` is retained for rollback comparison only,
  never as an authorization source. No code reads these models via Prisma (raw
  Mongo driver), so the change is type-only — `prisma generate` clean.
- Extended the AST boundary scanner with a `TENANT_REPOSITORY_BYPASS` rule:
  direct access to a tenant-owned collection (`db.collection('formulas'|...)`)
  or a tenant Prisma control-plane model (`prisma.aIRun|...`) is a CI failure
  unless the file is in an allowed path — the repository layer
  (`apps/ai/server/repositories/**`), migration scripts (`apps/ai/scripts/**`),
  or the documented legacy ReAct tools (`apps/ai/agents/react/tool-handlers/**`,
  tenant-scoped in G2.6, retired in G5). The rule matches aliased db handles and
  chained collection calls. products/orders are intentionally out of the
  enforced set (the sanctioned public `submitClientOrder` ingress has no tenant
  context by design).
- Fixed a real bypass: `apps/web/app/api/index-data/route.ts` read the `formulas`
  collection unscoped (a cross-tenant read in the legacy Pinecone indexer).
  Formula indexing now runs only through the tenant-scoped
  `apps/ai/scripts/index-qdrant.ts` path.
- Recorded `docs/commercial/evidence/g2-release.md` (task map, enforcement
  detail, isolation tests, code gates, and the PENDING_EXTERNAL_STAGING data
  gates to record during cutover). G2 is now complete (G2.1–G2.7).

### Verification approach

- RED first: `tests/security/tenant-repository-boundary.test.ts` (8 cases,
  including the failing-test anchor + a full production-tree scan) — the anchor
  failed before the rule existed, green after.
- Four gates: full suite **437/437** (was 429; +8), typecheck 0, security scan 0
  (with the new rule active), production web build exit 0, `prisma generate`
  clean.

---

## [2026-07-15] fix: Tenant-scope all legacy AI tools + lock down mongo_query (G2.6 complete)

### Summary

- Completed G2.6: every legacy ReAct tool that touches a tenant collection now
  injects the tenant predicate from the trusted execution context, never from a
  model-supplied argument. A model can name a record ID; deterministic code
  decides which tenant the lookup runs against.
- Extended `apps/ai/agents/react/tenant-tool-scope.ts` with two reused helpers
  (`tenant_match_clause`, `tenant_scoped_query_filter`) and refactored
  `tenant_scoped_id_filter` onto the shared clause (DRY). The provenance field
  (`tenantId`, added by G2.2) is defined once as `TENANT_PROVENANCE_FIELD`.
- Converted four handlers: `get-formula-with-comments` and `revise-formula` now
  pin the formula load (and parent-formula load) to the caller's tenant —
  cross-tenant/missing IDs return the generic "Formula not found" shape with no
  existence oracle; `search-reference-formulas` ANDs a mandatory tenant clause
  into every query and **fails closed (empty result) when no tenant scope is
  present** — an unscoped multi-document search would have leaked every tenant's
  formulas; `generate-formula` stamps `tenantId` on the persisted formula and
  its version log so later tenant-scoped reads can find AI-generated formulas.
- Rewrote `mongo-query-handler` from a free-form (model supplies collection +
  filter + aggregation pipeline — a direct cross-tenant exfiltration vector)
  into a locked-down named-diagnostic surface: the model may only pick an
  allowlisted diagnostic by name (`tenant_formula_count`,
  `tenant_formula_status_breakdown`, `tenant_recent_formulas`,
  `raw_material_count`) plus allowlist-validated scalar params (status, limit).
  Server-authored templates own the collection/filter/stages; tenant diagnostics
  fail closed without a verified tenant. Updated the tool declaration and the
  ReAct system prompt so the model no longer attempts collection/filter usage.
- Threaded the trusted tenant end-to-end: `ReactAgentRequest.tenant_id` →
  `ToolHandlerContext.tenant_id`; the tool-handler dispatch map now passes `ctx`
  to every tenant-scoped tool; the `raw-materials-agent` route sources
  `tenant_id` from `principal.active_tenant_id` (never the body).

### Verification approach

- RED first: `tests/integration/tenant-ai-tool-isolation.test.ts` extended with a
  MongoMemoryServer-backed two-tenant fixture; 9 cross-tenant assertions failed
  against the pre-conversion handlers (the concrete exploit paths). GREEN after
  conversion: 17/17 in that file.
- Four gates: full suite **429/429** (was 416; +13), typecheck 0, security scan 0
  private-boundary violations, production web build exit 0.

### Remaining (tracked)

- G2.7 (now unblocked): extend the boundary scanner so tenant collections may
  only be accessed inside `apps/ai/server/repositories/**`; the remaining
  `TODO(G2.6)` raw accesses in the routers are the last whitelist to remove.

---

## [2026-07-15] feat: Routers on tenant repositories + AI control-plane models (G2.5, G3.1)

### Summary

- G2.5 (delegated agent, independently verified): tenant-scoped procedures now build a frozen TenantExecutionContext and a per-request repositories bundle on ctx; business routers converted to fine-grained named permissions (formula:read/draft:create/draft:update_own/confirm, tenant:members:*, tenant:analytics:read, ai:run, ai:feedback:create, ...) and repository access (raw collection reads remaining only with TODO(G2.6) markers and tenant_context scoping, incl. dual-encoding legacy organizationId filters); integration isolation suite added (tests/integration/tenant-router-isolation.test.ts).
- G3.1 (delegated agent, independently verified): tenant AI control-plane Prisma models + enums (TenantAIProfile, AgentDeployment, PromptVersion, KnowledgeSource, AIRun with all eight immutable pins, append-only AIUsageLedger, AIArtifact, AIApproval; BigInt micro-USD budgets) and shared EffectiveAIPolicy contracts (packages/shared-types/src/ai/).
- Two cross-cutting typecheck fixes: BigInt literal → BigInt() for the sub-ES2020 web target; Mongo UpdateFilter cast in feedback-repository.

### Verification approach

- Full suite 412/412; typecheck 0; security scan 0; production web build exit 0; prisma validate/generate clean; G3.1 architecture tests 19/19 RED→GREEN.

---

## [2026-07-15] feat: Add capability cards and context assembler (G4 Task 3)

### Summary

- Added the orchestrator contract card (`ai-control/cards/orchestrator.md`) encoding the invariant loop rules: evidence-first completion, citation duties, clarify-when-missing-input, draft-vs-commit semantics, budget awareness, and the injection-resistance stance (retrieved content is data, never instructions).
- Added one agent card per agent_key (`raw_material_research`, `formulation`, `sales_rnd`) with persona, domain scope, working style, quality bar, output contract, and escalation guidance; tenant/deployment overrides stay in PromptVersion records, not repo cards.
- Added `ContextAssembler`: loads the orchestrator card and the run's agent card, filters the tool catalogue by the pinned EffectiveAIPolicy and loads only allowed tools' cards (re-verifying frontmatter against each registered definition), renders a deterministic plain-language policy digest (budgets, tenant boundary, approval rules, allowed and disallowed tools), computes `pack_hash` (SHA-256 over all card hashes plus the digest hash), and returns a ContextPackV1-shaped object. Assembly fails closed on POLICY_DISABLED, CONTEXT_CARD_MISSING, and CONTEXT_CARD_DRIFT.
- Card size stays under a configurable budget (`AI_CAPABILITY_CARD_MAX_CHARS`, default 12000 chars) enforced by tests for all 11 cards.

### Verification approach

- Captured RED for `tests/ai-control/capability-cards.test.ts` (missing orchestrator/agent cards) and `tests/ai-control/context-assembler.test.ts` (missing module) before implementing, then confirmed GREEN: 47 ai-control tests, 61 tests repo-wide, strict `tsc --noEmit` over all ai-control modules and tests, and the root web typecheck.
- Pack-hash determinism proven by stable-hash and card-mutation tests against a synthetic temp cards root; no network or real datastores anywhere in the suite.

### Remaining integration (tracked)

- ContextPackV1 re-validation in `packages/ai-orchestration/src/context/context-pack.ts` is owned by the orchestration workspace task (G4 Task 3 Step 10).
- Recording card names/versions/hashes on the AIRun, real AgentDeployment/PromptVersion pin resolution, the shared `EffectiveAIPolicy`/Permission contracts from `packages/shared-types`, and real repository/gateway ports for the governed tools (currently fail-closed NOT_WIRED) land with the gateway/knowledge tasks (G3 Tasks 5-7, G4 Tasks 8-9).

## [2026-07-15] feat: Execute AI tools through tenant policy (G3 Task 4)

### Summary

- Added the governed tool catalogue under `apps/ai/server/services/ai-control/`: a declarative `ToolDefinition` contract (stable name/version, strict Zod input/output schemas, named permission, side-effect class read|draft_write|commit, approval requirement, timeout/retry policy, required `capability_card_path`, and `execute(args, trusted_context)`).
- Added `ToolCatalogue` with policy-allowlist filtering; registration fails when the input schema is not strict, declares identity/scope/datastore fields, or when the capability card is missing or its frontmatter drifts from the definition (agentic design §4.2/§4.3 pulled forward because card enforcement is part of registration).
- Added `ToolExecutor` — the only path from a model-proposed tool call to a side effect: policy allowlist and enabled check, permission check, recursive forbidden-key scan (tenant/org/user/actor/permission/provider-key/collection/Mongo-operator fields rejected with TOOL_INPUT_INVALID), strict input validation, strongest-of(definition, policy) approval evaluation against a durable manager-approval port, deterministic call idempotency key (SHA-256 of run/step/tool@version/canonical arguments), duplicate side-effect suppression, trusted-context injection, per-attempt timeout with bounded read-only retry (writes never retry), output validation, usage metering via an injected UsageService port, and an append-only audit event for every attempt.
- Registered seven governed tools replacing both legacy tool systems (ReAct declarations and the Zod registry): `formula.search`, `formula.draft`, `formula.revise`, `formula.comment`, `formula.confirm` (commit-class, manager approval), `knowledge.search`, `web.search`. Tools delegate to narrow injected ports; production ports fail closed with `NOT_WIRED` until gateway/repository integration lands — no legacy handler is imported or called.
- Added a hand-rolled strict frontmatter card loader (gray-matter deliberately not added to keep the dependency graph frozen), SHA-256 card pinning with an in-process content-hash cache, and seven operator-grade tool capability cards grounded in the audited legacy semantics (Thai domain vocabulary preserved).

### Verification approach

- Captured the RED run of `tests/ai-control/tool-executor.test.ts` (module-not-found failures for all governed modules) before implementation, then confirmed 24/24 tests pass, plus the existing architecture/regression/security suites (38 tests total) and a strict `tsc --noEmit` over every new module.
- Deterministic tests only: usage, audit, approval, idempotency, and every tool port are in-process fakes; no network, Qdrant, Mongo, or Gemini access.

## [2026-07-15] feat: Implement deterministic governor for agentic loop (G4 Task 5)

### Summary

- Implemented the gate node: per-action re-check via the injected policy engine (emergency disable, pinned policy/deployment status, tool allowlist, permission, budget reservation, approval class); non-fatal denials return to the agent as typed, safe policy_denied observations (trusted_system, reason-coded) so the model re-plans within the run; fatal denials (POLICY_EMERGENCY_DISABLED, POLICY_DEPLOYMENT_REVOKED) end the run; approval-class actions route to request_approval. The gate never executes a tool.
- Implemented normalized-action loop detection (tool name + canonical arguments hash) counting both denied and executed proposals in the decision log; at the configured threshold the run fails with LOOP_DETECTED — the gate routes directly to fail so a stuck model cannot burn another reasoning turn.
- Implemented the act node: exactly one ToolExecutor invocation per deterministic idempotency key (run:iteration:tool:arguments-hash), retries only executor-reported retryable failures within the definition's retry budget, validates output against the tool's output schema (violations become TOOL_OUTPUT_INVALID observations, not run failures), trust-labels results from the tool definition, and runs deterministic evaluators on every result: evidence bookkeeping, contradiction flags for identical arguments with diverging content, and freshness. Blocking artifact validation returns to the agent as a validation_finding observation; warnings surface on the run.
- Implemented the fail node: safe partial output (evidence references, action rationales, usage — never hidden reasoning), usage reconciliation, run.failed persistence and event. No path anywhere falls back to a legacy executor.
- Wired routing.ts + graph.ts to the final topology and replaced the reasoning/governor stubs; finalize is an interim deterministic minimal implementation (schema-validated output, completion persistence) until Task 8 adds artifact validators; interrupt nodes remain typed stubs until Task 7.

### Verification approach

- RED first (modules missing), then GREEN: 28 governor + graph-shape tests, including gate denial observations, loop-detection trips (denials and allowed repeats), idempotency-key stability, retry budgets, output-schema violations, blocking artifact findings, contradiction flagging, fail-node partial output, and four full end-to-end loop runs on the compiled graph (complete, deny-and-replan, LOOP_DETECTED, LIMIT_MAX_ITERATIONS). Full repository suite 97/97 with orchestration typecheck clean.

---

## [2026-07-15] feat: Implement agentic reasoning node and ingress (G4 Task 4)

### Summary

- Implemented the deterministic ingress node: re-validates AgentRunInputV1, fail-closed context-pack validation, orchestrator-version and context-pack-hash pin verification, trusted observation seeding (user message + optional thread summary through injected ports), and typed run.accepted / stage.changed / observation.added events. Ingress never loads authorization from input; on verification failure it sets a typed error that the agent node routes to fail before any model call.
- Implemented the agent reasoning node — the only model-facing node: deterministic LIMIT_MAX_ITERATIONS / LIMIT_DEADLINE / LIMIT_TOKENS / LIMIT_COST budget checks BEFORE the model call (decimal-safe cost comparison), exactly one native tool-calling turn per iteration, a single bounded retry with a system-authored correction for malformed/unknown/no-tool turns, then MODEL_OUTPUT_INVALID — never a fallback executor.
- DecisionRecordV1 is derived from the model's native tool call (kind tool/clarify/finalize, arguments hash, ≤600-char safe rationale); pending_action routes to gate / request_clarification / finalize via Command.
- Implemented message-builder: system prompt rendered only from the hash-pinned context pack; observations rendered as provenance-labeled data blocks (type, source, IDs, content hash, trust, retrieved_at, scope); untrusted content is fenced, labeled, and framed as data never instructions — it is never concatenated into the system section.

### Verification approach

- RED first (module missing), then GREEN: 19 tests covering fresh-request tool proposal, conversation reuse, bounded clarification, finalize routing, unknown-tool retry-then-fail, malformed-turn recovery, prompt-injection containment (injected directives stay fenced; an injected tool name never becomes a pending action), and all four LIMIT_* pre-model failures with zero model calls. Full orchestration suite 59/59 with package typecheck clean.

---

## [2026-07-15] feat: Define agentic loop contracts and state (G4 Task 2)

### Summary

- Added versioned public AI contracts in packages/shared-types/src/ai/contracts.ts: strict AgentRunInputV1 (no tenant/user/role/policy/model/tool/provider fields), the 12-type AgentRunEventV1 discriminated union (stage.changed is derived UI bookkeeping, not graph phase state), AgentRunOutputV1 with named quality dimensions (strict — a lone scalar confidence cannot be attached), DecisionRecordV1 as a derived audit record of the model's native tool call (max 600-char safe rationale), and RunErrorV1 with stable codes (LIMIT_*, LOOP_DETECTED, MODEL_OUTPUT_INVALID, POLICY_*, CONTEXT_PACK_INVALID...).
- Added loop-internal contracts (ProposedActionV1 tool/clarification/finalize union, ActionResultV1, RunBudgetV1, RunPinsV1, LoopUsageV1) and the trust-labeled ObservationV1 schema.
- Added ContextPackV1 with fail-closed validation in packages/ai-orchestration/src/context/context-pack.ts: structural schema, per-card SHA-256 integrity, and a binding pack hash (covers the orchestration-package half of plan Task 3 Step 10).
- Added AgentLoopState (Annotation.Root) with reducer channels for observations/action_results/decision_log/events/warnings and replace channels for pending_action/output/error; deliberately no phase channel.
- Added the StateGraph shell with exactly ingress, agent, gate, act, request_clarification, request_approval, finalize, fail and only the governed edges; gate additionally routes to fail so LOOP_DETECTED terminates without another model hop.

### Verification approach

- RED first (2 files failed: modules missing), then GREEN: 37 tests across contracts and graph shape, including a static scan asserting agent is the only model-facing node, plus a clean package typecheck.

---

## [2026-07-15] feat: Scaffold isolated agentic orchestration package (G4 Task 1)

### Summary

- Created the private `@rnd-ai/ai-orchestration` workspace (type=commonjs, src entrypoint) with exactly the pinned governed-loop dependencies: @langchain/langgraph 1.4.7, @langchain/core 1.2.2, @langchain/langgraph-checkpoint-mongodb 1.4.0, mongodb 6.21.0, zod 3.25.76, decimal.js 10.6.0, @rnd-ai/shared-types 1.0.0. The apps/ai legacy graph keeps its own 0.2.x LangGraph via nested workspace resolution, so the two never share an instance.
- Defined the injected port contracts (ModelGateway with one native tool-calling turn per call, KnowledgeGateway, ToolExecutor, ArtifactService, RunRepository, ApprovalService, UsageService, PolicyEngine, Clock, IdGenerator, LoopLogger) — every method receives TrustedRuntimeContext outside model input.
- Exported ORCHESTRATOR_VERSION="agentic-1.0.0" with a supported-version assertion that rejects resuming a run pinned to an unknown orchestrator version instead of falling back to any legacy executor.
- Added a boundary test that walks the workspace's import specifiers (static, dynamic, export-from, require) and rejects apps/ai/agents, apps/ai/services, apps/web, @langchain/langgraph/prebuilt, and provider SDKs; a missing workspace is itself a violation so the contract cannot silently pass.
- Added root scripts typecheck:orchestration and chained it into root typecheck.

### Verification approach

- Captured the RED run (3 failed: workspace missing) before creating the package, then GREEN (3 passed) plus a clean `tsc --noEmit` for the package after implementation.

---

## [2026-07-15] feat: Tenant-scoped domain repositories (G2.4)

### Summary

- Added the tenant repository layer — the only allowed data-access surface for tenant collections from G2.7 on: `tenant-repository-base.ts` (`tenant_scope(context)` accepting only a TenantExecutionContext; typed `ResourceNotFoundError` with identical shape for cross-tenant, missing, and malformed IDs; `PermissionDeniedError`; security-field rejection before any DB access) plus product/stock/order/formula/calculation/conversation/feedback/audit-log repositories.
- Every read/write filter is `{_id, tenantId}`; nested resources (formula comments/version logs, chat messages) also require the tenant-scoped parent; creates overwrite tenant/actor/owner fields from context and reject inputs carrying security fields; owner rules (own-draft/own-thread updates) and manager gates (`formula:confirm`, review queue) live in the repositories; formula confirm uses an idempotency key with a compensating writeState (documented: standalone Mongo has no transactions) so partial writes are visible and repairable.
- Documented deviation: tenantId is filtered as a string (matching the G2.3 backfill and G1.2 projections), not the plan anchor's ObjectId.

### Verification approach

- TDD RED (module missing) → GREEN 46/46 table-driven tests against mongodb-memory-server (tenant A/B sharing secondary keys; identical not-found shapes; nested scoping; owner/manager rules; security-field rejection; audit scoping); suite 245/245; verify:commercial exit 0. Implemented by a delegated subagent; independently re-verified.

---

## [2026-07-15] feat: Verified tenant ownership backfill (G2.3)

### Summary

- Added `tenant-ownership-mapper.ts`: pure deterministic `resolve_tenant_ownership` (direct organizationId mapping → parent tenant → uniquely mapped legacy actor; disagreement/absence → quarantine with candidates and reason — never a silent assignment), plus the audit engine covering all 14 backfill collections with parent-cache resolution (formulas→version logs/comments, chat_threads→messages).
- `tenant:audit` (dry run) emits JSON totals (already_scoped/resolvable/ambiguous/orphaned/malformed/conflicts), by_collection, by_tenant, SHA-256 bucket hashes, and an overall audit_hash. `tenant:backfill` requires `--apply --audit-hash=<hash>`, refuses when data changed after the reviewed audit, applies conditional `{_id, tenantId: null}` updates (replay cannot overwrite concurrent assignments), quarantines the rest into `tenant_ownership_quarantine`, and writes `migration_receipts` per collection. `tenant:verify` repeats the audit and exits non-zero while anything remains unscoped — blocking G2.4 enforcement on dirty data.
- Runbook `docs/commercial/runbooks/tenant-backfill.md`: backup, dry-run, review, apply, verify, quarantine repair, `TENANT_ENFORCEMENT=shadow` rollback, and evidence commands.

### Verification approach

- TDD RED → GREEN 8/8 mapper fixtures (direct/parent/user-unique/agreeing matches, conflicting evidence, no-owner, malformed ObjectId as absent evidence, deterministic replay); suite 199/199; verify:commercial exit 0.

---

## [2026-07-15] feat: Tenant provenance on every private schema (G2.2)

### Summary

- Expanded 15 Prisma models (Product, StockEntry, Formula, FormulaVersionLog, FormulaComment, Order, CreditTransaction, ProductLog, Conversation, Feedback, AiResponse, ChatThread, ChatMessage, PriceCalculation, UserLog) with nullable `tenantId String? @db.ObjectId`; `organizationId` stays for dual-read comparison and tenantId becomes required only after the G2.3/G2.4 backfill verifies.
- Added `actorProfileId` wherever free-form createdBy/userId/performedBy attribution exists and `ownerProfileId` to Conversation, ChatThread, Formula, Feedback, and AiResponse (owner-level rules); UserLog gains an explicit platform/tenant `scope`.
- Added compound tenant indexes per lookup key ([tenantId,formulaId], [tenantId,threadId], [tenantId,ownerProfileId], [tenantId,status], [tenantId,createdAt], [tenantId,materialId], [tenantId,productId], [tenantId,isActive]).
- RawMaterial stays platform-global (pinned by test); legacy Account/Session/User/Organization documented as frozen. Full per-collection scope/source/conflict/owner/enforcement table in docs/commercial/data/tenant-ownership-map.md — every row resolved.

### Verification approach

- TDD RED (29 schema assertions failing) → GREEN 30/30 after expansion; prisma format+validate+generate clean; suite 191/191; verify:commercial exit 0.

---

## [2026-07-15] feat: Tenant execution and ownership contracts (G2.1)

### Summary

- Added `packages/shared-types/src/tenant.ts`: frozen `TenantExecutionContext` (tenant_id, actor, clerk identifiers, membership, role, permissions, access_mode member|support, support_grant_id, correlation_id, request_started_at) — the scope every repository will require from G2.4 on — plus `SupportAccessGrantView`, the diagnostic-permission allowlist, and the 72h grant ceiling.
- Added `build_tenant_execution_context(principal, support_grant, extras)`: member mode requires an active membership; support mode requires a non-expired, non-revoked grant approved by a different profile and restricts permissions to the grant's diagnostic set; requested/body tenant mismatches raise `TENANT_MISMATCH`; the returned context is `Object.freeze`d so tenant_id cannot be swapped mid-request.
- Added the `SupportAccessGrant` Prisma model (unique correlationId; [tenantId,expiresAt] and [platformProfileId,expiresAt] indexes), the support-access repository (request/approve/revoke/find_active_for), request validation (diagnostic allowlist, duration ceiling), and the `platformSupportAccess` router: request via platformAdminProcedure; approve/revoke via superAdminProcedure with self-approval rejected; request/approval/revocation audited.

### Verification approach

- TDD RED first, then 7/7 context tests (member, suspended, platform-admin-without-grant, expired grant, self-approved/revoked grant, support-mode permission restriction, tenant mismatch, frozen mutation rejection); suite 161/161; `npm run verify:commercial` exit 0; `prisma generate` clean.

---

## [2026-07-15] feat: Authentication cut over to Clerk (G1.7 — G1 complete)

### Summary

- Custom client authentication is retired: deleted `apps/web/lib/auth-context.tsx`, `/login`, and `/signup`; `authRouter` now exposes only a public health probe (login/logout/me/signup procedures removed, including bcrypt verification and custom session creation). Onboarding is invitation-only through Clerk.
- New purpose-built `apps/web/lib/app-auth.tsx` adapts Clerk session state (useUser/orgRole/signOut) plus the tenant-scoped organizations query into the narrow `{user, organization, isLoading, logout}` view the UI consumes; 17 consumer files swept to it. No tokens in localStorage or JavaScript-readable cookies — Clerk manages its own httpOnly session. Deployments without a publishable key render the signed-out state.
- Route contract updated: public paths are `/sign-in`, `/sign-up`, `/onboarding`; anonymous protected traffic redirects to `/sign-in` (regression tests updated to the post-cutover contract). The legacy resolver remains only as the `CLERK_CUTOVER=false` rollback adapter for existing cookie sessions.
- E2E scaffold: `@playwright/test@1.61.1` pinned, `test:e2e` script + `playwright.config.ts` (webServer `dev:web`), and `tests/e2e/clerk-auth.spec.ts` with 7 staged cases that self-skip without `E2E_CLERK_CONFIGURED=true` (staging execution recorded in G1 evidence).
- Recorded `docs/commercial/evidence/g1-release.md` with the gate map, code-side command evidence, and the PENDING_EXTERNAL_STAGING checklist (dashboard snapshot, staged migration+reconciliation, webhook health, staged e2e, rollback rehearsal).

### Verification approach

- Full suite 154/154 after the sweep (regression tests pin the new /sign-in contract); `npm run verify:commercial` exit 0; playwright lists 7 tests; the security scanner confirms no localStorage tokens, no custom password/session code paths, no public org creation.

---

## [2026-07-15] feat: Legacy bcrypt identities imported into Clerk (G1.6)

### Summary

- Added `legacy-import.ts` service + `migrate:clerk` CLI: imports active legacy accounts as Clerk users with `passwordDigest`/`passwordHasher="bcrypt"` and `externalId` = the legacy Account ObjectId, then links `clerkUserId`+`legacyAccountId` on the UserProfile — valid users keep their passwords (Clerk verifies the bcrypt digest and upgrades transparently on first sign-in).
- Replay safety at every step: already-linked profiles count as `replayed`; a partially created Clerk user (found by externalId) is linked without a second `createUser`; duplicate emails are reported as `failed/duplicate_email`; invalid digests, missing user profiles, and inactive accounts are skipped with stable reasons.
- Dry-run is the default; writes require BOTH `--apply` and `--report=<path>`. Reports and results carry counts and stable record IDs only — a test pins that no password digest ever appears in any result.
- No university is created from a legacy organization: `legacy_org_resolution` reports `matched_tenant_id` (via `Tenant.legacyOrganizationId`) or `unresolved_reason: no_tenant_mapping` for explicit platform-admin approval.
- Added `docs/commercial/runbooks/clerk-migration.md`: snapshot, dry run, apply, sampled sign-in verification, reconciliation, cutover (`CLERK_CUTOVER=true`), and rollback commands.

### Verification approach

- TDD RED first, then 9/9 tests: bcrypt import + replay (single createUser, hasher pinned), partial-creation linking, duplicate email, invalid digest, missing user, digest-free results, org resolution matched/unresolved, dry-run-versus-apply write behavior.
- Full suite 154/154; `npm run verify:commercial` exit 0.

---

## [2026-07-15] feat: Clerk membership lifecycle synchronization (G1.5)

### Summary

- Added the signed Clerk webhook ingress (`apps/web/app/api/webhooks/clerk/route.ts` → `handle_clerk_webhook`): svix v1 signature verified (timing-safe, 5-minute tolerance) before any parsing; processed event IDs stored in `clerk_webhook_receipts` (unique index added to `setup:commercial-indexes`) so duplicates acknowledge 200 without reapplying; projection writes use monotonic `clerkSyncedAt` guards so an older event never overwrites newer state; deletions mark records `revoked`/`deleted`, never hard-delete identity.
- Multiple-membership containment: when a webhook reveals a second active membership for a profile, authorization is suspended, both projections are preserved for repair, and a `membership_reconciliation_required` audit event is recorded — the system never silently picks a side.
- Added `invite_tenant_user`/`suspend_tenant_user` services and the `tenantMembers` router (`list`/`inviteUser`/`suspendUser` behind the fine-grained tenant permissions): managers invite students only (the Clerk role is always the user role — this path cannot mint a manager; appointment stays platform-side), and the single-membership rule rejects any email with an active or pending university elsewhere (`MULTIPLE_MEMBERSHIPS_DISABLED`), while same-tenant re-invites stay idempotent.
- Added `reconcile:clerk --tenant=<id>`: compares Clerk memberships against internal projections, emits a JSON report, repairs safe missing projections, and marks contradictory roles for manual repair.
- Added the manager members page (`/settings/members`): list, invite student, suspend — no role-promotion UI (and the server rejects it regardless).
- Scanner: `/api/webhooks/` routes are exempt from the principal-guard rule because webhook ingress authenticates by signature verification (fixture-tested).
- Deviation: webhook signature verification is implemented against the documented svix v1 scheme with node:crypto (timing-safe) rather than `@clerk/backend/webhooks`' `verifyWebhook`, so tests exercise real signatures deterministically; the scheme and secret format are identical.

### Verification approach

- TDD RED first, then 14 new tests green: invalid signature (400, nothing touched), duplicate event applied once, out-of-order event ignored, soft-delete, membership revocation, multi-membership suspension with preserved projections, invitation acceptance; manager-invites-user-only, student caller rejected, cross-university active/pending memberships rejected, same-tenant idempotent re-invite, manager suspension, student suspension rejected.
- Full suite 145/145; `npm run verify:commercial` exit 0.

---

## [2026-07-15] feat: Platform-controlled university provisioning (G1.4)

### Summary

- Added `apps/ai/server/services/provisioning/`: `provision_university(actor, input, ports)` runs an idempotent state machine — Tenant(provisioning) keyed by a client-generated UUID idempotency key → ensure Clerk organization (create-or-get with private metadata `internal_tenant_id`; never a second organization) → persist `clerkOrganizationId` → ensure the initial manager invitation (create-or-get by normalized email, role from the configured `CLERK_ORG_ROLE_MODE` mapper) → persist `TenantInvitationProjection` → activate + platform audit event. Membership projections are created only when Clerk reports an accepted membership (G1.5).
- When a retry cannot prove external Clerk state, the tenant parks in `repair_required` with a correlation ID (`ClerkStateUnprovableError` path) — provisioning never risks a duplicate organization.
- Input contract: normalized lower-case slug, allowlisted data-residency region, stored plan key, manager email, UUID idempotency key (strict zod schema).
- New `platformTenants` router: `list` and `create` behind `platformAdminProcedure`; `grantPlatformRole` behind `superAdminProcedure` only (audited, database-authoritative). Production ports adapt `@clerk/backend` at one explicit boundary (`ClerkBackendLike`).
- Platform console (`apps/web/app/platform/`): server-side role-checked layout, tenant metadata table, and the exact create form (idempotency key generated once per form instance). No tenant business data, no impersonation shortcut.

### Verification approach

- TDD RED first, then 10/10 provisioning tests: success, non-platform caller rejected before any side effect, duplicate slug, replay after failure injection at each of the four external steps without duplicate Clerk objects, unprovable-state repair_required with correlation ID, and input normalization/allowlist enforcement.
- Full suite 131/131; `npm run verify:commercial` exit 0 (a real ClerkClient/structural-type mismatch was caught by typecheck and resolved with the explicit boundary adapter).

---

## [2026-07-15] feat: Server authorization from Clerk sessions (G1.3)

### Summary

- Added `apps/ai/server/auth/clerk-principal-resolver.ts`: `resolve_clerk_principal(auth_state, repositories)` turns verified `await auth()` values (userId, orgId, orgRole, sessionId) into a database-authoritative `RequestPrincipal`. Platform roles read from the `UserProfile` record, never session claims; a platform admin gets `active_tenant_id=null`/`tenant_role=null` and a tenant request never fabricates membership from a platform role. One mapping function handles Clerk roles (`org:manager`/`org:admin` → manager; `org:user`/`org:member` → user); any Clerk/internal role mismatch is rejected and appends a `role_reconciliation` record to `platform_audit_events`.
- Expanded `Permission` to the complete platform + university catalogue from design §6.2 (colon-separated literals mapping 1:1 to dotted policy names) with per-role permission sets; the G0 coarse names remain as documented transitional aliases until the G2.5 router conversion.
- Procedure stack extended in `apps/ai/server/trpc.ts`: `tenantMemberProcedure`, `tenantPermissionProcedure(permission)`, `platformAdminProcedure`, `superAdminProcedure` (typed TRPCError codes), alongside the existing `authenticatedProcedure`/`tenantProcedure`/`managerProcedure`.
- Cutover discipline: both the tRPC context and the direct-route guard now select exactly one resolver per request — `CLERK_CUTOVER=true` may only call the Clerk resolver, false may only call the G0 legacy resolver — and record `resolver_used` on the request context/audit log. New `apps/ai/server/auth/identity-repositories.ts` assembles the projection-repository ports.
- Added `require_platform_admin`/`require_super_admin` assertions to `apps/ai/server/auth/authorize.ts`.

### Verification approach

- TDD RED first (resolver missing), then 11/11 resolver tests: role mapping (custom + compatibility), missing user, inactive profile, platform-only principal, no-fabricated-membership, unknown organization, suspended tenant, revoked membership, role-mismatch reconciliation audit, manager and user permission sets.
- Full suite 121/121; `npm run verify:commercial` exit 0.

---

## [2026-07-15] feat: Internal identity, tenant, and membership projections (G1.2)

### Summary

- Added Prisma models `UserProfile`, `Tenant`, `TenantMembershipProjection`, and `TenantInvitationProjection` with lifecycle enums (`UserProfileStatus`, `PlatformRole`, `TenantType`, `TenantStatus`, `TenantRole`, `MembershipStatus`) — internal projections with stable ObjectIds; Clerk remains the identity source.
- Added `apps/ai/scripts/setup-commercial-indexes.ts` (`setup:commercial-indexes`): idempotent partial unique indexes for nullable external identifiers (`UserProfile.legacyAccountId`, `Tenant.clerkOrganizationId`, `Tenant.legacyOrganizationId`, `TenantMembershipProjection.clerkMembershipId`) using `partialFilterExpression` on the string BSON type — never Prisma `@unique`, because provisioning-phase records hold null — plus the non-null unique indexes (clerkUserId, slug, provisioningKey, tenant+profile membership, clerkInvitationId).
- Added repositories with explicit active-record lookups only (`find_active_*`; no generic findOne filter reaches routers): `user-profile-repository`, `tenant-repository`, `membership-repository` under `apps/ai/server/repositories/`.
- Added `apps/ai/scripts/bootstrap-super-admin.ts` (`bootstrap:super-admin`): single-use — requires `--clerk-user-id` and `--email`, succeeds only while no active platform role exists, writes one `super_admin` UserProfile plus one `platform_audit_events` record, and exits non-zero on any later invocation.
- Test infrastructure: `mongodb-memory-server` (root devDependency) provides a real mongod for index-semantics tests; also reusable for the G4.7 checkpoint integration tests.

### Verification approach

- TDD RED first (models/repositories/scripts missing), then 9/9 tests against a real in-memory MongoDB: duplicate-present/allow-null partial index semantics for every external ID, idempotent re-setup, tenant/profile membership uniqueness, active-only lookups rejecting suspended records, Clerk-org tenant lookup, and single-use bootstrap with audit trail.
- `npx prisma generate` clean; `npm run verify:commercial` exit 0 (typecheck + 110 tests + security scan + web build).

---

## [2026-07-15] feat: Clerk authentication surface (G1.1)

### Summary

- Pinned `@clerk/nextjs@7.5.18` (apps/web) and `@clerk/backend@3.11.5` (apps/ai). Route code will use `@clerk/nextjs/server`; framework-neutral provisioning code (G1.4+) uses `@clerk/backend`.
- `apps/web/proxy.ts` now runs `clerkMiddleware` with `createRouteMatcher`, `frontendApiProxy` enabled, and `await auth.protect()` for application, API, and tRPC paths — gated by two runtime switches in `apps/web/lib/server/clerk-config.ts`: the Clerk surface activates only when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is configured, and enforcement applies only when `CLERK_CUTOVER=true`. Before cutover the legacy cookie flow keeps guarding pages (documented G1 rollback lever); `/sign-in`, `/sign-up`, `/onboarding`, `/api/webhooks/clerk`, `/api/health` are public, and legacy `/login`/`/signup` stay public until G1.7.
- `ClerkProvider` renders inside the body element (conditional on configuration, so builds succeed without Clerk credentials). Clerk `SignIn`/`SignUp` catch-all pages added; sign-up is invitation-only and no `OrganizationSwitcher`/`CreateOrganization` is rendered anywhere (pinned by test).
- `/onboarding` shows three explicit states from the server-side Clerk principal only (invitation pending, membership synchronization pending, contact support) and never queries tenant business data.
- `.env.example` documents the Clerk names without secrets, including `CLERK_CUTOVER=false` and `CLERK_ORG_ROLE_MODE=custom`.
- PENDING_EXTERNAL_DASHBOARD: Clerk Dashboard settings (disable end-user org creation, invitation-required production sign-up, `org:manager`/`org:user` custom roles, MFA for platform admins) are an external deployment gate; the non-secret settings snapshot goes into G1 release evidence at cutover.

### Verification approach

- TDD RED first (6 of 7 surface tests failing before installation/wiring), then GREEN; full suite 101/101, `npm run typecheck` 0 errors, `npm run security:scan` 0 violations, `npm run build:web` succeeds without Clerk credentials.
- Legacy behavior pinned: the G0.2 regression tests still pass against the legacy guidance path (public `/login`/`/signup`, anonymous protected pages redirect to `/login`).

---

## [2026-07-15] ci: Private server boundaries enforced by scanner (G0.7 — G0 complete)

### Summary

- Added `scripts/security/scan-private-boundaries.ts` (TypeScript-AST based) behind `npm run security:scan` and `npm run verify:commercial`: deterministic findings with file:line for `PUBLIC_BUSINESS_PROCEDURE` (publicProcedure outside auth.ts; client-order ingress outside orders.ts), `UNGUARDED_ROUTE_HANDLER` (direct API handler not behind with_request_principal; tRPC adapter and OPTIONS exempt), `CLIENT_IDENTITY_FIELD` (identity destructured from request JSON or read from query params), `LOCALSTORAGE_AUTH_TOKEN`, `ORG_CREATION_OUTSIDE_PROVISIONING` (reserved for the G1 provisioning service), and `IGNORED_TYPE_ERRORS`.
- The scanner immediately caught and we fixed: `apps/web/lib/auth-context.tsx` now uses the auth cookie as the single client-side token store (no localStorage writes), and the orphaned duplicate `apps/ai/lib/auth-context.tsx` (zero importers) was deleted.
- Recorded G0 release evidence in `docs/commercial/evidence/g0-release.md` (commands, UTC timestamps, commit SHAs, exit codes, output). G0 exit criteria are met; external provider-console credential rotation remains a documented deployment gate (`PENDING_EXTERNAL_ROTATION`).
- Remaining limitation carried to G1: legacy cookie sessions and public auth.login/logout/me stay until the Clerk cutover (G1.7).

### Verification approach

- TDD RED first (missing scanner module), then 9/9 scanner tests including a production-tree zero-findings assertion; the production scan itself found the two real localStorage violations before the fix — evidence the rules bite.
- `npm run verify:commercial` (typecheck + 94 tests + security scan + production web build) observed exit 0.

---

## [2026-07-15] fix: Guarded direct API handlers and removed body identity (G0.6)

### Summary

- Added `apps/web/lib/server/with-request-principal.ts`: every direct route handler now runs behind `with_request_principal(request, permission, handler)`, which verifies the legacy session cookie, asserts one named permission, recursively rejects client-supplied identity fields (`userId`/`orgId`/`organizationId`/`tenantId`/`actorId`/`accountId`, case- and separator-insensitive, anywhere in the JSON body) with `400 IDENTITY_FIELD_NOT_ALLOWED`, and passes the verified `RequestPrincipal` plus the screened body to the handler. Anonymous/invalid sessions get 401; suspended memberships get 403.
- Guarded all 13 direct route files: agent routes, AI chat/enhanced/cosmetic routes, and the LangGraph module with `ai:run`; `index-data` and `ai-chat/refresh` with `tenant:settings:write`; the three RAG retrieval routes with `tenant:read`. `apps/web/app/api/trpc/[trpc]` stays outside the wrapper because its tRPC context performs the same verification (G0.5).
- Deleted every body/query identity fallback: handlers now derive `userId`/`organizationId` exclusively from the principal (including `enhanced-chat` GET, which previously took `userId` from query params), and the web pages (raw-materials AI, sales AI, formulas AI-suggest, feedback PUTs) no longer send identity fields.
- Test injection point: `set_identity_store_for_testing()` lets route tests run against an in-memory identity store with no MongoDB.

### Verification approach

- TDD RED first: 38 of 43 new table-driven tests failing against unguarded routes (each of the 13 handlers invoked without a cookie, with an expired cookie, and with forged identity fields); GREEN after guarding.
- Full suite 85/85; `npm run typecheck` 0 errors; `npm run build:web` completes.

---

## [2026-07-15] fix: Verified principals required for all tRPC operations (G0.5)

### Summary

- `createTRPCContext` now resolves the `auth_token` cookie once per request through `resolve_legacy_principal` (Mongo-backed `LegacyIdentityStore`) and exposes only `{ principal, auth_error, legacy_user }`. Request bodies are never an identity source; resolution failures fail closed.
- New procedure stack in `apps/ai/server/trpc.ts`: `authenticatedProcedure` (anonymous → `UNAUTHORIZED`; suspended membership → `FORBIDDEN`), `tenantProcedure(permission)` (active tenant + named permission), and `managerProcedure`. `protectedProcedure` is deleted.
- All 16 business routers converted; `publicProcedure` survives only in `auth.ts`. Permission mapping: reads → `tenant:read`; AI surfaces → `ai:run`; formula create/update/delete/comments → `formula:draft`; `formulas.confirm` and any status transition to confirmed/approved → `formula:confirm`; credits/user administration and shipping-cost billing → manager only.
- `auth.signup` is closed: it now always returns `PRECONDITION_FAILED` ("universities are provisioned by platform administration"). `auth.logout` derives the logged identity from the session record, not the request body.
- Organizations/users/orders are tenant-scoped: cross-tenant `getById`/credit/order access is rejected; the anonymous list-all-organizations and all-tenants transaction views are removed; targets and acting identity (`performedBy`, `createdBy`, `organizationId`) derive from the verified principal, and those fields were removed from input schemas and web call sites.
- Deliberate exception: `orders.submitClientOrder` remains anonymous on a dedicated `publicClientOrderProcedure` because the public client order form is a preserved G0.2 route contract; the architecture test pins it to exactly one usage.
- Known behavior change: `ctx.user.id` previously evaluated to `undefined` at runtime (untyped raw document); conversation/feedback records now carry the real internal user ID. Legacy records with undefined IDs are handled by the G2 backfill.
- Test infra: root `vitest.config.ts` now mirrors the web webpack aliases (`@/ai`, `@/server`, `@/` → apps/web) so router-level caller tests run against the real `appRouter`.

### Verification approach

- TDD RED first: 8 of 9 new architecture/caller tests failing against the public routers; GREEN after conversion (28 auth tests, 42 total across 6 files).
- `npm run typecheck` exits 0 (after removing client-supplied identity fields from 4 web call sites) and `npm run build:web` completes.

---

## [2026-07-15] feat: Provider-neutral request principal (G0.4)

### Summary

- Added provider-neutral authorization contracts to `packages/shared-types/src/auth.ts`: `PlatformRole`, `TenantRole`, `Permission`, `RequestPrincipal`, and per-role permission catalogues (`TENANT_ROLE_PERMISSIONS`, `PLATFORM_ROLE_PERMISSIONS`). Platform and tenant role dimensions are separate types; neither converts into the other.
- Added `apps/ai/server/auth/legacy-principal-resolver.ts`: `resolve_legacy_principal(token, db, now)` resolves a verified legacy session through one session query plus an account/user/organization lookup sequence against an injected read-only `LegacyIdentityStore` port (Prisma adapter lands with tRPC wiring in G0.5; tests use in-memory fakes).
- Legacy role mapping grants no platform authority: legacy `admin` maps to tenant `manager`; `shipper`/`shopper` map to tenant `user`; `platform_role` is always null for legacy identities.
- Added `apps/ai/server/auth/authorize.ts` (`require_permission`, `require_active_tenant`) and `apps/ai/server/auth/errors.ts` (`AuthorizationError` with stable codes `UNAUTHENTICATED`, `MEMBERSHIP_INACTIVE`, `FORBIDDEN`).
- Rejection semantics: missing/unknown/expired session, inactive or missing account, missing user profile, and missing organization raise `UNAUTHENTICATED`; suspended/inactive user or inactive organization raise `MEMBERSHIP_INACTIVE`.

### Verification approach

- TDD: captured the RED run (2 test files failing on missing modules), then GREEN with 19 passing auth tests covering all rejection cases, role mapping, and authorization assertions.
- Full suite remains green (33 tests across 5 files) and `npm run typecheck` passes; the four new modules also pass an isolated `tsc --strict` check.

---

## [2026-07-15] docs: Dynamic agentic orchestrator design supersedes fixed OODA pipeline

### Summary

Replaced the planned twelve-fixed-node OODA StateGraph with a governed agentic loop per product-owner direction ("dynamic pure agentic with orchestrator and .md inject"). One model-driven reasoning node owns flow (which tool, when to clarify, when to finalize); a deterministic governor (ingress, gate, act, validators, finalize, fail) owns authorization, budgets, checkpoints, loop detection, and side effects. The orchestrator understands its capabilities through injected markdown capability cards — one .md per tool and per agent — assembled at ingress, filtered by tenant policy, and pinned by content hash on the run. Specialists become delegation tools running the same loop recursively with narrowed allowlists and reserved budgets.

### Rationale (OODA on the AI architecture)

- Observe: the audited system has ~9 executor paths with only 2 user-reachable, both funneling into one hardcoded ReAct agent with silent fallbacks; two disjoint tool systems with inline mixed-language description strings; prompts split across hardcoded TS and orphaned .md files.
- Orient: OODA as emergent loop behavior (tool result = observe, reasoning turn = orient+decide, gated execution = act, deterministic validators = evaluate) preserves every governance guarantee of the fixed graph while cutting 3-4 structured-output model calls per cycle to 1 native tool-calling turn and removing the OrientationV1/DecisionV1 structured-output failure mode.
- Decide: keep LangGraph for durability only (checkpoints, interrupts, streaming); keep all public contracts, formula validation, run API/worker, typed UI events, and boundary scanning from the prior plan.
- Act: rewrote the G4 plan in place; program gate references remain valid.

### Documentation

- Added docs/superpowers/specs/2026-07-15-agentic-orchestrator-design.md (supersedes section 11 of the tenancy design; includes current-state audit appendix).
- Rewrote docs/superpowers/plans/2026-07-15-ooda-agent-orchestration.md as the Agentic Orchestration Implementation Plan (11 tasks: workspace, contracts, capability cards + context assembler, agent node, deterministic governor, delegation tools, checkpoints/interrupts, formula artifacts, run API, typed UI events, boundary enforcement).
- Updated docs/superpowers/plans/2026-07-15-commercialization-program.md G4 exit criteria and architecture summary.

---

## [2026-07-15] fix: Remove public AI credential fallbacks

### Summary

- Added a private, runtime-neutral `@rnd-ai/server-config` workspace contract that loads Gemini, OpenAI, Qdrant, and Google web-search credentials only from explicit server environment input, performs no import-time environment reads, and never accepts a public credential fallback.
- Removed public provider-key build arguments, container variables, deployment-script forwarding, duplicated environment-example names, and the tracked production environment file; tightened environment-file ignore rules while retaining committed examples.
- Routed server provider construction through the canonical credential loader, preserved lazy request-time initialization, and moved client chat retrieval to the existing server-backed unified-search API client.
- Added a repository scanner that rejects public credential-shaped names, client provider construction/imports, client imports of the private credential package, and tracked non-example environment files while allowing the Clerk publishable key and public API URLs.
- Recorded the required provider/environment rotation and revocation ledger as `PENDING_EXTERNAL_ROTATION`; local source containment does not claim provider-console rotation.

### Root cause

- Historical provider integrations reused browser-prefixed variables as server fallbacks and passed those names through Docker build layers, runtime configuration, deployment automation, examples, and client-side service construction.
- Credential loading was duplicated across web routes and AI agents, so later integrations could silently preserve the insecure fallback instead of consuming one private server contract.

### Verification approach

- Captured the focused scanner RED result across application source, client components, Docker configuration, environment examples, and deployment automation before production edits, then confirmed the complete focused security suite passes.
- Confirmed the root TypeScript check, private package TypeScript check, web ESLint command, and Next.js production build pass without provider credentials at build time.
- Confirmed the AI workspace lint command remains unavailable because that workspace has no ESLint 9 flat configuration; no lint infrastructure was added in this containment change.
- Deferred the global `npm run security:scan` gate to G0 Task 7 because its planned scanner entry point is not present yet.

## [2026-07-15] build: Upgrade to patched Next and React baseline

### Summary

- Pinned the web runtime to Next.js 16.2.10, React/React DOM 19.2.7, matching React type packages, and eslint-config-next 16.2.10; pinned the AI workspace MongoDB driver to 6.21.0.
- Replaced the removed `next lint` command with ESLint, migrated the configuration from the obsolete FlatCompat adapter to Next.js 16 native flat exports, restored explicit TypeScript checking, removed the build-time TypeScript bypass, and migrated redirect-only request guidance from `middleware.ts` to the Next.js 16 `proxy.ts` convention.
- Repaired the existing TypeScript contract drift in legacy agent calls, LangGraph state annotations, logger errors, cosmetic regulatory and threshold types, dashboard metrics, and formula router outputs/statuses.
- Cleared the React 19 lint baseline without suppressions by deriving query-backed chat state, reconciling optimistic messages by server ID, moving pagination resets into user events, and making effect-driven external data updates asynchronous and cleanup-safe.
- Deferred environment-dependent Gemini and MongoDB client construction until request-time use so production builds do not require runtime secrets.
- Kept the existing webpack configuration active under Next.js 16 by selecting webpack explicitly for production builds.
- Resolved the G0 Task 2 review findings while preserving the binding G0 route contract: `/login` and `/signup` remain public, anonymous protected pages redirect to `/login`, and the Clerk-style route rename stays deferred to G1.
- Added privacy-safe structured proxy lifecycle logs, hydration-safe App Router search-parameter handling for the public order form, one-time chat-thread default pinning across refetch reordering, and schema-backed formula-status narrowing without an `any` assertion.

### Verification approach

- Installed the pinned workspace dependency graph and confirmed the exact top-level package versions.
- Ran the web lint command, root TypeScript check, focused framework architecture test, and Next.js 16 production build with TypeScript validation enabled.
- Reviewed all touched React components against the repository's component, hook, rendering, accessibility, and type-safety conventions.
- Added and ran an eight-case review regression suite, then verified both public auth routes and their bidirectional navigation in a real browser with no console, runtime, or Next error-overlay failures.

---

## [2026-07-15] test: Add commercial verification baseline

### Summary

- Added a root Vitest harness with reproducible test and watch commands.
- Added root typecheck, private-boundary security scan, and combined commercial verification commands for later commercialization gates.
- Added an architecture baseline that pins the intended patched Next.js and React versions and prohibits bypassing TypeScript build validation.
- Deliberately retained the current framework versions and `ignoreBuildErrors` setting so the architecture baseline remains RED until the framework upgrade task completes.

### Verification approach

- Captured the initial missing-test-script failure before installing the harness.
- Re-ran the focused architecture test after installation to confirm it now reaches the deliberate framework baseline failures.

---

## [2026-07-15] chore: Prepare isolated commercialization worktree

### Summary

- Ignored the project-local `.worktrees/` directory so the `v2/dev` commercialization branch can be developed in an isolated Git worktree without polluting repository status.

---

## [2026-07-15] docs: Commercial migration implementation program

### Summary

Added the execution-ready program and six gated implementation plans for commercializing R&D AI. The plans translate the approved Clerk tenancy and OODA design into test-driven tasks with exact file ownership, interfaces, dependency pins, failing-test anchors, implementation anchors, verification commands, rollback evidence, and commit boundaries.

### Plans

- Added docs/superpowers/plans/2026-07-15-commercialization-program.md for gate order, shared invariants, rollback mapping, and release criteria.
- Added docs/superpowers/plans/2026-07-15-commercial-security-containment.md for the patched Next.js/React baseline, route protection, server-derived identity, public-secret removal, credential rotation, and static boundary enforcement.
- Added docs/superpowers/plans/2026-07-15-clerk-identity-tenant-provisioning.md for Clerk sessions, identity projections, platform-created universities, invitation/webhook reconciliation, bcrypt import, and cutover.
- Added docs/superpowers/plans/2026-07-15-tenant-data-authorization.md for tenant provenance, audited backfill/quarantine, scoped repositories, support access, and router/tool conversion.
- Added docs/superpowers/plans/2026-07-15-tenant-ai-control-plane.md for effective policy, deployments, quotas, usage, tool governance, upload quarantine, and Qdrant knowledge isolation.
- Added docs/superpowers/plans/2026-07-15-ooda-agent-orchestration.md for versioned contracts, bounded specialist subgraphs, OODA nodes, durable interrupts/checkpoints, formula validation, private workers, one run API, and typed UI events.
- Added docs/superpowers/plans/2026-07-15-commercial-evaluation-rollout.md for the frozen baseline, quantitative release thresholds, shadow/canary, load and resilience, operations, tenant lifecycle, CI, and legacy retirement.

### Additional implementation decisions

- Pinned the planned web baseline to Next.js 16.2.10, React 19.2.7, and Clerk Next.js 7.5.18 based on current package compatibility.
- Isolated current LangGraph 1.4.7 in a new orchestration workspace so legacy LangChain dependencies can coexist until cutover.
- Added partial unique MongoDB index setup for nullable Clerk/legacy IDs instead of invalid nullable Prisma uniqueness assumptions.
- Added a separate invitation projection because an invited email may not yet have a Clerk user or internal user profile.
- Stored AI cost as integer micro-USD because Prisma Decimal is unsupported by the MongoDB connector.
- Added explicit public AI key removal and rotation, one-membership enforcement, bounded specialist subgraphs, upload authorization/quarantine, private run workers, support grants, and load/failure recovery gates found during plan self-review.

---

## [2026-07-15] docs: Commercial Clerk tenancy and OODA AI migration design

### Summary

Added the evidence-backed commercial architecture specification for replacing custom authentication with Clerk, introducing separate platform and university role scopes, enforcing tenant isolation across application and AI data, and consolidating overlapping AI paths into a governed LangGraph OODA orchestrator.

### Repository audit findings

- Identified public organization creation with automatic admin assignment, JavaScript-readable custom session tokens, cookie-presence middleware, and API routes excluded from middleware.
- Counted 20 sensitive public procedures across organization, user, order, and credit routers and 12 direct API route files without verified server authentication.
- Flagged client-controlled AI identity fields and formula tools that load or mutate records without tenant predicates.
- Documented missing tenant provenance across AI conversations, responses, feedback, formula discussions, and version history.
- Flagged overlapping ReAct, fixed pipeline, legacy LangGraph, agent-manager, cosmetic, and sales execution paths with silent fallbacks.
- Confirmed the deployed boundary currently bundles AI source into the web runtime despite separate workspace naming.
- Recorded missing standard tests, CI gates, evaluation corpus, quota ledger, durable approvals, and commercial data-governance operations.

### Architecture decisions

- Clerk owns identity, sessions, organizations, memberships, and invitations; MongoDB owns application and tenant AI state.
- Platform roles (`super_admin`, `admin`) are independent from university roles (`manager`, `user`).
- Only platform admins create universities and appoint managers; managers invite students and govern tenant AI within platform limits.
- Every resource and AI operation derives tenant context from verified server state and enforces named permissions at the resource boundary.
- Tenant AI policy controls models, tools, prompts, knowledge, quotas, retention, approvals, and usage.
- A typed LangGraph `Observe -> Orient -> Decide -> Act` loop becomes the sole production AI architecture.
- Deterministic code authorizes actions, injects tenant filters, validates artifacts, controls budgets, and commits side effects.
- Existing bcrypt account hashes are eligible for Clerk import, avoiding a mandatory reset for valid records.
- Implementation is decomposed into six gated subprojects from immediate containment through canary and deprecation.

### Documentation

- Added `docs/superpowers/specs/2026-07-15-commercial-clerk-tenancy-ooda-design.md`.

---

## [2026-03-30] feat: Show chat history threads in main navigation sidebar

### Summary
Recent AI chat threads now appear in the main navigation sidebar under each AI assistant link. Users can expand/collapse the thread list and click a thread to deep-link directly into that conversation. Supports URL-based thread selection via `?thread=<id>` query param.

### Approach
- Navigation sidebar fetches the 5 most recent threads per agent type via tRPC (React Query cached, no extra overhead)
- Each AI link gets a chevron toggle to expand/collapse thread history
- Thread items show truncated title + relative timestamp, linking to `?thread=<id>`
- `use_chat_threads` hook accepts optional `initial_thread_id` to auto-select a thread from URL params on mount
- Both AI pages read `useSearchParams().get('thread')` and pass it to the hook

### Changes
- `apps/web/components/navigation.tsx` — Added tRPC thread queries (limit 5 per agent type), `format_thread_time` helper, `get_threads_for_href` mapper, expandable thread sub-items under AI links with `MessageSquare` icons
- `apps/web/hooks/use_chat_threads.ts` — Added optional `initial_thread_id` parameter with `initial_thread_applied_ref` guard to auto-select on mount without overriding manual selections
- `apps/web/app/ai/raw-materials-ai/page.tsx` — Added `useSearchParams` to read `?thread=` param and pass to `use_chat_threads`
- `apps/web/app/ai/sales-rnd-ai/page.tsx` — Same `useSearchParams` wiring as raw-materials page

### Files Changed
- `apps/web/components/navigation.tsx`
- `apps/web/hooks/use_chat_threads.ts`
- `apps/web/app/ai/raw-materials-ai/page.tsx`
- `apps/web/app/ai/sales-rnd-ai/page.tsx`

---

## [2026-03-30] feat: Slide-over panel, inline edit mode, AI Suggest

### Summary
- **Slide-over panel**: Replaced dialog-based formula detail view with a 70vw fixed right-side panel. Supports both **view** and **edit** modes with a header toggle. Row click opens view; Edit button opens edit mode.
- **Inline edit mode**: All formula fields (name, client, batch size, status, benefits, ingredients, remarks) are editable within the panel. Ingredient amounts auto-recalculate percentages.
- **AI Suggest button**: A toolbar button opens a modal where users describe what they want. AI (ReAct agent → generate_formula tool) creates a complete draft and the panel auto-opens it for review.
- **Hidden /stock page**: Removed from sidebar navigation.

### Changes
- `apps/web/app/formulas/page.tsx` — Full rewrite: slide-over panel (70vw), view/edit modes, AI Suggest modal with auto-open, simplified table (Code/Name/Ver/Status/Actions), confirm button for drafts
- `apps/web/components/navigation.tsx` — Commented out `/stock` navigation link
- `apps/web/app/formulas/create/page.tsx` — Added `useSearchParams` to detect edit mode, dynamic title

### Approach
- Panel uses `fixed inset-y-0 right-0 w-[70vw]` with z-50 and backdrop overlay
- AI Suggest calls `/api/ai/raw-materials-agent` which triggers ReAct agent; after response, `utils.formulas.list.fetch()` refetches and auto-opens the newest AI draft
- Edit mode populates form state from the selected formula; save calls `trpc.formulas.update` mutation

---

## [2026-03-30] feat: Per-version comments + hide calculation page

### Summary
- **Comments are now per-version**: Each comment is scoped to the formula version it was written on. When you view comments for v01, you only see v01's feedback — v02 gets a fresh thread. The `revise_formula` AI tool now only reads comments for the current version, keeping revision context precise.
- **Hidden calculation page**: Removed `/calculation` (Price Calculator) from sidebar navigation.

### Changes
- `prisma/schema.prisma` — Added `version Int @default(0)` field to `FormulaComment` model + compound index `[formulaId, version]`
- `apps/ai/server/routers/formula-comments.ts` — `list` and `count` queries now accept optional `version` filter; `create` mutation auto-resolves formula version if not provided; added `version_update` to COMMENT_TYPES
- `apps/web/components/formula-comments.tsx` — Added `version` prop; all queries/mutations scoped to version; header shows "Comments for v00"
- `apps/web/app/formulas/page.tsx` — Passes `version` prop to `FormulaComments`
- `apps/ai/agents/react/tool-handlers/revise-formula-handler.ts` — Loads only current-version comments; writes `version` on revision_note comments
- `apps/ai/agents/react/tool-handlers/confirm-formula-handler.ts` — Writes `version` on version_update comments
- `apps/ai/server/routers/formulas.ts` — Confirm mutation writes `version` on version_update comments
- `apps/web/components/navigation.tsx` — Removed `/calculation` link and `Calculator` import

---

## [2026-03-30] feat: Formula draft/confirm workflow with version history log

### Summary
Added a full draft→confirm versioning workflow for AI-generated formulas. When the AI generates or revises a formula in chat, it is saved as a **draft** (v00). Users must explicitly **confirm** to bump the version (v01, v02, v03...). Every change is tracked in an immutable `FormulaVersionLog` collection that records whether each update was made by AI or a user. Users can confirm via chat ("looks good" → AI calls confirm_formula tool) or directly from the formula page UI.

### Approach
- Version numbers only increment on `draft → confirmed` transitions (not on every edit)
- Each version log entry snapshots the full ingredients array for auditability
- Revisions now update the existing formula in-place (keeping same ID/code) instead of creating new documents
- The AI system prompt instructs Dr. Arun to always ask for confirmation before finalizing

### Schema Changes
- `prisma/schema.prisma` — Added `FormulaVersionLog` model with: formulaId, version, changeType, updatedBySource (ai/user), ingredientSnapshot, changelog, remarks
- `prisma/schema.prisma` — Added `confirmed` to `FormulaStatus` enum
- `prisma/schema.prisma` — Added `FormulaChangeType` enum (created, revised, edited, confirmed, status_changed)
- `prisma/schema.prisma` — Added `FormulaUpdateSource` enum (ai, user)
- `prisma/schema.prisma` — Added `version_update` to `CommentType` enum

### Backend Changes — New Files
- `apps/ai/agents/react/tool-handlers/confirm-formula-handler.ts` — NEW: `confirm_formula` tool handler — validates draft status, bumps version, creates version log entry, adds version_update comment
- `apps/ai/server/routers/formula-version-logs.ts` — NEW: tRPC router for listing version logs per formula

### Backend Changes — Modified Files
- `apps/ai/agents/react/tool-definitions.ts` — Added `confirm_formula` to `ReactToolName` union + built Gemini function declaration
- `apps/ai/agents/react/react-agent-service.ts` — Registered `confirm_formula` handler in `TOOL_HANDLER_MAP`
- `apps/ai/agents/react/react-system-prompt.ts` — Added confirmation workflow instructions + FORMULA_CONFIRM classification category
- `apps/ai/agents/react/tool-handlers/generate-formula-handler.ts` — Changed to save with `version: 0` (pre-confirm), creates initial version log, outputs `pending_confirmation: true` flag
- `apps/ai/agents/react/tool-handlers/revise-formula-handler.ts` — Changed to update formula in-place (not create new doc), resets status to draft, creates "revised" version log entry
- `apps/ai/server/routers/formulas.ts` — Added `confirm` mutation: validates draft status, bumps version, creates version log + version_update comment
- `apps/ai/server/index.ts` — Registered `formulaVersionLogsRouter`

### Frontend Changes
- `apps/web/components/formula-version-history.tsx` — NEW: Timeline component showing version audit trail with AI/User badges, change types, timestamps
- `apps/web/app/formulas/page.tsx` — Added confirm button (CheckCircle) for draft formulas in table + detail dialog, version history section in detail dialog, `confirmed` status badge (blue), version display as v00 format

### Files Changed
- `prisma/schema.prisma`
- `apps/ai/agents/react/types.ts` (unchanged, referenced)
- `apps/ai/agents/react/tool-definitions.ts`
- `apps/ai/agents/react/react-agent-service.ts`
- `apps/ai/agents/react/react-system-prompt.ts`
- `apps/ai/agents/react/tool-handlers/generate-formula-handler.ts`
- `apps/ai/agents/react/tool-handlers/revise-formula-handler.ts`
- `apps/ai/agents/react/tool-handlers/confirm-formula-handler.ts` (NEW)
- `apps/ai/server/routers/formulas.ts`
- `apps/ai/server/routers/formula-version-logs.ts` (NEW)
- `apps/ai/server/index.ts`
- `apps/web/components/formula-version-history.tsx` (NEW)
- `apps/web/app/formulas/page.tsx`

---

## [2026-03-30] config: Set production domain to rndai.erporganics.com

### Summary
Updated all production environment variables and Docker Compose build args to use `rndai.erporganics.com` as the frontend domain.

### Changes
- `.env.production` — `NEXT_PUBLIC_API_URL` → `https://rndai.erporganics.com/api`
- `docker-compose.yml` — Default `NEXT_PUBLIC_API_URL` fallback → `https://rndai.erporganics.com/api`
- `docker-compose.yml` — Added `build.args` for `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GEMINI_API_KEY`, `NEXT_PUBLIC_OPENAI_API_KEY` so Next.js inlines them at build time

### Files Changed
- `.env.production`
- `docker-compose.yml`

---

## [2026-03-30] feat: Per-message feedback + auto-save AI-generated formulas to DB

### Summary
Two features: (1) Moved HITL Yes/No feedback buttons from the input area to under each assistant message for better ML signal granularity. (2) AI-generated formulas (generate_formula and revise_formula tools) now auto-persist to MongoDB `formulas` collection so they appear on `/formulas` page.

### Changes — Per-message feedback
- `ai_chat_message.tsx` — Added `onFeedback` and `feedbackSubmitted` props; renders `AIFeedbackButtons` under each assistant message
- `ai_chat_messages_area.tsx` — Added `onFeedback` and `feedbackSubmitted` props; passes to each `AIChatMessage`
- `ai_chat_input_area.tsx` — Removed all feedback-related props and rendering (simplified to input + height reporting)
- `raw-materials-ai/page.tsx` — Moved `onFeedback`/`feedbackSubmitted` from `AIChatInputArea` to `AIChatMessagesArea`
- `sales-rnd-ai/page.tsx` — Same prop migration as raw-materials page

### Changes — Auto-save formulas to DB
- `apps/ai/agents/react/types.ts` — NEW: Shared `ToolHandlerContext` interface (user_id, organization_id, session_id)
- `react-agent-service.ts` — Handler map signature expanded from `(args, session_id?)` to `(args, context?)`; builds `ToolHandlerContext` from request and passes to handlers
- `ReactAgentRequest` — Added optional `organization_id` field
- `generate-formula-handler.ts` — Added `persist_formula_to_db()`: auto-generates formulaCode, maps ingredients to DB schema, inserts to `formulas` collection with `aiGenerated: true`
- `revise-formula-handler.ts` — After building revision, persists as new formula version with `parentFormulaId` linking to original
- `raw-materials-agent/route.ts` — Passes `organizationId` from request body to `ReactAgentService.execute()`
- `raw-materials-ai/page.tsx` — Sends `organizationId: user?.organizationId` in API request body

### Architecture
- `ToolHandlerContext` extracted to `apps/ai/agents/react/types.ts` to avoid circular imports
- Re-exported from `react-agent-service.ts` for backward compatibility
- Formula persistence is non-fatal: DB write failures are logged but don't block the AI response

### Files Changed
- `apps/ai/agents/react/types.ts` (NEW)
- `apps/ai/agents/react/react-agent-service.ts`
- `apps/ai/agents/react/tool-handlers/generate-formula-handler.ts`
- `apps/ai/agents/react/tool-handlers/revise-formula-handler.ts`
- `apps/web/app/ai/raw-materials-ai/page.tsx`
- `apps/web/app/ai/sales-rnd-ai/page.tsx`
- `apps/web/app/api/ai/raw-materials-agent/route.ts`
- `apps/web/components/ai/ai_chat_input_area.tsx`
- `apps/web/components/ai/ai_chat_message.tsx`
- `apps/web/components/ai/ai_chat_messages_area.tsx`

---

## [2026-03-30] UI: Redesign stock page — Cloudflare-minimal design system

### Summary
Rewrote `apps/web/app/stock/page.tsx` to match the Cloudflare-minimal design system used across the rest of the app.

### Changes
- Replaced purple icon header + back button with `ConsolePageShell` wrapper
- Replaced `Card`/`CardHeader`/`CardContent` wrappers with simple containers and `ConsoleSection`
- Typography: `text-[13px]` titles, `text-[12px]` body, `text-[11px]` helper, `text-[10px]` uppercase labels
- Table headers: `text-[10px] font-medium text-gray-400 uppercase tracking-wider`
- Table rows: `border-b border-gray-50 hover:bg-gray-50/50`
- Filter toolbar: `bg-[#fafafa]` with `border-gray-200/60 rounded-lg text-[11px]` selects
- Buttons: `bg-gray-900 hover:bg-gray-800 text-white rounded-lg` (removed purple/green)
- Empty state: `py-16` with `text-gray-200` icon and `text-[12px] text-gray-400` text
- Form sections: `border border-gray-200/60 rounded-xl p-4` instead of Card
- Summary stat cards: flat grid with `border-r border-gray-50` dividers
- Extracted `resetForm()` helper to DRY up form-clearing logic
- Loading spinner: smaller, consistent with other redesigned pages
- Removed unused imports: `Card`, `CardContent`, `CardHeader`, `CardTitle`, `CardDescription`, `ArrowLeft`, `Plus`, `useEffect`

### Files Changed
- `apps/web/app/stock/page.tsx` — Full Cloudflare-minimal redesign

---

## [2026-03-30] UI: Redesign calculation page — Cloudflare-minimal design system

### Summary
Rewrote `apps/web/app/calculation/page.tsx` to match the Cloudflare-minimal design system. Visual-only change; all functionality preserved.

### Changes
- Replaced header (green icon box + back button) with `ConsolePageShell` wrapper
- Replaced Card wrappers with `border border-gray-200/60 rounded-xl` containers
- Typography: text-[13px] titles, text-[12px] labels/body, text-[11px] helpers
- Buttons: `bg-gray-900 hover:bg-gray-800` (removed green accent)
- Empty states: `py-16` with muted icon and text
- Removed unused imports (Card, Badge, ArrowLeft, etc.)

### Files Changed
- `apps/web/app/calculation/page.tsx`

---

## [2026-03-30] UI: Products page — Cloudflare-minimal design system migration

### Summary
Rewrote products page visual layer to match the Cloudflare-minimal design system.

### Changes
- Replaced purple/green icon header + back button with `ConsolePageShell` wrapper
- Replaced `Card`/`CardHeader`/`CardContent` with `ConsoleSection` and plain containers
- Typography: `text-[13px]` titles, `text-[12px]` body, `text-[11px]` helper, `text-[10px]` table headers
- Table headers: uppercase tracking-wider; rows: `border-gray-50 hover:bg-gray-50/50`
- Search toolbar: `bg-[#fafafa]` background, compact inputs
- Buttons: gray-900 primary, ghost secondary (removed green-600)
- Badges: neutral `text-[10px]` with `border-gray-200/80 bg-gray-50/50`
- Empty state: `py-16` with muted icon/text
- Form inputs: `border-gray-200/60 bg-white rounded-lg text-[12px]`
- All functionality preserved — zero logic changes

### Files Changed
- `apps/web/app/products/page.tsx` — Full visual rewrite

---

## [2026-03-30] UI: Redesign Create Formula page — Cloudflare-minimal design system

### Summary
Rewrote `apps/web/app/formulas/create/page.tsx` to match the Cloudflare-minimal design system used across other console pages.

### Changes
- Replaced purple icon box header + back button with `ConsolePageShell` wrapper
- Replaced `Card`/`CardContent` wrappers with minimal `border border-gray-200/60 rounded-xl` containers
- Applied consistent typography: `text-[13px]` titles, `text-[12px]` labels/body, `text-[11px]` helper text
- Submit/action buttons now use `bg-gray-900 hover:bg-gray-800` instead of colored variants
- Loading spinner uses gray-400 instead of blue-600
- Removed `lucide-react` Beaker and ArrowLeft icon imports (no longer needed)
- All existing functionality (auth checks, role gates, FormulaForm) preserved as-is

### Files Changed
- `apps/web/app/formulas/create/page.tsx` — Full rewrite to ConsolePageShell + minimal styling

---

## [2026-03-30] UI: Redesign chat layout — kill double header, flatten nesting

### Summary
Complete redesign of AI chat page layout. Removed redundant page header, eliminated Card nesting, merged sidebar toggle into toolbar, and refined all component typography/spacing.

### Problem
- **Double header**: `AIPageHeader` (page title) + `AIChatHeader` (card header) stacked = wasted space
- **7 layers of nesting**: Page → container → PageHeader → Layout → Card → CardHeader → CardContent → ScrollArea
- **Two borders**: Layout border + Card border = visual noise
- **Sidebar toggle awkwardly nested** in a div alongside CardHeader, causing alignment issues
- **Overly verbose text**: "Hello! I'm your Raw Materials AI assistant. Ask me about:" etc.

### Changes
- **Removed `AIPageHeader`** from both AI pages — the toolbar title provides enough context
- **Flattened `AIChatMessagesContainer`** — removed Card/CardHeader/CardContent wrapper. Now a plain flex div.
- **Redesigned `AIChatHeader`** — Flat toolbar with `leading` prop for sidebar toggle. No more CardHeader. Uses `bg-gray-50/40` for subtle toolbar feel.
- **Redesigned `AIChatLayout`** — Single border container with `shadow-sm`. Sidebar uses `border-r border-gray-100`.
- **Redesigned `AIChatSidebar`** — Dashed-border "New chat" button, lighter background (`bg-gray-50/60`), smaller type, subtle active state with shadow.
- **Redesigned `AIEmptyState`** — Suggestion chips instead of bullet list. Centered with max-width.
- **Redesigned `AIChatMessage`** — "AI" instead of "AI Assistant", smaller timestamps, muted badge colors with transparency, cleaner metadata line.
- **Reduced page padding** — `p-2 lg:p-3` instead of `container mx-auto px-6 pt-2` for edge-to-edge feel.

### Files Changed
- `apps/web/components/ai/ai_chat_header.tsx` — Flat toolbar with `leading` prop
- `apps/web/components/ai/ai_chat_container.tsx` — Removed Card wrapper
- `apps/web/components/ai/ai_chat_layout.tsx` — Cleaner border, shadow-sm
- `apps/web/components/ai/ai_chat_sidebar.tsx` — Lighter, dashed new-chat button
- `apps/web/components/ai/ai_empty_state.tsx` — Chip-style suggestions
- `apps/web/components/ai/ai_chat_message.tsx` — Shorter labels, muted colors
- `apps/web/app/ai/raw-materials-ai/page.tsx` — Removed AIPageHeader, flattened
- `apps/web/app/ai/sales-rnd-ai/page.tsx` — Same treatment

---

## [2026-03-30] Fix: AI response creates new thread instead of staying in same conversation

### Root Cause
Stale closure in `use_chat_threads.add_message` — the `useCallback` captured `active_thread_id`
from React state, but between the user message (which creates the thread) and the assistant
message (same turn), React hasn't re-rendered yet. The closure still sees `null`, so it creates
a second thread.

### Fix
Added `active_thread_id_ref` (useRef) that mirrors `active_thread_id` state. The `add_message`
function reads from the ref instead of the stale closure value. Both `select_thread` and
`start_new_chat` also update the ref synchronously for consistency.

### Files Updated
- `apps/web/hooks/use_chat_threads.ts` — Ref-based thread ID tracking in add_message

---

## [2026-03-30] Performance: AI pipeline + chat UX optimizations

### Summary
6 targeted optimizations across the AI pipeline and frontend chat, addressing performance bottlenecks found during codebase audit.

### Backend Performance

1. **Parallelize Qdrant searches in formula generation** — Replaced sequential for-loop with `Promise.all()`. With 5-7 phase queries × (embedding + search latency), this drops formula generation from ~2.5s to ~500ms for the search phase.
   - File: `apps/ai/agents/react/tool-handlers/generate-formula-handler.ts`

2. **Singleton ReactAgentService** — Both API routes (`raw-materials-agent`, `enhanced-chat`) were creating a new `ReactAgentService` (and Gemini client) per request. Now reuses a module-level singleton.
   - Files: `apps/web/app/api/ai/raw-materials-agent/route.ts`, `apps/web/app/api/ai/enhanced-chat/route.ts`

### Frontend UX

3. **Auto-scroll to bottom on new messages** — Chat now auto-scrolls when new messages arrive (if user is near bottom). Floating "scroll to bottom" button appears when user scrolls up.
   - File: `apps/web/components/ai/ai_chat_messages_area.tsx`

4. **Mobile-aware sidebar default** — Sidebar now defaults to collapsed on screens < 1024px. Also added `AbortController` with 60s timeout on AI fetch calls to prevent indefinite hanging.
   - Files: `apps/web/app/ai/raw-materials-ai/page.tsx`, `apps/web/app/ai/sales-rnd-ai/page.tsx`

5. **React.memo on AIChatMessage** — Prevents re-rendering all messages when a new one is added. Also added `break-words` on message content to prevent long URL/text overflow.
   - File: `apps/web/components/ai/ai_chat_message.tsx`

6. **Accessibility: ARIA labels** — Added `aria-label` to send button, chat input, and loading indicator (`aria-live="polite"` for screen reader announcement).
   - Files: `apps/web/components/ai/ai_chat_input.tsx`, `apps/web/components/ai/ai_loading_indicator.tsx`

---

## [2026-03-30] Fix: Replace hardcoded 80% confidence with computed scoring

### Summary
Replaced all hardcoded `0.8` confidence defaults across the entire AI pipeline with
real computed values. Created a shared `confidence-calculator.ts` utility that derives
confidence from actual signals: similarity scores, match types, source count, content
quality indicators, and data completeness.

### Root Cause
The confidence pipeline was designed as a pass-through — each layer passed `confidence`
from the layer below with a `|| 0.8` fallback. Since no layer computed it, the fallback
triggered at the bottom and propagated up unchanged. Functions like `assessTrendAlignment()`
were stubs that always returned 0.8 regardless of inputs.

### Approach
1. **Created shared utility** `apps/ai/utils/confidence-calculator.ts` with:
   - `compute_search_confidence()` — derives confidence from score × match_type_weight + field_bonus + source_bonus + credibility_adjustment
   - `compute_response_confidence()` — weighted average of source scores (70%) + content quality (20%) + coverage (10%)
   - `compute_analysis_confidence()` — accounts for data_completeness, recency, and whether data is real vs estimated
   - `compute_trend_alignment()` — keyword overlap between concept attributes and trend descriptions
   - `assess_content_quality()` — scores scientific terms, structure, specificity, domain relevance

2. **Wired through all layers:**
   - Source layer: hybrid-search-service (exact, metadata, fuzzy, semantic strategies)
   - Agent layer: enhanced-sales-rnd-agent, enhanced-raw-materials-agent
   - Scoring layer: response-reranker (replaced stub with real quality + relevance computation)
   - Service layer: enhanced-ai-service, langgraph-agent, streaming-ai-service
   - API layer: enhanced-chat route, raw-materials-agent route
   - Frontend layer: raw-materials-ai page, sales-rnd-ai page

3. **Changed fallback default from 0.8 → 0.5** so missing confidence is visibly
   "uncertain" (yellow) instead of misleadingly "confident" (green).

### Files Created
- `apps/ai/utils/confidence-calculator.ts` — Shared confidence computation utility

### Files Updated
- `apps/ai/services/rag/hybrid-search-service.ts` — 4 search strategies now compute confidence from scores
- `apps/ai/agents/sales-rnd-ai/enhanced-sales-rnd-agent.ts` — Real confidence for knowledge, market, cost results; fixed assessTrendAlignment and assessMarketPotential stubs
- `apps/ai/agents/raw-materials-ai/enhanced-raw-materials-agent.ts` — Real confidence for knowledge and tool results
- `apps/ai/services/response/response-reranker.ts` — Replaced stub scoreResponse with real quality + relevance + source scoring
- `apps/ai/services/enhanced/enhanced-ai-service.ts` — Fallback 0.8 → 0.5
- `apps/ai/agents/raw-materials-ai/langgraph-agent.ts` — Fallback 0.8 → 0.5
- `apps/ai/services/streaming/streaming-ai-service.ts` — Uses shared assess_content_quality
- `apps/web/app/api/ai/enhanced-chat/route.ts` — Passes through computed confidence, fallback 0.5
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — Fallback 0.8 → 0.5
- `apps/web/app/ai/raw-materials-ai/page.tsx` — Fallback 0.8 → 0.5
- `apps/web/app/ai/sales-rnd-ai/page.tsx` — Fallback 0.8 → 0.5

### Confidence Signal Map
| Signal | Source | Weight |
|--------|--------|--------|
| Similarity score | Qdrant/fuzzy match | Primary (scaled by match_type) |
| Match type | exact > hybrid > metadata > fuzzy > semantic | 1.0 → 0.7 multiplier |
| Matched fields | Document field hits | +0.04/field, max +0.12 |
| Source count | Corroborating sources | +0.05 × log2, max +0.10 |
| Content quality | Scientific terms, structure, specificity | 20% of response confidence |
| Data completeness | Market/cost field coverage | Primary for analysis confidence |
| Data recency | Age of analytical data | Penalty after 90 days |

---

## [2026-03-30] Feature: Structured Formulation Engine + Persistent Conversation History

### Summary
Three-part enhancement addressing R&D client feedback on formula quality and adding persistent chat history with org-scoped threads.

### Part 1: Structured Formulation Engine (Formula Accuracy)

**Problem:** `generate-formula-handler.ts` used pure vector-similarity scoring with flat score-weighted percentage distribution. R&D clients reported: wrong percentages, no phase structure, no regulatory awareness, output felt like a rough guess.

**Solution: 3-Layer Pipeline**

1. **Layer 1 — Phase-Aware Ingredient Selection**: Ingredients classified into 7 formulation phases (water, oil, active, emulsifier, preservative, pH adjuster, fragrance) using keyword matching against category/benefits/INCI fields. Each phase gets a percentage budget from product-type templates. Aqua (water) absorbs the remainder to guarantee 100% total.

2. **Layer 2 — Regulatory & Safety Validation**: Post-generation validation checks:
   - `usage_max_pct` from Qdrant payload (4.6K ingredients have this data)
   - Fallback to hardcoded `REGULATORY_LIMITS` config (EU Cosmetics Regulation Annex III/IV)
   - `usage_min_pct` enforcement for minimum effective concentration
   - 8 known incompatible ingredient pairs with severity levels
   - Mandatory ingredient check (preservative + pH adjuster auto-added if missing)
   - Percentage adjustment + warnings in output

3. **Layer 3 — Structured Output Formatting**: Phase-grouped ingredient table, warnings section, estimated cost, backward-compatible flat list.

**Files:**
- `apps/ai/agents/react/config/formulation-rules.ts` — NEW: Central config with phase budgets, regulatory limits, incompatible pairs, mandatory ingredients (all data-driven, not hardcoded in handler)
- `apps/ai/agents/react/tool-handlers/generate-formula-handler.ts` — REWRITTEN: 3-layer pipeline replacing flat score-weighted distribution

### Part 2: Persistent Conversation History (Backend)

**Problem:** Conversations were ephemeral (React `useState` only). Existing `Conversation` model had no `organizationId`, no thread concept, no agent type scoping.

**Solution: New ChatThread + ChatMessage models**
- `ChatThread`: org-scoped, user-owned, agent-type-scoped, with denormalized `messageCount` + `lastMessageAt`
- `ChatMessage`: belongs to thread, stores role/content/metadata
- Thread title auto-generated from first user message (truncated to 50 chars)
- tRPC router with: list, create, getMessages, addMessage, archive, updateTitle

**Files:**
- `prisma/schema.prisma` — Added ChatThread + ChatMessage models, AgentType enum, Organization relation
- `apps/ai/server/routers/chat-threads.ts` — NEW: Full tRPC router for thread CRUD
- `apps/ai/server/index.ts` — Mounted chatThreadsRouter

### Part 3: Frontend History Sidebar

**Problem:** No conversation history UI. Messages lost on page refresh.

**Solution: Toggleable sidebar with date-grouped threads**
- `AIChatSidebar` — History panel with "+ New Chat", date groups (Today/Yesterday/7 Days/Older), active highlight, archive on hover
- `AIChatLayout` — Wraps sidebar + chat area with toggle animation (240px open, 0px closed)
- `SidebarToggleButton` — PanelLeft/PanelLeftClose icon toggle in chat header
- `use_chat_threads` hook — Manages thread CRUD via tRPC with optimistic updates, auto-thread creation on first message
- Both AI pages refactored: messages now persist to MongoDB via tRPC instead of local useState

**Files:**
- `apps/web/components/ai/ai_chat_sidebar.tsx` — NEW: History sidebar component
- `apps/web/components/ai/ai_chat_layout.tsx` — NEW: Layout wrapper with toggle
- `apps/web/hooks/use_chat_threads.ts` — NEW: Thread management hook
- `apps/web/components/ai/index.ts` — Added exports for new components
- `apps/web/app/ai/raw-materials-ai/page.tsx` — REWRITTEN: Uses persistent threads + sidebar
- `apps/web/app/ai/sales-rnd-ai/page.tsx` — REWRITTEN: Uses persistent threads + sidebar

### Design Spec
- `docs/superpowers/specs/2026-03-30-formula-accuracy-conversation-history-design.md` — Full approved design document

---

## [2026-03-30] Cleanup: Remove legacy REST auth system — single tRPC auth path

### Summary
Removed the unused legacy REST API auth system (`/api/auth/login`, `/api/auth/logout`, `/api/auth/verify`) that checked `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars and set `rnd-ai-auth-session` cookies. The active auth system uses tRPC (`auth.signup` / `auth.login` / `auth.logout` / `auth.me`) with bcrypt + MongoDB sessions + `auth_token` cookie.

### Root Cause
Two auth systems coexisted — the legacy REST routes were dead code (nothing imported or called them) but created confusion. The middleware checked for `auth_token` (new system) while legacy routes set `rnd-ai-auth-session` (old system). Config files advertised stale route paths.

### Files Deleted
- `apps/web/app/api/auth/login/route.ts` — Legacy env-var credential check
- `apps/web/app/api/auth/logout/route.ts` — Legacy cookie-clearing endpoint
- `apps/web/app/api/auth/verify/route.ts` — Legacy session verification
- `apps/web/lib/auth.ts` — Legacy `useAuth()` hook calling REST endpoints
- `apps/ai/lib/auth.ts` — Duplicate of above

### Files Updated
- `apps/web/lib/config.ts` — Session cookie updated to `auth_token`, removed `ROUTES.api.auth` legacy routes
- `apps/ai/lib/config.ts` — Same as above
- `apps/web/lib/env.ts` — Removed `ADMIN_EMAIL`/`ADMIN_PASSWORD` from required env vars and accessor functions
- `apps/ai/lib/env.ts` — Same as above
- `apps/web/lib/validate-env.ts` — Removed `ADMIN_EMAIL`/`ADMIN_PASSWORD` from required validation list
- `apps/ai/lib/validate-env.ts` — Same as above
- `.env.example` — Replaced admin credentials section with tRPC auth note
- `.env.production` — Same as above

### Active Auth Flow (unchanged)
1. `/signup` → tRPC `auth.signup` → creates Account + Organization + User + Session
2. `/login` → tRPC `auth.login` → bcrypt verify → creates Session → sets `auth_token` cookie
3. Middleware checks `auth_token` cookie for route protection
4. `auth-context.tsx` manages state via `AuthProvider`

---

## [2026-03-30] Feature: AI Formula Tools — NPD generation, revision, comments, reference search

### Summary
Major AI enhancement: 4 new ReAct tools for New Product Development (NPD) formula workflows.
AI can now generate formulas from concept briefs, search reference formulas, revise formulas
based on human feedback/comments, and load formulas with their discussion threads.

### New ReAct Tools (9 total, up from 5)
1. **`generate_formula`** — AI creates cosmetic formulas from concept briefs
   - Searches Qdrant (raw_materials_myskin) for ingredients matching product type + target benefits
   - Assigns percentages based on product-type templates (serum, cream, toner, etc.)
   - De-duplicates, ranks by similarity score, normalises percentages
   - Returns structured JSON with ingredients, rationale, estimated cost

2. **`search_reference_formulas`** — Look up existing formulas as inspiration
   - MongoDB regex search across formula name, ingredients, benefits, client, remarks
   - Optional filters: status, client, benefits array
   - Returns full ingredient breakdowns for each matching formula

3. **`revise_formula`** — AI reads comments and improves a formula (HITL closer)
   - Loads formula + all comments, extracts feedback themes (suggestions, rejections, approvals)
   - Searches Qdrant for alternative ingredients based on actionable feedback
   - Generates revised formula with changelog documenting every change + which comment drove it
   - Saves a `revision_note` comment to track AI revisions in the discussion thread
   - Supports revision_focus: cost, performance, safety, or all

4. **`get_formula_with_comments`** — Load formula + comment discussion thread
   - Returns complete formula detail + all comments sorted chronologically
   - Includes summary: total comments, breakdown by type, has_approval/has_rejection flags
   - Loads parent formula name if `parentFormulaId` exists

### System Prompt Updates
- Added NPD domain knowledge: formula architecture (water/oil/active/emulsifier/preservative phases)
- Added 4 new intent categories: FORMULA_GENERATION, FORMULA_REFERENCE, FORMULA_REVISION, FORMULA_REVIEW
- Added Thai/English phrase-to-tool mapping for formula tools
- Added formula generation and revision workflow instructions
- Bumped max tool calls from 5 to 8 for complex multi-step NPD workflows

### tRPC Router: formulaComments
- Mounted `formulaCommentsRouter` in app router (list, create, update, delete, count)
- Full CRUD for formula comments with typed categories (feedback, suggestion, approval, rejection, revision_note)
- Author-only update/delete enforcement
- Aggregation pipeline for comment count by type

### Database (Prisma Schema — done in prior session)
- FormulaComment model with formulaId, commentType enum, parentCommentId for threading
- Formula model additions: parentFormulaId, referenceFormulaIds, aiGenerated, generationPrompt

### Files Changed
- `apps/ai/server/index.ts` — Mounted formulaCommentsRouter
- `apps/ai/agents/react/tool-handlers/generate-formula-handler.ts` — NEW
- `apps/ai/agents/react/tool-handlers/search-reference-formulas-handler.ts` — NEW
- `apps/ai/agents/react/tool-handlers/revise-formula-handler.ts` — NEW
- `apps/ai/agents/react/tool-handlers/get-formula-with-comments-handler.ts` — NEW
- `apps/ai/agents/react/tool-definitions.ts` — Added 4 new tool declarations (9 total)
- `apps/ai/agents/react/react-system-prompt.ts` — NPD domain knowledge + formula tool selection
- `apps/ai/agents/react/react-agent-service.ts` — 4 new handler imports + TOOL_HANDLER_MAP entries + max_iterations 8
- `apps/ai/server/routers/formula-comments.ts` — NEW (tRPC router)
- `prisma/schema.prisma` — FormulaComment model + Formula field additions

---

## [2026-03-30] Performance: AI system audit — embedding cache, payload projection, HITL wiring

### Summary
Full-stack AI system audit identifying 6 performance bottlenecks and 2 HITL gaps.
Implemented 3 quick wins and 1 HITL fix.

### Audit Findings
- **Stack**: Gemini 3.1 Pro + LangChain/LangGraph + Qdrant (768-dim) + MongoDB
- **Agents**: ReactAgentService (primary), LangGraph agent, Sales/RnD agent
- **RAG**: Hybrid search (exact + fuzzy + semantic + metadata), dynamic chunking
- **HITL**: Feedback UI complete, tRPC routers mounted, but 2/3 API routes missing feedback endpoints

### Quick Win #1: LRU Embedding Cache (est. ~40% latency reduction on cache hits)
- Added `EmbeddingLRUCache` class to `universal-embedding-service.ts`
- 500-entry LRU eviction, normalised key (lowercase+trim)
- Cache-aware `createEmbedding()` and `createEmbeddings()` — only uncached texts hit the API
- Observability: `get_cache_stats()` returns size, hits, misses, hit_rate
- Configurable via `EMBEDDING_CACHE_MAX_SIZE` env var

### Quick Win #2: Qdrant Payload Field Projection (est. ~10-20% bandwidth reduction)
- `qdrant-search-handler.ts` now uses `withPayload: { include: [...] }` instead of `true`
- Only 13 field-name variants fetched (covers the 8 logical fields used by `format_result()`)
- Updated `QdrantSearchOptions.withPayload` type to accept `{ include: string[] }`

### Quick Win #3: Singleton Embedding Service (eliminates per-request instantiation)
- `createEmbeddingService()` now returns a module-level singleton
- Same instance (and its cache) shared across all callers
- `resetEmbeddingServiceSingleton()` for testing/config changes

### HITL Fix: Feedback PUT Endpoints on Missing Routes
- **`/api/ai/raw-materials-agent`** — Added PUT handler using existing `PreferenceLearningService`
- **`/api/ai/cosmetic-enhanced`** — Added PUT handler writing to `raw_materials_feedback` MongoDB collection
- Both follow the same contract as enhanced-chat: `{ userId, feedback: { type, score, messageId } }`

### Remaining Opportunities (not implemented)
- Enable streaming in API routes (SSE infrastructure exists but is disabled)
- Add HTTP Cache-Control headers for repeated identical requests
- Add Redis-backed embedding cache for cross-instance persistence
- Add rate-limit-aware retry/backoff in embedding service
- Add pre-response approval gates for destructive actions (currently feedback is retroactive only)

### Files Changed
- `apps/ai/services/embeddings/universal-embedding-service.ts` — LRU cache + singleton
- `apps/ai/agents/react/tool-handlers/qdrant-search-handler.ts` — Payload projection
- `apps/ai/services/vector/qdrant-service.ts` — Updated withPayload type
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — PUT feedback endpoint
- `apps/web/app/api/ai/cosmetic-enhanced/route.ts` — PUT feedback endpoint

---

## [2026-03-30] Feature: CAS Number backfill + display in products/ingredients tables

### Summary
- **Phase 1**: 647 ingredients matched from MySkin collection by `inci_name` (instant, no AI cost)
- **Phase 2**: 30,532 ingredients processed via Gemini AI (gemini-2.5-flash) to look up CAS numbers from EU CosIng + PubChem
- AI also flags non-ingredient items (packaging, finished products, generic labels) with `is_ingredient=false`
- CAS No. column added to `/products` and `/ingredients` tables
- CAS numbers searchable in the search bar
- CAS shown in ingredient detail dialog

### Script: `scripts/backfill-cas-numbers.ts`
- Connects to MongoDB `rnd_ai.raw_materials_console` (31,179 docs)
- Phase 1: Pre-fills CAS from `raw_materials_myskin` by inci_name match (free, no API calls)
- Phase 2: Batches of 20 → Gemini AI prompt asking for CAS from EU CosIng/PubChem → writes `cas_no`, `cas_source`, `cas_confidence`, `is_ingredient` to each doc
- Supports `--dry-run` and `--skip-existing` flags
- Run: `npx tsx scripts/backfill-cas-numbers.ts`

### Backend Changes
- `apps/ai/server/routers/products.ts` — `build_cas_no_map()` helper for runtime MySkin fallback, `cas_no` in list/getById response, cas_no in search filter

### Frontend Changes
- `apps/web/app/products/page.tsx` — CAS No. column (monospace), search placeholder updated
- `apps/web/app/ingredients/page.tsx` — CAS No. column, detail dialog field, search placeholder updated

### Data Flow (priority order)
1. `raw_materials_console.cas_no` (backfilled by script) — primary
2. `raw_materials_myskin.inci_name` match → `cas_no` — runtime fallback
3. Empty (`"-"`) if no match found

---

## [2026-03-30] Fix: AI chat failures — model upgrade to Gemini 3.1 Pro + production logging

### Root Cause
- `removeConsole: true` in next.config.js stripped ALL logging in production — AI errors silently swallowed
- Default model `gemini-3-flash-preview` intermittently failing in ReAct loop's 2nd iteration
- All fallback paths used same broken model → cascade failure → empty response → "Sorry, I could not process your request"
- `Failed to find Server Action "x"` errors from stale Next.js build

### Fixes Applied
1. **next.config.js** — `removeConsole` now preserves `console.error` and `console.warn` in production
2. **All AI services** — Default model changed from `gemini-3-flash-preview` to `gemini-3.1-pro-preview` (verified working via API)
3. **docker-compose.yml** — Added `GEMINI_MODEL` env var for runtime model switching
4. **react-agent-service.ts** — Key request tracking logs upgraded to `console.warn` for production visibility
5. **All hardcoded `gemini-2.0-flash-exp` references** — Replaced with `process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview'`

### Files Changed
- `apps/web/next.config.js` — removeConsole: exclude error/warn
- `apps/ai/agents/react/react-agent-service.ts` — Model + logging
- `apps/ai/services/providers/gemini-service.ts` — Model
- `apps/ai/services/providers/gemini-tool-service.ts` — Model
- `apps/ai/services/providers/agent-api-service.ts` — Model
- `apps/ai/services/enhanced/enhanced-ai-service.ts` — Model
- `apps/ai/agents/raw-materials-ai/langgraph-agent.ts` — Model
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — Model
- `apps/web/app/api/ai/enhanced-chat/route.ts` — Model
- `apps/web/app/api/ai/cosmetic-enhanced/route.ts` — Model
- `docker-compose.yml` — GEMINI_MODEL env var

### Verification
- `gemini-3.1-pro-preview` confirmed available and responsive via Google AI API
- Zero remaining `gemini-3-flash-preview` or `gemini-2.0-flash-exp` hardcoded references in source

---

## [2026-03-30] Feature: CAS Number mapping from MySkin to products table

### Summary
- Added CAS No. column to `/products` and `/ingredients` tables
- CAS numbers are resolved at runtime by joining `raw_materials_console.inci_name` → `raw_materials_myskin.inci_name` → `cas_no`
- No data migration needed — uses batch lookup via `build_cas_no_map()` helper
- CAS numbers are searchable in the products search bar
- CAS No. shown in ingredient detail dialog

### Approach
- `raw_materials_console` never had `cas_no` — the field only exists in `raw_materials_myskin` (4,652 MySkin cosmetic ingredients)
- Join key: `inci_name` (INCI Name) — the international standard identifier for cosmetic ingredients
- Case-insensitive regex matching handles variations ("glycerin" vs "Glycerin")
- Materials without a matching INCI in MySkin show "-" (no CAS available)

### Files Changed
- `apps/ai/server/routers/products.ts` — Added `build_cas_no_map()` helper, CAS lookup in list/getById, cas_no in search filter
- `apps/web/app/products/page.tsx` — Added CAS No. table column, updated search placeholder
- `apps/web/app/ingredients/page.tsx` — Added CAS No. table column, detail dialog field, updated search placeholder

---

## [2026-03-27] Upgrade: Gemini 3 Flash Preview + Web Search Grounding

### Summary
- Upgraded all AI model references from gemini-2.0-flash-exp to gemini-3-flash-preview (Pro-level intelligence at Flash pricing)
- All model references now configurable via GEMINI_MODEL env var for easy switching
- Web search tool rewritten to use Gemini Google Search grounding (@google/genai SDK) — no external API keys needed
- Search model uses gemini-2.5-flash (stable, confirmed grounding support)

### Files Changed
- `apps/ai/agents/react/react-agent-service.ts` — Default model → gemini-3-flash-preview
- `apps/ai/services/providers/gemini-service.ts` — Default model → gemini-3-flash-preview
- `apps/ai/services/enhanced/enhanced-ai-service.ts` — Default model → gemini-3-flash-preview
- `apps/web/app/api/ai/cosmetic-enhanced/route.ts` — Model → gemini-3-flash-preview
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — Model → gemini-3-flash-preview
- `apps/web/app/api/ai/enhanced-chat/route.ts` — Model → gemini-3-flash-preview
- `apps/ai/agents/react/tool-handlers/web-search-handler.ts` — Full rewrite: Gemini Google Search grounding

---

## [2026-03-27] Fix: Remove all OpenAI/Pinecone dependencies — Gemini + Qdrant everywhere

### Summary
- All 3 AI API routes now use Gemini + Qdrant exclusively (zero OpenAI/Pinecone dependency)
- cosmetic-enhanced: ReAct agent as primary path, GeminiService fallback (was OpenAI GPT-4 + Pinecone)
- raw-materials-agent: Removed PINECONE_API_KEY guard, search uses Qdrant directly
- enhanced-chat: Same Pinecone removal, Qdrant-based search
- EnhancedAIService: Default model changed from gpt-4 to gemini-2.0-flash-exp
- ReAct system prompt: Routes all qdrant_search to raw_materials_myskin (only indexed collection)
- All health checks pass: toolService, searchService, mlService, geminiAI, knowledgeService, etc.

### Verification
- POST /api/ai/raw-materials-agent → success=true, type=react-agent
- POST /api/ai/enhanced-chat → success=true, type=react-agent
- POST /api/ai/cosmetic-enhanced → success=true, type=react-agent
- All GET ?action=health → all services true
- Container: healthy

### Files Changed
- `apps/web/app/api/ai/cosmetic-enhanced/route.ts` — Gemini+Qdrant, ReAct primary path
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — Remove Pinecone guard
- `apps/web/app/api/ai/enhanced-chat/route.ts` — Remove Pinecone guard
- `apps/ai/services/enhanced/enhanced-ai-service.ts` — Default model → gemini-2.0-flash-exp
- `apps/ai/agents/react/react-system-prompt.ts` — Route all search to myskin collection

---

## [2026-03-27] Fix: UI consistency — all light mode, black text, no CSS variable issues

### Summary
- Fixed CSS variable color references that Tailwind couldn't resolve (broke opacity modifiers)
- Converted ALL components from CSS variable references to direct Tailwind gray-scale colors
- Switched sidebar from dark (#1b1b1b) to light white with gray-200 borders
- All text now uses explicit gray-900 (black) for primary, gray-500 for secondary
- Removed all custom CSS color tokens from tailwind.config.ts (sidebar, primary, etc.)
- globals.css simplified to just --background/#ffffff and --foreground/#111111
- Body background: #f8f9fa (light gray), all cards: bg-white

### Root Cause
- Tailwind CSS variables (e.g., `bg-primary/90`) require colors in RGB/HSL format without wrappers
- Hex values in CSS variables break Tailwind's opacity modifier, causing invisible/wrong colors
- Fix: replaced all `text-foreground`, `bg-muted`, `border-border` etc. with `text-gray-900`, `bg-gray-50`, `border-gray-200`

### Files Changed (37 files — all re-touched)
- All `components/ui/*.tsx` — direct gray colors, white bg, gray borders
- `navigation.tsx`, `admin-navigation.tsx` — white sidebar, gray-200 border
- `globals.css` — simplified, no custom tokens
- `tailwind.config.ts` — removed sidebar/primary/secondary/etc. color tokens
- All AI components — gray-900 text, gray-50 backgrounds
- All pages — gray-900 headings, gray-500 descriptions

---

## [2026-03-27] Deploy: Full stack deployment — MySkin + UI redesign live on production

### Summary
- Rebuilt and deployed web container with all MySkin search tools + Cloudflare UI redesign
- Qdrant collection `raw_materials_myskin`: 4,652 vectors (3072-dim, gemini-embedding-001), status green
- E2E verified: login API, AI chat with MySkin semantic search (hyaluronic acid query returned 5 results)
- All 35 UI component files committed and deployed (Cloudflare-inspired dark sidebar, compact spacing)

### Verification Results
- Login: 200 OK, returns admin user
- AI Chat (ReAct agent): qdrant_search → raw_materials_myskin → 5 HA variants (scores 70.7-71.6%)
- Qdrant: green status, 4652 points, optimizer OK, HNSW indexing active

---

## [2026-03-27] Feature: MySkin Search Tools — 4 AI chatbot tools for 4,652 cosmetic ingredients

### Summary
- Added 4 MySkin search tools to the raw materials AI agent:
  1. `search_myskin_materials` — Hybrid text+semantic search across MySkin database
  2. `get_myskin_material_detail` — Full material profile lookup with related materials
  3. `browse_myskin_categories` — Category/supplier/cost/usage filtering with aggregation
  4. `compare_myskin_materials` — Side-by-side comparison of 2-5 materials
- Tools registered in all 3 agent entry points (agent.ts, langgraph-agent.ts, enhanced-raw-materials-agent.ts)
- ReAct agent updated: `raw_materials_myskin` added to Qdrant collection enum + system prompt
- Qdrant config: new `raw_materials_myskin` collection schema (768-dim Cosine, MySkin-specific payload indexes)
- RAG service: `rawMaterialsMySkinAI` service name → `raw_materials_myskin` collection mapping
- Indexing script: MySkin target added to INDEX_TARGETS for Qdrant vector indexing

### Chain of Thought
- User query → POST /api/ai/raw-materials-agent
- ReAct agent (primary): Gemini decides tools → executes up to 5 iterations → final response
- Fallback: GeminiToolService with function calling via tool registry
- MySkin tools accessible from both paths:
  - ReAct: via qdrant_search (collection=raw_materials_myskin) + mongo_query (collection=raw_materials_myskin)
  - GeminiToolService: via registered tool definitions (search_myskin_materials, etc.)
- Human-in-the-loop: Feedback recording only (PreferenceLearningService) — no approval gates

### Files Changed
- `apps/ai/agents/raw-materials-ai/tools/myskin-search-tools.ts` — CREATE: 4 tools + exports
- `apps/ai/config/qdrant-config.ts` — MODIFY: Add raw_materials_myskin collection + search defaults
- `apps/ai/scripts/index-qdrant.ts` — MODIFY: Add MySkin index target + RagServiceName
- `apps/ai/agents/raw-materials-ai/agent.ts` — MODIFY: Import + register MySkin tools + system prompt
- `apps/ai/agents/raw-materials-ai/langgraph-agent.ts` — MODIFY: Import + register + state schema
- `apps/ai/agents/raw-materials-ai/enhanced-raw-materials-agent.ts` — MODIFY: Import MySkin tools
- `apps/ai/agents/react/tool-definitions.ts` — MODIFY: Add raw_materials_myskin to qdrant_search enum
- `apps/ai/agents/react/react-system-prompt.ts` — MODIFY: Add MySkin routing in phrase table
- `apps/ai/services/rag/qdrant-rag-service.ts` — MODIFY: Add rawMaterialsMySkinAI service mapping

---

## [2026-03-27] Redesign: Cloudflare-inspired UI overhaul across entire frontend

### Summary
- Complete UI redesign to match Cloudflare dashboard aesthetic: dark sidebar, compact spacing, small text, flat design
- Switched font from Noto Sans Thai to Inter (Google Fonts) for clean, professional appearance
- Added comprehensive CSS design tokens (CSS variables) for colors, spacing, sidebar theme
- Reduced all text sizes: body 13px, headers proportionally smaller, badges 10-11px
- Dark charcoal sidebar (#1b1b1b) with orange brand accent, replacing white/green sidebar
- Flat card design with subtle 1px borders, no gradients on metric cards
- ChatGPT-style AI chat interface: full-width messages, no bubbles, clean avatar layout
- Cloudflare-style data tables: compact rows, uppercase headers, subtle borders
- Compact form inputs (h-8), buttons (h-8/h-7), and badges (rounded-md, tiny padding)
- Consistent design language across all 40+ component files

### Design Tokens Added (globals.css)
- --sidebar-bg, --sidebar-fg, --sidebar-muted, --sidebar-accent, --sidebar-border
- --primary (#2563eb), --muted (#f4f5f6), --border (#e5e7eb)
- Custom scrollbar styling (6px, gray-300 thumb)
- Font smoothing (antialiased)

### Tailwind Config Changes
- Added custom fontSize scale: 2xs (10px), xs (11px), sm (13px), base (14px)
- Added sidebar color palette with CSS variable references
- Added semantic color tokens: primary, secondary, destructive, muted, accent, card, popover
- Reduced border-radius: lg=0.5rem, md=0.375rem, sm=0.25rem
- Subtler box-shadow presets

### Files Changed (37 files)
- `apps/web/app/globals.css` — Complete CSS variables overhaul + scrollbar + font smoothing
- `apps/web/tailwind.config.ts` — New color palette, fontSize scale, border-radius, shadows
- `apps/web/app/layout.tsx` — Noto Sans Thai → Inter font
- `apps/web/components/ui/button.tsx` — Compact sizing (h-8/h-7), gap-1.5, rounded-md
- `apps/web/components/ui/card.tsx` — Flat design, px-4 py-3, text-sm titles
- `apps/web/components/ui/input.tsx` — h-8, px-2.5, rounded-md
- `apps/web/components/ui/badge.tsx` — px-1.5 py-0.5, text-2xs, rounded-md, pastel variants
- `apps/web/components/ui/table.tsx` — Compact h-8 headers, uppercase, tracking-wider
- `apps/web/components/ui/textarea.tsx` — min-h-[72px], rounded-md
- `apps/web/components/ui/label.tsx` — text-xs, text-muted-foreground
- `apps/web/components/ui/progress.tsx` — h-1.5 (thinner)
- `apps/web/components/ui/tabs.tsx` — Cloudflare underline tabs (border-b-2 on active)
- `apps/web/components/ui/alert.tsx` — Compact padding, text-xs description
- `apps/web/components/ui/separator.tsx` — h-px (thinner)
- `apps/web/components/ui/error-display.tsx` — Compact, text-xs
- `apps/web/components/ui/status-badge.tsx` — Pastel colors, outline variant
- `apps/web/components/navigation.tsx` — Dark sidebar, orange brand mark, compact nav items
- `apps/web/components/admin-navigation.tsx` — Dark sidebar, red admin accent
- `apps/web/app/page.tsx` — Clean dashboard with icon-in-box metric cards
- `apps/web/app/login/page.tsx` — Minimal centered card, dark logo header
- `apps/web/app/ingredients/page.tsx` — Compact table, smaller headers, clean pagination
- `apps/web/app/formulas/page.tsx` — Compact table, clean status badges
- `apps/web/components/ai/ai_chat_message.tsx` — ChatGPT-style full-width, no bubbles
- `apps/web/components/ai/ai_chat_input.tsx` — ArrowUp send button, compact textarea
- `apps/web/components/ai/ai_chat_header.tsx` — Compact py-2.5, text-sm
- `apps/web/components/ai/ai_page_header.tsx` — text-sm title, text-2xs description
- `apps/web/components/ai/ai_empty_state.tsx` — Minimal, muted colors
- `apps/web/components/ai/ai_loading_indicator.tsx` — w-1.5 dots, subtle animation
- `apps/web/components/ai/ai_chat_container.tsx` — Clean border, border-t on input
- `apps/web/components/ai/ai_chat_messages_area.tsx` — divide-y message separation
- `apps/web/components/ai/ai_chat_input_area.tsx` — Clean composition
- `apps/web/components/ai/ai_feedback_buttons.tsx` — text-2xs, h-5 buttons
- `apps/web/components/ai/ai_features_grid.tsx` — p-3, text-xs titles
- `apps/web/components/ai/ai_auth_guard.tsx` — Minimal centered layout

### No New TypeScript Errors
- All 43 pre-existing errors remain unchanged (cosmetic services, langgraph, calculations)
- Zero new errors introduced by this redesign

---

## [2026-03-27] Task 1: Add MySkin Qdrant collection config

### Summary
- Added `raw_materials_myskin` collection schema to `QDRANT_COLLECTIONS` with MySkin-specific payload indexes (category, cas_no, usage_min_pct, usage_max_pct)
- Added `raw_materials_myskin` search defaults to `QDRANT_SEARCH_DEFAULTS` (top_k=5, score_threshold=0.7, ef=128)
- Updated file header comment in qdrant-config.ts to document the new collection
- Extended `RagServiceName` type in index-qdrant.ts with `'rawMaterialsMySkinAI'`
- Added `MySkin Raw Materials` index target to `INDEX_TARGETS` array (rnd_ai.raw_materials_myskin → Qdrant raw_materials_myskin)

### Files Changed
- `apps/ai/config/qdrant-config.ts` — new collection + search defaults + header comment
- `apps/ai/scripts/index-qdrant.ts` — RagServiceName type + INDEX_TARGETS entry

---

## [2026-03-27] Feature: Add Prisma ORM v6.19 with MongoDB schema (20 models, 30+ indexes)

### Summary
- Added Prisma v6.19 with MongoDB provider — Prisma v7 does NOT support MongoDB yet
- Schema covers all 20 collections with relations, enums, embedded types, indexes
- Models: Account, Session, User, Organization, RawMaterial, Product, StockEntry,
  Formula, Order, CreditTransaction, ProductLog, UserLog, Conversation, Feedback,
  AiResponse, PriceCalculation
- Pushed schema to DO MongoDB — all collections and indexes created
- Prisma client singleton in shared-database package (imports from @prisma/client)
- Docker build verified — copies .prisma + @prisma to runner stage

### Issues Resolved
- Prisma 7 `prisma-client` generator outputs .ts files — Next.js 14 can't transpile node_modules .ts
- Prisma 7 engine type "client" requires adapter/accelerateUrl — no MongoDB adapter exists yet
- Solution: Downgraded to Prisma v6.19 (latest v6, full MongoDB support, prisma-client-js generator)
- Fixed import path: `@prisma/client` instead of relative `../../../../generated/prisma`
- Fixed Dockerfile: copy `node_modules/.prisma` + `node_modules/@prisma` instead of `generated/`

### Files Changed
- `prisma/schema.prisma` — Full MongoDB schema with `url = env("DATABASE_URL")` in datasource
- `prisma.config.ts` — Prisma config (v6 compatible)
- `packages/shared-database/src/prisma/client.ts` — Singleton client, imports from @prisma/client
- `packages/shared-database/src/index.ts` — Export prisma client
- `apps/web/Dockerfile` — prisma generate + copy .prisma/@prisma to runner stage
- `docker-compose.yml` — Added DATABASE_URL env var
- `.env.production` — Added DATABASE_URL template

---

## [2026-03-27] Deploy: R&D AI Management live on DigitalOcean Droplet

### Summary
- Created droplet `rnd-ai-droplet` (2vCPU/4GB, sgp1, Ubuntu 24.04) — IP: 165.245.181.97
- Created managed MongoDB `rnd-ai-mongodb` (MongoDB 8, sgp1, 1 node)
- Firewall configured: SSH(22), HTTP(80), HTTPS(443), App(3000)
- Fixed Dockerfile: removed non-existent `apps/web/node_modules` COPY (npm workspaces hoist to root)
- Fixed Qdrant healthcheck: replaced wget with bash /dev/tcp probe (Qdrant image has no wget/curl)
- App is live at http://165.245.181.97:3000
- Qdrant collections empty — ready for data indexing

### Infrastructure
- Droplet ID: 561184147 | DB ID: 28d32669-76af-4d48-aff8-063d6f9902f6
- Both assigned to `organicsai` project
- DB trusted sources: droplet + local dev IP

---

## [2026-03-27] Fix: Final Pinecone→Qdrant migration cleanup — zero migration TS errors

### Summary
- Fixed `enhanced-chat/route.ts` and `raw-materials-agent/route.ts`: snake_case alignment with ReactAgent interfaces
  - `toolCalls` → `tool_calls`, `processingTime` → `processing_time`
  - `userId` → `user_id`, `sessionId` → `session_id`, `conversationHistory` → `conversation_history`
- Fixed `ai-chat.tsx` and `raw-materials-chat.tsx`: redirected deleted `pinecone-client` import → `qdrant-rag-service`
- All migration-related TypeScript errors now resolved. Remaining 43 errors (web app) are pre-existing (langgraph API, cosmetic services types, calculations router).

### Files Changed
- `apps/web/app/api/ai/enhanced-chat/route.ts` — `reactResult.toolCalls` → `reactResult.tool_calls`, `reactResult.processingTime` → `reactResult.processing_time`
- `apps/ai/components/chat/ai-chat.tsx` — `PineconeClientService` import → `QdrantRAGService as PineconeClientService`
- `apps/ai/components/chat/raw-materials-chat.tsx` — same import redirect

---

## [2026-03-27] Refactor: Rename pineconeIndex → qdrant_collection across agent configs

### Summary
- Eliminated all remaining Pinecone field-name references in the agent layer.
- Four files updated: index-config.ts, agent-manager.ts, collection-router.ts, agent-system.ts.

### Planning / Approach
- Read CHANGELOG.md to understand full migration history (Tasks 1-19 + cleanup).
- Read qdrant-rag-service.ts to confirm QdrantRAGService constructor signature:
  `(service_name?, config_override?, custom_embedding_service?)`.
- Read qdrant-config.ts to confirm four valid Qdrant collection names:
  `raw_materials_console`, `raw_materials_fda`, `raw_materials_stock`, `sales_rnd`.
- Applied minimal targeted edits; no file rewritten from scratch.

### Files Changed

#### apps/ai/rag/indices/index-config.ts — MODIFIED
- Interface `RAGIndexConfig`: `pineconeIndex: string` → `qdrant_collection: string` with JSDoc.
- 8 config objects updated with correct Qdrant collection targets:
  - `raw-materials-db` → `raw_materials_stock` (source: raw_materials_real_stock)
  - `formulations-db`  → `raw_materials_console`
  - `regulations-db`   → `raw_materials_fda`
  - `market-research-db` → `sales_rnd`
  - `research-db`      → `raw_materials_fda`
  - `product-docs-db`  → `raw_materials_console`
  - `suppliers-db`     → `raw_materials_console`
  - `safety-db`        → `raw_materials_fda`

#### apps/ai/agents/agent-manager.ts — MODIFIED
- Import: `PineconeRAGService` → `QdrantRAGService` from `qdrant-rag-service`.
- `ragServices` Map type: `Map<string, PineconeRAGService>` → `Map<string, QdrantRAGService>`.
- `getRAGService()`: `indexConfig.pineconeIndex` → `indexConfig.qdrant_collection`; replaced
  `new PineconeRAGService({index, namespace, ...})` stub with correct
  `new QdrantRAGService(serviceName, { collectionName, topK, ... })` call.
- Added `salesRndAI` routing for `market-data` category.
- `ragService.searchSimilar()` → `ragService.search_similar()` (snake_case).
- Added entry/exit console.log in `getRAGService()`.

#### apps/ai/utils/collection-router.ts — MODIFIED
- All `qdrant_collections` values updated from old namespace strings (`'in_stock'`, `'all_fda'`)
  to actual Qdrant collection names (`'raw_materials_stock'`, `'raw_materials_fda'`).
- Header comment updated to reference correct collection names.

#### apps/ai/agents/core/agent-system.ts — MODIFIED
- Header comment: Removed stale "TODO: Implement full agent system without Pinecone".
- `searchVectorDatabase()` stub: updated comment to reference `QdrantRAGService.search_similar()`.
- `getVectorIndex()` stub: updated return shape to Qdrant API (`get_index_stats` / `pointsCount`).

### Root Cause
After the ChromaDB → Qdrant migration (Tasks 1-19), agent-layer files still used `pineconeIndex`
as a field name and old Pinecone namespace strings as values. This caused a semantic mismatch:
the field held Qdrant collection names but was named after the old system, making the code
misleading and prone to breaking if anyone followed the field name literally.

---

## [2026-03-27] cleanup: Remove legacy Pinecone scripts and update source types to Qdrant

### Summary
- Deleted 6 legacy Pinecone migration/indexing scripts that used `@pinecone-database/pinecone` directly
- Deleted `apps/ai/lib/services/embedding.ts` (Pinecone-backed EmbeddingService, no active importers)
- Updated `source` type literal from `'pinecone'` to `'qdrant'` in `HybridSearchResult` and `UnifiedSearchResult` interfaces in the client wrappers
- Renamed `pinecone_namespaces` field to `qdrant_collections` throughout `collection-router.ts` (interface + all return sites); values updated to real Qdrant collection names (`raw_materials_stock`, `raw_materials_fda`)
- Updated consumer `unified-search-service.ts` to use `routing.qdrant_collections`; local var `namespace` -> `qdrant_collection`
- Updated JSDoc comment in `dynamic-chunking-service.ts` (`chunks_to_documents`) from "Pinecone" to "Qdrant"

### Root Cause / Context
After the Qdrant migration (Tasks 1-4, 18-19), several script files and type literals still referenced Pinecone. This was dead code and misleading naming that would confuse future contributors and cause TypeScript type errors if a Qdrant-sourced result is passed to a consumer expecting `source: 'mongodb' | 'pinecone'`.

### Files Deleted (git rm)
- `apps/ai/scripts/migrate-unified-collections.ts`
- `apps/ai/scripts/migrate-unified-collections-ultra-fast.ts`
- `apps/ai/scripts/verify-migration.ts`
- `apps/ai/scripts/create-sales-ai-index.js`
- `apps/ai/scripts/migrate-to-dynamic-chunking.ts`
- `apps/ai/scripts/index-sample-data.ts`
- `apps/ai/lib/services/embedding.ts`

### Files Modified
- `apps/ai/services/rag/hybrid-search-client.ts` — `source: 'mongodb' | 'pinecone'` -> `'qdrant'`
- `apps/ai/services/rag/unified-search-client.ts` — Same
- `apps/ai/utils/collection-router.ts` — Interface + all return sites renamed `pinecone_namespaces` -> `qdrant_collections`; values mapped to real Qdrant collection names
- `apps/ai/services/rag/unified-search-service.ts` — Updated to use `routing.qdrant_collections`; local var renamed `namespace` -> `qdrant_collection`
- `apps/ai/services/rag/dynamic-chunking-service.ts` — JSDoc updated at `chunks_to_documents`

### Not Deleted
- `apps/web/lib/services/embedding.ts` — Still imported by `apps/web/app/api/ai-chat/route.ts` and `apps/web/app/api/index-data/route.ts`; left in place

---

## [2026-03-27] fix: Update web RAG routes from Pinecone to Qdrant env checks

### Summary
- Replaced all `PINECONE_API_KEY` env guards in web RAG API routes with `QDRANT_URL` checks.
- Fixed `searchRawMaterials/route.ts` calling `ragService.searchSimilar` (camelCase) to `ragService.search_similar` (snake_case) to match the actual `QdrantRAGService` method signature.
- Added `QDRANT_URL` / `QDRANT_API_KEY` entries to `apps/web/lib/env.ts` type union and `env` object.
- Kept `pinecone_api_key` in `env.ts` as `@deprecated` for backward compat.
- Added clear 503 guards in `index-data/route.ts` since its underlying `EmbeddingService` still uses Pinecone SDK directly — prevents a runtime crash on Qdrant deployments and surfaces a migration note.

### Root Cause
Routes in `apps/web/app/api/rag/` and `apps/web/app/api/index-data/` still checked `PINECONE_API_KEY` which was removed from the Qdrant-based deployment environment (Task 15). This meant hybrid-search and searchRawMaterials would silently return empty results on every call to the new droplet even though Qdrant was running.

Additionally `searchRawMaterials/route.ts` called `ragService.searchSimilar` (camelCase) which does not exist on `QdrantRAGService` — it would throw a `TypeError: ragService.searchSimilar is not a function` at runtime.

### Planning / Approach
1. Read CHANGELOG.md for migration context.
2. Read all 4 target files before any edits.
3. Read `qdrant-rag-service.ts` to confirm `PineconeRAGService` alias exists and method is `search_similar`.
4. Made minimal targeted edits — no full-file rewrites.
5. `index-data/route.ts` is NOT wired to Qdrant yet (its `EmbeddingService` uses Pinecone SDK); added 503 guard + TODO comment instead of silently crashing.

### Files Changed
- `apps/web/app/api/rag/hybrid-search/route.ts` — MODIFIED: `PINECONE_API_KEY` check -> `QDRANT_URL`, updated log messages
- `apps/web/app/api/rag/searchRawMaterials/route.ts` — MODIFIED: `PINECONE_API_KEY` check -> `QDRANT_URL`, `searchSimilar` -> `search_similar`, updated comments
- `apps/web/app/api/index-data/route.ts` — MODIFIED: Updated JSDoc, added 503 guard for POST/GET with migration note to `index:qdrant` script
- `apps/web/lib/env.ts` — MODIFIED: Added `QDRANT_URL`/`QDRANT_API_KEY` to `OptionalEnvVar` type, added `qdrant_url()` and `qdrant_api_key()` getters, marked `pinecone_api_key()` as `@deprecated`, updated `get_env_status()`

---

## [2026-03-27] Add ReAct Agent Tool Handlers (qdrant, mongo, formula, web, memory)

### Summary
- Created `apps/ai/agents/react/tool-handlers/` directory with 5 handler files that
  implement the ReAct agent tools declared in `tool-definitions.ts`.

### Planning / Approach
- Read `tool-definitions.ts` to understand the 5 tool contracts (ReactToolName union).
- Read `qdrant-service.ts` to confirm `get_qdrant_service()` singleton + `search()` API.
- Read `qdrant-config.ts` to confirm `get_search_defaults()` signature.
- Read `universal-embedding-service.ts` to confirm `createEmbeddingService()` factory.
- Reused `MongoClient` caching pattern (module-level Map keyed by URI) in both
  `mongo-query-handler` and `context-memory-handler` to avoid connection churn.
- All files: snake_case names, JSDoc on every function, console.log entry/exit.

### Files Created
- `apps/ai/agents/react/tool-handlers/qdrant-search-handler.ts` — NEW
  - Generates query embedding via `createEmbeddingService()`
  - Builds Qdrant `must` filter from `params.filters`
  - Calls `QdrantService.search()` with resolved top_k / score_threshold
  - Returns formatted string: score%, code, trade_name, INCI, supplier, cost, benefits, stock_status
- `apps/ai/agents/react/tool-handlers/mongo-query-handler.ts` — NEW
  - Dispatches find / findOne / aggregate / count operations
  - URI routing: database==='raw_materials' → RAW_MATERIALS_REAL_STOCK_MONGODB_URI, else MONGODB_URI
  - MongoClient cached per URI in module-level Map; max 20 results cap
  - Returns JSON stringified results with context header
- `apps/ai/agents/react/tool-handlers/formula-calc-handler.ts` — NEW
  - Pure math; no external deps
  - Operations: batch_cost, scale_formula, unit_convert, ingredient_percentage
  - Unit-to-grams map: g=1, kg=1000, lb=453.592, ton=1_000_000, oz=28.3495, ml=1, l=1000
  - Handles unit aliases (litre, gram, kilogram, ounce, etc.)
- `apps/ai/agents/react/tool-handlers/web-search-handler.ts` — NEW
  - Calls Google Custom Search API when GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CSE_ID set
  - Gracefully degrades to training-data fallback when credentials absent
  - Uses native fetch with AbortSignal.timeout(15s)
- `apps/ai/agents/react/tool-handlers/context-memory-handler.ts` — NEW
  - Queries rnd_ai.conversations + rnd_ai.raw_materials_conversations in parallel
  - Normalises 3 document shapes (messages[], conversation[], flat role+content)
  - Merges and sorts by timestamp; trims to lookback (default: 10, max: 50)
  - Returns [ROLE]: content formatted turns

---

## [2026-03-27] Tasks 18 & 19: Delete ChromaDB files + update RAG config for Qdrant

### Summary
- Removed 7 legacy ChromaDB/Pinecone source files via `git rm`
- Updated `apps/ai/config/rag-config.ts`: renamed `pineconeIndex` -> `collectionName`, updated values to Qdrant collection names, replaced Pinecone API config block with Qdrant equivalent

### Task 18 — Delete old ChromaDB files
Files removed with `git rm`:
- `apps/ai/services/vector/chroma-service.ts` — Low-level ChromaDB client (replaced by qdrant-service.ts)
- `apps/ai/services/rag/chroma-rag-service.ts` — High-level ChromaDB RAG service (replaced by qdrant-rag-service.ts)
- `apps/ai/services/rag/pinecone-service-stub.ts` — Pinecone stub (Qdrant now primary)
- `apps/ai/scripts/index-chromadb-simple.ts` — ChromaDB indexing script (replaced by index-qdrant.ts)
- `apps/ai/scripts/index-chromadb-resume.ts` — ChromaDB resume indexing script
- `apps/ai/scripts/index-chromadb-resume-fast.ts` — ChromaDB fast resume script
- `apps/ai/scripts/check-chromadb-count.ts` — ChromaDB count check script

### Task 19 — Update RAG config for Qdrant
- **Interface change**: `RAGServiceConfig.pineconeIndex: string` -> `collectionName: string`
- **Comment update**: JSDoc updated to reference Qdrant collection
- **Value updates**:
  - `rawMaterialsAllAI`: `'raw-materials-stock'` -> `'raw_materials_fda'`
  - `rawMaterialsAI`: `'raw-materials-stock'` -> `'raw_materials_console'`
  - `salesRndAI`: `'003-sales-ai'` -> `'sales_rnd'`
- **validateRAGConfig**: `config.pineconeIndex` -> `config.collectionName`
- **PINECONE_API_CONFIG** replaced with `QDRANT_API_CONFIG` reading `QDRANT_URL` / `QDRANT_API_KEY`
- **validateEnvironment**: checks `QDRANT_URL` instead of `PINECONE_API_KEY`
- **Descriptions**: All descriptions updated to reference Qdrant collections

### Root Cause / Context
ChromaDB was the original vector store; Tasks 1-4 migrated the codebase to Qdrant. These tasks complete the cleanup by removing dead code and aligning the central config with Qdrant collection names.

### Files Changed
- `apps/ai/services/vector/chroma-service.ts` — DELETED
- `apps/ai/services/rag/chroma-rag-service.ts` — DELETED
- `apps/ai/services/rag/pinecone-service-stub.ts` — DELETED
- `apps/ai/scripts/index-chromadb-simple.ts` — DELETED
- `apps/ai/scripts/index-chromadb-resume.ts` — DELETED
- `apps/ai/scripts/index-chromadb-resume-fast.ts` — DELETED
- `apps/ai/scripts/check-chromadb-count.ts` — DELETED
- `apps/ai/config/rag-config.ts` — MODIFIED: pineconeIndex -> collectionName, Qdrant collection names, Qdrant API config

---

## [2026-03-27] Task 13 (Update): Refactor index-qdrant.ts — Typed IndexTarget + URI Fallback + MONGODB_URI Guard

### Summary
- Refactored `apps/ai/scripts/index-qdrant.ts` to align with spec requirements.

### Details
- **Added `RagServiceName` type**: Explicit union `'rawMaterialsAllAI' | 'rawMaterialsAI' | 'salesRndAI'` for type safety.
- **Renamed `IndexTarget` fields**: `database`/`collection`/`mongodb_uri_env` → `mongo_db`/`mongo_collection`/`mongo_uri_env` for consistent snake_case and clarity.
- **MONGODB_URI validation**: Added upfront guard in `main()` — exits with code 1 if `MONGODB_URI` is unset.
- **URI fallback**: `index_target()` now resolves `process.env[target.mongo_uri_env] || process.env.MONGODB_URI` so target 2 (`raw_materials_real_stock`) uses `RAW_MATERIALS_REAL_STOCK_MONGODB_URI` when set, falling back to `MONGODB_URI`.
- **Updated log lines**: Progress logs reference `mongo_db.mongo_collection` with new field names.

### Files Changed
- `apps/ai/scripts/index-qdrant.ts` — UPDATED: Typed interface, MONGODB_URI guard, URI fallback

---

## [2026-03-27] Task 16: Update RAG Router to Use QdrantRAGService

### Summary
- Migrated `apps/ai/server/routers/rag.ts` from stub `PineconeRAGService` to `QdrantRAGService`.
- All tRPC procedure definitions remain unchanged; only service instantiation and method calls updated.

### Root Cause
`rag.ts` still imported `PineconeRAGService` from `@/ai/services/rag/pinecone-service-stub` and called
camelCase methods (`searchSimilar`, `upsertDocuments`, `getIndexStats`, `prepareRawMaterialDocument`).
QdrantRAGService exposes all these as snake_case methods per project convention.

### Changes Made
- **Import swap**: `PineconeRAGService` from `pinecone-service-stub` → `QdrantRAGService` from `../../services/rag/qdrant-rag-service`
- **Instantiation**: `new PineconeRAGService(...)` → `new QdrantRAGService(...)`
- **Method renames**: `searchSimilar` → `search_similar`, `upsertDocuments` → `upsert_documents`, `getIndexStats` → `get_index_stats`, `prepareRawMaterialDocument` → `prepare_raw_material_document`
- **Response shape fix**: `getIndexStats` procedure now reads `qdrantStats.pointsCount` (was `pineconeStats.totalRecordCount`) and returns renamed key `qdrantStats`
- **Logging**: Added `console.log` entry/exit/error calls to all procedure handlers per function-logging rule
- **Typing**: `keywordMatches` properly typed as `typeof vectorMatches` to avoid implicit `any[]`

### Files Changed
- `apps/ai/server/routers/rag.ts` — MODIFIED: PineconeRAGService stub → QdrantRAGService migration

---

## [2026-03-27] dev/droplet — Qdrant Migration + ReAct Agent Architecture

### Architecture Changes
- **ChromaDB → Qdrant**: Replaced ChromaDB with Qdrant for production-grade vector search
  - Cosine similarity with HNSW tuning (ef=128, m=16), typed payload indexes, on-disk payloads
- **MongoDB Atlas → DO Managed MongoDB**: Migrated to DigitalOcean managed database ($15/mo)
- **ReAct Agent**: Chain-of-thought reasoning replaces RAG-only pipeline
  - 5 tools: qdrant_search, mongo_query, formula_calculate, web_search, context_memory
  - Gemini function calling drives tool selection with multi-step reasoning
  - Graceful fallback to existing flow

### Infrastructure
- DO droplet provisioning script (doctl CLI), 4GB + 2GB swap
- docker-compose: Qdrant replaces ChromaDB, mem_limit on all services
- .env.production updated for Qdrant + DO MongoDB

### New Files
- apps/ai/services/vector/qdrant-service.ts
- apps/ai/services/rag/qdrant-rag-service.ts
- apps/ai/config/qdrant-config.ts
- apps/ai/agents/react/react-agent-service.ts
- apps/ai/agents/react/react-system-prompt.ts
- apps/ai/agents/react/tool-definitions.ts
- apps/ai/agents/react/tool-handlers/ (5 files)
- apps/ai/scripts/index-qdrant.ts
- scripts/provision-droplet.sh

### Deleted Files
- apps/ai/services/vector/chroma-service.ts
- apps/ai/services/rag/chroma-rag-service.ts
- apps/ai/services/rag/pinecone-service-stub.ts
- apps/ai/scripts/index-chromadb-simple.ts

---

## [2026-03-27] Refactor: Update auto-index service to target Qdrant

### Summary
- Migrated `apps/ai/server/services/auto-index-service.ts` from ChromaDB to Qdrant.
- Removed all ChromaDB/GoogleGenerativeAI embedding logic; delegated to `QdrantRAGService` and `get_qdrant_service`.

### Details
- **Import swap**: `getChromaService` replaced with `get_qdrant_service` and `QdrantRAGService`
- **Removed**: `GoogleGenerativeAI` import, `CHROMA_COLLECTION` constant, `EMBEDDING_MODEL` constant, `format_document()`, `generate_embedding()` helpers (now owned by `QdrantRAGService`)
- **`auto_index_material`**: Constructs `QdrantRAGService('rawMaterialsAI')`, calls `prepare_raw_material_document()` then `upsert_documents()` — identical public signature
- **`auto_delete_material`**: Uses `get_qdrant_service()` → `ensure_initialised()` → `delete('raw_materials_console', [rm_code])` — identical public signature
- Log format standardised to `[auto-index] <fn_name>: rm_code=<x>, start|success|error`

### Files Changed
- `apps/ai/server/services/auto-index-service.ts` — MODIFIED: ChromaDB -> Qdrant migration

---

## [2026-03-27] Tasks 14 & 15: Replace ChromaDB with Qdrant in docker-compose + env

### Summary
- Replaced ChromaDB service with Qdrant in `docker-compose.yml`
- Updated `.env.production` to use Qdrant and DO Managed MongoDB URIs

### Details — docker-compose.yml (Task 14)
- Removed `chromadb` service; added `qdrant` service (qdrant/qdrant:latest) with mem_limit 512m, healthcheck
- Added `mem_limit: 768m` to both `web` and `ai` services
- Updated `depends_on`: chromadb -> qdrant (ai uses `condition: service_healthy`)
- Replaced `VECTOR_DB_PROVIDER` + `CHROMA_URL` with `QDRANT_URL=http://qdrant:6333`
- Removed `PINECONE_API_KEY` from both services
- Removed old chromadb-data volume mount from ai service
- Renamed volume: `chromadb-data` -> `qdrant-data` (rnd-ai-qdrant-data)

### Details — .env.production (Task 15)
- Replaced MongoDB Atlas URIs with DO Managed MongoDB template URIs (tls=true&authSource=admin)
- Replaced `VECTOR_DB_PROVIDER` + `CHROMA_URL` with `QDRANT_URL` and `QDRANT_API_KEY`
- Added `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_CSE_ID` (optional, for ReAct web_search)
- Removed `PINECONE_API_KEY`

### Files Changed
- `docker-compose.yml` — Replaced ChromaDB with Qdrant, added mem_limit, updated depends_on/volumes
- `.env.production` — Qdrant + DO MongoDB URIs + Google Search keys

---

## [2026-03-27] Task 9: Update EnhancedHybridSearchService to Use Qdrant

### Summary
- Migrated `apps/ai/services/rag/enhanced-hybrid-search-service.ts` from ChromaDB to Qdrant.
- All search strategies (semantic, keyword, fuzzy, metadata, hybrid) remain functional.

### Details
- **Import swap**: `getChromaService / ChromaService` replaced with `get_qdrant_service / QdrantService`
- **Property rename**: `chromaService` -> `qdrantService`, `chromaCollectionName` -> `qdrantCollectionName`
- **Initialize**: Calls `qdrantService.ensure_initialised()` + `get_collection_info()` instead of ChromaDB `initialize()` / `getCollectionStats()`
- **Semantic search**: ChromaDB `query()` replaced with Qdrant `search()` using `QdrantSearchOptions` (topK, scoreThreshold, filter, ef, withPayload)
- **Filter conversion**: ChromaDB where-filter `{ category, userId: { $ne } }` converted to Qdrant `must` / `must_not` conditions
- **Result mapping**: `match.document` -> `match.payload.details || match.payload.content`, `match.metadata` -> `match.payload`, score used directly (Qdrant returns similarity score, not distance)
- MongoDB text search (keyword), metadata search, and fuzzy search strategies unchanged

### Files Changed
- `apps/ai/services/rag/enhanced-hybrid-search-service.ts` — MODIFIED: ChromaDB -> Qdrant migration

---

## [2026-03-27] Task 13: Create Qdrant Re-Indexing Script

### Summary
- Created `apps/ai/scripts/index-qdrant.ts` to read raw materials from MongoDB and index them into Qdrant.

### Details
- **Index targets**:
  1. `rnd_ai.raw_materials_console` → Qdrant `raw_materials_fda` (RAG service: rawMaterialsAllAI)
  2. `raw_materials.raw_materials_real_stock` → Qdrant `raw_materials_stock` (RAG service: rawMaterialsAI)
- **Flow**: CLI arg parsing → Qdrant collection provisioning → cursor-based streaming from MongoDB → `batch_process_documents()` per batch → progress tracking (rate, ETA) → verification via `get_collection_info`
- **CLI flags**: `--collection <name>` to index a specific collection, `--batch-size <n>` to override default (env BATCH_SIZE or 50)
- **Environment**: reads MONGODB_URI, RAW_MATERIALS_REAL_STOCK_MONGODB_URI, BATCH_SIZE, GEMINI_API_KEY, QDRANT_URL, QDRANT_API_KEY
- **Pattern**: matches `index-chromadb-simple.ts` — cursor streaming, batch processing, progress logging, final verification
- All functions use snake_case, have docstrings, and include console.log entry/exit logging

### Files Changed
- `apps/ai/scripts/index-qdrant.ts` — NEW: Qdrant re-indexing script (MongoDB → embeddings → Qdrant)

---

## [2026-03-27] Task 12: Wire ReactAgentService into API Routes

### Summary
- Wired `ReactAgentService` into both `raw-materials-agent` and `enhanced-chat` API routes.
- ReAct agent is attempted first; on success it returns immediately. On failure or non-success, the existing flow runs as fallback.

### Details
- Added `import { ReactAgentService } from '@/ai/agents/react/react-agent-service'` to both route files.
- Inserted a try/catch ReAct agent block in each POST handler before existing logic.
- Response includes `type: 'react-agent'`, tool call metadata, iteration count, and processing time.
- Existing code paths (enhanced response, Gemini service, ML learning) remain intact as fallback.

### Files Changed
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — MODIFIED: Added ReactAgentService import and ReAct agent path in POST handler
- `apps/web/app/api/ai/enhanced-chat/route.ts` — MODIFIED: Added ReactAgentService import and ReAct agent path in POST handler

---

## [2026-03-27] Task 8: Create ReactAgentService (Main Reasoning Loop)

### Summary
- Created `apps/ai/agents/react/react-agent-service.ts` — the main ReAct agent that uses Gemini function calling to implement a Thought -> Action -> Observation -> Answer loop.

### Details
- **Types exported**: `ReactAgentConfig`, `ReactAgentRequest`, `ReactAgentResponse`
- **ReactAgentConfig**: model (default 'gemini-2.0-flash'), temperature (0.7), max_tokens (9000), max_iterations (5)
- **Constructor**: accepts optional api_key and config_override; falls back to GEMINI_API_KEY / NEXT_PUBLIC_GEMINI_API_KEY env vars
- **execute(request)**: Main entry point — builds Gemini model with tool declarations from `get_react_tool_declarations()` and system prompt from `get_react_system_prompt()`, converts conversation history to Gemini Content format, runs the ReAct loop up to max_iterations
- **ReAct loop logic**: Each iteration calls `model.generateContent()`, checks for functionCall parts (execute tools, feed results back) or text parts (final answer, break). If max iterations hit, synthesises a partial answer from accumulated tool results.
- **_execute_tool(name, args, session_id)**: Routes tool calls through TOOL_HANDLER_MAP to handler functions: qdrant_search -> handle_qdrant_search, mongo_query -> handle_mongo_query, formula_calculate -> handle_formula_calculate, web_search -> handle_web_search, context_memory -> handle_context_memory
- **_build_contents(request)**: Converts conversation_history + current prompt to Gemini Content[] format
- **_synthesise_partial_answer(tool_calls)**: Best-effort markdown summary when max iterations exhausted
- All functions use snake_case, have docstrings, and include console.log entry/exit logging
- Follows existing patterns from `gemini-tool-service.ts` (GoogleGenerativeAI init, tool iteration loop, function response handling)

### Files Changed
- `apps/ai/agents/react/react-agent-service.ts` — NEW: ReAct reasoning loop with Gemini function calling

---

## [2026-03-27] Task 4: Create QdrantRAGService (High-Level RAG)

### Summary
- Created `apps/ai/services/rag/qdrant-rag-service.ts` as a drop-in replacement for `chroma-rag-service.ts`.
- Matches ChromaRAGService interface so consumers can switch with minimal changes.

### Details
- **Types exported**: `RawMaterialDocument`, `RAGSearchConfig`, `RAGSearchResult`, `RAGServicesConfig`
- **Service name -> collection mapping**: rawMaterialsAllAI -> raw_materials_fda, rawMaterialsAI -> raw_materials_console, salesRndAI -> sales_rnd
- **Constructor**: accepts service_name, optional config override, optional custom embedding service; resolves defaults from SERVICE_DEFAULTS map
- **Embedding**: `create_embeddings(texts)` delegates to UniversalEmbeddingService (lazy singleton)
- **Upsert**: `upsert_documents(docs)` embeds texts then upserts as QdrantPoints with `indexed_at` timestamp
- **Batch**: `batch_process_documents(materials, batch_size)` with inter-batch EMBEDDING_BATCH_DELAY_MS delay
- **Search**: `search_similar(query, options)` embeds query -> Qdrant search -> maps to RAGSearchResult
- **Format**: `search_and_format(query, options)` convenience wrapper for search + markdown formatting
- **Delete**: `delete_documents(ids)` delegates to QdrantService.delete
- **Stats**: `get_index_stats()` returns pointsCount/status/config via QdrantService.get_collection_info
- **Config**: `update_config(partial)` / `get_config()` for runtime config changes
- **Static helpers**: `prepare_raw_material_document(material)` and `format_search_results(results)`
- **Backward compat**: exports `PineconeRAGService` alias
- All functions use snake_case, have docstrings, and include console.log entry/exit logging

### Files Changed
- `apps/ai/services/rag/qdrant-rag-service.ts` — NEW: High-level Qdrant RAG service

---

## [2026-03-27] Tasks 5 & 7: ReAct Agent Tool Definitions and System Prompt

### Summary
- Created `apps/ai/agents/react/tool-definitions.ts` with Gemini function calling declarations for 5 tools.
- Created `apps/ai/agents/react/react-system-prompt.ts` with full ReAct system prompt.

### Details — Tool Definitions (Task 5)
- **qdrant_search**: Semantic similarity search across 4 Qdrant collections (raw_materials_console, raw_materials_fda, raw_materials_stock, sales_rnd). Params: query, collection (enum), top_k, score_threshold, filters.
- **mongo_query**: Read-only MongoDB queries against rnd_ai or raw_materials databases. Params: collection, database (enum), operation (enum: find/findOne/aggregate/count), filter, projection, sort, limit.
- **formula_calculate**: Batch cost, scaling, unit conversion, ingredient percentage. Params: operation (enum), ingredients (array of objects), batch_size, target_unit (enum), formula_id.
- **web_search**: External web search for regulatory/market info. Params: query, max_results.
- **context_memory**: Conversation history look-back. Params: session_id, lookback.
- Exported: `get_react_tool_declarations()` returning `GeminiFunctionDeclaration[]`, type `ReactToolName`.
- Declarations use plain-object format compatible with `@google/generative-ai` (STRING/NUMBER/OBJECT/ARRAY types), aligned with existing `gemini-tool-service.ts` patterns.

### Details — System Prompt (Task 7)
- 7 composable sections: persona, classification, tool selection guide, execution flow, synthesis, safety rules, domain context.
- **Intent classification**: 6 categories (EXACT_LOOKUP, SEMANTIC_SEARCH, CALCULATION, EXTERNAL_INFO, CONTEXTUAL, MULTI_STEP) with clear routing rules.
- **Tool selection guide**: Thai/English phrase-to-tool mapping table with key parameters.
- **ReAct loop**: Thought -> Action -> Observation -> Repeat, max 5 tool calls per query.
- **Safety rules**: Read-only only, max 20 results, no secret exposure, no hallucinated data, PII handling, prompt injection defense.
- **Domain context**: INCI terminology, data field descriptions, Thai cosmetic keyword dictionary, formulation context.
- Exported: `get_react_system_prompt()` returning assembled string.

### Files Changed
- `apps/ai/agents/react/tool-definitions.ts` — NEW: Gemini function declarations for 5 ReAct tools
- `apps/ai/agents/react/react-system-prompt.ts` — NEW: ReAct agent system prompt with 7 sections

---

## [2026-03-27] Task 3: Create QdrantService (Low-Level Vector Client)

### Summary
- Created `apps/ai/services/vector/qdrant-service.ts` as a drop-in replacement for `chroma-service.ts`.
- Singleton pattern (`get_qdrant_service()` / `reset_qdrant_service()`) mirrors ChromaService's architecture.
- Lazy initialisation via `ensure_initialised()` reads connection config from qdrant-config.

### Details
- **Types exported**: `QdrantPoint`, `QdrantSearchOptions`, `QdrantSearchResult`, `QdrantCollectionInfo`
- **Collection mgmt**: `ensure_collection(schema)` creates collection with HNSW config + payload indexes;
  `ensure_all_collections()` iterates all QDRANT_COLLECTIONS; `delete_collection(name)` drops a collection
- **Upsert**: Batched at UPSERT_BATCH_SIZE (100) with `wait: true` for durability
- **Search**: Merges caller options with per-collection QDRANT_SEARCH_DEFAULTS; supports pre-filter,
  scoreThreshold, HNSW ef override, and selective withPayload
- **Delete**: Accepts either string[] of IDs or a Qdrant filter object
- **Info**: `get_collection_info()` returns pointsCount/status/config; `health_check()` verifies connectivity;
  `scroll()` provides paginated point reads with optional filter and offset
- All functions use snake_case, have docstrings, and include console.log entry/exit logging
- Imports `QdrantClient` from `@qdrant/js-client-rest`, config from `../../config/qdrant-config`
- Uses same Logger + ErrorHandler patterns as chroma-service.ts

### Files Changed
- `apps/ai/services/vector/qdrant-service.ts` — NEW: Low-level Qdrant vector client with typed payloads

---

## [2026-03-27] Task 2: Create Qdrant Configuration

### Summary
- Created `apps/ai/config/qdrant-config.ts` with full collection schemas, HNSW tuning,
  connection settings, search defaults, and batch constants for Qdrant.

### Details
- 4 collections defined: `raw_materials_console`, `raw_materials_fda`, `raw_materials_stock`, `sales_rnd`
- All collections use vectorSize=768 (Gemini text-embedding-004), Cosine distance, HNSW m=16/efConstruct=128
- Shared payload indexes extracted to DRY constant (rm_code, trade_name, inci_name, supplier, source, stock_status, cost, indexed_at)
- Per-collection search defaults mirror rag-config.ts topK/threshold values with added Qdrant-specific `ef` param
- `get_qdrant_connection_config()` reads QDRANT_URL and QDRANT_API_KEY from env
- Batch constants: UPSERT_BATCH_SIZE=100, EMBEDDING_BATCH_DELAY_MS=1000
- All functions use snake_case, have docstrings, and include entry/exit console.log

### Files Changed
- `apps/ai/config/qdrant-config.ts` — NEW: Qdrant collection schemas and configuration

---

## [2026-03-27] Task 1: Replace ChromaDB with Qdrant client

### Dependencies
- Removed `chromadb` (1.8.1) from `apps/ai/package.json`
- Added `@qdrant/js-client-rest` (^1.12.0) to `apps/ai/package.json`
- Replaced chromadb-related npm scripts with qdrant equivalents in both root and apps/ai package.json
- Old scripts removed: `index:chromadb`, `index:chromadb:resume`, `index:chromadb:fast`, `check:chromadb`
- New scripts added: `index:qdrant`, `check:qdrant`

### Files Changed
- `package.json` (root) — Replaced chromadb workspace scripts with qdrant equivalents
- `apps/ai/package.json` — Swapped chromadb dep for @qdrant/js-client-rest, updated scripts

---

## [2026-03-27] dev/droplet — Full Codebase Audit + Droplet Deployment Setup

### Audit Findings

#### BLOCKERS FIXED
- **Auth middleware cookie mismatch**: `middleware.ts` checked `"auth_token"` but login/verify/logout all use `"rnd-ai-auth-session"`. Users were stuck in infinite login redirect. Fixed.
- **Missing `Dockerfile.ai`**: `docker-compose.yml` referenced it but file didn't exist. AI service couldn't start. Created.
- **Secrets baked into Docker images**: Server-side secrets (MONGODB_URI, API keys, ADMIN_PASSWORD) were embedded into image layers via ARG->ENV. Now only NEXT_PUBLIC_* build-time vars are embedded; secrets injected at runtime.

#### CRITICAL AI WIRING FIXES
- **Cosmetic-enhanced broken await chain** (`route.ts:307-317`): `.response` was accessed on a Promise object instead of the resolved value. Result was always `undefined`. Fixed with proper `await` then property access.
- **Cosmetic-enhanced zero timing** (`route.ts:473`): `Date.now() - Date.now()` always produced 0. Fixed to use captured `streamStartTime`.
- **Raw-materials-agent health check** (`route.ts:214-215`): Referenced `services.enhancedService` and `services.responseReranker` which don't exist in `initialize_services()` return. Removed phantom properties.

#### KNOWN ISSUES (Not fixed in this branch — require architectural decisions)
- **Dead LangGraph route**: `langgraph-route.ts` not named `route.ts`, never served by Next.js
- **Missing `/api/index-data/manage`**: Admin AI indexing page calls it but route doesn't exist (404)
- **AI Hub dead link**: `/ai/agents` page doesn't exist
- **AI Analytics page**: Entirely mock data, no real API integration
- **Shared-types orphaned**: Created during deduplication but zero consumers; full duplicate in `apps/ai/lib/types.ts`
- **Insecure auth**: Plain text password comparison, unsigned session cookie string "authenticated"
- **NEXT_PUBLIC_GEMINI_API_KEY as server fallback**: Used in `enhanced-chat` and `raw-materials-agent` routes
- **Dead imports**: `AgentFactory` in agent chat, `getEmbeddingService` in ai-chat, `GoogleGenerativeAI` in enhanced-chat
- **AI-chat simulated streaming**: Full response generated then chunked with setTimeout, not real streaming
- **MongoDB connection leak in index-data**: Client never closed after use
- **PreferenceLearningService inconsistent API**: Called with different schemas across routes

#### HITL Flow Status
- Shipping: STRONG (full confirmation modal)
- Calculation, Formulas, Orders, Credits: GOOD (confirm dialogs, role-based)
- Admin Vector Indexing: GOOD (batch controls)
- Admin AI Indexing: BROKEN (missing API route)
- Sales/Raw Materials AI Chat: PARTIAL (feedback buttons, no approval gate)
- AI Analytics: NONE (mock data)

### Deployment Changes
- Created `Dockerfile.ai` for AI backend service
- Upgraded all Dockerfiles from Node 18 (EOL) to Node 20
- Added missing workspace package.json copies to Docker deps stages (shared-utils, shared-database, apps/ai)
- Removed server-side secrets from Docker build-time ARGs (security fix)
- Created `.env.production` template for droplet deployment
- Created `scripts/deploy-droplet.sh` deployment automation script
- Fixed `apps/web/middleware.ts` cookie name to match auth system

### Files Changed
- `apps/web/middleware.ts` — Fixed cookie name from `auth_token` to `rnd-ai-auth-session`
- `apps/web/app/api/ai/cosmetic-enhanced/route.ts` — Fixed broken await chain + zero timing
- `apps/web/app/api/ai/raw-materials-agent/route.ts` — Fixed phantom health check properties
- `Dockerfile` — Node 20, removed secret baking, added missing package copies
- `apps/web/Dockerfile` — Node 20, removed secret baking, added missing package copies
- `Dockerfile.ai` — NEW: AI backend service Dockerfile
- `.env.production` — NEW: Production env template for droplet
- `scripts/deploy-droplet.sh` — NEW: Droplet deployment automation
- `CHANGELOG.md` — This file
