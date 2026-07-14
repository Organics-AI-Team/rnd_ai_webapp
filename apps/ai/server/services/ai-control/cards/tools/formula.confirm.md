---
name: formula.confirm
version: 1.0.0
kind: tool
side_effect: commit
required_permission: formula:confirm
---

# formula.confirm — commit a draft as an official version (manager only)

## Purpose

Transition a formula from `draft` to `confirmed`: bump the version number
(v01 → v02 → ...), write an immutable version log entry with a full
ingredient snapshot, and post a system `version_update` note in the thread.
Version numbers increase **only** here, so every version label represents a
human-approved milestone. This is the only commit-class formula action:
it requires the `formula:confirm` permission (managers) **and** a durable,
pre-approved manager approval bound to this exact formula and arguments.

## When to use

- A manager explicitly instructs: "ยืนยันสูตรนี้เป็นเวอร์ชันจริง",
  "confirm draft 665f...c21 as official".
- The team finished reviewing a draft (from `formula.draft` or
  `formula.revise`) and the manager approves publishing it.

## When NOT to use

- On any formula whose status is not `draft` — confirming a confirmed,
  testing, or rejected formula is invalid by design.
- When the requester is not a manager or no approval has been granted:
  do not attempt the call "to check" — request approval through the
  proper interrupt flow and wait.
- To express informal agreement — that is a `formula.comment` with type
  `approval`, which changes nothing.
- Never chain confirm immediately after draft/revise in one breath without
  an explicit human decision in between: draft-then-confirm must always
  cross a human review boundary.

## Arguments

- `formula_id` (required, 24-hex id): the draft formula to confirm.
- `remarks` (optional string, ≤500 chars): confirmation note recorded in
  the immutable version log, e.g. "approved after stability test round 2"
  or "ผ่านการทดสอบความคงตัวแล้ว".

## Result interpretation

- Returns `formula_id`, `formula_code`, `previous_version`, `new_version`,
  `version_label` (e.g. "v02"), and `status: "confirmed"`.
- After success: the formula is official, the ingredient snapshot at this
  moment is frozen in the version log, and a `version_update` comment
  appears in the thread automatically. Report the new `version_label`
  to the user.
- The action is idempotent per step: replaying the identical confirmed
  call returns the recorded result and does not bump the version twice.

## Failure modes

- `TOOL_APPROVAL_REQUIRED`: no durable manager approval covers this exact
  action. Tell the user approval is pending; the run will pause at an
  approval checkpoint. Do not retry in a loop.
- `TOOL_PERMISSION_DENIED`: the acting user lacks `formula:confirm`
  (program rule: only managers confirm; users create and revise drafts).
- `TOOL_EXECUTION_FAILED`: the formula is missing or not in `draft` status
  — check current status via `formula.search` and report it honestly
  (e.g. "already confirmed as v03").
- `TOOL_INPUT_INVALID`: malformed id or over-length remarks.

## Example

Manager: "ยืนยันสูตร FM-0001 (draft) เป็นเวอร์ชันทางการ หมายเหตุ:
ผ่าน stability test 4 สัปดาห์"

Call (after the manager approval checkpoint is granted):

```json
{
  "formula_id": "665f00000000000000000c21",
  "remarks": "ผ่าน stability test 4 สัปดาห์"
}
```

Answer: "FM-0001 ได้รับการยืนยันเป็น v02 แล้ว" citing `version_label` and
noting the immutable version log entry.
