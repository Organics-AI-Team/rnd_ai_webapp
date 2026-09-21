---
name: delegate.raw_material_research
version: 1.0.0
kind: tool
side_effect: read
required_permission: ai:run
---

# delegate.raw_material_research — hand a research sub-task to the ingredient specialist

## Purpose

Run the Raw-Material Research specialist as a bounded, read-only sub-loop. It
searches the tenant's formula portfolio, the partitioned knowledge base, and
(when permitted) the external web to gather ingredient evidence, then returns
normalized observations and non-commit proposals for you to act on.

## When delegation beats a direct tool call

- The question needs several rounds of retrieval and comparison (ingredient
  candidates, usage limits, incompatibilities) that would otherwise consume many
  of your own iterations.
- You want a focused evidence pack with citations, not a single lookup.
- Prefer a direct `knowledge.search` / `formula.search` for a single fact.

## Budget cost

Reserves ~30% of the run's remaining budget before dispatch. If the slice is too
small the delegation is refused rather than starting a run it cannot finish.

## How to interpret the result

- `summary` + `evidence_ids` are the specialist's findings and their sources.
- `proposals` are read-only actions it took; the specialist never commits.
- `uncertainty` lists gaps you should weigh before acting. You remain the only
  decision-maker — the specialist proposes, you dispose.
