# MySkin Search Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 MySkin search tools to the raw materials AI agent so the chatbot can search 4,652 cosmetic ingredients via text, semantic, and category-based queries.

**Architecture:** New `myskin-search-tools.ts` file following `separated-search-tools.ts` pattern. Tools registered in agent files alongside existing FDA/stock tools. New Qdrant collection `raw_materials_myskin` for semantic search. Indexing script extended with MySkin target.

**Tech Stack:** TypeScript, Zod, MongoDB (direct queries), Qdrant (vector search), Gemini embeddings (768-dim), LangGraph agent

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/ai/agents/raw-materials-ai/tools/myskin-search-tools.ts` | CREATE | 4 MySkin tools + exports |
| `apps/ai/config/qdrant-config.ts` | MODIFY | Add `raw_materials_myskin` collection schema + search defaults |
| `apps/ai/scripts/index-qdrant.ts` | MODIFY | Add MySkin index target |
| `apps/ai/agents/raw-materials-ai/agent.ts` | MODIFY | Register MySkin tools |
| `apps/ai/agents/raw-materials-ai/langgraph-agent.ts` | MODIFY | Register MySkin tools |
| `apps/ai/agents/raw-materials-ai/enhanced-raw-materials-agent.ts` | MODIFY | Import MySkin tools |

---

### Task 1: Add MySkin Qdrant collection config

**Files:**
- Modify: `apps/ai/config/qdrant-config.ts:156-235`

- [ ] **Step 1: Add collection schema**

In `apps/ai/config/qdrant-config.ts`, add the MySkin collection inside `QDRANT_COLLECTIONS` (after the `sales_rnd` entry at ~line 199):

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
    description:
      'MySkin cosmetic ingredients (~4.6K). Detailed benefits, usage guidelines, CAS/EC numbers.',
  },
```

- [ ] **Step 2: Add search defaults**

In the same file, add inside `QDRANT_SEARCH_DEFAULTS` (after `sales_rnd` entry at ~line 234):

```typescript
  raw_materials_myskin: {
    top_k: 5,
    score_threshold: 0.7,
    ef: 128,
    with_payload: true,
  },
```

- [ ] **Step 3: Update RagServiceName type in index-qdrant.ts**

In `apps/ai/scripts/index-qdrant.ts`, update the `RagServiceName` type at line 41:

```typescript
type RagServiceName = 'rawMaterialsAllAI' | 'rawMaterialsAI' | 'salesRndAI' | 'rawMaterialsMySkinAI';
```

- [ ] **Step 4: Add MySkin index target**

In `apps/ai/scripts/index-qdrant.ts`, add to the `INDEX_TARGETS` array (after the sales_rnd entry at ~line 93):

```typescript
  {
    name: 'MySkin Raw Materials',
    mongo_db: 'rnd_ai',
    mongo_collection: 'raw_materials_myskin',
    mongo_uri_env: 'MONGODB_URI',
    qdrant_collection: 'raw_materials_myskin',
    rag_service_name: 'rawMaterialsMySkinAI',
  },
```

- [ ] **Step 5: Commit**

```bash
git add apps/ai/config/qdrant-config.ts apps/ai/scripts/index-qdrant.ts
git commit -m "feat: add MySkin Qdrant collection config and index target"
```

---

### Task 2: Create myskin-search-tools.ts — Tool 1 (search_myskin_materials)

**Files:**
- Create: `apps/ai/agents/raw-materials-ai/tools/myskin-search-tools.ts`

- [ ] **Step 1: Create file with imports and shared helpers**

```typescript
/**
 * MySkin Search Tools
 * Search across MySkin cosmetic raw materials database (4,652 items)
 *
 * Tools:
 * 1. search_myskin_materials - Hybrid text+semantic search
 * 2. get_myskin_material_detail - Full material profile lookup
 * 3. browse_myskin_categories - Category/filter browsing
 * 4. compare_myskin_materials - Side-by-side material comparison
 *
 * Search fields: rm_code, trade_name, inci_name, supplier, category,
 *                benefits, details, cas_no
 */

import { z } from 'zod';

/**
 * MongoDB collection name for MySkin data
 */
const MYSKIN_COLLECTION = 'raw_materials_myskin';
const MYSKIN_DB = 'rnd_ai';

/**
 * Fields searched by text/regex queries
 */
const MYSKIN_SEARCH_FIELDS = [
  'rm_code', 'trade_name', 'inci_name', 'supplier',
  'category', 'benefits', 'details', 'cas_no'
];

/**
 * Parse array-like string fields from MySkin docs into clean arrays.
 * MySkin benefits field stores Python-style list strings like "['item1', 'item2']".
 *
 * @param field - Raw field value from MongoDB document
 * @returns Cleaned array of strings
 */
const parse_myskin_array = (field: any): string[] => {
  if (!field) return [];
  if (Array.isArray(field)) return field.map(String).filter(Boolean);
  if (typeof field === 'string') {
    return field
      .replace(/[\[\]'"]/g, ' ')
      .split(/[,|\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }
  return [String(field)].filter(Boolean);
};

/**
 * Truncate string for table display with ellipsis.
 *
 * @param text - Input string to truncate
 * @param max_length - Maximum character length before truncation
 * @returns Truncated string with '...' suffix if exceeded
 */
const truncate = (text: string, max_length: number): string => {
  if (!text) return 'N/A';
  return text.length > max_length ? text.substring(0, max_length) + '...' : text;
};

/**
 * Get MongoDB client and MySkin collection.
 * Uses shared-database package for cached connection.
 *
 * @returns Object with db and collection references
 */
const get_myskin_collection = async () => {
  console.log('[myskin-tools] get_myskin_collection — start');
  const { default: client_promise } = await import('@rnd-ai/shared-database');
  const client = await client_promise;
  const db = client.db(MYSKIN_DB);
  const collection = db.collection(MYSKIN_COLLECTION);
  console.log('[myskin-tools] get_myskin_collection — done');
  return { db, collection };
};
```

- [ ] **Step 2: Add Tool 1 — search_myskin_materials**

Append to the same file:

```typescript
/**
 * Tool 1: search_myskin_materials
 * Hybrid search across MySkin ingredients — text + semantic.
 *
 * @param query - Search term (Thai/English): name, benefit, use-case, RM code
 * @param benefit - Optional benefit filter
 * @param category - Optional category filter
 * @param limit - Results count (1-10, default 5)
 * @param offset - Pagination offset (default 0)
 * @param exclude_codes - RM codes to skip
 * @param search_mode - "text" | "semantic" | "hybrid" (default "hybrid")
 */
export const searchMySkinMaterialsTool = {
  name: 'search_myskin_materials',
  description: `ค้นหาวัตถุดิบจากฐานข้อมูล MySkin (4,652 รายการ) — เครื่องสำอางและสกินแคร์

  ใช้เมื่อผู้ใช้ถาม:
  - "หาวัตถุดิบสกินแคร์..." (find skincare ingredients...)
  - "สารกันแดด..." (sunscreen ingredients...)
  - "แนะนำสารจาก MySkin..." (recommend MySkin ingredients...)
  - "CAS number ..." (search by CAS number)
  - "สารที่ใช้ในเซรั่ม..." (ingredients for serum...)
  - "ราคาวัตถุดิบ..." (ingredient pricing)

  ค้นหาทั้ง text search และ semantic search
  รองรับ pagination และการยกเว้นผลลัพธ์`,

  parameters: z.object({
    query: z.string().describe('คำค้นหา ภาษาไทยหรืออังกฤษ เช่น "vitamin C", "กันแดด", "moisturizer", "RM000123", "CAS 56-81-5"'),
    benefit: z.string().optional().describe('กรองตามประโยชน์ เช่น "ความชุ่มชื้น", "ลดริ้วรอย", "กันแดด"'),
    category: z.string().optional().describe('กรองตามหมวดหมู่ เช่น "sunscreen", "antioxidant", "moisturizer"'),
    limit: z.number().optional().default(5).describe('จำนวนผลลัพธ์ (1-10)'),
    offset: z.number().optional().default(0).describe('ข้ามผลลัพธ์สำหรับหน้าถัดไป'),
    exclude_codes: z.array(z.string()).optional().describe('รหัส RM ที่ต้องการยกเว้น'),
    search_mode: z.enum(['text', 'semantic', 'hybrid']).optional().default('hybrid').describe('โหมดค้นหา: text, semantic, หรือ hybrid'),
  }),

  handler: async (params: {
    query: string;
    benefit?: string;
    category?: string;
    limit?: number;
    offset?: number;
    exclude_codes?: string[];
    search_mode?: 'text' | 'semantic' | 'hybrid';
  }) => {
    console.log('[myskin-tools] search_myskin_materials — start', params);

    try {
      const { collection } = await get_myskin_collection();
      const search_query = params.benefit || params.query;
      const limit = Math.min(params.limit || 5, 10);
      const offset = params.offset || 0;
      const exclude_codes = params.exclude_codes || [];
      const mode = params.search_mode || 'hybrid';

      // --- Text search (MongoDB regex) ---
      let text_results: any[] = [];
      if (mode === 'text' || mode === 'hybrid') {
        const mongo_filter: any = {};

        // Check if query is an RM code
        if (/^RM\d+$/i.test(search_query)) {
          mongo_filter.rm_code = new RegExp(search_query, 'i');
        } else {
          const regex = new RegExp(search_query, 'i');
          mongo_filter.$or = MYSKIN_SEARCH_FIELDS.map(f => ({ [f]: regex }));
        }

        // Category filter
        if (params.category) {
          mongo_filter.category = new RegExp(params.category, 'i');
        }

        // Exclude codes
        if (exclude_codes.length > 0) {
          mongo_filter.rm_code = mongo_filter.rm_code
            ? { ...mongo_filter.rm_code, $nin: exclude_codes }
            : { $nin: exclude_codes };
        }

        const total_text = await collection.countDocuments(mongo_filter);
        text_results = await collection.find(mongo_filter).skip(offset).limit(limit).toArray();
        console.log(`[myskin-tools] text search found ${total_text} total, returning ${text_results.length}`);
      }

      // --- Semantic search (Qdrant) ---
      let semantic_results: any[] = [];
      if ((mode === 'semantic' || mode === 'hybrid') && text_results.length < limit) {
        try {
          const { QdrantRAGService } = await import('@/ai/services/rag/qdrant-rag-service');
          const rag = QdrantRAGService.get_instance();
          const vector_results = await rag.search(search_query, {
            collection_name: 'raw_materials_myskin',
            top_k: limit,
            score_threshold: 0.7,
          });
          semantic_results = (vector_results || [])
            .filter((r: any) => !exclude_codes.includes(r.payload?.rm_code))
            .map((r: any) => r.payload);
          console.log(`[myskin-tools] semantic search found ${semantic_results.length} results`);
        } catch (err: any) {
          console.warn('[myskin-tools] semantic search unavailable:', err.message);
        }
      }

      // --- Merge & deduplicate ---
      const seen_codes = new Set<string>();
      const merged: any[] = [];

      for (const doc of [...text_results, ...semantic_results]) {
        const code = doc.rm_code || doc._id?.toString();
        if (code && !seen_codes.has(code)) {
          seen_codes.add(code);
          merged.push(doc);
        }
      }

      const final_results = merged.slice(0, limit);
      const total_count = text_results.length > 0
        ? await collection.countDocuments(text_results.length > 0 ? {} : {})
        : final_results.length;

      // --- Format results ---
      const formatted = final_results.map((doc, idx) => ({
        rank: offset + idx + 1,
        rm_code: doc.rm_code || 'N/A',
        trade_name: doc.trade_name || 'N/A',
        inci_name: doc.inci_name || 'N/A',
        category: doc.category || 'N/A',
        rm_cost: doc.rm_cost != null ? `${doc.rm_cost} THB` : 'N/A',
        benefits: truncate(parse_myskin_array(doc.benefits).join(', '), 60),
        usage_pct: doc.usage_min_pct != null && doc.usage_max_pct != null
          ? `${doc.usage_min_pct}-${doc.usage_max_pct}%`
          : 'N/A',
        supplier: doc.supplier || doc.company_name || 'N/A',
      }));

      // Thai table
      let table = '\n| # | รหัส | ชื่อการค้า | INCI Name | หมวด | ราคา | ประโยชน์ | สัดส่วนใช้ |\n';
      table += '|---|------|-----------|-----------|------|------|----------|----------|\n';
      for (const m of formatted) {
        table += `| ${m.rank} | ${m.rm_code} | ${truncate(m.trade_name, 25)} | ${truncate(m.inci_name, 25)} | ${truncate(m.category, 12)} | ${m.rm_cost} | ${truncate(m.benefits, 30)} | ${m.usage_pct} |\n`;
      }

      console.log('[myskin-tools] search_myskin_materials — done', { count: formatted.length });

      return {
        success: true,
        query: search_query,
        search_mode: mode,
        total_found: total_count,
        returned: formatted.length,
        offset,
        limit,
        database: 'MySkin Database (4,652 รายการ)',
        materials: formatted,
        table_display: formatted.length > 0 ? table : 'ไม่พบวัตถุดิบที่ตรงกับคำค้นหา',
        instruction_to_ai: 'แสดงผลลัพธ์โดยใช้ table_display ตอบเป็นภาษาไทย',
      };
    } catch (error: any) {
      console.error('[myskin-tools] search_myskin_materials — error:', error);
      return {
        success: false,
        error: error.message,
        materials: [],
        table_display: 'เกิดข้อผิดพลาดในการค้นหา: ' + error.message,
      };
    }
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/ai/agents/raw-materials-ai/tools/myskin-search-tools.ts
git commit -m "feat: add MySkin search tool 1 — search_myskin_materials (hybrid text+semantic)"
```

---

### Task 3: Add Tool 2 (get_myskin_material_detail) and Tool 3 (browse_myskin_categories)

**Files:**
- Modify: `apps/ai/agents/raw-materials-ai/tools/myskin-search-tools.ts`

- [ ] **Step 1: Add Tool 2 — get_myskin_material_detail**

Append to `myskin-search-tools.ts`:

```typescript
/**
 * Tool 2: get_myskin_material_detail
 * Full profile lookup for a single MySkin material.
 *
 * @param identifier - RM code (e.g. "RM000123") or trade name
 * @param include_related - Find similar materials via Qdrant vector similarity
 */
export const getMySkinMaterialDetailTool = {
  name: 'get_myskin_material_detail',
  description: `ดูรายละเอียดวัตถุดิบจาก MySkin แบบเต็ม

  ใช้เมื่อผู้ใช้ถาม:
  - "ข้อมูล RM000123" (details for RM000123)
  - "Poloxamer 188 คืออะไร" (what is Poloxamer 188)
  - "รายละเอียดสาร..." (ingredient details)
  - "CAS number ของ..." (CAS number of...)
  - "สารที่คล้ายกับ..." (similar to... — use include_related)`,

  parameters: z.object({
    identifier: z.string().describe('รหัส RM (เช่น "RM000123") หรือชื่อการค้า'),
    include_related: z.boolean().optional().default(false).describe('ค้นหาวัตถุดิบที่คล้ายกัน'),
  }),

  handler: async (params: { identifier: string; include_related?: boolean }) => {
    console.log('[myskin-tools] get_myskin_material_detail — start', params);

    try {
      const { collection } = await get_myskin_collection();

      // Try exact match on rm_code first, then trade_name regex
      let doc = await collection.findOne({
        rm_code: new RegExp(`^${params.identifier}$`, 'i'),
      });
      if (!doc) {
        doc = await collection.findOne({
          trade_name: new RegExp(params.identifier, 'i'),
        });
      }
      if (!doc) {
        // Fuzzy fallback: search across multiple fields
        const regex = new RegExp(params.identifier, 'i');
        doc = await collection.findOne({
          $or: MYSKIN_SEARCH_FIELDS.map(f => ({ [f]: regex })),
        });
      }

      if (!doc) {
        console.log('[myskin-tools] get_myskin_material_detail — not found');
        return {
          success: false,
          error: `ไม่พบวัตถุดิบ "${params.identifier}" ในฐานข้อมูล MySkin`,
          material: null,
        };
      }

      // Parse benefits
      const benefits_list = parse_myskin_array(doc.benefits);

      // Build profile
      const profile = {
        rm_code: doc.rm_code,
        trade_name: doc.trade_name,
        inci_name: doc.inci_name || 'N/A',
        supplier: doc.supplier || doc.company_name || 'N/A',
        rm_cost: doc.rm_cost != null ? `${doc.rm_cost} THB` : 'N/A',
        category: doc.category || 'N/A',
        cas_no: doc.cas_no || 'N/A',
        ec_no: doc.ec_no || 'N/A',
        usage_range: doc.usage_min_pct != null && doc.usage_max_pct != null
          ? `${doc.usage_min_pct}% - ${doc.usage_max_pct}%`
          : 'N/A',
        benefits: benefits_list,
        details: doc.details || 'N/A',
        url: doc.url || null,
      };

      // Format as Thai text
      let display = `## ${profile.trade_name} (${profile.rm_code})\n\n`;
      display += `| รายการ | ข้อมูล |\n|--------|--------|\n`;
      display += `| INCI Name | ${profile.inci_name} |\n`;
      display += `| หมวดหมู่ | ${profile.category} |\n`;
      display += `| ซัพพลายเออร์ | ${profile.supplier} |\n`;
      display += `| ราคา | ${profile.rm_cost} |\n`;
      display += `| CAS No. | ${profile.cas_no} |\n`;
      display += `| EC No. | ${profile.ec_no} |\n`;
      display += `| สัดส่วนการใช้ | ${profile.usage_range} |\n\n`;
      display += `### ประโยชน์\n`;
      for (const b of benefits_list.slice(0, 5)) {
        display += `- ${b}\n`;
      }
      if (doc.details) {
        display += `\n### รายละเอียด\n${truncate(doc.details, 500)}\n`;
      }

      // Related materials via Qdrant
      let related: any[] = [];
      if (params.include_related) {
        try {
          const { QdrantRAGService } = await import('@/ai/services/rag/qdrant-rag-service');
          const rag = QdrantRAGService.get_instance();
          const embed_text = `${doc.trade_name} ${doc.inci_name} ${doc.benefits}`;
          const results = await rag.search(embed_text, {
            collection_name: 'raw_materials_myskin',
            top_k: 4,
            score_threshold: 0.75,
          });
          related = (results || [])
            .filter((r: any) => r.payload?.rm_code !== doc!.rm_code)
            .slice(0, 3)
            .map((r: any) => ({
              rm_code: r.payload?.rm_code,
              trade_name: r.payload?.trade_name,
              inci_name: r.payload?.inci_name,
              similarity: ((r.score || 0) * 100).toFixed(0) + '%',
            }));

          if (related.length > 0) {
            display += `\n### วัตถุดิบที่คล้ายกัน\n`;
            display += `| รหัส | ชื่อ | INCI | ความคล้าย |\n|------|------|------|----------|\n`;
            for (const r of related) {
              display += `| ${r.rm_code} | ${truncate(r.trade_name, 20)} | ${truncate(r.inci_name, 20)} | ${r.similarity} |\n`;
            }
          }
        } catch (err: any) {
          console.warn('[myskin-tools] related search failed:', err.message);
        }
      }

      console.log('[myskin-tools] get_myskin_material_detail — done');
      return {
        success: true,
        material: profile,
        related_materials: related,
        display,
        instruction_to_ai: 'แสดง display ให้ผู้ใช้เห็นโดยตรง ตอบเป็นภาษาไทย',
      };
    } catch (error: any) {
      console.error('[myskin-tools] get_myskin_material_detail — error:', error);
      return { success: false, error: error.message, material: null };
    }
  },
};
```

- [ ] **Step 2: Add Tool 3 — browse_myskin_categories**

Append to the same file:

```typescript
/**
 * Tool 3: browse_myskin_categories
 * Browse and filter MySkin materials by structured fields.
 *
 * @param category - Filter by category
 * @param supplier - Filter by supplier
 * @param min_cost / max_cost - Cost range filter
 * @param min_usage_pct / max_usage_pct - Usage percentage range
 * @param sort_by - Sort order
 * @param limit / offset - Pagination
 * @param list_categories - Return category list with counts instead of materials
 */
export const browseMySkinCategoriesTool = {
  name: 'browse_myskin_categories',
  description: `เรียกดูวัตถุดิบ MySkin ตามหมวดหมู่ ซัพพลายเออร์ ราคา และสัดส่วนการใช้

  ใช้เมื่อผู้ใช้ถาม:
  - "มีหมวดหมู่อะไรบ้าง" (list categories)
  - "วัตถุดิบราคาถูกกว่า 100 บาท" (ingredients under 100 THB)
  - "สารจากซัพพลายเออร์ X" (ingredients from supplier X)
  - "สารที่ใช้ได้ 1-5%" (ingredients with 1-5% usage range)
  - "เรียงตามราคา" (sort by cost)`,

  parameters: z.object({
    category: z.string().optional().describe('กรองตามหมวดหมู่'),
    supplier: z.string().optional().describe('กรองตามซัพพลายเออร์/บริษัท'),
    min_cost: z.number().optional().describe('ราคาขั้นต่ำ (THB)'),
    max_cost: z.number().optional().describe('ราคาสูงสุด (THB)'),
    min_usage_pct: z.number().optional().describe('สัดส่วนการใช้ขั้นต่ำ (%)'),
    max_usage_pct: z.number().optional().describe('สัดส่วนการใช้สูงสุด (%)'),
    sort_by: z.enum(['cost_asc', 'cost_desc', 'name', 'usage_pct']).optional().default('name').describe('เรียงลำดับ'),
    limit: z.number().optional().default(10).describe('จำนวนผลลัพธ์'),
    offset: z.number().optional().default(0).describe('ข้ามผลลัพธ์'),
    list_categories: z.boolean().optional().default(false).describe('แสดงรายการหมวดหมู่พร้อมจำนวน'),
  }),

  handler: async (params: {
    category?: string;
    supplier?: string;
    min_cost?: number;
    max_cost?: number;
    min_usage_pct?: number;
    max_usage_pct?: number;
    sort_by?: string;
    limit?: number;
    offset?: number;
    list_categories?: boolean;
  }) => {
    console.log('[myskin-tools] browse_myskin_categories — start', params);

    try {
      const { collection } = await get_myskin_collection();

      // List categories mode
      if (params.list_categories) {
        const pipeline = [
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $match: { _id: { $ne: null } } },
          { $sort: { count: -1 as const } },
        ];
        const categories = await collection.aggregate(pipeline).toArray();

        let table = '| หมวดหมู่ | จำนวน |\n|----------|-------|\n';
        for (const cat of categories) {
          table += `| ${cat._id || 'ไม่ระบุ'} | ${cat.count} |\n`;
        }

        console.log('[myskin-tools] browse_myskin_categories — listed', categories.length, 'categories');
        return {
          success: true,
          mode: 'list_categories',
          categories: categories.map(c => ({ name: c._id, count: c.count })),
          table_display: table,
          instruction_to_ai: 'แสดง table_display ตอบเป็นภาษาไทย',
        };
      }

      // Build filter
      const filter: any = {};
      if (params.category) filter.category = new RegExp(params.category, 'i');
      if (params.supplier) {
        filter.$or = [
          { supplier: new RegExp(params.supplier, 'i') },
          { company_name: new RegExp(params.supplier, 'i') },
        ];
      }
      if (params.min_cost != null || params.max_cost != null) {
        filter.rm_cost = {};
        if (params.min_cost != null) filter.rm_cost.$gte = params.min_cost;
        if (params.max_cost != null) filter.rm_cost.$lte = params.max_cost;
      }
      if (params.min_usage_pct != null) {
        filter.usage_min_pct = { $gte: params.min_usage_pct };
      }
      if (params.max_usage_pct != null) {
        filter.usage_max_pct = { $lte: params.max_usage_pct };
      }

      // Sort
      const sort_map: Record<string, any> = {
        cost_asc: { rm_cost: 1 },
        cost_desc: { rm_cost: -1 },
        name: { trade_name: 1 },
        usage_pct: { usage_min_pct: 1 },
      };
      const sort = sort_map[params.sort_by || 'name'] || { trade_name: 1 };

      const limit = Math.min(params.limit || 10, 20);
      const offset = params.offset || 0;

      const total = await collection.countDocuments(filter);
      const docs = await collection.find(filter).sort(sort).skip(offset).limit(limit).toArray();

      // Format table
      let table = '| # | รหัส | ชื่อการค้า | INCI | หมวด | ราคา | สัดส่วนใช้ |\n';
      table += '|---|------|-----------|------|------|------|----------|\n';
      docs.forEach((doc, idx) => {
        const usage = doc.usage_min_pct != null && doc.usage_max_pct != null
          ? `${doc.usage_min_pct}-${doc.usage_max_pct}%` : 'N/A';
        table += `| ${offset + idx + 1} | ${doc.rm_code} | ${truncate(doc.trade_name, 22)} | ${truncate(doc.inci_name, 22)} | ${truncate(doc.category, 12)} | ${doc.rm_cost != null ? doc.rm_cost + ' THB' : 'N/A'} | ${usage} |\n`;
      });

      console.log('[myskin-tools] browse_myskin_categories — done', { total, returned: docs.length });
      return {
        success: true,
        mode: 'browse',
        total_found: total,
        returned: docs.length,
        offset,
        limit,
        materials: docs.map(d => ({ rm_code: d.rm_code, trade_name: d.trade_name, inci_name: d.inci_name, category: d.category, rm_cost: d.rm_cost })),
        table_display: docs.length > 0 ? table : 'ไม่พบวัตถุดิบตามเงื่อนไข',
        instruction_to_ai: 'แสดง table_display ตอบเป็นภาษาไทย',
      };
    } catch (error: any) {
      console.error('[myskin-tools] browse_myskin_categories — error:', error);
      return { success: false, error: error.message, table_display: 'เกิดข้อผิดพลาด: ' + error.message };
    }
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/ai/agents/raw-materials-ai/tools/myskin-search-tools.ts
git commit -m "feat: add MySkin tools 2-3 — material detail + category browsing"
```

---

### Task 4: Add Tool 4 (compare_myskin_materials) and exports

**Files:**
- Modify: `apps/ai/agents/raw-materials-ai/tools/myskin-search-tools.ts`

- [ ] **Step 1: Add Tool 4 — compare_myskin_materials**

Append to `myskin-search-tools.ts`:

```typescript
/**
 * Tool 4: compare_myskin_materials
 * Side-by-side comparison of 2-5 materials from MySkin.
 *
 * @param rm_codes - Array of 2-5 RM codes to compare
 */
export const compareMySkinMaterialsTool = {
  name: 'compare_myskin_materials',
  description: `เปรียบเทียบวัตถุดิบ MySkin แบบเคียงข้างกัน (2-5 รายการ)

  ใช้เมื่อผู้ใช้ถาม:
  - "เปรียบเทียบ RM000001 กับ RM000002" (compare RM000001 vs RM000002)
  - "ต่างกันยังไง..." (what's the difference...)
  - "เทียบสารกันแดด 3 ตัว" (compare 3 sunscreen ingredients)`,

  parameters: z.object({
    rm_codes: z.array(z.string()).min(2).max(5).describe('รหัส RM ที่ต้องการเปรียบเทียบ (2-5 รายการ)'),
  }),

  handler: async (params: { rm_codes: string[] }) => {
    console.log('[myskin-tools] compare_myskin_materials — start', params);

    try {
      const { collection } = await get_myskin_collection();

      const docs = await collection.find({
        rm_code: { $in: params.rm_codes.map(c => new RegExp(`^${c}$`, 'i')) },
      }).toArray();

      if (docs.length < 2) {
        return {
          success: false,
          error: `พบเพียง ${docs.length} รายการจาก ${params.rm_codes.length} ที่ขอ ต้องการอย่างน้อย 2 รายการ`,
          table_display: 'ไม่สามารถเปรียบเทียบได้ — พบวัตถุดิบไม่ครบ',
        };
      }

      // Build comparison table (rows = fields, columns = materials)
      const fields = [
        { key: 'rm_code', label: 'รหัส' },
        { key: 'trade_name', label: 'ชื่อการค้า' },
        { key: 'inci_name', label: 'INCI Name' },
        { key: 'category', label: 'หมวดหมู่' },
        { key: 'supplier', label: 'ซัพพลายเออร์' },
        { key: 'rm_cost', label: 'ราคา (THB)' },
        { key: 'cas_no', label: 'CAS No.' },
        { key: 'usage_range', label: 'สัดส่วนใช้' },
        { key: 'benefits_summary', label: 'ประโยชน์' },
      ];

      // Header
      let table = '| รายการ |';
      for (const doc of docs) table += ` ${doc.rm_code} |`;
      table += '\n|--------|';
      for (const _ of docs) table += '---------|';
      table += '\n';

      // Rows
      for (const field of fields) {
        table += `| **${field.label}** |`;
        for (const doc of docs) {
          let val: string;
          if (field.key === 'usage_range') {
            val = doc.usage_min_pct != null && doc.usage_max_pct != null
              ? `${doc.usage_min_pct}-${doc.usage_max_pct}%` : 'N/A';
          } else if (field.key === 'benefits_summary') {
            val = truncate(parse_myskin_array(doc.benefits).join(', '), 35);
          } else if (field.key === 'supplier') {
            val = doc.supplier || doc.company_name || 'N/A';
          } else {
            val = doc[field.key] != null ? truncate(String(doc[field.key]), 25) : 'N/A';
          }
          table += ` ${val} |`;
        }
        table += '\n';
      }

      console.log('[myskin-tools] compare_myskin_materials — done', { compared: docs.length });
      return {
        success: true,
        compared_count: docs.length,
        requested: params.rm_codes,
        found: docs.map(d => d.rm_code),
        table_display: table,
        instruction_to_ai: 'แสดง table_display ให้ผู้ใช้เห็น ตอบเป็นภาษาไทย อธิบายความแตกต่างสำคัญ',
      };
    } catch (error: any) {
      console.error('[myskin-tools] compare_myskin_materials — error:', error);
      return { success: false, error: error.message, table_display: 'เกิดข้อผิดพลาด: ' + error.message };
    }
  },
};
```

- [ ] **Step 2: Add exports at the bottom of the file**

```typescript
/**
 * All MySkin tools keyed by name (for handler lookup).
 */
export const myskinSearchTools = {
  search_myskin_materials: searchMySkinMaterialsTool,
  get_myskin_material_detail: getMySkinMaterialDetailTool,
  browse_myskin_categories: browseMySkinCategoriesTool,
  compare_myskin_materials: compareMySkinMaterialsTool,
};

/**
 * Tool definitions array for AI agent registration.
 */
export const myskinToolDefinitions = [
  {
    name: searchMySkinMaterialsTool.name,
    description: searchMySkinMaterialsTool.description,
    parameters: searchMySkinMaterialsTool.parameters,
  },
  {
    name: getMySkinMaterialDetailTool.name,
    description: getMySkinMaterialDetailTool.description,
    parameters: getMySkinMaterialDetailTool.parameters,
  },
  {
    name: browseMySkinCategoriesTool.name,
    description: browseMySkinCategoriesTool.description,
    parameters: browseMySkinCategoriesTool.parameters,
  },
  {
    name: compareMySkinMaterialsTool.name,
    description: compareMySkinMaterialsTool.description,
    parameters: compareMySkinMaterialsTool.parameters,
  },
];
```

- [ ] **Step 3: Commit**

```bash
git add apps/ai/agents/raw-materials-ai/tools/myskin-search-tools.ts
git commit -m "feat: add MySkin tool 4 — compare materials + exports"
```

---

### Task 5: Register MySkin tools in all agent files

**Files:**
- Modify: `apps/ai/agents/raw-materials-ai/agent.ts:7,18-23`
- Modify: `apps/ai/agents/raw-materials-ai/langgraph-agent.ts:10,49-52`
- Modify: `apps/ai/agents/raw-materials-ai/enhanced-raw-materials-agent.ts:12`

- [ ] **Step 1: Update agent.ts**

At line 7, add import:

```typescript
import { myskinSearchTools } from './tools/myskin-search-tools';
```

Inside `initialize_raw_materials_agent()`, extend the `tools` array (after line 23):

```typescript
    // Register MySkin tools
    myskinSearchTools.search_myskin_materials,
    myskinSearchTools.get_myskin_material_detail,
    myskinSearchTools.browse_myskin_categories,
    myskinSearchTools.compare_myskin_materials,
```

- [ ] **Step 2: Update langgraph-agent.ts**

At line 10, add import:

```typescript
import { myskinSearchTools } from './tools/myskin-search-tools';
```

Inside the constructor where `this.tools` is assigned (around line 49-52), add after the existing entries:

```typescript
      // MySkin tools
      search_myskin_materials: myskinSearchTools.search_myskin_materials,
      get_myskin_material_detail: myskinSearchTools.get_myskin_material_detail,
      browse_myskin_categories: myskinSearchTools.browse_myskin_categories,
      compare_myskin_materials: myskinSearchTools.compare_myskin_materials,
```

Also update `RawMaterialsStateSchema` to add `myskinResults` field (around line 13):

```typescript
  myskinResults: z.array(z.any()).optional(),
```

And update `queryType` enum to include `'myskin_search'`:

```typescript
  queryType: z.enum(['search', 'stock_check', 'profile', 'usecase_search', 'myskin_search', 'general']).optional(),
```

- [ ] **Step 3: Update enhanced-raw-materials-agent.ts**

At line 12, add import:

```typescript
import { myskinSearchTools } from './tools/myskin-search-tools';
```

- [ ] **Step 4: Commit**

```bash
git add apps/ai/agents/raw-materials-ai/agent.ts apps/ai/agents/raw-materials-ai/langgraph-agent.ts apps/ai/agents/raw-materials-ai/enhanced-raw-materials-agent.ts
git commit -m "feat: register MySkin tools in all agent entry points"
```

---

### Task 6: Build, deploy, and verify

**Files:**
- No new files — verification only

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -i myskin
```

Expected: no MySkin-related errors.

- [ ] **Step 2: Docker build test**

```bash
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:3000/api -t rnd-web-test . 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 3: Push and deploy to droplet**

```bash
git push origin dev/droplet
ssh root@165.245.181.97 "cd /opt/rnd-ai && git pull origin dev/droplet && docker compose build web && docker compose up -d web"
```

- [ ] **Step 4: Test via AI chat**

Open `http://165.245.181.97:3000` and try these queries in the AI chat:
1. "หาวัตถุดิบกันแดดจาก MySkin" → should return sunscreen ingredients
2. "ข้อมูล RM000001" → should return full Poloxamer 188 profile
3. "มีหมวดหมู่อะไรบ้างใน MySkin" → should list categories
4. "เปรียบเทียบ RM000001 กับ RM000002" → should show comparison table

- [ ] **Step 5: Commit verification and update CHANGELOG**

```bash
# Update CHANGELOG.md with the new feature entry, then:
git add CHANGELOG.md
git commit -m "docs: add MySkin search tools to CHANGELOG"
```
