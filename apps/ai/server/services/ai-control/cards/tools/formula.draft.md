---
name: formula.draft
version: 2.0.0
kind: tool
side_effect: draft_write
required_permission: formula:draft:create
---

# formula.draft — submit an evidence-bearing formula candidate

## Purpose

Submit a complete `FormulaArtifactV1` candidate after gathering material
evidence. Decimal strings, material IDs, source IDs, amounts, costs, claims,
warnings, and the mandatory laboratory-review statement are required so the
deterministic artifact service can validate the candidate. The model proposes;
the validator decides. This tool never confirms a formula.

## When to use

- After `knowledge.search` returned retrievable usage/source evidence for each
  non-water material.
- The user supplied enough constraints to construct a complete candidate.
- After `formula.search` confirmed no suitable existing formula.

## When NOT to use

- To modify an existing formula — use `formula.revise` (it preserves
  lineage and reads the comment thread).
- When product requirements or evidence are missing: clarify or search first.
- To make a formula official — that is `formula.confirm` (manager-approved
  commit), never this tool.

## Arguments

- `artifact` (required strict `FormulaArtifactV1`): `name`, `product_type`,
  decimal-string `batch_size`, `batch_unit`, and `ingredients[]` containing
  `material_id`, `rm_code`, `phase`, decimal-string `percentage`/`amount`,
  unit, dated cost when required, `source_ids`, rationale, and water/external
  flags. Include evidence-backed claims and the mandatory review warning.

## Result interpretation

- Returns the canonical artifact unchanged. The loop then checks exact total
  percentage (100 +/- 0.01), amounts, evidence, usage bounds, phases,
  incompatibilities, cost, claims, and mandatory warnings. Blocking findings
  return to the agent for revision; a validated final draft receives a durable
  artifact reference.

## Failure modes

- `TOOL_INPUT_INVALID`: incomplete artifact, numeric values instead of decimal
  strings, missing material/source IDs, or stray fields.
- `TOOL_APPROVAL_REQUIRED`: tenant policy escalated drafting to manager
  approval — tell the user approval is pending; do not work around it.
- `TOOL_OUTPUT_INVALID`: the candidate did not match the canonical artifact.
- Drafts are idempotent per step: repeating the identical call in the same
  step returns the already-created draft, not a second one.

## Example

User: "ขอสูตรเซรั่มหน้าใส งบไม่เกิน 1,500 บาท/กก. ห้ามใส่น้ำหอม"

Call:

```json
{"artifact":{"name":"Brightening serum","product_type":"serum","batch_size":"100","batch_unit":"g","ingredients":[{"material_id":"water","rm_code":"WATER","phase":"A","percentage":"95","amount":"95","unit":"g","cost":"0","source_ids":[],"rationale":"Water base","is_water":true,"external_unverified":false},{"material_id":"rm-nia","rm_code":"RM-NIA","phase":"A","percentage":"5","amount":"5","unit":"g","cost":"1.25","source_ids":["src-nia"],"rationale":"Evidence-backed active","is_water":false,"external_unverified":false}],"claims":[],"warnings":["Laboratory, stability, safety, and regulatory review remain required before production."]}}
```

Present the ingredient table and the deterministic findings; never claim the
draft is production-ready.
