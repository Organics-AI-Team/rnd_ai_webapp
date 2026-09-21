# R&D AI module

This module powers the single R&D AI workspace at `/ai`. The agent can combine material and stock research, formula work, costing, market research, and sales planning in one conversation.

## Architecture

```
apps/ai/
├── agents/react/                 # Unified ReAct agent
│   ├── skills/                   # Versioned operational skill documents
│   ├── skill-catalog.ts          # Loads skill documents into the prompt
│   ├── tool-definitions.ts       # Agent tool contracts
│   └── tool-handlers/            # Stock, formula, RAG, context, and web tools
├── config/qdrant-config.ts       # Qdrant collections and vector schemas
├── services/
│   ├── embeddings/               # Gemini embeddings with OpenAI fallback
│   ├── rag/qdrant-rag-service.ts # High-level RAG operations
│   └── vector/qdrant-service.ts  # Qdrant client operations
├── server/routers/               # tRPC procedures used by the web app
└── scripts/index-qdrant.ts       # Re-indexes source data into Qdrant
```

## Agent skills

The running agent reads these Markdown documents at startup. They are the authoritative operational instructions for each capability:

- `skills/materials-and-stock.md`
- `skills/formula-design.md`
- `skills/cost-and-scale.md`
- `skills/market-research.md`
- `skills/sales-planning.md`

Update the relevant document and its matching tool implementation together. The agent reports a concise plan, tool actions, verification, and conclusion; it does not expose private reasoning.

## Qdrant collections

| Collection | Purpose |
| --- | --- |
| `raw_materials_fda` | FDA ingredient knowledge |
| `raw_materials_stock` | In-stock materials and availability |
| `raw_materials_console` | General raw-material search |
| `sales_rnd` | Sales and R&D intelligence |
| `raw_materials_myskin` | MySkin material data |

The core collections use 768-dimensional Gemini `text-embedding-004` vectors; the MySkin collection uses its configured 3072-dimensional schema.

## Environment

```env
MONGODB_URI=mongodb+srv://...
RAW_MATERIALS_REAL_STOCK_MONGODB_URI=mongodb+srv://...
GEMINI_API_KEY=...
OPENAI_API_KEY=...                 # Optional embedding fallback
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=                    # Optional for authenticated Qdrant
```

## Commands

```bash
npm run index:qdrant --workspace=apps/ai
npm run check:qdrant --workspace=apps/ai
```

Use `index-qdrant.ts --collection <collection-name>` to re-index a single collection.
