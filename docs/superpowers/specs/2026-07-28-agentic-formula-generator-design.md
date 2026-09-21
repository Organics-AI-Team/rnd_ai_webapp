# Agentic Formula Generator + Sustainable Chem/Formula Data Migration — Design

**Status:** Draft for review · **Date:** 2026-07-28 · **Branch:** `v2/dev`
**Supersedes/extends:** `2026-07-15-agentic-orchestrator-design.md` (design of record for the governed agentic loop), `2026-03-30-ai-formula-tools-design.md`.

---

## 1. Context

`rd_ai_gen2` is the production project (running live at `rndai.erporganics.com`
on the IT-account droplet). Today's fresh database was populated by hand with a
3,049-item raw-material catalog imported from the legacy `rnd_ai` folder via
throwaway `ssh + node` scripts. Two problems remain:

1. **The migration is not sustainable.** It was ad-hoc, non-idempotent, run
   off-repo, and covered only raw materials (no formulas, no INCI reference, no
   AI knowledge index). Benefits/CAS columns are empty (`-`).
2. **The AI can't yet formulate from grounded data.** The governed agentic
   generator and its tools already exist in the codebase, but the corpora those
   tools read (Qdrant knowledge collections, the `formulas` collection, enriched
   `products`) are empty on the fresh DB, so retrieval fails closed and the
   agent has nothing to ground on.

### What already exists (reuse — do NOT rebuild)

The governed **dynamic agentic loop** and its tools are implemented:

- **Orchestrator** (`packages/ai-orchestration/src/`): one model-driven `agent`
  node (`nodes/agent.ts`) that owns flow; deterministic governor
  (`nodes/gate.ts` authz/policy, `nodes/act.ts`, `loop-detection.ts`,
  `nodes/finalize.ts`, `nodes/fail.ts`); `nodes/request-clarification.ts` and
  `nodes/request-approval.ts` interrupts; `checkpoint.ts` / `resume.ts`
  durability; typed `events.ts`; capability-card injection via
  `context/context-pack.ts`.
- **Formula artifacts**: `artifacts/formula-schema.ts` (`FormulaArtifactV1` —
  decimal-string percentages/amounts/costs, per-ingredient `source_ids` +
  `rationale`, claims with evidence, warnings), `artifacts/formula-validator.ts`
  (sole authority; exact 100% ±0.01 via `decimal.js`; the model never
  self-certifies), `artifacts/formula-finalizer.ts`.
- **Governed tools + capability cards**
  (`apps/ai/server/services/ai-control/tools/` + `cards/tools/`):
  `web.search`, `knowledge.search` (semantic RAG over raw-material corpora — FDA
  ~31k, curated cosmetic profiles, supplier/stock — plus tenant docs, every
  result carries provenance), `formula.search`, `formula.draft`,
  `formula.revise`, `formula.confirm`, `formula.comment`, and specialist
  delegation (`delegate.formulation`, `delegate.raw_material_research`,
  `delegate.sales_rnd`).
- **Run API**: `apps/web/app/api/ai/runs/route.ts`, `runs/[runId]/events`
  (SSE), `runs/[runId]/resume`.
- **Repositories** (`apps/ai/server/repositories/`): tenant-scoped
  `product-repository.ts`, `formula-repository.ts` (create/list/versions/
  comments/review-queue).

### The three requested capabilities already map to existing tools

| Requested | Existing governed tool | Status |
|---|---|---|
| Web search for new chem | `web.search` | built |
| Reference old chem | `knowledge.search` (materials/FDA/supplier RAG) + `formula.search` (past formulas) | built; **needs corpora populated** |
| Generate from DB ingredients | `formula.draft` → `formula.revise` → `formula-validator` | built; **needs enriched products + grounding** |

**Conclusion:** this is not an AI build. It is (Phase 1) a sustainable data
migration that *grounds* the already-built tools, and (Phase 2) the
composition, verification, and UI surfacing of the existing agentic generator.

---

## 2. Goals & non-goals

### Goals
1. Replace the ad-hoc import with a **versioned, idempotent, one-command data
   pipeline** in the repo (materials + enrichment, formulas, INCI/CosIng
   reference, Qdrant knowledge).
2. **Ground** the existing governed tools so `knowledge.search` /
   `formula.search` return real, cited results.
3. Surface a **fully dynamic (agentic) formula generator** that composes web
   search + reference retrieval + DB-grounded generation at the model's own
   discretion, producing a validated, cited `FormulaArtifactV1`.
4. Everything **production-grade and maintainable**: config not hardcoding,
   dry-run + integrity reports, tests, CI gate, docs/runbook.

### Non-goals (this spec)
- No rewrite of the orchestrator, tools, validator, or run API — reuse as-is.
- No new AI provider stack; use the existing adapter.
- Clerk **production** instance, CI wiring, and secrets-manager migration are
  tracked as prod-hardening follow-ups (Section 8), not blockers for the data +
  generator work.
- No import of unrelated legacy tables (activity_log, CRM, etc.).

---

## 3. Principles (load-bearing)

1. **Dynamic agentic, never a fixed workflow.** The model-driven `agent` node
   decides every action — which tool, how many times, in what order, whether to
   ask a clarifying question, whether to generate now or gather more, or to
   answer with no web search at all. There is **no hardcoded sequence**. This is
   the design of record (`2026-07-15-agentic-orchestrator-design.md`) and is
   binding here.
2. **The governor bounds, it does not sequence.** The only deterministic parts
   are safety bounds — tenant authorization, per-run token/cost budget,
   loop-detection, and the formula validator at finalize — plus clean failure.
   They constrain the loop; they never dictate the order of reasoning.
3. **Grounding determines quality.** Generator output is only as good as the
   corpus. Data-first is therefore the critical path.
4. **Sustainable by construction.** Import is code (idempotent, re-runnable,
   tested, documented), driven by config; no console-run migrations, no
   hardcoded paths.
5. **Tenant isolation preserved.** All imported private data carries `tenantId`
   and flows through the tenant-scoped repositories; reference data (INCI/CosIng,
   FDA) is platform-global read-only.

---

## 4. Architecture

Two **build** phases in one repo. At **runtime** there are no phases — one
free-running governed agentic loop.

```
BUILD PHASE 1 — Data (grounding)              BUILD PHASE 2 — Compose + surface
 rnd_ai/ exports ─▶ import pipeline ─▶ Mongo   reuse orchestrator + tools:
   rm_lines           (npm run import:*)          agent loop composes, dynamically,
   rd_formulas       ┌ products (enriched)         web.search · knowledge.search ·
   inci_lines        │ formulas (+lines)           formula.search · formula.draft ·
   cosing            │ inci_reference              formula.revise → validator
   myskin scrape     └ Qdrant knowledge     ◀── grounds ──┘  → finalize: cited
                                                              FormulaArtifactV1
RUNTIME: one agentic loop (no phases) inside deterministic guardrails.
```

---

## 5. Phase 1 — Data migration & enrichment

### 5.1 Source inventory (`client_projects/organics_group/rnd_ai/`)

| Source file | Rows | Role |
|---|---|---|
| `internal_raw/sql_raw/rm_lines.csv` | 3,070 | raw materials (rm_code, trade_name, inci_name, supplier, rm_cost, company) |
| `internal_raw/sql_raw/inci_lines.csv` | 11,450 | INCI master (CAS, TH/EN names, FDA number) |
| `inci_datasets/cosing_ingredients_clean_final.csv` | ~30k | CosIng reference (function, restriction) |
| `internal_raw/sql_raw/rd_formulas.csv` | 5,844 | formula headers |
| `internal_raw/sql_raw/rd_formula_lines.csv` | (23 MB) | formula ingredient lines |
| `internal_raw/sql_raw/formula_masters.csv` | 474 | registered/approved formula masters |
| `myskin_scraping/raws/…clean.csv` | (126 MB) | market product scrape → AI knowledge |

Source paths are **config**, not hardcoded (an `import.config.ts` maps dataset →
absolute-or-relative source path + target; the `rnd_ai` export is treated as an
external drop-in, not committed to this repo).

### 5.2 Target collections & schemas

- **`products`** (tenant-scoped; extends today's import). Canonical fields
  already used by `map_product_response`: `productCode`/`rm_code`,
  `productName`/`trade_name`, `INCI_name`, `supplier`, `price`/`rm_cost`,
  `company_name`, `stockQuantity`, `isActive`, plus stamps (`tenantId`,
  `actorProfileId`, `ownerProfileId`). **Enrichment (new):** `cas_no` (join
  `inci_lines` by INCI), `benefits[]` / `usecase[]` and `functions[]` (from
  CosIng function classes), `restrictions[]` (CosIng regulatory limits).
- **`formulas`** (+ lines) (tenant-scoped; via `formula-repository`). Header from
  `rd_formulas`/`formula_masters` (name, product_code, version, status), lines
  from `rd_formula_lines` **linked to `products` by `rm_code`** with
  `percentage`/`amount`. Preserve version history. Unmatched rm_codes recorded
  in the integrity report, not silently dropped.
- **`inci_reference`** (platform-global, read-only): INCI → {CAS, function,
  restriction, FDA number}. Backs enrichment and future validation. Not
  tenant-scoped (public reference).
- **Qdrant collections** (what `knowledge.search` reads):
  - `market_knowledge` — myskin scrape, chunked + embedded (public market
    products the agent can cite).
  - `formula_knowledge` — the tenant's imported formulas, embedded, tenant
    payload-filtered (retrieval of "similar past formulas").
  - Reuse the existing embedding version/config already referenced by
    `knowledge.search`; do not invent a new one.

### 5.3 Import pipeline (`apps/ai/scripts/import/`)

- One module per dataset — small, single-purpose, testable:
  `import-materials.ts`, `import-formulas.ts`, `import-reference.ts`,
  `import-knowledge.ts`, plus shared `csv.ts`, `enrich.ts`, `report.ts`, and
  `import.config.ts`. Today's `import-rm-catalog.ts` folds into
  `import-materials.ts` with the enrichment join added.
- **Idempotent**: upsert by natural key (`tenantId`+`productCode`;
  formula by `tenantId`+product_code+version; reference by INCI). Re-runnable
  in any environment with the same result.
- **`--dry-run`** flag (parse + report, no writes) and a printed **integrity
  report** (rows in / upserted / skipped-with-reason / unmatched foreign keys).
- **One command each** (`npm run import:materials|formulas|reference|knowledge`)
  and **`npm run import:all`** (ordered: reference → materials(enrich) →
  formulas(link) → knowledge). Reads Mongo/Qdrant connection from the env
  contract (Section 8); no `ssh`, no hand-editing.
- **Runbook**: `docs/import/README.md` — where the `rnd_ai` export must be, the
  commands, expected counts, how to re-run for a new tenant.

### 5.4 Tests (Phase 1)
- Unit: CSV parsing (multiline quoted INCI), `map_rm_line_to_product`, enrichment
  joins (CAS/function lookup), formula-line → product linking, natural-key
  idempotency (re-run yields no duplicates).
- Integration: `import:all` into an ephemeral DB (`mongodb-memory-server`,
  already a dep) → assert counts and a spot-checked enriched material + a linked
  formula.

---

## 6. Phase 2 — Governed agentic formula generator

Minimal net-new code. The deliverable is **composition + verification +
surface** of the existing agentic loop, grounded by Phase 1.

### 6.1 The agent (reused, dynamic)
The generator run starts the existing orchestrator with the `agent` node in
control. Given a brief, the model **dynamically** chooses among its allowlisted
tools — any order, any count, or not at all — and loops on tool results until it
decides to finalize or to ask a clarifying question. No sequencing code is added.

### 6.2 Tool allowlist for the generator (all existing)
`web.search`, `knowledge.search`, `formula.search`, `formula.draft`,
`formula.revise` (and `formula.confirm` only behind the existing manager-approval
interrupt for side-effecting confirmation). Allowlist is assembled at ingress
from the tenant's effective AI policy and the capability cards — adding/removing
a tool later is a card + policy change, not a flow change.

### 6.3 Possible new tool (verify need first)
`knowledge.search` already covers ingredient discovery over materials/FDA/
supplier corpora. **If** structured, non-semantic filtering of the tenant's own
`products` is needed for formulation (e.g. "actives under ฿250/kg, paraben-free,
in stock"), add a single governed `material.search` tool over
`product-repository.search_products` with a capability card — mirroring the
existing tool/card pattern. Decide during planning; do not build speculatively.

### 6.4 Grounding & citations
Every `FormulaArtifactV1` ingredient already requires `source_ids` and a
`rationale`; claims require evidence `source_ids`. `knowledge.search` /
`formula.search` / `web.search` return provenance the agent cites. The validator
enforces source-backing (water/solvent and explicitly-declared
`external_unverified` materials exempt). Result: **every generated formula is
traceable to past formulas, DB materials, and/or web sources.**

### 6.5 Clarification & approval (dynamic)
The agent may call `request-clarification` mid-loop (e.g. product type, cost
ceiling, actives to avoid) and resume via the durable checkpoint. Confirming a
formula (a side effect) routes through `request-approval` (manager-gated),
unchanged.

### 6.6 UI surface
Reuse the existing AI surface rather than a new stack. Prefer the
**Sales Formulation AI** page (`/ai/sales-rnd-ai`) as the generator entry, or a
dedicated "Formulate" action on `/formulas/create`, both driving the **same**
run API (`POST /api/ai/runs`) and consuming typed SSE events
(`runs/[runId]/events`) with the existing evidence/clarification/approval UI
components. The generated artifact can be handed into the existing formula draft
flow so the user edits/saves it as a normal formula.

### 6.7 Tests (Phase 2)
- The generator run, given a brief against a seeded corpus, yields a validated
  `FormulaArtifactV1` (100% ±0.01, every non-exempt ingredient source-backed).
- **Dynamism assertions** (guard against regressions to a fixed workflow): a
  brief answerable from the DB alone finalizes with **zero** `web.search` calls;
  a brief needing a novel active triggers `web.search`; a validator rejection
  (total ≠ 100%) causes the agent to re-plan and re-`formula.revise` rather than
  fail. These assert *the model chose*, not that a script ran.
- Tenant isolation: retrieval never returns another tenant's formulas.

---

## 7. Data flow (runtime, end to end)

```
user brief → POST /api/ai/runs → orchestrator ingress
  (assemble capability cards + effective policy + tenant context; pin hashes)
     → agent loop (DYNAMIC):
         model picks tools freely: knowledge.search / formula.search /
         web.search / material.search? / formula.draft / formula.revise;
         may request_clarification and resume;
         governor gates authz + budget + loop-detection each turn
     → model decides it's done → finalize:
         formula-validator (exact 100% ±0.01, source-backing) — authoritative
     → FormulaArtifactV1 emitted as typed SSE events → UI renders cited formula
     → optional: hand to formula.draft/save (manager approval for confirm)
```

---

## 8. Prod-readiness / sustainability

- **Import as code** (Section 5.3): the sole, repeatable migration path.
- **Env contract**: replace the hand-edited droplet `.env` with a documented,
  reproducible env (Mongo, Qdrant, Clerk, AI keys, budgets) — a checked-in
  `.env.example` contract + a load step; no `&`-unquoted values (today's
  sourcing bug). Secrets-manager migration is a follow-up.
- **CI gate** (follow-up): typecheck + tests + `security:scan` (boundary
  scanner) + `build:web` on every push before deploy.
- **Clerk production instance** (follow-up): live keys + custom domain; today it
  runs the dev instance ("Development mode" badge, ~100-user cap).
- **Docs**: `docs/import/README.md` (pipeline) and a short generator page
  (tools, cards, run API, how to add a tool).

---

## 9. Sequencing / milestones

1. **M1 — Import pipeline skeleton + materials(enriched).** `apps/ai/scripts/import/`,
   config, dry-run, report; materials with CAS + functions/benefits. Verify
   picker shows enriched columns.
2. **M2 — Reference + formulas.** `inci_reference`; `formulas` (+lines) linked to
   products; `/formulas` list populated; unmatched-key report clean or explained.
3. **M3 — Qdrant knowledge.** `market_knowledge` + `formula_knowledge` ingested;
   `knowledge.search` / `formula.search` return cited results.
4. **M4 — Generator composition + verification.** Allowlist + cards for the
   generator run; (optional) `material.search`; dynamism + validation + isolation
   tests green.
5. **M5 — UI surface.** Wire the generator entry to the run API + SSE; end-to-end
   grounded, cited generation verified live.
6. **Follow-ups**: env contract, CI, Clerk prod.

Each milestone ships value and is independently verifiable.

---

## 10. Success criteria

- `npm run import:all` on a clean DB reproduces the full grounded corpus
  (materials enriched, formulas linked, reference, Qdrant) idempotently, with a
  clean integrity report; re-running changes nothing.
- `/formulas/create` picker shows enriched materials (CAS/benefits populated);
  `/formulas` shows migrated historical formulas.
- A formula brief produces a validated, **cited** `FormulaArtifactV1` grounded in
  DB materials + past formulas, augmented by web search **only when the model
  chose to** — proven by the dynamism tests.
- No hand-run migration remains; the pipeline, tools, and generator are covered
  by tests and documented.

---

## 11. Resolved decisions (2026-07-28)

1. **`material.search` tool — YES, add it.** A single governed `material.search`
   tool over `product-repository.search_products` with a capability card, for
   structured filtering the semantic `knowledge.search` cannot do (cost ceiling,
   in-stock, exclude-INCI, supplier). Mirrors the existing tool/card pattern.
2. **Generator entry point — dedicated "Formulate" action on
   `/formulas/create`.** Closest to where the gap was felt; drives the same
   `POST /api/ai/runs` + SSE events; the artifact hands into the existing draft
   flow. (`/ai/sales-rnd-ai` may also start a generator run later; not required.)
3. **Formula history depth — latest version per product first.** Import the
   latest `rd_formulas` version per product (+ `formula_masters`) for clean
   grounding; full version history is a follow-up import (the pipeline's
   natural-key upsert supports adding versions later).
4. **CosIng benefits — full function-class map first.** Map all CosIng function
   classes into `benefits`/`usecase`; curate/rename later if the picker filters
   get noisy. Keeps M1 simple and grounding rich.

---

## 12. Risks

- **Legacy CSV quality** (multiline INCI, unmatched rm_codes) → robust parser +
  integrity report + explicit unmatched handling (already validated on materials).
- **Qdrant scale** (126 MB scrape) → chunk/batch ingest with resumable progress;
  ingest is idempotent by source id.
- **Regressing to a fixed workflow** → the dynamism tests (6.7) are the guard;
  the governor must never gain sequencing logic.
