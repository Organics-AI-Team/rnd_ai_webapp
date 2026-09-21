---
name: delegate.formulation
version: 1.0.0
kind: tool
side_effect: read
required_permission: ai:run
---

# delegate.formulation — hand a drafting sub-task to the formulation specialist

## Purpose

Run the Formulation specialist as a bounded sub-loop. It searches the tenant's
formulas and knowledge, drafts or revises a formula (draft-class only), and
returns the draft plus its rationale as proposals. It can never confirm — a
confirmed formula always remains a human, parent-driven decision.

## When delegation beats a direct tool call

- The task is "produce or revise a reviewable draft" from a brief or feedback,
  which benefits from several phased reasoning steps.
- You want the draft accompanied by evidence and changelog, not a raw
  `formula.draft` call with no framing.
- Prefer a direct `formula.search` for a simple lookup.

## Budget cost

Reserves ~40% of the run's remaining budget before dispatch (drafting is heavier
than pure retrieval). Refused if the reserved slice is too small.

## How to interpret the result

- `summary` describes the proposed draft; `proposals` are its draft/read actions
  (never commit). `evidence_ids` cite the sources behind the draft.
- Treat the draft as a proposal for a human chemist. To commit it, YOU call the
  governed `formula.confirm` tool — the specialist cannot.
