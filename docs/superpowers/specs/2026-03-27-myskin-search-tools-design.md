# MySkin Search Tools — Design Spec

## Goal

Add 4 search tools to the in-app AI chatbot that let it query the MySkin raw materials database (4,652 cosmetic ingredients) via text search, semantic/vector search, and category browsing. Follow the exact same pattern as the existing `separated-search-tools.ts`.

## Architecture

New file `apps/ai/agents/raw-materials-ai/tools/myskin-search-tools.ts` — exports tool objects and definitions identical in shape to `separated-search-tools.ts`. The agent files (`agent.ts`, `langgraph-agent.ts`, `enhanced-raw-materials-agent.ts`) register these tools alongside the existing FDA/stock tools.

Semantic search: index MySkin docs into a new Qdrant collection `raw_materials_myskin` (768-dim Gemini vectors). Add the collection schema to `qdrant-config.ts`.

Data sources:
- **MongoDB**: `rnd_ai.raw_materials_myskin` — 4,652 docs (text/exact search, aggregations)
- **Qdrant**: `raw_materials_myskin` collection — same docs embedded as vectors (semantic search)

## MySkin Document Schema

```typescript
{
  _id: ObjectId,
  id: number,
  rm_code: string,          // "RM000001"
  trade_name: string,       // "Poloxamer 188"
  inci_name: string,        // "Poloxamer 188"
  supplier: string,         // "cosmetics"
  rm_cost: number,          // 35
  company_name: string,     // "Imported"
  companies_id: number,     // 1
  benefits: string,         // Thai text array-like string
  details: string,          // Chemical/usage details (Thai)
  cas_no?: string,          // CAS number
  ec_no?: string,           // EC number
  url?: string,             // Reference URL
  category?: string,        // Ingredient category
  usage_min_pct?: number,   // Min usage percentage
  usage_max_pct?: number,   // Max usage percentage
  imported_at?: Date
}
```

## Tools

### Tool 1: `search_myskin_materials`

**Purpose**: Hybrid search across MySkin ingredients — combines MongoDB regex for exact/keyword matches with Qdrant vector search for semantic/natural-language queries.

**Parameters** (Zod schema):
- `query` (string, required) — search term in Thai or English (name, benefit, use-case, RM code)
- `benefit` (string, optional) — filter by specific benefit
- `category` (string, optional) — filter by category
- `limit` (number, optional, default 5) — results count (1-10)
- `offset` (number, optional, default 0) — pagination offset
- `exclude_codes` (string[], optional) — RM codes to exclude
- `search_mode` (enum: "text" | "semantic" | "hybrid", optional, default "hybrid") — search strategy

**Logic**:
1. If query looks like an RM code or exact name → MongoDB regex search on `rm_code`, `trade_name`, `inci_name`
2. If `search_mode` is "semantic" or "hybrid" → embed query via `UniversalEmbeddingService`, search Qdrant `raw_materials_myskin` collection
3. If `search_mode` is "text" or "hybrid" → MongoDB regex search across `trade_name`, `inci_name`, `benefits`, `details`, `category`
4. Merge & deduplicate results (hybrid mode), rank by relevance
5. Apply `exclude_codes`, `category`, `benefit` filters
6. Return formatted Thai table with: rm_code, trade_name, inci_name, cost, benefits summary, category, usage %

**Search fields** (MongoDB regex):
- `rm_code`, `trade_name`, `inci_name`, `supplier`, `category`, `benefits`, `details`, `cas_no`

### Tool 2: `get_myskin_material_detail`

**Purpose**: Full profile lookup for a single MySkin material by RM code or trade name.

**Parameters**:
- `identifier` (string, required) — RM code (e.g., "RM000123") or trade name
- `include_related` (boolean, optional, default false) — find similar materials via Qdrant vector similarity

**Logic**:
1. MongoDB exact match on `rm_code` (case-insensitive) OR regex on `trade_name`
2. If not found, fallback to fuzzy text search
3. If `include_related` is true → embed the material's text, search Qdrant for top-3 similar (excluding self)
4. Return full profile: all fields + parsed benefits list + parsed details + related materials

**Output format**: Formatted Thai text with sections for basic info, chemical info, benefits, usage guidelines, and related materials.

### Tool 3: `browse_myskin_categories`

**Purpose**: Browse and filter MySkin materials by structured fields — category, supplier, cost range, usage percentage range.

**Parameters**:
- `category` (string, optional) — filter by category
- `supplier` (string, optional) — filter by supplier/company
- `min_cost` (number, optional) — minimum cost per unit
- `max_cost` (number, optional) — maximum cost per unit
- `min_usage_pct` (number, optional) — minimum usage percentage
- `max_usage_pct` (number, optional) — maximum usage percentage
- `sort_by` (enum: "cost_asc" | "cost_desc" | "name" | "usage_pct", optional, default "name")
- `limit` (number, optional, default 10) — results count
- `offset` (number, optional, default 0) — pagination offset
- `list_categories` (boolean, optional, default false) — return list of all available categories instead of materials

**Logic**:
1. If `list_categories` is true → MongoDB distinct aggregation on `category` field, return sorted list with counts
2. Otherwise → build MongoDB filter from parameters, apply sort, skip, limit
3. Return formatted table of matching materials

### Tool 4: `compare_myskin_materials`

**Purpose**: Side-by-side comparison of 2-5 MySkin materials.

**Parameters**:
- `rm_codes` (string[], required, min 2, max 5) — RM codes to compare
- `compare_fields` (string[], optional, default all) — which fields to include in comparison

**Logic**:
1. MongoDB `$in` query for all requested RM codes
2. Build comparison table with columns per material, rows per field
3. Highlight differences (cost, usage %, benefits)
4. Return formatted Thai comparison table

## Qdrant Collection

Add to `qdrant-config.ts`:

```typescript
raw_materials_myskin: {
  name: 'raw_materials_myskin',
  vector_size: 768,
  distance: 'Cosine',
  hnsw_config: { ...DEFAULT_HNSW_CONFIG },
  on_disk_payload: true,
  payload_indexes: [
    ...RAW_MATERIAL_PAYLOAD_INDEXES,
    { field_name: 'category', field_type: 'keyword' },
    { field_name: 'cas_no', field_type: 'keyword' },
    { field_name: 'usage_min_pct', field_type: 'float' },
    { field_name: 'usage_max_pct', field_type: 'float' },
  ],
  description: 'MySkin cosmetic ingredients (~4.6K). Detailed benefits, usage guidelines, CAS/EC numbers.',
}
```

Search defaults:
```typescript
raw_materials_myskin: {
  top_k: 5,
  score_threshold: 0.7,
  ef: 128,
  with_payload: true,
}
```

## Embedding Text

For each MySkin document, construct the embedding text as:

```
{trade_name} | {inci_name} | {category} | {benefits} | {details}
```

This captures the semantic meaning of the ingredient for vector search.

## Indexing Script

Add MySkin to the existing Qdrant indexing flow (or add a section in `apps/ai/scripts/index-qdrant.ts`):

1. Read all 4,652 docs from MongoDB `raw_materials_myskin`
2. Construct embedding text for each doc
3. Batch embed via `UniversalEmbeddingService` (Gemini, 768 dims)
4. Batch upsert into Qdrant `raw_materials_myskin` collection
5. Log progress every 100 docs

## Agent Registration

In `agent.ts`, `langgraph-agent.ts`, and `enhanced-raw-materials-agent.ts`:

```typescript
import { myskinSearchTools, myskinToolDefinitions } from './tools/myskin-search-tools';
```

Merge `myskinSearchTools` into the agent's tool map and `myskinToolDefinitions` into the tool definitions array.

Update the agent's system prompt to mention MySkin tools are available for cosmetic ingredient search from the MySkin database.

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/ai/agents/raw-materials-ai/tools/myskin-search-tools.ts` | CREATE | 4 tools following separated-search-tools.ts pattern |
| `apps/ai/config/qdrant-config.ts` | MODIFY | Add `raw_materials_myskin` collection schema + search defaults |
| `apps/ai/agents/raw-materials-ai/agent.ts` | MODIFY | Import & register MySkin tools |
| `apps/ai/agents/raw-materials-ai/langgraph-agent.ts` | MODIFY | Import & register MySkin tools |
| `apps/ai/agents/raw-materials-ai/enhanced-raw-materials-agent.ts` | MODIFY | Import & register MySkin tools |
| `apps/ai/scripts/index-qdrant.ts` | MODIFY | Add MySkin collection indexing |

## Out of Scope

- Migration of MySkin data (already done — 4,652 docs in DO MongoDB)
- New UI components (tools are consumed by existing AI chat)
- Changes to existing FDA/stock tools (these stay unchanged)
