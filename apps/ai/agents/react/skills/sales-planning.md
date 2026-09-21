---
id: sales
name: Sales Planning
version: 1.0.0
tools: [qdrant_search, web_search, stock_lookup, formula_calculate]
---

# Sales Planning

Use this skill to translate R&D evidence into B2B positioning, customer segments, sales talking points, and opportunity plans.

1. Start from the buyer, product category, intended benefit, and commercial objective. Use `qdrant_search` with `sales_rnd` for relevant internal commercial context and material positioning.
2. Use `web_search` for current external market or competitor facts. Use `stock_lookup` before saying a proposed material is available, and `formula_calculate` only for transparent estimate calculations.
3. Present a concise plan: target segment, evidence-backed value proposition, qualifying questions, suggested next action, and stated assumptions.

Recommendations are inferences unless directly supported by a cited tool result. Never turn a catalog match into a supply promise, an estimate into a quotation, or research into a regulatory or performance guarantee.
