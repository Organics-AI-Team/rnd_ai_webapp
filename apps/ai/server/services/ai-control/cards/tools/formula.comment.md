---
name: formula.comment
version: 1.0.0
kind: tool
side_effect: draft_write
required_permission: formula:comment
---

# formula.comment — record a note in a formula's discussion thread

## Purpose

Append one structured comment to a formula's comment thread (the same
thread human R&D reviewers use). Comments are the durable, auditable way to
attach analysis, suggestions, or review notes to a formula so that later
revisions (`formula.revise`) can act on them.

## When to use

- The user asks you to leave feedback: "ช่วยคอมเมนต์สูตรนี้",
  "note that the preservative system looks weak".
- After you analyzed a formula and produced findings worth persisting for
  the team, and the user agreed to record them.
- To summarize a decision the user made in chat so it is visible in the
  formula thread ("client approved direction, awaiting stability test").

## When NOT to use

- To change the formula itself — use `formula.revise`.
- To approve/publish a version — `approval`-type comments do NOT confirm a
  formula; only `formula.confirm` (manager) does.
- Do not post unsolicited comments: record only what the user asked for or
  explicitly agreed to persist.
- Never write secrets, credentials, or personal data into a comment.

## Arguments

- `formula_id` (required, 24-hex id): the target formula, from
  `formula.search`.
- `content` (required string, 1–2000 chars): the comment body. Write in the
  user's language (Thai for Thai teams). Be specific and reference
  ingredients by INCI name.
- `comment_type` (optional enum, default `feedback`):
  - `feedback` — general observation;
  - `suggestion` — a concrete proposed change ("ลด Niacinamide เหลือ 5%");
  - `approval` — a stakeholder's positive verdict (informational only);
  - `rejection` — a stakeholder's negative verdict with reasons;
  - `revision_note` — context accompanying an AI-generated revision.
  The `version_update` type is reserved for the system and cannot be set
  here.

## Result interpretation

- Returns `comment_id`, the `formula_id`, the recorded `comment_type`, and
  `created_at` (ISO timestamp).
- The comment is immediately visible in the formula's thread and will be
  weighed by future `formula.revise` runs — `suggestion` and `rejection`
  types drive revision behavior most strongly, so choose the type
  deliberately.
- Confirm to the user what was recorded, quoting the stored content.

## Failure modes

- `TOOL_INPUT_INVALID`: empty content, content over 2000 chars, malformed
  id, or an unsupported comment type (including attempts to use
  `version_update`). Shorten or restructure, then retry once.
- `TOOL_EXECUTION_FAILED`: the formula does not exist in this tenant —
  re-check the id with `formula.search`.
- Duplicate protection: repeating the identical call in the same step
  returns the already-created comment instead of posting twice; still,
  do not deliberately post the same content in multiple steps.

## Example

User: "ช่วยบันทึกไว้ในสูตรว่า ลูกค้าขอลดความเหนียวเนื้อครีม และลอง
substitute dimethicone"

Call:

```json
{
  "formula_id": "665f00000000000000000c21",
  "content": "ลูกค้า feedback: เนื้อครีมเหนียวเกินไป ขอให้ลองแทน Dimethicone ด้วย silicone alternative ที่เบากว่า เช่น C13-15 Alkane",
  "comment_type": "suggestion"
}
```

Reply confirming the recorded suggestion and offer to run
`formula.revise` once the team is ready.
