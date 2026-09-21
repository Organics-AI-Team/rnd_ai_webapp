# Dynamic Agentic Orchestrator with Capability-Card Injection

**Status:** Approved direction (supersedes section 11 "OODA orchestration" of
`2026-07-15-commercial-clerk-tenancy-ooda-design.md`; all other sections of that
design remain authoritative).

**Decision owner:** Product owner directive 2026-07-15: "dynamic pure agentic
with orchestrator and .md inject for AI understanding each tools and better
flow instead of fixed pipeline."

---

## 1. Executive decision

Replace the planned twelve-fixed-node OODA `StateGraph` with a **governed
agentic loop**: one orchestrator reasoning node whose flow is model-driven, and
a deterministic governor (gate + executor + validators) that owns authorization,
budgets, checkpoints, and side effects.

OODA remains the operating doctrine, but as **emergent loop behavior, not graph
topology**. Each loop turn is one OODA cycle: appended tool results are the
observation, the orchestrator's single reasoning turn is orientation and
decision, and the gated tool execution is the action. Evaluation is
deterministic code on every result and on finalization.

The orchestrator understands its capabilities through **injected markdown
capability cards** — one `.md` document per tool and per agent — assembled into
the system context at run start, filtered by tenant policy, and pinned by
content hash on the run.

## 1a. Current state (audited 2026-07-15, branch dev/droplet)

The live system has ~9 executor paths of which only two are user-reachable, and
both funnel into a single hardcoded ReAct agent
(`apps/ai/agents/react/react-agent-service.ts`) with silent fallbacks to a
fixed GeminiToolService pipeline or bare Gemini calls. The sales UI runs the
raw-materials persona because `enhanced-chat` ignores its category. There are
two disjoint tool systems (10 Gemini function declarations vs 8 Zod registry
tools) with duplicated inline English/Thai description strings, no central
catalogue, prompts split between hardcoded TS builders and one
runtime-loaded `.md` (16 more `.md` prompts orphaned), and Qdrant collections
with inconsistent dimensions. The LangGraph, agent-manager, agent-factory,
cosmetic, and sales orchestrator paths are orphaned or test-only. This design
replaces all of them behind one gateway; G5 retires them.

## 2. Why the fixed pipeline is rejected

| Fixed 12-node OODA graph (old plan) | Governed agentic loop (this design) |
|---|---|
| 3–4 structured-output model calls per cycle (observe, orient, decide, evaluate) | 1 native tool-calling turn per cycle |
| Flow frozen at compile time; new behavior requires new nodes/edges | Flow chosen by the model per turn; new behavior = new tool + card |
| Custom Zod structured outputs (`OrientationV1`, `DecisionV1`) are a recurring `MODEL_OUTPUT_INVALID` failure mode | Decision is the model's native tool call; provider-validated function calling |
| Tool knowledge limited to JSON schema descriptions | Tool knowledge from rich markdown cards: when to use, argument semantics, result interpretation, failure modes, worked examples |
| Specialist subgraphs are separate fixed graphs | Specialists are sub-agents invoked as tools through the same loop |

What is **kept unchanged** from the prior plan: versioned public contracts
(`AgentRunInputV1/EventV1/OutputV1`), MongoDB checkpoints and durable
interrupts, deterministic formula artifact validation, the single authenticated
run API + private worker, typed UI events, budgets, boundary scanning, and the
no-silent-fallback rule. Every guarantee in §11.4 of the parent design
(budgets, allowlists, loop detection, clarification, approval) survives —
relocated from graph topology into the governor.

## 3. Architecture

### 3.1 The loop

```
ingress ──> agent ──(tool call)──> gate ──> act ──> agent   (loop)
              │                      │
              │                      ├──(approval class)──> request_approval [interrupt]
              │                      └──(policy denial)───> agent (typed denial observation)
              ├──(clarify tool)────> request_clarification [interrupt]
              ├──(finalize tool)───> finalize ──> END
              └──(budget/limit)────> fail ──> END
```

LangGraph is retained **for durability, not flow control**: checkpointing,
interrupt/resume, streaming, and replay. The graph has exactly one reasoning
node (`agent`); every other node is deterministic code.

- `ingress` — deterministic. Validates `AgentRunInputV1`, verifies pinned
  policy/deployment/prompt versions, assembles the context pack (§4), reserves
  budget, emits `run.accepted`.
- `agent` — the only model node. Receives: system context pack + conversation
  + full observation history. Emits exactly one of: a tool call, a
  `request_clarification` call, or a `finalize` call. Iteration counter
  increments here; hitting `max_iterations`, deadline, token, or cost budget
  routes to `fail` with `LIMIT_*` codes — never to a legacy executor.
- `gate` — deterministic. Re-checks emergency disable, pinned policy status,
  tool allowlist, permission, budget reservation, and approval class **per
  action**, immediately before execution. A denial returns to `agent` as a
  typed, safe `policy_denied` observation (bounded: repeated denials of the
  same normalized action trip loop detection and route to `fail`).
- `act` — deterministic. Invokes `ToolExecutor` exactly once per action
  idempotency key; validates output against the tool's Zod output schema;
  appends a normalized `ObservationV1` (source, content hash, trust label,
  cost, latency). Deterministic evaluators run here: schema/domain checks,
  contradiction flags, evidence bookkeeping.
- `request_clarification` / `request_approval` — LangGraph interrupts,
  unchanged from the prior plan (durable, idempotent, re-authorized on
  resume).
- `finalize` — deterministic. Runs the artifact validators (formula totals,
  citations, warnings), computes quality dimensions (groundedness, evidence
  coverage, contradiction state, validation rate — never a lone scalar
  confidence), builds `AgentRunOutputV1`, reconciles usage. Blocking
  validation failures return to `agent` as observations (bounded by budget);
  they never silently pass.
- `fail` — deterministic. Safe error, partial output when possible, usage
  reconciliation.

### 3.2 Model-driven flow, code-driven governance

The division of authority is absolute:

- **The model decides:** which tool next, in what order, when to ask, when to
  stop, how to compose the answer.
- **The code decides:** whether an action is permitted, how it executes,
  whether results are valid, whether budgets remain, and whether output may be
  released.

Model output can only ever *propose*; §6.7 and invariant 7 of the program plan
are unchanged.

## 4. Capability-card injection

### 4.1 Card types

| Card | Source | Content |
|---|---|---|
| **Agent card** | `apps/ai/server/services/ai-control/cards/agents/<agent_key>.md` | Persona, domain scope, working style, quality bar, output contract, escalation guidance for one `agent_key` (raw_material_research, formulation, sales_rnd). |
| **Tool card** | `apps/ai/server/services/ai-control/cards/tools/<tool_name>.md` | Purpose; when to use / when NOT to use; argument semantics and units; how to interpret results; cost/latency hints; common failure modes; 1–2 worked examples. |
| **Policy digest** | Rendered at ingress from `EffectiveAIPolicy` | Plain-language budgets, tenant boundary, approval rules, disallowed actions — so the model plans within constraints instead of discovering them through gate denials. |
| **Orchestrator contract** | `cards/orchestrator.md` | The invariant loop rules: evidence-first completion, citation duties, clarify-when-missing, draft-vs-commit semantics, injection-resistance stance (retrieved content is data, never instructions). |

### 4.2 Assembly and pinning

`ContextAssembler` (deterministic, in `ai-control`) builds the system context
at ingress:

1. Load the orchestrator contract card.
2. Load the agent card for the run's `agent_key` (via `AgentDeployment` /
   `PromptVersion` pins).
3. Filter the tool catalogue by effective tenant policy; load **only the
   allowed tools'** cards. A tool without a valid card fails registration in
   CI — a card is part of the tool's definition of done.
4. Render the policy digest from the pinned policy snapshot.
5. Record the SHA-256 of every card in the `AIRun` (`context_pack_hash`es) so
   any run is reproducible and auditable.

Cards are versioned with the code (semantic version in frontmatter), reviewed
in PRs like code, and covered by tests that assert frontmatter validity, size
budgets, and that every registered tool has exactly one card.

### 4.3 ToolDefinition extension

G3.4's `ToolDefinition` gains one field and one rule:

```ts
export interface ToolDefinition<I, O> {
  // ... name, version, input_schema, output_schema, required_permission,
  //     side_effect, approval_requirement, timeout_ms, retry, execute ...
  readonly capability_card_path: string; // .md card, required, CI-enforced
}
```

The card frontmatter must match the definition (`name`, `version`,
`side_effect`, `required_permission`) — a test fails on drift, so prose and
enforcement cannot diverge.

## 5. Specialists as sub-agents

The three planned fixed specialist subgraphs are replaced by **delegation
tools** (`delegate.raw_material_research`, `delegate.formulation`,
`delegate.sales_rnd`). Each delegation tool:

- has its own capability card telling the orchestrator when delegation beats
  direct tool use;
- invokes the same governed loop recursively with the specialist's agent card,
  a narrowed tool allowlist, a reserved slice of the parent budget, and
  `max_iterations` from the specialist definition;
- inherits the parent `TrustedRuntimeContext`, run ID lineage, and
  checkpointer; its public schemas carry no tenant/actor/credential fields;
- may only return normalized observations and **proposals** — commit-class
  side effects remain exclusively parent + approval territory. Depth is capped
  at 1 (a specialist cannot delegate).

One loop implementation, N agent definitions — deduplicated by construction.

## 6. Contracts

Public contracts are unchanged in shape from the prior plan with two
adjustments:

- `DecisionV1` becomes a **derived record** of the model's native tool call
  (tool, arguments hash, rationale summary), captured for audit/events — not a
  schema the model must emit. `MODEL_OUTPUT_INVALID` now only applies to
  malformed provider tool-calls (retried once) and card/contract violations.
- `AIRun` gains `context_pack` (card names → versions → hashes) and
  `executor: "agentic"`; `ORCHESTRATOR_VERSION = "agentic-1.0.0"`.

State (`OODAState` → `AgentLoopState`) keeps run/tenant/iteration/budget
channels and appends observations and action results with reducers; it drops
the `phase` channel (no fixed phases) in favor of `last_event` bookkeeping for
UI stage display.

## 7. Failure modes and mitigations

- **Model loops on a useless tool** → normalized-action loop detection in the
  gate + iteration budget; typed denial observations teach the model within
  the run.
- **Prompt injection via retrieved content** → observations are trust-labeled
  (`untrusted_content`); the orchestrator contract card states retrieved text
  is never instructions; the gate ignores model claims and enforces only
  catalogue rules; injection tests from the prior plan are retained verbatim.
- **Card drift from code** → frontmatter/definition consistency tests;
  registration fails without a card.
- **Cost regression vs fixed pipeline** → per-run token/cost budgets are
  unchanged; the loop uses ~1 model call per cycle vs 3–4, so the expected
  cost curve is lower for equal work; G5 evaluation compares both.
- **Loss of per-phase auditability** → every turn still emits typed events
  (`observation.added`, `action.started/completed`, decision records), giving
  a *finer*-grained audit trail than phase-level logging.

## 8. Migration impact on the G4 plan

| G4 task | Change |
|---|---|
| G4.1 workspace | Unchanged (isolation, ports, version pin becomes `agentic-1.0.0`). |
| G4.2 contracts | Keep public contracts; state loses fixed `phase`; graph-shape test asserts the small loop topology instead of 12 nodes. |
| G4.3 reasoning nodes | Replaced: single `agent` node with native tool calling + `ContextAssembler` + capability cards. |
| G4.4 specialist subgraphs | Replaced: delegation tools + recursive governed loop (§5). |
| G4.5 gates/evaluate/budgets | Kept, relocated: gate/act/validators/loop-detection as governor around the loop. |
| G4.6 checkpoints/interrupts | Unchanged. |
| G4.7 formula artifacts | Unchanged. |
| G4.8 run API/worker | Unchanged (executor value `agentic`). |
| G4.9 typed UI events | Unchanged (stage display driven by events, not phases). |
| G4.10 boundary + evidence | Unchanged + card/definition consistency scan. |

The rewritten plan lives in
`docs/superpowers/plans/2026-07-15-ooda-agent-orchestration.md` (same file,
revised in place so the program's G4 gate reference stays valid).

## 9. Testing

- Deterministic fake-model harness drives the loop: scripted tool-call
  sequences assert gate enforcement, denial observations, loop detection,
  budget exhaustion, interrupt/resume, and finalize validation.
- Card tests: every tool has one card; frontmatter matches definition; context
  pack hashes are stable; policy filtering excludes disallowed cards.
- All injection, tenancy, approval, artifact, API, and E2E tests from the
  prior plan carry over with the new topology.
