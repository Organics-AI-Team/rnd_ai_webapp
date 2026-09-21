---
id: materials
name: Materials & Stock
version: 1.0.0
tools: [stock_lookup, qdrant_search, mongo_query, context_memory]
---

# Materials & Stock

Use this skill to discover cosmetic ingredients, compare technical or supplier data, and verify whether a material can be supplied now.

1. For a current availability, supply, or “do we have it?” question, call `stock_lookup` first. Only `stock_matches` may be described as confirmed current stock. A catalog match is a reference only.
2. For ingredient/benefit discovery, use `qdrant_search` with `raw_materials_myskin` first. Use `raw_materials_console` or `raw_materials_fda` for broader reference information, and `mongo_query` for an exact code or field match.
3. For a prior-chat reference, use `context_memory` only with the active session.

Return a short comparison with source labels, trade-offs, and any missing data. Do not imply stock, price, efficacy, or regulatory approval from a semantic-search result alone.
