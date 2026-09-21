---
name: delegate.sales_rnd
version: 1.0.0
kind: tool
side_effect: read
required_permission: ai:run
---

# delegate.sales_rnd — hand a commercial/positioning sub-task to the sales-R&D specialist

## Purpose

Run the Sales-R&D specialist as a bounded, read-only sub-loop. It combines
formula portfolio search, knowledge retrieval, and (when permitted) web research
to assess market fit, positioning, and commercial framing, returning normalized
observations and non-commit proposals.

## When delegation beats a direct tool call

- The question blends product and market signals and needs multi-step synthesis
  (comparable products, claims, differentiation).
- You want a cited commercial summary rather than a single search hit.
- Prefer a direct `knowledge.search` for one fact.

## Budget cost

Reserves ~30% of the run's remaining budget before dispatch. Refused if the
reserved slice is too small to run.

## How to interpret the result

- `summary` + `evidence_ids` are the commercial findings and their sources.
- `proposals` are read-only actions only; the specialist commits nothing.
- `uncertainty` flags assumptions to validate. The parent run decides any action.
