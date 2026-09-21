---
id: market
name: Market Research
version: 1.0.0
tools: [web_search, qdrant_search]
---

# Market Research

Use this skill for current category, consumer, competitor, regulatory, and supplier information outside the internal material records.

1. Use `web_search` for time-sensitive facts, then cite the returned source URLs near the related claim. Prefer dates, market scope, and primary or authoritative sources where available.
2. Use internal Qdrant material records only for internal ingredient context; do not present them as external market evidence.
3. Separate observed facts from recommendations. State clearly when a conclusion is an inference, and say that current information could not be verified when grounded search returns an error.

Do not invent market size, competitor activity, pricing, regulatory status, or trend claims from model memory. Regulatory information is research support, not legal approval.
