# Governed AI Orchestrator — Developer & Operator Guide

This is the human-facing guide to the agentic orchestrator: how a run
flows through the system, how the reasoning loop chains tools, how search
and citations work, every available tool, and how to add a new one. The
model-facing counterparts are the capability cards in
`apps/ai/server/services/ai-control/cards/` — those are injected into the
model's context at run time and are enforced against the code by CI.

## 1. Architecture — how a run flows

```
Browser (useAgentRun hook, SSE)
  → POST /api/ai/runs                  (versioned AgentRunInputV1, no identity fields)
  → ai-gateway create_run              (policy compile → context pack pin → executor
                                        selection → budget reservation → transactional
                                        run + job insert)
  → ai_run_jobs queue                  (durable compare-and-set leases)
  → private worker (compose service)   (rebuilds tenant authorization per job,
                                        drives the loop, appends events before ack)
  → agent loop (packages/ai-orchestration, LangGraph + MongoDBSaver checkpoints)
  → GET /api/ai/runs/[runId]/events    (ordered SSE replay via Last-Event-ID)
  → typed reducer → run view UI        (evidence, clarification, approval, artifacts)
```

Key properties, each locked by tests:

- **Admission is fail-closed.** A run is only accepted after the effective
  tenant policy compiles with AI enabled, a context pack is pinned by hash,
  the executor (agentic or legacy rollback) is pinned, and budget is
  reserved — all inside one transaction with the job insert.
- **The worker is the only executor.** The web tier never drives a loop;
  queued governed runs complete only through the worker service
  (`apps/ai/Dockerfile.worker` in Docker Compose).
- **Every event is durable before it is visible.** Events are appended
  idempotently (keyed by run + sequence) before acknowledgement, so a
  browser reconnect replays a gap-free ordered stream.
- **Approvals survive restarts.** Checkpoints live in MongoDB
  (MongoDBSaver); a manager approval resumes exactly-once even across an
  independently constructed saver.

## 2. The reasoning chain — how the loop thinks

The loop topology is fixed (`packages/ai-orchestration/src/nodes/`):

```
agent → gate → act → agent → … → finalize → END
          ↘ request_clarification (interrupt)
          ↘ request_approval      (durable interrupt)
          ↘ fail
```

- **agent** (the only model node) receives the pinned context pack: the
  orchestrator card (invariant loop rules), the agent persona card, the
  policy digest, capability cards for exactly the allowlisted tools, and
  the conversation. Each turn it emits **one** action: a tool call, a
  clarification request, or finalize. There is no hidden chain-of-thought
  channel — reasoning is expressed as the sequence of typed actions and
  observations, which makes every step auditable and replayable.
- **gate** (deterministic, not the model) authorizes the action: tool on
  the policy allowlist, permission held, budget available, loop detection
  (unchanged repeated calls are rejected), draft/commit semantics
  (commits require the durable manager approval interrupt).
- **act** executes through the governed tool executor and appends a typed
  observation (`tool_result`, `policy_denied`, `validation_finding`).
  Observations are data for the next agent turn — retrieved content is
  never treated as instructions (injection resistance).
- **finalize** is authoritative: produced artifacts are re-validated
  deterministically (schema, amounts vs batch, constraints, costs). A
  blocking finding with budget remaining sends the loop back to the agent
  with the finding as an observation; with budget exhausted it completes
  honestly with warnings and no artifact.
- **Interrupts**: `request_clarification` pauses for the user's answer;
  `request_approval` pauses durably for a manager decision. Both resume
  through the strict resume API (`ClarificationResponseV1` /
  `ApprovalDecisionV1`) — never arbitrary graph state.

### Chain-of-thought policy

The orchestrator card mandates evidence-first completion: gather evidence
through tools before answering, cite every retrieved source, clarify
instead of guessing missing arguments, and finalize as soon as evidence
supports a complete answer. Quality is reported as named dimensions
(evidence coverage, groundedness, validation rate, …), never a lone
confidence number.

### Delegation (sub-loops)

Three delegation tools run a bounded specialist sub-loop (depth 1) with an
inherited tenant context, a budget slice (~40% of remaining), and a
narrowed allowlist that can never commit: `delegate.raw_material_research`,
`delegate.formulation`, `delegate.sales_rnd`. Specialists return proposals
plus evidence IDs; committing remains a parent, human-approved decision.

## 3. Search — internal first, web as bounded fallback

Ordering the orchestrator card enforces:

1. `knowledge.search` — tenant-partitioned Qdrant retrieval (platform and
   tenant collections, mandatory payload filters, post-retrieval
   validation). Citations carry source IDs and provenance (tenant document
   vs platform knowledge).
2. `formula.search` — the tenant's own formula portfolio via tenant
   repositories.
3. `web.search` — only for information internal corpora cannot contain
   (regulatory currency, recent publications, public supplier data).
   Server-only Google Custom Search adapter: 1–10 results, 512 KiB
   response cap, HTTP(S)-only citations, no tenant specifics in queries.
   Absent credentials the tool is `NOT_WIRED` and simply missing from the
   allowlist.

Web results are untrusted external content: the model must verify claims
against cited domains, date-stamp regulatory claims, and report empty
results as weak grounding instead of guessing.

## 4. Tool inventory

Every governed tool has exactly one capability card (enforced: a missing
or drifted card fails `ToolCatalogue.register`, and the no-orphan test
fails CI if the card directory and the registered set diverge).

| Tool | Side effect | Permission | Purpose |
|---|---|---|---|
| `formula.search` | read | `formula:read` | Search the tenant's formula portfolio |
| `formula.draft` | draft | `formula:draft:create` | Create a reviewable draft formula from a brief |
| `formula.revise` | draft | `formula:draft:update_own` | Revise an existing draft from feedback |
| `formula.comment` | draft | `formula:comment:create` | Record structured notes on a formula |
| `formula.confirm` | commit | `formula:confirm` | Commit a validated draft — durable manager approval required |
| `knowledge.search` | read | `tenant:knowledge:read` | Tenant-partitioned Qdrant knowledge retrieval with citations |
| `web.search` | read | `ai:run` | Bounded cited external search (optional, credential-gated) |
| `delegate.raw_material_research` | read | `ai:run` | Sub-loop: raw material evidence gathering |
| `delegate.formulation` | read | `ai:run` | Sub-loop: draft/revise proposals with rationale |
| `delegate.sales_rnd` | read | `ai:run` | Sub-loop: sales/R&D analysis proposals |

Cards live at `apps/ai/server/services/ai-control/cards/tools/<name>.md`.
Agent personas: `cards/agents/{raw_material_research,formulation,sales_rnd}.md`.
Loop rules: `cards/orchestrator.md`.

## 5. Authoring a new tool

1. **Define it** — add a `ToolDefinition` (name, version, `side_effect`:
   read/draft/commit, `required_permission` from the shared permission
   set, zod input/output schemas, execute port) under
   `apps/ai/server/services/ai-control/tools/`.
2. **Write its card** — `cards/tools/<name>.md` with frontmatter matching
   the definition exactly (name, version, kind: tool, side_effect,
   required_permission) and the seven required sections:
   Purpose · When to use · When NOT to use · Arguments ·
   Result interpretation · Failure modes · Example.
   Stay within the card size budget.
3. **Register it** in the production catalogue composition. Registration
   fails closed on a missing card (`TOOL_CARD_MISSING`) or frontmatter
   drift (`TOOL_CARD_DRIFT`).
4. **Update the universe** — add the tool name to
   `PLATFORM_TOOL_UNIVERSE` (platform-ai-constraints) so policies can
   allow it; tenants only ever see policy-narrowed subsets.
5. **Tests** — extend `tests/ai-control/capability-cards.test.ts`
   expectations (the no-orphan list and permission map are exact) and add
   behavior tests for the execute port. Update the inventory table above;
   `tests/ai-control/orchestrator-guide.test.ts` fails if this guide does
   not mention the new tool.

## 6. Model configuration

- The platform model universe is
  `PLATFORM_PROVIDER_UNIVERSE` in
  `apps/ai/server/services/ai-control/platform-ai-constraints.ts`; plans
  and tenant settings can only narrow it.
- The effective policy compile selects the model for a run; the gateway
  pins it on the run record (`run.model`) so mid-run configuration changes
  never affect in-flight runs.
- The worker's model gateway receives the pinned model and prices usage
  with `AI_GEMINI_INPUT/OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS`
  (required, fail-closed) under `AI_RATE_CARD_VERSION`.
- Embeddings: `AI_EMBEDDING_MODEL` (default `gemini-embedding-001`),
  `AI_EMBEDDING_VERSION`, `AI_EMBEDDING_DIMENSIONS` (default 768).
- Model updates are a config/policy change (universe + plan defaults +
  compose `GEMINI_MODEL` default), never a code fork; in-flight runs stay
  pinned to their admission-time model.

## 7. Where things live

| Concern | Path |
|---|---|
| Loop nodes & contracts | `packages/ai-orchestration/src/` |
| Governed tools & catalogue | `apps/ai/server/services/ai-control/` |
| Capability cards | `apps/ai/server/services/ai-control/cards/` |
| Gateway (admission) | `apps/ai/server/services/ai-gateway/ai-gateway.ts` |
| Worker (execution) | `apps/ai/server/worker.ts` + `run-worker.ts` |
| Run/event/resume API | `apps/web/app/api/ai/runs/` |
| Client hook & reducer | `apps/web/hooks/use_agent_run.ts`, `apps/web/lib/agent_run_view.ts` |
| Run view UI | `apps/web/components/ai/ai_run_view.tsx` |
| Card/loop enforcement tests | `tests/ai-control/`, `tests/orchestration/` |
