# G4 — Agentic Orchestration Release Evidence (interim)

Gate G4 replaces free-form agent execution with a **governed agentic loop**: one
reasoning node may call the model, every other node is deterministic code, and a
tenant AI control plane pins policy, budget, and identity for each run. This
document records the behavior verified so far. G4 is **not yet fully closed** —
the authenticated run/event API and private worker (G4.9) remain, and the items
that depend on a live run stream are marked pending below.

## Task completion map

| Task | Outcome | Evidence |
|------|---------|----------|
| G4.1 Isolated orchestration workspace | done | merged 599fc72 |
| G4.2 Versioned input/event/output/loop-state contracts | done | merged 599fc72 |
| G4.3 Capability cards + context assembler | done | merged 4244665 / 599fc72 |
| G4.4 Agent reasoning node + ingress | done | merged 599fc72 |
| G4.5 Deterministic governor (gate, act, validators, loop detection) | done | merged 599fc72 |
| G4.6 Specialist delegation running the same loop | done | 6d6bd10 |
| G4.7 MongoDB checkpoints, clarification, durable approval interrupts | core done | 2418bce (real MongoDBSaver pending langgraph upgrade with G4.9) |
| G4.8 Deterministic, approval-aware formula artifacts + finalize node | done | bf644b7 · 57c6e01 · 97d88b7 · 20984ae · 042f5a6 · 9b353ff |
| G4.9 Authenticated run + event API + private worker | pending | needs fresh integration + `@langchain/langgraph` upgrade |
| G4.10 AI UI on versioned run events | core done | reducer 3967621 (SSE hook + cards pending G4.9) |
| G4.11 Orchestration-boundary enforcement + this evidence | this commit | scanner rule + fixtures below |

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

## Pending (with G4.9)

- The authenticated `POST /run` + SSE `events` + `resume` routes, the event store,
  and the leased private worker.
- Real `MongoDBSaver` durability (needs the `@langchain/langgraph` upgrade that
  resolves the checkpoint-mongodb `pending_sends` conflict with pinned 0.2.74).
- The live SSE UI hook, approval/clarification/evidence cards, and the reconnect
  e2e spec (`tests/e2e/agentic-run.spec.ts`).
- A CI check that every registered `ToolDefinition` has a matching capability card
  and no card lacks a tool.
- Provider-failure and budget-limit evidence exercised through the live run API.
