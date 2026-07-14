---
name: formula.draft
version: 1.0.0
kind: tool
side_effect: draft_write
required_permission: formula:draft
---

# formula.draft — generate a new draft formula from a concept brief

## Purpose

Create a new cosmetic formula as a **draft** from a product concept: the
formulation engine selects raw materials phase-by-phase (water / oil /
active / emulsifier / preservative / pH adjuster), allocates percentages
within phase budgets, runs regulatory and compatibility validation, and
persists the result with status `draft`. Drafts are proposals — they never
become official until a manager confirms them with `formula.confirm`.

## When to use

- The user asks to create/แนะนำสูตรใหม่: "ช่วยคิดสูตรเซรั่มลดริ้วรอย",
  "formulate a brightening toner under 800 THB/kg".
- Brainstorming product concepts where a concrete ingredient table with
  percentages is more useful than prose.
- After `formula.search` confirmed no suitable existing formula.

## When NOT to use

- To modify an existing formula — use `formula.revise` (it preserves
  lineage and reads the comment thread).
- When required inputs are missing: if you do not know the product type or
  the target benefits, ask the user (request clarification) instead of
  guessing.
- To make a formula official — that is `formula.confirm` (manager-approved
  commit), never this tool.

## Arguments

- `product_type` (required enum): `serum` | `cream` | `lotion` | `toner` |
  `cleanser` | `mask` | `sunscreen` | `shampoo`. Map Thai product words
  (เซรั่ม → serum, ครีม → cream, โทนเนอร์ → toner) before calling.
- `target_benefits` (required string[], 1–10): desired benefits, Thai or
  English — e.g. ["anti-aging", "ความชุ่มชื้น", "brightening"].
- `constraints` (optional object):
  - `budget_per_kg_thb` (number, THB per kg): raw-material cost ceiling.
  - `excluded_ingredients` (string[], max 30): INCI names to avoid
    (allergies, client bans).
  - `max_ingredients` (int 3–20): cap on ingredient count (engine default
    is around 12).
- `batch_size_grams` (optional number, default 100): lab sample size used
  to compute per-ingredient gram amounts.
- `reference_notes` (optional string, ≤500 chars): texture/positioning
  notes, e.g. "lightweight gel texture, for sensitive skin".

## Result interpretation

- Returns the created draft: `formula_id`, `status: "draft"`,
  `formula_name`, `batch_size_grams`, `total_percentage`, and
  `ingredients[]` with `rm_code`, `inci_name`, `trade_name`, `phase`,
  `percentage`, `amount_grams`, and a per-ingredient `rationale`.
- `total_percentage` should be 100; small rounding drift is normalized by
  the engine.
- `warnings[]` is the regulatory/compatibility report. Severity `critical`
  (e.g. an ingredient over its legal usage limit, incompatible pair)
  **must** be surfaced to the user prominently and usually warrants an
  immediate revision; `warning` should be mentioned; `info` is advisory.
- Always present the draft as a proposal awaiting human review — cite the
  `formula_id` so the user can comment, revise, or confirm.

## Failure modes

- `TOOL_INPUT_INVALID`: unknown product type, empty benefits, or stray
  fields. Re-map the user's words to the enum and retry once with fixed
  arguments.
- `TOOL_APPROVAL_REQUIRED`: tenant policy escalated drafting to manager
  approval — tell the user approval is pending; do not work around it.
- `TOOL_EXECUTION_FAILED` / `TOOL_TIMEOUT` (30 s budget): the engine could
  not complete (e.g. no candidate ingredients under the budget). Relax the
  tightest constraint (usually `budget_per_kg_thb`) only with the user's
  agreement.
- Drafts are idempotent per step: repeating the identical call in the same
  step returns the already-created draft, not a second one.

## Example

User: "ขอสูตรเซรั่มหน้าใส งบไม่เกิน 1,500 บาท/กก. ห้ามใส่น้ำหอม"

Call:

```json
{
  "product_type": "serum",
  "target_benefits": ["brightening", "ความชุ่มชื้น"],
  "constraints": {
    "budget_per_kg_thb": 1500,
    "excluded_ingredients": ["Fragrance", "Parfum"]
  },
  "batch_size_grams": 100
}
```

Present the ingredient table grouped by phase, lead with any `critical`
warnings, and note the draft's `formula_id` for follow-up.
