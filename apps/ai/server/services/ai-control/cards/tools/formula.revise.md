---
name: formula.revise
version: 1.0.0
kind: tool
side_effect: draft_write
required_permission: formula:revise
---

# formula.revise — produce an improved draft from comment feedback

## Purpose

Revise an existing formula based on the human feedback recorded in its
comment thread. The revision engine loads the formula and all comments,
categorizes the feedback (suggestions / rejections / approvals / ingredient
mentions), searches for better ingredient alternatives where needed, and
creates a **new draft** linked to the original, with an explicit changelog
of every change and why. This is the human-in-the-loop closer: R&D leaves
comments, the AI proposes the next iteration.

## When to use

- The user asks to act on feedback: "ปรับสูตรตามคอมเมนต์", "revise
  FM-0001 based on the team's comments", "ลดต้นทุนสูตรนี้".
- A formula has `rejection` or `suggestion` comments and the user wants an
  improved version.
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
- `revision_focus` (optional enum, default `all`):
  - `cost` — cheaper alternatives, ราคาถูกลง, keep performance acceptable;
  - `performance` — stronger actives / better efficacy;
  - `safety` — regulatory limits, irritation, sensitive-skin concerns;
  - `all` — balance every dimension raised in the comments.
- `additional_notes` (optional, ≤500 chars): extra instruction from the
  user, e.g. "prioritise natural ingredients", "ห้ามเกิน 12 ส่วนผสม".

## Result interpretation

- Returns `draft_formula_id` (the NEW draft), `parent_formula_id` (the
  original — lineage is preserved), `status: "draft"`, `changelog[]`, and
  `warnings[]`.
- Each changelog entry has `action` (`replaced` | `adjusted_percentage` |
  `added` | `removed` | `modified`), the `ingredient` affected, a `detail`
  explanation, and `driven_by_comment` linking back to the feedback that
  motivated it (null when engine-driven, e.g. a regulatory fix).
- Present the changelog as the headline of your answer — reviewers care
  about *what changed and why* more than the full table. Attribute changes
  to the comments that drove them.
- Treat `critical` warnings exactly as in `formula.draft`: surface first.

## Failure modes

- `TOOL_INPUT_INVALID`: malformed `formula_id` (must be 24 hex chars) or
  unknown focus value.
- `TOOL_EXECUTION_FAILED`: formula not found in this tenant, or it has no
  usable feedback for the requested focus. Verify the id via
  `formula.search`; if there are simply no comments, tell the user and ask
  for direction instead of retrying.
- `TOOL_TIMEOUT` (30 s budget): the alternative-ingredient search can be
  slow; report the failure rather than duplicating the revision.
- Never call revise in a loop to "iterate" without new human feedback in
  between — one revision per feedback cycle.

## Example

User: "ทีมคอมเมนต์ว่าสูตร 665f...c21 แพงไปและกลิ่นแรง ช่วยปรับให้หน่อย"

Call:

```json
{
  "formula_id": "665f00000000000000000c21",
  "revision_focus": "cost",
  "additional_notes": "reduce fragrance load; keep texture unchanged"
}
```

Answer with the changelog (e.g. "replaced X with Y, −220 THB/kg, driven by
คอมเมนต์ของคุณเมย์"), the new `draft_formula_id`, and the note that a
manager must confirm it to make it official.
