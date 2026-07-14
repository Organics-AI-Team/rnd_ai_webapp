# OODA Agent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed pipelines, overlapping agents, and hidden fallbacks with one typed, checkpointed Observe-Orient-Decide-Act graph that produces evidence-backed, validated tenant artifacts.

**Architecture:** A new dependency-isolated workspace owns LangGraph v1. The graph receives versioned business input plus a trusted runtime context, stores durable checkpoints by run/thread, and loops through observation, orientation, structured decision, governed action, and deterministic evaluation. Clarification and approval use LangGraph interrupts. Finalization emits one versioned output contract; the graph cannot switch to a legacy executor during a run.

**Tech Stack:** @langchain/langgraph 1.4.7, @langchain/core 1.2.2, @langchain/langgraph-checkpoint-mongodb 1.4.0, MongoDB driver 6.21.0, Zod 3.25.76, decimal.js 10.6.0, TypeScript 5.9, Vitest 4.1.10, Next.js Route Handlers.

## Global Constraints

- New code does not import legacy agent services; security context is never model-visible; checkpoints contain IDs and version pins but no secrets; every action uses ToolExecutor; interrupts are not caught; side effects are idempotent under node replay; final answers distinguish evidence, inference, and uncertainty; no chain-of-thought is stored or returned; iteration, time, token, and cost budgets are deterministic.

**Primary references:** LangGraph JavaScript persistence, interrupts, StateGraph, and MongoDBSaver documentation current for the pinned v1 packages.

---

## File Structure

- packages/ai-orchestration/src/contracts.ts and state.ts own versioned graph input/state/output.
- packages/ai-orchestration/src/nodes owns one focused implementation per OODA phase.
- packages/ai-orchestration/src/artifacts owns deterministic artifact schemas and validators.
- packages/ai-orchestration/src/checkpoint.ts and resume.ts own MongoDBSaver and interrupt resume.
- apps/ai/server/services/ai-gateway owns run creation, executor selection, jobs, events, and workers.
- apps/web/app/api/ai/runs owns authenticated HTTP ingress/events/resume.
- apps/web/hooks/use_agent_run.ts and apps/web/components/ai own typed client rendering.

### Task 1: Create a dependency-isolated orchestration workspace

**Files:**

- Create: packages/ai-orchestration/package.json
- Create: packages/ai-orchestration/tsconfig.json
- Create: packages/ai-orchestration/src/index.ts
- Create: packages/ai-orchestration/src/ports.ts
- Create: packages/ai-orchestration/src/version.ts
- Create: tests/orchestration/package-boundary.test.ts
- Modify: package.json
- Modify: package-lock.json

**Interfaces:**

- Consumes: shared AI contracts and injected control-plane ports.

- Produces: current LangGraph package that cannot import apps/ai legacy implementations.

**Failing test anchor:**

~~~ts
it("has no dependency on legacy agent implementations", () => {
  const violations = scan_workspace_imports("packages/ai-orchestration");
  expect(violations).toEqual([]);
});
~~~

**Implementation anchor:**

~~~ts
export interface OrchestrationPorts {
  readonly model: ModelGateway;
  readonly knowledge: KnowledgeGateway;
  readonly tools: ToolExecutor;
  readonly artifacts: ArtifactService;
  readonly runs: RunRepository;
  readonly approvals: ApprovalService;
  readonly usage: UsageService;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
~~~

- [ ] **Step 1:** Write a boundary test that walks packages/ai-orchestration imports and rejects paths under apps/ai/agents, apps/ai/services, apps/web, @langchain/langgraph/prebuilt legacy agents, or provider SDKs.
- [ ] **Step 2:** Run npm test -- tests/orchestration/package-boundary.test.ts.
- [ ] **Step 3:** Expected: FAIL because the workspace does not exist.
- [ ] **Step 4:** Create @rnd-ai/ai-orchestration as private, type=commonjs to match apps/ai during coexistence, exports=./src/index.ts, and scripts typecheck=tsc --noEmit and test=vitest run. The pinned LangGraph packages expose supported require builds as well as ESM builds.
- [ ] **Step 5:** Pin dependencies @langchain/langgraph=1.4.7, @langchain/core=1.2.2, @langchain/langgraph-checkpoint-mongodb=1.4.0, mongodb=6.21.0, zod=3.25.76, decimal.js=10.6.0, and @rnd-ai/shared-types=1.0.0.
- [ ] **Step 6:** Define ports for ModelGateway, KnowledgeGateway, ToolExecutor, ArtifactService, RunRepository, ApprovalService, UsageService, Clock, and IdGenerator. Each method receives TrustedRuntimeContext outside model input.
- [ ] **Step 7:** Export ORCHESTRATOR_VERSION="ooda-1.0.0" and reject an unknown version when resuming a pinned run.
- [ ] **Step 8:** Add typecheck:orchestration at the root and include it in root typecheck.
- [ ] **Step 9:** Run npm install, npm run typecheck:orchestration, and npm test -- tests/orchestration/package-boundary.test.ts.
- [ ] **Step 10:** Expected: PASS.
- [ ] **Step 11:** Commit: git add packages/ai-orchestration package.json package-lock.json tests/orchestration && git commit -m "feat: scaffold isolated OODA orchestration package"

### Task 2: Define versioned input, event, output, and graph state contracts

**Files:**

- Modify: packages/shared-types/src/ai/contracts.ts
- Create: packages/ai-orchestration/src/contracts.ts
- Create: packages/ai-orchestration/src/state.ts
- Create: packages/ai-orchestration/src/graph.ts
- Create: tests/orchestration/contracts.test.ts
- Create: tests/orchestration/graph-shape.test.ts

**Interfaces:**

- Consumes: AgentRunInputV1 and TrustedRuntimeContext.

- Produces: strict public contracts and typed StateGraph shell.

**Failing test anchor:**

~~~ts
it("rejects identity fields in public run input", () => {
  const result = agent_run_input_v1_schema.safeParse({
    ...valid_input,
    tenant_id: tenant_a,
  });
  expect(result.success).toBe(false);
});
~~~

**Implementation anchor:**

~~~ts
export const OODAState = Annotation.Root({
  run_id: Annotation<string>,
  tenant_id: Annotation<string>,
  phase: Annotation<OODAPhase>,
  iteration: Annotation<number>,
  observations: Annotation<ObservationV1[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  action_results: Annotation<ActionResultV1[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  decision: Annotation<DecisionV1 | null>,
  output: Annotation<AgentRunOutputV1 | null>,
  error: Annotation<RunErrorV1 | null>,
});
~~~

- [ ] **Step 1:** Write contract tests rejecting unknown fields, missing schema version, unsupported agent key, empty message, client identity/security fields, oversized attachment metadata, and unsupported output/event versions.
- [ ] **Step 2:** Write a graph-shape test asserting nodes ingress, observe, orient, decide, action_gate, act, evaluate, request_clarification, request_approval, finalize, and fail, plus only the allowed edges.
- [ ] **Step 3:** Run npm test -- tests/orchestration/contracts.test.ts tests/orchestration/graph-shape.test.ts.
- [ ] **Step 4:** Expected: FAIL.
- [ ] **Step 5:** Define strict AgentRunInputV1: schema_version="1", thread_id, agent_key, message, attachment_source_ids, response_preferences(language,detail), and idempotency_key. It contains no tenant/user/role/policy/model/tool/provider fields.
- [ ] **Step 6:** Define AgentRunEventV1 as a discriminated union: run.accepted, phase.changed, observation.added, action.started, action.completed, clarification.required, approval.required, artifact.updated, usage.updated, run.completed, run.failed. Every event has schema_version, event_id, run_id, sequence, occurred_at, and safe payload.
- [ ] **Step 7:** Define AgentRunOutputV1 with schema_version, run_id, status, answer, decision_summary, citations, artifacts, quality_dimensions, warnings, usage_summary, started_at, and completed_at. Decision summary is facts considered, evidence references, selected action rationale, validation results, and uncertainty; it excludes hidden reasoning tokens. quality_dimensions carries groundedness, evidence coverage, source quality/freshness, contradiction state, deterministic validation rate, completeness, and risk severity; it never exposes an arbitrary single confidence number.
- [ ] **Step 8:** Define RunErrorV1 with stable code, safe_message, retryable, correlation_id, and nullable partial_output. Keep provider error bodies, stack traces, prompts, evidence content, and secrets in redacted internal diagnostics only.
- [ ] **Step 9:** Define OODAState using Annotation.Root with replace channels for phase/decision/output/error and reducer channels for observations/action_results/events/warnings. Include run_id, thread_id, tenant_id, actor_profile_id, pinned versions, iteration, started_at, deadline_at, and budget counters; include no provider credentials or raw Clerk token.
- [ ] **Step 10:** Create a StateGraph shell with the exact nodes and START -> ingress. Stub nodes return typed partial state only for the failing graph-shape test, then wire the permitted edges without model logic.
- [ ] **Step 11:** Run npm test -- tests/orchestration/contracts.test.ts tests/orchestration/graph-shape.test.ts.
- [ ] **Step 12:** Expected: PASS.
- [ ] **Step 13:** Commit: git add packages/shared-types packages/ai-orchestration tests/orchestration && git commit -m "feat: define OODA run contracts and state"

### Task 3: Implement ingress, observation, orientation, and structured decisions

**Files:**

- Create: packages/ai-orchestration/src/nodes/ingress.ts
- Create: packages/ai-orchestration/src/nodes/observe.ts
- Create: packages/ai-orchestration/src/nodes/orient.ts
- Create: packages/ai-orchestration/src/nodes/decide.ts
- Create: packages/ai-orchestration/src/schemas/observation.ts
- Create: packages/ai-orchestration/src/schemas/orientation.ts
- Create: packages/ai-orchestration/src/schemas/decision.ts
- Create: tests/orchestration/reasoning-nodes.test.ts

**Interfaces:**

- Consumes: validated input, policy/deployment pins, prior action results, and evidence from ports.

- Produces: normalized observations, bounded orientation, and a strict DecisionV1.

**Failing test anchor:**

~~~ts
it("treats retrieved instructions as untrusted evidence", async () => {
  const state = await observe(initial_state, runtime_with_injected_document);
  expect(state.observations[0].trust).toBe("untrusted_content");
  const decision = await decide(await orient(state, runtime), runtime);
  expect(decision.selected_tool).not.toBe("platform.disable_policy");
});
~~~

**Implementation anchor:**

~~~ts
export const decision_v1_schema = z.object({
  kind: z.enum(["act", "clarify", "approve", "finalize", "fail"]),
  selected_tool: z.string().max(80).nullable(),
  tool_arguments: z.record(z.unknown()),
  rationale: z.string().max(600),
  expected_observation: z.string().max(400).nullable(),
  clarification_questions: z.array(z.string().max(300)).max(5),
  approval_reason: z.string().max(400).nullable(),
}).strict();
~~~

- [ ] **Step 1:** Write deterministic fake-model tests for fresh request, follow-up, missing requirements, conflicting evidence, unsupported request, tool proposal, final proposal, malformed structured output, and prompt injection in retrieved text.
- [ ] **Step 2:** Run npm test -- tests/orchestration/reasoning-nodes.test.ts.
- [ ] **Step 3:** Expected: FAIL.
- [ ] **Step 4:** In ingress, verify input version and the run/deployment/policy/prompt pins supplied by the gateway, initialize counters/deadline, and emit run.accepted. Do not load authorization from input.
- [ ] **Step 5:** Observe in parallel through trusted ports: current thread summary, requested attachment sources, platform knowledge, permitted tenant knowledge, relevant tenant resources, prior action results, and deterministic budget/time state. Normalize each observation with source type, source ID, content hash, retrieved_at, relevance, confidence, and scope.
- [ ] **Step 6:** Treat retrieved/user content as data. Mark instructions found inside evidence as untrusted and never concatenate them into the system policy section.
- [ ] **Step 7:** Orient with structured output containing task_type, user_goal, known_facts with citation IDs, assumptions, missing_information, constraints, candidate_actions, risk_flags, and completion_criteria. Cap candidate actions and text lengths in Zod.
- [ ] **Step 8:** Decide with DecisionV1 kind=act|clarify|approve|finalize|fail, selected_tool nullable, strict tool_arguments, safe rationale, expected_observation, approval_reason, and clarification_questions. Retry malformed structured output once through the allowed model adapter; then route fail with MODEL_OUTPUT_INVALID. Do not ask the model for or expose a scalar confidence score.
- [ ] **Step 9:** Run npm test -- tests/orchestration/reasoning-nodes.test.ts.
- [ ] **Step 10:** Expected: PASS.
- [ ] **Step 11:** Commit: git add packages/ai-orchestration tests/orchestration && git commit -m "feat: implement OODA observation orientation and decisions"

### Task 4: Add bounded specialist subgraphs

**Files:**

- Create: packages/ai-orchestration/src/subgraphs/subgraph-registry.ts
- Create: packages/ai-orchestration/src/subgraphs/raw-material-research.ts
- Create: packages/ai-orchestration/src/subgraphs/formulation.ts
- Create: packages/ai-orchestration/src/subgraphs/sales-rnd.ts
- Create: packages/ai-orchestration/src/schemas/specialist.ts
- Create: tests/orchestration/specialist-subgraphs.test.ts

**Interfaces:**

- Consumes: SpecialistRequestV1, the parent TrustedRuntimeContext, parent checkpointer, and the governed ports.
- Produces: SpecialistResultV1 observations/proposals that return to the parent OODA graph without committing side effects.

**Failing test anchor:**

~~~ts
it("inherits parent tenant policy and cannot commit a side effect", async () => {
  const result = await specialist_registry.invoke("formulation", specialist_request, runtime);
  expect(result.tenant_id).toBe(runtime.tenant.tenant_id);
  expect(result.proposals.every((proposal) => proposal.side_effect !== "commit")).toBe(true);
  expect(direct_write_repository.calls).toHaveLength(0);
});
~~~

**Implementation anchor:**

~~~ts
export interface SpecialistDefinition {
  readonly key: "raw_material_research" | "formulation" | "sales_rnd";
  readonly max_steps: number;
  readonly input_schema: z.ZodType<SpecialistRequestV1>;
  readonly output_schema: z.ZodType<SpecialistResultV1>;
  invoke(
    request: SpecialistRequestV1,
    runtime: OODARuntime,
  ): Promise<SpecialistResultV1>;
}
~~~

- [ ] **Step 1:** Write tests for registry allowlisting, inherited tenant/policy/run/checkpoint context, maximum specialist steps, no direct provider/tool/repository access, prompt injection, and concurrent read-only specialists.
- [ ] **Step 2:** Run npm test -- tests/orchestration/specialist-subgraphs.test.ts.
- [ ] **Step 3:** Expected: FAIL because the specialist registry does not exist.
- [ ] **Step 4:** Implement the three specialists as small StateGraphs that can gather domain observations and propose parent actions only. They receive the parent runtime object; their public schemas contain no tenant, actor, permission, provider, or credential field.
- [ ] **Step 5:** Route raw-material, formulation, and sales tasks through the registry from orient/decide. Permit parallel specialists only when every branch is read-only and the parent budget reserves all branch work before dispatch.
- [ ] **Step 6:** Make each specialist return normalized observations, proposed actions, completion criteria, evidence IDs, and uncertainty. The parent Decision node remains the only component that selects an action, and ToolExecutor remains the only executor.
- [ ] **Step 7:** Run npm test -- tests/orchestration/specialist-subgraphs.test.ts and npm test -- tests/orchestration/ooda-loop.test.ts.
- [ ] **Step 8:** Expected: PASS with no context override or specialist commit.
- [ ] **Step 9:** Commit: git add packages/ai-orchestration/src/subgraphs packages/ai-orchestration/src/schemas tests/orchestration && git commit -m "feat: add bounded OODA specialist subgraphs"

### Task 5: Implement deterministic action gates, actions, evaluation, and loop budgets

**Files:**

- Create: packages/ai-orchestration/src/nodes/action-gate.ts
- Create: packages/ai-orchestration/src/nodes/act.ts
- Create: packages/ai-orchestration/src/nodes/evaluate.ts
- Create: packages/ai-orchestration/src/nodes/fail.ts
- Create: packages/ai-orchestration/src/routing.ts
- Modify: packages/ai-orchestration/src/graph.ts
- Create: tests/orchestration/ooda-loop.test.ts

**Interfaces:**

- Consumes: DecisionV1, EffectiveAIPolicy, ToolExecutor, action result, and deterministic validators.

- Produces: bounded loop transitions and no unauthorised tool invocation.

**Failing test anchor:**

~~~ts
it("fails at the iteration budget without invoking a fallback", async () => {
  const result = await graph.invoke(state_at_iteration_limit, test_config);
  expect(result.error?.code).toBe("LIMIT_MAX_ITERATIONS");
  expect(legacy_executor.invoke).not.toHaveBeenCalled();
});
~~~

**Implementation anchor:**

~~~ts
export async function action_gate(
  state: OODAStateType,
  runtime: OODARuntime,
): Promise<Command> {
  const decision = require_action_decision(state.decision);
  await runtime.policy.assert_action_allowed(decision, state);
  if (runtime.policy.requires_approval(decision)) {
    return new Command({ goto: "request_approval" });
  }
  return new Command({ goto: "act", update: { iteration: state.iteration + 1 } });
}
~~~

- [ ] **Step 1:** Write tests for disallowed tool, permission failure, approval requirement, budget exhaustion, deadline, max iterations, successful read action, failed retryable action, non-retryable action, evaluation requiring another observation, and satisfied completion criteria.
- [ ] **Step 2:** Run npm test -- tests/orchestration/ooda-loop.test.ts.
- [ ] **Step 3:** Expected: FAIL.
- [ ] **Step 4:** ActionGate rechecks current emergency disable, pinned policy/deployment status, tool allowlist, permission, budget reservation, iteration, deadline, and approval class. It returns a Command routing to act, request_approval, or fail; it never executes a tool.
- [ ] **Step 5:** Act calls ToolExecutor exactly once per action idempotency key and appends the validated result. It does not catch policy/authorization failures as model-retryable errors.
- [ ] **Step 6:** Evaluate runs deterministic schema/domain/evidence checks first, then an optional structured evaluator model allowed by policy. Produce EvaluationV1 with criteria results, groundedness, evidence coverage, source quality/freshness, contradiction state, deterministic validation rate, completeness, risk severity, artifact validity, unresolved issues, next phase, and safe summary. A composite may be emitted only when calibrated against the approved evaluation corpus and must retain every component.
- [ ] **Step 7:** Route evaluation to observe when more evidence/action is allowed, clarify for required user facts, approve for a proposed gated commit, finalize when all completion criteria pass, or fail when hard limits/errors apply.
- [ ] **Step 8:** Increment iteration before each decide/act cycle. Emit LIMIT_MAX_ITERATIONS, LIMIT_DEADLINE, LIMIT_TOKENS, or LIMIT_COST with a partial safe result rather than calling an unrestricted fallback.
- [ ] **Step 9:** Run npm test -- tests/orchestration/ooda-loop.test.ts.
- [ ] **Step 10:** Expected: PASS.
- [ ] **Step 11:** Commit: git add packages/ai-orchestration tests/orchestration && git commit -m "feat: implement governed OODA action loop"

### Task 6: Add MongoDB checkpoints, clarification, and durable approval interrupts

**Files:**

- Create: packages/ai-orchestration/src/checkpoint.ts
- Create: packages/ai-orchestration/src/nodes/request-clarification.ts
- Create: packages/ai-orchestration/src/nodes/request-approval.ts
- Create: packages/ai-orchestration/src/resume.ts
- Create: apps/ai/scripts/setup-langgraph-checkpoints.ts
- Modify: apps/ai/package.json
- Create: tests/orchestration/interrupt-resume.test.ts

**Interfaces:**

- Consumes: MongoClient, thread/run ID, interrupt input, ApprovalService, and re-resolved runtime context.

- Produces: durable resumable graph with replay-safe side effects.

**Failing test anchor:**

~~~ts
it("resumes an approval exactly once after process restart", async () => {
  await first_graph.invoke(approval_state, thread_config);
  const resumed = await restarted_graph.invoke(
    new Command({ resume: approved_resume }),
    thread_config,
  );
  expect(resumed.approval_result?.status).toBe("approved");
  expect(await approvals.count_for_run(run_id)).toBe(1);
});
~~~

**Implementation anchor:**

~~~ts
export async function request_approval(
  state: OODAStateType,
  runtime: OODARuntime,
): Promise<Partial<OODAStateType>> {
  const approval = await runtime.approvals.ensure_pending(state);
  const resumed = interrupt<ApprovalRequestV1, ApprovalResumeV1>({
    schema_version: "1",
    approval_id: approval.id,
    run_id: state.run_id,
    summary: approval.summary,
  });
  return { approval_result: await runtime.approvals.verify_resume(state, resumed) };
}
~~~

- [ ] **Step 1:** Write tests with an in-memory saver for clarification and approval; resume with new Command({resume:value}); assert the node re-enters, no duplicate approval is created, wrong tenant/user cannot resume, expired approval fails, and a pinned-version mismatch fails safely.
- [ ] **Step 2:** Add an integration test for MongoDBSaver showing state survives a graph/service instance restart and pending writes do not duplicate completed actions.
- [ ] **Step 3:** Run npm test -- tests/orchestration/interrupt-resume.test.ts.
- [ ] **Step 4:** Expected: FAIL.
- [ ] **Step 5:** Create a lazy MongoDBSaver({client,dbName:"langgraph"}) getter and compile the production graph with it. Use configurable.thread_id built from internal tenant and thread IDs, never a client-controlled raw key.
- [ ] **Step 6:** Add setup:langgraph-checkpoints to initialize/verify the saver collections and indexes as a deployment step, not module import side effect.
- [ ] **Step 7:** request_clarification calls interrupt with ClarificationRequestV1 and validates the resumed answer before updating state. Do not wrap interrupt in try/catch.
- [ ] **Step 8:** request_approval first upserts AIApproval by run/action idempotency key, then calls interrupt with ApprovalRequestV1. On replay the upsert returns the same approval. Resume accepts approval ID and decision; ApprovalService verifies tenant, checkpoint, permission, decider, expiry, and current status.
- [ ] **Step 9:** Resume first resolves the current Clerk principal and tenant context, loads AIRun, verifies tenant/owner or manager permission, verifies pinned orchestrator/policy/deployment/prompt versions remain available, then invokes the graph with Command. Never accept a checkpoint state blob from the client.
- [ ] **Step 10:** Run npm test -- tests/orchestration/interrupt-resume.test.ts.
- [ ] **Step 11:** Expected: PASS.
- [ ] **Step 12:** Commit: git add packages/ai-orchestration apps/ai/scripts apps/ai/package.json tests/orchestration && git commit -m "feat: persist and resume OODA checkpoints"

### Task 7: Make formula artifacts deterministic and approval aware

**Files:**

- Create: packages/ai-orchestration/src/artifacts/formula-schema.ts
- Create: packages/ai-orchestration/src/artifacts/formula-validator.ts
- Create: packages/ai-orchestration/src/artifacts/formula-finalizer.ts
- Create: apps/ai/server/services/ai-control/formula-artifact-service.ts
- Create: tests/orchestration/formula-artifact.test.ts

**Interfaces:**

- Consumes: proposed formula, material evidence, tenant constraints, cost data, and manager approval.

- Produces: validated draft artifact or confirmed formula commit with full provenance.

**Failing test anchor:**

~~~ts
it.each([
  ["99.98", false],
  ["99.99", true],
  ["100.00", true],
  ["100.01", true],
  ["100.02", false],
])("validates total %s at the 0.01 tolerance", (total, valid) => {
  expect(validate_formula_artifact(formula_with_total(total), evidence).valid).toBe(valid);
});
~~~

**Implementation anchor:**

~~~ts
export function validate_formula_artifact(
  artifact: FormulaArtifactV1,
  evidence: MaterialEvidenceIndex,
): FormulaValidationV1 {
  const total = artifact.ingredients.reduce(
    (sum, ingredient) => sum.plus(ingredient.percentage),
    new Decimal(0),
  );
  const checks = [
    check_total_percentage(total, new Decimal("0.01")),
    check_unique_materials(artifact.ingredients),
    check_usage_ranges(artifact.ingredients, evidence),
    check_incompatibilities(artifact.ingredients, evidence),
    check_claim_citations(artifact.claims, evidence),
  ];
  return summarize_formula_checks(checks);
}
~~~

- [ ] **Step 1:** Write tests for exact 100 percent, 99.98, 100.02, duplicate material, missing source, amount/percentage inconsistency, usage above evidence limit/jurisdiction, incompatible phases or pH, unavailable/unverified non-water material, missing preservative/stability/allergen/regulatory warning, missing dated cost, missing laboratory-review statement, user confirmation attempt, manager approval, and replayed commit.
- [ ] **Step 2:** Run npm test -- tests/orchestration/formula-artifact.test.ts.
- [ ] **Step 3:** Expected: FAIL.
- [ ] **Step 4:** Define FormulaArtifactV1 with name, product_type, batch_size, ingredients(material_id,rm_code,phase,percentage,amount,unit,cost,source_ids,rationale), total_percentage, total_cost, claims, warnings, validation, and approval state.
- [ ] **Step 5:** FormulaValidator uses decimal arithmetic and requires absolute(total_percentage-100)<=0.01. It verifies amount from batch size, unique materials, tenant-visible or explicitly external/unverified non-water materials, source- and jurisdiction-backed usage ranges, required phases, configured incompatibility/pH rules, preservative/stability/allergen/regulatory warnings, dated cost completeness, claim citations, and the mandatory statement that laboratory, stability, safety, and regulatory review remain required.
- [ ] **Step 6:** Users may persist draft AIArtifact and submit review. Only a manager with formula:confirm and an approved AIApproval may call FormulaArtifactService.commit_confirmed. The repository creates/updates Formula and version/audit records in one idempotent commit.
- [ ] **Step 7:** Finalizer cannot turn warnings into approval. Blocking validation errors route back to observe/clarify/fail; non-blocking warnings are visible in output.
- [ ] **Step 8:** Run npm test -- tests/orchestration/formula-artifact.test.ts.
- [ ] **Step 9:** Expected: PASS.
- [ ] **Step 10:** Commit: git add packages/ai-orchestration apps/ai/server/services/ai-control tests/orchestration && git commit -m "feat: validate and approve formula artifacts"

### Task 8: Expose one authenticated AI run and event API

**Files:**

- Create: apps/ai/server/services/ai-gateway/ai-gateway.ts
- Create: apps/ai/server/services/ai-gateway/event-store.ts
- Create: apps/ai/server/services/ai-gateway/run-selector.ts
- Create: apps/ai/server/services/ai-gateway/run-job-queue.ts
- Create: apps/ai/server/worker.ts
- Modify: apps/ai/package.json
- Create: apps/web/app/api/ai/runs/route.ts
- Create: apps/web/app/api/ai/runs/[runId]/events/route.ts
- Create: apps/web/app/api/ai/runs/[runId]/resume/route.ts
- Create: tests/integration/ai-run-api.test.ts

**Interfaces:**

- Consumes: Clerk principal, AgentRunInputV1, tenant AI control plane, and OODA package.

- Produces: idempotent POST, resumable command, and ordered versioned server event stream.

**Failing test anchor:**

~~~ts
it("returns the same run for a repeated idempotency key", async () => {
  const first = await post_run(valid_input);
  const second = await post_run(valid_input);
  expect(first.status).toBe(202);
  expect(second.status).toBe(202);
  expect((await first.json()).run_id).toBe((await second.json()).run_id);
});
~~~

**Implementation anchor:**

~~~ts
export async function create_run(
  principal: RequestPrincipal,
  input: AgentRunInputV1,
): Promise<AcceptedRunV1> {
  const tenant = build_tenant_execution_context(principal);
  return database.with_transaction(async (session) => {
    const prepared = await prepare_ai_run(tenant, input, session);
    await run_jobs.enqueue({ run_id: prepared.run.id, command: "start" }, session);
    return accepted_run(prepared.run);
  });
}
~~~

- [ ] **Step 1:** Write API tests for anonymous, suspended tenant, disabled AI, invalid input, duplicate idempotency, cross-tenant run read/resume, ordered event replay using Last-Event-ID, disconnect/reconnect, clarification resume, approval resume, completion, and provider failure.
- [ ] **Step 2:** Run npm test -- tests/integration/ai-run-api.test.ts.
- [ ] **Step 3:** Expected: FAIL.
- [ ] **Step 4:** POST /api/ai/runs builds RequestPrincipal and TenantExecutionContext, validates input, resolves policy/deployment, reserves budget, creates AIRun, pins executor=ooda, and inserts one ai_run_jobs record in the same transaction. Return 202 with run_id and events URL; do not rely on a serverless request remaining alive.
- [ ] **Step 5:** Implement run-job-queue with Mongo compare-and-set leases, lease owner, lease expiry, heartbeat, attempts, availableAt, and unique run/command idempotency. apps/ai/server/worker.ts claims jobs, rebuilds trusted runtime ports from the pinned AIRun plus current tenant/membership/emergency state, executes/resumes the graph, appends events, and renews its lease. A crashed worker makes the job reclaimable; completed tool actions remain idempotent.
- [ ] **Step 6:** Add worker=tsx server/worker.ts and start:worker=node dist/server/worker.js to apps/ai/package.json. Run the private worker process from the same server artifact and deployment boundary as the application; docker-compose.yml may use a second process/container with no public port and a heartbeat-freshness health check, but this gate does not create a separately authenticated network service.
- [ ] **Step 7:** RunSelector evaluates the tenant rollout flag once before AIRun creation. Store executor and orchestrator version on the run; a legacy-selected run never invokes OODA and an OODA-selected run never falls back to legacy.
- [ ] **Step 8:** Store every AgentRunEventV1 with unique [runId,sequence] and append before sending. The event route authorizes the run, replays events after Last-Event-ID, then streams new events with heartbeat and cancellation handling.
- [ ] **Step 9:** Resume route accepts strict ClarificationResponseV1 or ApprovalDecisionV1 only, re-authorizes, and delegates to resume.ts. It cannot update arbitrary graph state.
- [ ] **Step 10:** Reconcile usage and AIRun terminal status in worker finally logic outside graph interrupts. Resume inserts a resume job rather than running the graph inside the HTTP request. A disconnected browser does not cancel the server run unless an explicit authorized cancellation is requested.
- [ ] **Step 11:** Run npm test -- tests/integration/ai-run-api.test.ts.
- [ ] **Step 12:** Expected: PASS.
- [ ] **Step 13:** Commit: git add apps/ai/server/services/ai-gateway apps/web/app/api/ai/runs tests/integration && git commit -m "feat: expose the governed OODA run API"

### Task 9: Convert the AI UI to versioned run events

**Files:**

- Create: apps/web/hooks/use_agent_run.ts
- Modify: apps/web/hooks/use_chat_threads.ts
- Modify: apps/web/components/ai/ai_chat_container.tsx
- Modify: apps/web/components/ai/ai_chat_message.tsx
- Modify: apps/web/components/ai/ai_formula_result.tsx
- Create: apps/web/components/ai/ai_approval_card.tsx
- Create: apps/web/components/ai/ai_clarification_card.tsx
- Create: apps/web/components/ai/ai_evidence_list.tsx
- Modify: apps/web/app/ai/raw-materials-ai/page.tsx
- Modify: apps/web/app/ai/sales-rnd-ai/page.tsx
- Create: tests/e2e/ooda-run.spec.ts

**Interfaces:**

- Consumes: AgentRunEventV1 and AgentRunOutputV1.

- Produces: UI that renders progress, evidence, questions, approvals, artifacts, failure, reconnect, and completion without parsing prose for control state.

**Failing test anchor:**

~~~ts
test("reconnects and renders each event once", async ({ page }) => {
  await start_test_run(page);
  await disconnect_event_stream(page);
  await reconnect_event_stream(page);
  await expect(page.getByTestId("run-completed")).toBeVisible();
  await expect(page.getByTestId("artifact-card")).toHaveCount(1);
});
~~~

**Implementation anchor:**

~~~ts
function reduce_run_event(state: AgentRunViewState, raw: unknown): AgentRunViewState {
  const event = agent_run_event_v1_schema.parse(raw);
  if (event.sequence <= state.last_sequence) return state;
  return apply_typed_run_event(state, event);
}

export function use_agent_run(): UseAgentRunResult {
  return useReducerBackedEventStream({ reduce_run_event, reconnect: true });
}
~~~

- [ ] **Step 1:** Write Playwright tests for normal answer, formula draft, clarification, manager approval, user denied approval, reconnect/event replay, budget failure, citation display, and no hidden reasoning display.
- [ ] **Step 2:** Run npm run test:e2e -- tests/e2e/ooda-run.spec.ts.
- [ ] **Step 3:** Expected: FAIL against legacy chat endpoints.
- [ ] **Step 4:** Implement use_agent_run with POST, event stream, sequence de-duplication, Last-Event-ID reconnect, resume actions, cancellation, and terminal state. Validate every event with its Zod schema before state update.
- [ ] **Step 5:** Render phase changes as compact status, citations as evidence links with provenance, clarification as structured questions, approvals as manager-only explicit decision cards, formula artifacts from schema fields, and errors by stable error code.
- [ ] **Step 6:** Do not display model scratchpads, raw prompts, provider keys, hidden policy, raw tool arguments containing sensitive data, or LangGraph debug checkpoints.
- [ ] **Step 7:** Replace raw-materials and sales route-specific execution with agent_key selection through the same run API. Keep differences in deployment/prompt/tool configuration, not separate orchestration code.
- [ ] **Step 8:** Run npm run test:e2e -- tests/e2e/ooda-run.spec.ts and npm run build:web.
- [ ] **Step 9:** Expected: PASS.
- [ ] **Step 10:** Commit: git add apps/web tests/e2e && git commit -m "feat: render typed OODA run events"

### Task 10: Enforce the OODA boundary and record G4 evidence

**Files:**

- Modify: scripts/security/scan-private-boundaries.ts
- Create: tests/security/ooda-boundary.test.ts
- Create: docs/commercial/evidence/g4-release.md
- Modify: CHANGELOG.md

**Interfaces:**

- Consumes: new AI gateway and orchestration package.

- Produces: no new caller can invoke legacy AI entry points or bypass the graph/control plane.

**Failing test anchor:**

~~~ts
it("flags direct graph invocation outside AIGateway", () => {
  const findings = find_ooda_boundary_violations(
    source("apps/web/app/api/example/route.ts", "await graph.stream(input)"),
  );
  expect(findings).toEqual([
    expect.objectContaining({ code: "OODA_GATEWAY_BYPASS" }),
  ]);
});
~~~

**Implementation anchor:**

~~~ts
export function find_ooda_boundary_violations(file: SourceFile): SecurityFinding[] {
  if (is_test_file(file.fileName) || is_ai_gateway(file.fileName)) return [];
  return [
    ...find_calls(file, ["graph.invoke", "graph.stream"]),
    ...find_imports(file, legacy_ai_entry_points),
    ...find_provider_calls_outside_adapters(file),
  ];
}
~~~

- [ ] **Step 1:** Extend the scanner to reject imports of legacy agent/service entry points from the new run API, new UI, control-plane services, and orchestration workspace. Reject direct graph.invoke/stream outside AIGateway and test files.
- [ ] **Step 2:** Add fixtures for alias imports, dynamic import, barrel re-export, and require.
- [ ] **Step 3:** Run npm run security:scan.
- [ ] **Step 4:** Expected: PASS; legacy paths may remain only behind RunSelector for G5 canary and cannot be reached from an OODA run.
- [ ] **Step 5:** Run npm test, npm run typecheck, npm run security:scan, npm run test:e2e -- tests/e2e/ooda-run.spec.ts, and npm run build:web.
- [ ] **Step 6:** Expected: all PASS.
- [ ] **Step 7:** Record graph shape, checkpoint restart, interrupt authorization, formula validation, event reconnect, provider failure, budget limit, and no-mixed-fallback evidence in docs/commercial/evidence/g4-release.md.
- [ ] **Step 8:** Update CHANGELOG.md with the typed OODA run behavior.
- [ ] **Step 9:** Commit: git add scripts tests/security docs/commercial CHANGELOG.md && git commit -m "feat: gate production AI through OODA orchestration"
