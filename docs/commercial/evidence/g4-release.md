# G4 — Agentic Orchestration Implementation Evidence

Gate G4 replaces free-form agent execution with a **governed agentic loop**: one
reasoning node may call the model, every other node is deterministic code, and a
tenant AI control plane pins policy, budget, and identity for each run. This
document records the implemented and locally verified behavior. The production
composition is complete; G4 release approval remains open only for the
credentialed staged full-story evidence listed below.

## Task completion map

| Task | Outcome | Evidence |
|------|---------|----------|
| G4.1 Isolated orchestration workspace | done | merged 599fc72 |
| G4.2 Versioned input/event/output/loop-state contracts | done | merged 599fc72 |
| G4.3 Capability cards + context assembler | done | merged 4244665 / 599fc72 |
| G4.4 Agent reasoning node + ingress | done | merged 599fc72 |
| G4.5 Deterministic governor (gate, act, validators, loop detection) | done | merged 599fc72 |
| G4.6 Specialist delegation running the same loop | done | 6d6bd10 |
| G4.7 MongoDB checkpoints, clarification, durable approval interrupts | done | real MongoDBSaver restart/resume exactly-once test |
| G4.8 Deterministic, approval-aware formula artifacts + finalize node | done | bf644b7 · 57c6e01 · 97d88b7 · 20984ae · 042f5a6 · 9b353ff |
| G4.9 Authenticated run + event API + private worker | implementation done | concrete admission/runtime, deployable worker, queue/events/resume, pinned rollback path, focused integration tests |
| G4.10 AI UI on versioned run events | done | typed client/hook/reducer/cards and both AI pages, with reconnect/wiring tests |
| G4.11 Orchestration-boundary enforcement + this evidence | done | scanner rules plus exact tool/card consistency tests |

## Verified behavior

Each property is proven by a deterministic test in `tests/orchestration/`,
`tests/ai-control/`, `tests/repositories/`, `tests/web/`, or `tests/security/`.

- **Loop topology is fixed.** `graph-shape.test.ts` locks the exact node/edge set
  (`START → ingress → agent`; `agent → {gate, request_clarification, finalize,
  fail}`; `finalize → {END, agent}`) and asserts the agent node is the **only**
  file that calls the model gateway — no other node can reach a provider.
- **Context-pack pinning.** The run pins orchestrator/policy/deployment/prompt
  versions and the context-pack hash at ingress; the gate consumes approvals
  pinned to an action's arguments hash (`interrupt-resume.test.ts`).
- **Checkpoint restart / durable interrupts.** Approval resumes **exactly once**
  across a simulated restart (count is 1, one commit); a denied approval routes to
  the agent with no commit; clarification re-enters with the validated answer
  (`interrupt-resume.test.ts`).
- **Interrupt authorization.** `resume_run` verifies run/tenant/permission/version
  pins and never trusts a client checkpoint blob (`interrupt-resume.test.ts`).
- **Deterministic formula validation.** The validator is the sole finalize
  authority: percentage total within 0.01 of 100 (exact decimal), unique
  materials, evidence-backing and usage ranges, amount-from-batch, configured
  incompatibilities/phases/pH, dated cost, claim citations, and the mandatory
  review statement (`formula-artifact.test.ts`). The finalize node returns a
  blocking validation to the agent while budget remains, else completes with the
  findings as warnings (`finalize-node.test.ts`). Commit requires a manager with
  `formula:confirm` and an approved AIApproval, idempotently
  (`ai-artifact-repository.test.ts`).
- **Event reconnect renders each event once.** The versioned run-event reducer
  drops any already-seen sequence, so a reconnect that replays earlier events is
  idempotent (`agent-run-view.test.ts`).
- **Loop-detection and no mixed fallback.** A repeated identical action fails the
  run with `LOOP_DETECTED`; the graph cannot switch to a legacy executor mid-run
  (`governor.test.ts`, `graph-shape.test.ts`).

## Boundary enforcement (G4.11)

`scripts/security/scan-private-boundaries.ts` gained the **`OODA_GATEWAY_BYPASS`**
rule: any production caller that drives the governed loop graph directly —
`compile_agent_loop_graph(...).invoke|stream(...)` or a local variable bound to a
loop-graph builder — is rejected, so no route or service can run an agentic loop
outside the AI gateway that binds policy, budget, and identity. The orchestration
package (which owns the graph and its recursive delegation), the AI gateway, and
test files are exempt. Legacy LangGraph graphs (named `graph` but built from
`StateGraph`) are deliberately not flagged; they remain reachable only behind the
G5 canary selector. Covered by `tests/security/ooda-boundary.test.ts` (7 fixtures)
and enforced in CI via `npm run security:scan` (0 violations on the tree).

The scanner also gained the **`LEGACY_ENTRY_POINT_IMPORT`** rule: within the
governed orchestration path (the `packages/ai-orchestration/` package and the
`apps/ai/server/services/ai-gateway/` service) it rejects any static import,
dynamic `import()`, or `require()` that resolves into the legacy AI executor tree
(`apps/ai/agents/**` — the ReAct agent, per-domain legacy agents, and the agent
manager), so an agentic run can never fall back into a legacy executor. The legacy
tree itself (retired in G5) and test files are not policed. Covered by
`tests/security/legacy-entry-point-boundary.test.ts` (8 fixtures); 0 violations on
the tree (the governed path imports no legacy module).

## Run API and private worker (G4.9 implementation done)

The three governed-run routes are built on the tested G4.9 blocks: `POST
/api/ai/runs`, `GET /api/ai/runs/[runId]/events` (SSE with `Last-Event-ID`
replay + heartbeat), and `POST /api/ai/runs/[runId]/resume`. Run-specific
routing/validation/error mapping lives in pure handlers
(`apps/ai/server/services/ai-gateway/run-api-handlers.ts`) exercised with fakes by
`tests/integration/ai-run-api.test.ts` (create/error/idempotency,
id, ordered SSE replay + terminal close + `Last-Event-ID` + 404 authorization +
heartbeat/abort, and strict resume). Anonymous/suspended cases remain the reused
`with_request_principal` guard's responsibility (G0). Run creation now composes
the real policy compiler, context assembler, budget reservation, tenant rollout
assignment, transactional run/job persistence, and stable deployment/model
pins. Admission performs no paid provider request.

The private worker is a non-HTTP deployable process. It rebuilds authorization
from the pinned run, rechecks the platform emergency switch at action time,
loads MongoDB checkpoints, binds the governed catalogue and exact approval gate,
uses tenant-filtered Qdrant knowledge, optional fail-closed Google Custom Search,
and the pinned Gemini model/rate card. Retry is limited to explicitly retryable
errors with exponential backoff, jitter, a maximum-attempt poison path, lease
heartbeat, safe error codes, and append-before-ack event persistence. The
rollback-only legacy executor is selected before run creation and cannot be
entered from the governed graph.

`tests/integration/run-api-runtime.test.ts`, `private-worker-entry.test.ts`,
`run-worker.test.ts`, `governed-run-executor.test.ts`, and
`pinned-run-executor.test.ts` exercise these seams without paid credentials.
`npm run build:worker` and an import smoke test verify the server-only bundle.

## Pending release evidence (external gate — PENDING_EXTERNAL_ROTATION)

- End-to-end execution evidence through the live run API: completion,
  provider-failure, budget-limit, and live clarification/approval resume.
- A credentialed browser reconnect run proving the staged proxy, EventSource,
  Clerk identity, Mongo replica set, Qdrant service, and private worker together.
- Provider and vector credentials must be rotated/revoked as documented and
  provisioned only to the staged worker before either run is allowed.

The exact no-orphan card check is no longer pending:
`tests/ai-control/capability-cards.test.ts` builds all seven definitions with
fail-closed ports, requires one matching card for each, permits only the three
known delegation cards, and rejects metadata drift.
