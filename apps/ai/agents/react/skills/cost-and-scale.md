---
id: costing
name: Cost & Scale
version: 1.0.0
tools: [formula_calculate, stock_lookup, mongo_query]
---

# Cost & Scale

Use this skill for batch costing, formula scaling, unit conversion, and ingredient percentage checks.

1. Use `formula_calculate` for arithmetic. Pass quantities, units, and known cost-per-unit values; preserve units and clearly name the requested batch size.
2. If a user needs current availability or a live commercial decision, check `stock_lookup` separately. If a current internal price is needed, retrieve it with a supported exact data tool before calculating.
3. Label any result that uses supplied, missing, or non-current prices as an estimate and show the assumption that drives it.

Do not treat formula math as a purchasing quote, stock confirmation, or manufacturing release. Flag missing units, density assumptions, or incomplete cost inputs instead of silently guessing.
