---
name: formula.search
version: 1.0.0
kind: tool
side_effect: read
required_permission: formula:read
---

# formula.search — find existing formulas (สูตร) in this tenant

## Purpose

Look up formulas that already exist for this tenant: by product name,
ingredient (INCI or trade name), target benefit, client, or remark text.
This is the reference/inspiration lookup — the governed replacement for the
legacy `search_reference_formulas` tool. Results are always scoped to the
current tenant by trusted code; you cannot and need not specify a tenant.

## When to use

- The user asks "มีสูตรอะไรบ้าง..." / "what formulas do we have for X?".
- Before drafting a new formula, to check for near-duplicates or reusable
  reference formulas for the same product type or client.
- To find the `formula_id` you need for `formula.revise`,
  `formula.comment`, or `formula.confirm`.
- To compare how an ingredient (e.g. Niacinamide) is dosed across existing
  formulas.

## When NOT to use

- To discover raw materials or ingredient candidates — use
  `knowledge.search` (it searches ingredient knowledge, not formulas).
- To read a formula's discussion thread or comment feedback — that context
  arrives via `formula.revise`, which loads comments itself.
- For public/regulatory information — use `web.search`.
- Do not call it repeatedly with the same query hoping for new results;
  results are deterministic for a given database state.

## Arguments

- `query` (string, required, 1–200 chars): free text matched
  case-insensitively against formula name, ingredient product/INCI names,
  target benefits, remarks, and client. Thai or English (e.g.
  "เซรั่มลดริ้วรอย", "vitamin C serum", a client name).
- `status` (optional enum): `draft` | `testing` | `approved` | `rejected` |
  `confirmed`. Use `draft` to find work-in-progress, `confirmed` for
  official versions.
- `client_name` (optional string): narrow to one client (partial match).
- `benefits` (optional string[], max 10): benefit keywords; a formula
  matches if any benefit matches.
- `limit` (optional int 1–20, default 10): maximum formulas returned,
  newest updated first.

## Result interpretation

- `result_count` and `formulas[]`, sorted by most recently updated.
- Each item: `formula_id` (use this ID for follow-up tools),
  `formula_code` (e.g. "FM-0001", may be null), `formula_name`, `version`
  (integer; official versions are labelled v01, v02, ... on confirm),
  `status`, `client_name`, `target_benefits`, `ingredient_count`,
  `total_amount_grams`, `updated_at` (ISO timestamp).
- An empty list is a real answer: no matching formula exists — say so and
  offer to draft one; do not invent formulas.
- Text matching is substring/regex based, not semantic: if a Thai query
  returns nothing, retry once with the English term (or vice versa) before
  concluding nothing exists.

## Failure modes

- `TOOL_INPUT_INVALID`: empty query, query over 200 chars, unknown status
  value, or any extra/identity field. Fix the arguments; never retry the
  same invalid call.
- `TOOL_NOT_ALLOWED` / `TOOL_PERMISSION_DENIED`: this tenant or user cannot
  read formulas; tell the user instead of trying another tool.
- `TOOL_TIMEOUT` (10 s budget): retried once automatically; if it still
  fails, report the lookup as unavailable.
- Overly generic queries ("ครีม") return broad, low-value matches — prefer
  the most specific term the user gave.

## Example

User: "เคยทำเซรั่มไนอาซินาไมด์ให้ลูกค้า ABC ไหม" (have we made a niacinamide
serum for client ABC?)

Call:

```json
{ "query": "niacinamide serum", "client_name": "ABC", "limit": 5 }
```

Read `formulas[]`; if one matches, cite its `formula_code`, `version`, and
`status` in the answer and keep its `formula_id` for follow-up actions.
