---
name: formula.confirm
version: 2.0.0
kind: tool
side_effect: commit
required_permission: formula:confirm
---

# formula.confirm — commit a validated AI artifact (manager only)

## Purpose

Commit a deterministically validated `AIArtifact` into a tenant formula, mark
the artifact confirmed, and write the immutable confirmation version log. This
is the only commit-class formula action: it requires `formula:confirm` and a
durable manager approval bound to the exact run, tool, and canonical arguments.

## When to use

- A manager explicitly instructs: "ยืนยัน artifact นี้เป็นสูตรจริง".
- The team finished reviewing a draft (from `formula.draft` or
  `formula.revise`) and the manager approves publishing it.

## When NOT to use

- On arbitrary formula records; this commit accepts validated AI artifact IDs.
- When the requester is not a manager or no approval has been granted:
  do not attempt the call "to check" — request approval through the
  proper interrupt flow and wait.
- To express informal agreement — that is a `formula.comment` with type
  `approval`, which changes nothing.
- Never chain confirm immediately after draft/revise in one breath without
  an explicit human decision in between: draft-then-confirm must always
  cross a human review boundary.

## Arguments

- `artifact_id` (required, 24-hex id): the validated draft artifact reference
  returned by the governed run.
- `remarks` (optional string, ≤500 chars): confirmation note recorded in
  the immutable version log, e.g. "approved after stability test round 2"
  or "ผ่านการทดสอบความคงตัวแล้ว".

## Result interpretation

- Returns `artifact_id`, the committed `formula_id`, `status: "confirmed"`,
  and `already_committed`. After success, the validated artifact is linked to
  the official tenant formula and the immutable confirmation log.
- The action is idempotent per step: replaying the identical confirmed
  call returns the recorded result and does not bump the version twice.

## Failure modes

- `TOOL_APPROVAL_REQUIRED`: no durable manager approval covers this exact
  action. Tell the user approval is pending; the run will pause at an
  approval checkpoint. Do not retry in a loop.
- `TOOL_PERMISSION_DENIED`: the acting user lacks `formula:confirm`
  (program rule: only managers confirm; users create and revise drafts).
- `AI_ARTIFACT_NOT_FOUND`: the artifact is missing or outside the tenant.
- `FORMULA_COMMIT_NOT_APPROVED`: the exact artifact/run action is not approved.
- `TOOL_INPUT_INVALID`: malformed id or over-length remarks.

## Example

Manager: "ยืนยันสูตร FM-0001 (draft) เป็นเวอร์ชันทางการ หมายเหตุ:
ผ่าน stability test 4 สัปดาห์"

Call (after the manager approval checkpoint is granted):

```json
{
  "artifact_id": "665f00000000000000000c21",
  "remarks": "ผ่าน stability test 4 สัปดาห์"
}
```

Answer with the committed `formula_id` and note the immutable version log.
