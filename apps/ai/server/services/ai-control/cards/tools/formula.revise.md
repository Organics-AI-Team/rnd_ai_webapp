---
name: formula.revise
version: 2.0.0
kind: tool
side_effect: draft_write
required_permission: formula:draft:update_own
---

# formula.revise — submit a revised evidence-bearing candidate

## Purpose

Submit a complete replacement `FormulaArtifactV1` linked to an existing draft
owned by the acting user. Use prior formula/comment observations and fresh
material evidence to construct the candidate. Ownership is rechecked by the
tenant repository; deterministic validation remains authoritative.

## When to use

- The user asks to act on feedback: "ปรับสูตรตามคอมเมนต์", "revise
  FM-0001 based on the team's comments", "ลดต้นทุนสูตรนี้".
- A formula has review feedback already present in the run context and the user
  wants an improved evidence-bearing candidate.
- Cost, performance, or safety concerns were raised about an existing
  formula and the user wants a concrete alternative.

## When NOT to use

- To create a formula from scratch (no parent) — use `formula.draft`.
- When there is no feedback and no stated revision goal: ask the user what
  to improve rather than revising blindly.
- To record feedback without changing the formula — use `formula.comment`.
- To publish the revision — the new draft still requires `formula.confirm`
  by a manager.

## Arguments

- `formula_id` (required, 24-hex MongoDB id): the formula to revise. Get it
  from `formula.search` — never fabricate one.
- `artifact` (required): the complete canonical replacement candidate using
  the same decimal/evidence contract as `formula.draft`.
- `revision_summary` (required, <=1000 chars): safe summary of what changed and
  which user/review constraint drove it. It is audit context, not hidden chain
  of thought.

## Result interpretation

- Returns the canonical revised artifact. The loop validates it and surfaces
  blocking/warning findings. Present the safe revision summary, changed rows,
  evidence, and validation results.

## Failure modes

- `TOOL_INPUT_INVALID`: malformed `formula_id`, invalid canonical artifact, or
  missing revision summary.
- `FORMULA_NOT_FOUND`: missing, cross-tenant, or not-owned parent. Do not probe.
- `TOOL_TIMEOUT` (30 s budget): the alternative-ingredient search can be
  slow; report the failure rather than duplicating the revision.
- Never call revise in a loop to "iterate" without new human feedback in
  between — one revision per feedback cycle.

## Example

User: "ทีมคอมเมนต์ว่าสูตร 665f...c21 แพงไปและกลิ่นแรง ช่วยปรับให้หน่อย"

Call:

```json
{"formula_id":"665f00000000000000000c21","artifact":{"name":"Revised serum","product_type":"serum","batch_size":"100","batch_unit":"g","ingredients":[{"material_id":"water","rm_code":"WATER","phase":"A","percentage":"100","amount":"100","unit":"g","cost":"0","source_ids":[],"rationale":"Water base","is_water":true,"external_unverified":false}],"claims":[],"warnings":["Laboratory, stability, safety, and regulatory review remain required before production."]},"revision_summary":"Reduced unsupported materials and recalculated the batch."}
```

Answer with the safe change summary and deterministic validation results; a
manager must still confirm any eventual commit.
