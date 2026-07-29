# Commercialization Program — Session Handover

**Worktree:** `.worktrees/v2_dev` (branch `v2/dev`) · **HEAD:** `6ebb400` · **Tree:** clean · **Suite:** 416/416 green, typecheck 0, security scan 0, build:web 0.

The loop-engineering harness is **armed** here. A fresh Claude Code session opened in this worktree auto-resumes the loop and reads `.loop/tasks.md` + `.loop/journal.md` as its memory. This file is the human-readable summary of what remains.

## How to resume

1. Open a fresh session in `.worktrees/v2_dev`. The SessionStart hook re-arms the loop at the next `[ ]` task.
2. **Delegation works again in a fresh session.** In THIS session, subagents aborted immediately because the context-monitor hook leaked the parent's 92% usage into fresh subagent sessions (a false alarm — see journal iter 28c). A new parent session with low context does not have this problem, so `Agent`-tool delegation is the fastest path for the large TDD tasks below.
3. Per task: read the named plan file section, TDD (write failing test → implement → verify), run the four gates (`npm test`, `npm run typecheck`, `npm run security:scan`, `npm run build:web`), commit with the plan's message, flip the `.loop/tasks.md` checkbox, append one journal line.

## Done (26 tasks, all committed + verified)

- **G0** (7/7): security containment, provider-neutral principal, tRPC + route guards, boundary scanner.
- **G1** (7/7): Clerk surface, identity/tenant/membership projections, Clerk principal resolver, idempotent university provisioning, webhooks + invitations, legacy bcrypt import, cutover (legacy auth deleted).
- **G2.1–G2.5**: tenant execution context + support access, schema tenant provenance, verified backfill/quarantine tooling, tenant-scoped repositories, router conversion to named permissions + repositories.
- **G3.1**: AI control-plane Prisma models + `EffectiveAIPolicy` shared contract.
- **G4.1–G4.5 + G4.3**: the dynamic agentic orchestrator — isolated `packages/ai-orchestration` (LangGraph 1.4.7), versioned loop contracts, single model-driven `agent` node + ingress, deterministic governor (gate/act/validators/loop-detection), governed tool catalogue + executor, 11 capability cards, card-loader, context-assembler. **This is the original goal: fixed pipeline → governed agentic loop with `.md` capability-card injection.**

## In progress / next up

### G2.6 — Convert AI tools + direct APIs to tenant repositories — **PARTIAL (in `6ebb400`)**
Plan: `docs/superpowers/plans/2026-07-15-tenant-data-authorization.md` Task 6.
- **Done:** `apps/ai/agents/react/tenant-tool-scope.ts` (`tenant_scoped_id_filter`, fail-closed), `ToolHandlerContext.tenant_id` added, `confirm-formula-handler.ts` converted (the plan's failing-test anchor), `tests/integration/tenant-ai-tool-isolation.test.ts` (helper unit tests, 4 green).
- **Remaining:** apply the same tenant predicate (or route through `ctx.repositories.formulas` per the plan's anchor) to `generate-formula`, `revise-formula`, `get-formula-with-comments`, `search-reference-formulas` handlers; restrict `mongo-query-handler` to an allowlisted read-only diagnostic surface (no model-supplied collection/filter/stages); make the 6 direct route handlers (`apps/web/app/api/ai-chat/{route,refresh}`, `ai/raw-materials-agent/{route,langgraph-route}`, `agents/[agentId]/chat`, `agents/execute`) build a `TenantExecutionContext` once from the guard's principal and pass `tenant_id`/repositories through (delete organization/user fallbacks). Extend the isolation test to cover each. Then mark G2.6 `[x]`.

### G2.7 — Enforce tenant ownership + prevent repository bypass
Plan Task 7. Extend `scripts/security/scan-private-boundaries.ts` with a rule: tenant collections may only be accessed inside `apps/ai/server/repositories/**` (routers/handlers touching `db.collection("formulas"|...)` directly = violation). Whitelist the documented legacy `// TODO(G2.6)` raw accesses only until G2.6 finishes, then remove the whitelist. Add cross-tenant integration tests. Depends on G2.6.

### G3.2–G3.6 (plan: `2026-07-15-tenant-ai-control-plane.md`)
- **G3.2** Task 2: effective-policy compiler (platform defaults + plan + TenantAIProfile + AgentDeployment → frozen `EffectiveAIPolicy` + hash; fail-closed when disabled). Reconcile the merged `ai-control/policy-types.ts` with the shared `EffectiveAIPolicy`. Self-contained agent prompt in journal iter 28.
- **G3.3** usage ledger (reserve-before-run, reconcile-after); **G3.4** wire the merged tool catalogue's ports to the real tenant repositories (catalogue itself already merged in `4244665`); **G3.5** Qdrant platform/tenant partition; **G3.6** tenant AI admin UI + platform constraints.

### G4.6–G4.11 (plan: `2026-07-15-ooda-agent-orchestration.md`)
- **G4.6** Task 6: specialist delegation tools (recursive governed loop, depth 1, reserved budget, read-only proposals). Self-contained agent prompt in journal iter 24. Files: `packages/ai-orchestration/src/delegation/*`, `schemas/specialist.ts`, 3 `cards/tools/delegate.*.md`, `tests/orchestration/delegation.test.ts`.
- **G4.7** MongoDB checkpoints + clarification/approval interrupts (`mongodb-memory-server` already a dep); **G4.8** deterministic formula artifacts + finalize node; **G4.9** authenticated run + event API + private worker; **G4.10** typed UI events; **G4.11** boundary scanner + G4 evidence doc.

### G5.1–G5.11 + Program.1 (plan: `2026-07-15-commercial-evaluation-rollout.md`)
Evaluation corpus, scorers, frozen baseline + thresholds, shadow execution, canary + rollback, ops/incident controls, tenant export/deletion/retention, load/failure-injection, CI full-story verification, legacy retirement, 100% rollout evidence, gated-delivery management.

## Standing deployment gates (external, tracked in CHANGELOG)
- `PENDING_EXTERNAL_ROTATION` (G0.3): rotate exposed provider keys in provider consoles.
- `PENDING_EXTERNAL_DASHBOARD` (G1.1): Clerk Dashboard settings (invitation-only, org self-service off, custom roles, MFA for platform admins).
- `PENDING_EXTERNAL_STAGING` (G1.7): staged `CLERK_CUTOVER=true` + migrate/reconcile + e2e + rollback rehearsal → record in `docs/commercial/evidence/g1-release.md`.

## Conventions (match existing code)
snake_case, JSDoc on every function, strict TDD, `verify:commercial` before commit boundaries, one journal line per task, checkbox flip in `.loop/tasks.md`. Design of record for all AI work: `docs/superpowers/specs/2026-07-15-agentic-orchestrator-design.md` (dynamic agentic loop, never fixed pipelines).
