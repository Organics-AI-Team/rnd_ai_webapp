# Raw Materials AI Agent - Complete Data Flow

**Agent Path:** `/ai/agents/raw-materials-ai`
**UI Route:** `/ai/raw-materials-ai`
**Date:** 2025-11-05

---

## 🎯 Which Index It Connects To

### **Pinecone Index: `raw-materials-stock`**

**Config Location:** `ai/config/rag-config.ts:54-63`

```typescript
rawMaterialsAI: {
  pineconeIndex: 'raw-materials-stock',  // ← THE INDEX
  topK: 5,
  similarityThreshold: 0.7,
  includeMetadata: true,
  description: 'Unified RAG with intelligent routing',
  defaultFilters: {} // No filters - routing handles it
}
```

---

## 📊 Which Collections It Passes Data From

### **Migration Script:** `scripts/migrate-unified-collections.ts`

The migration script reads from **2 MongoDB collections** and writes to **2 Pinecone namespaces** in the same index:

```typescript
const COLLECTIONS: CollectionConfig[] = [
  {
    name: 'raw_materials_real_stock',        // ← MongoDB Collection 1
    namespace: 'in_stock',                   // ← Pinecone Namespace 1
    description: 'Materials currently in stock',
    source_tag: 'raw_materials_real_stock'
  },
  {
    name: 'raw_meterials_console',           // ← MongoDB Collection 2
    namespace: 'all_fda',                    // ← Pinecone Namespace 2
    description: 'All FDA-registered ingredients',
    source_tag: 'raw_meterials_console'
  }
];
```

---

## 🔄 Complete Data Flow

### **Step 1: Data Migration (One-time)**

```
MongoDB Collection 1                      Pinecone Index: raw-materials-stock
┌────────────────────────┐               ┌─────────────────────────────┐
│ raw_materials_real_stock│  Migration   │  Namespace: 'in_stock'     │
│ (3,111 documents)      │─────────────>│  (~18,666 vectors)          │
└────────────────────────┘   Script      │                             │
                                          │  Metadata per vector:       │
MongoDB Collection 2                      │  - source: 'raw_materials   │
┌────────────────────────┐               │             _real_stock'    │
│ raw_meterials_console  │  Migration   │  - namespace: 'in_stock'    │
│ (31,179 documents)     │─────────────>│  - collection: <name>       │
└────────────────────────┘   Script      │  - availability: 'in_stock' │
                                          │                             │
                                          │  Namespace: 'all_fda'       │
                                          │  (~187,074 vectors)         │
                                          │                             │
                                          │  Metadata per vector:       │
                                          │  - source: 'raw_meterials   │
                                          │             _console'       │
                                          │  - namespace: 'all_fda'     │
                                          │  - collection: <name>       │
                                          │  - availability: 'fda_only' │
                                          └─────────────────────────────┘
```

### **Step 2: User Query Flow**

```
1. USER OPENS PAGE
   └─> /ai/raw-materials-ai/page.tsx
       └─> <RawMaterialsChat serviceName="rawMaterialsAI" />

2. COMPONENT INITIALIZATION
   └─> ai/components/chat/raw-materials-chat.tsx:49-62
       └─> Creates: new UnifiedSearchClient('rawMaterialsAI')

3. USER SENDS MESSAGE
   └─> Query Classification (ai/utils/query-classifier.ts)
       ├─> Detects if it's a raw materials query
       └─> If yes, triggers performRAGSearch()

4. RAG SEARCH EXECUTION
   └─> ai/components/chat/raw-materials-chat.tsx:105-137
       └─> unifiedClient.search_and_format(query)
           └─> POST /api/rag/unified-search

5. API ENDPOINT
   └─> app/api/rag/unified-search/route.ts
       ├─> Gets routing decision from collection-router
       │   └─> ai/utils/collection-router.ts
       │       └─> Analyzes query keywords
       │           ├─> "in stock" → in_stock namespace
       │           ├─> "all FDA" → all_fda namespace
       │           └─> default → both namespaces
       │
       └─> Calls: getUnifiedSearchService().unified_search()

6. UNIFIED SEARCH SERVICE
   └─> ai/services/rag/unified-search-service.ts:42-112
       └─> For each routed collection:
           └─> Calls: this.hybrid_search(query, options)

7. HYBRID SEARCH SERVICE
   └─> ai/services/rag/hybrid-search-service.ts:76-101
       └─> Executes 4 search strategies in parallel:

           Strategy 1: Exact Match (MongoDB)
           ├─> Queries MongoDB collection directly
           │   └─> Collection: options.mongodb_collection
           │       ├─> 'raw_materials_real_stock' (if in_stock)
           │       └─> 'raw_meterials_console' (if all_fda)

           Strategy 2: Metadata Filter (Pinecone)
           ├─> Queries Pinecone with metadata filters
           │   └─> Namespace: options.pinecone_namespace
           │       ├─> 'in_stock' (if searching stock)
           │       └─> 'all_fda' (if searching FDA)

           Strategy 3: Fuzzy Match (MongoDB)
           ├─> Levenshtein distance search in MongoDB
           │   └─> Collection: options.mongodb_collection

           Strategy 4: Semantic Search (Pinecone)
           └─> Vector similarity search in Pinecone
               └─> Namespace: options.pinecone_namespace

8. PINECONE SERVICE
   └─> ai/services/rag/pinecone-service.ts:120-163
       └─> const queryTarget = config.namespace
             ? this.index.namespace(config.namespace)  // ← Uses namespace!
             : this.index
       └─> queryTarget.query({ vector, topK, filter })

9. RESPONSE FORMATTING
   └─> Merges results from both namespaces
       ├─> Groups by availability:
       │   ├─> ✅ In-stock results (from 'in_stock' namespace)
       │   └─> 📚 FDA results (from 'all_fda' namespace)
       └─> Returns formatted text to chat component

10. DISPLAY TO USER
    └─> Shows results with availability indicators
        ├─> ✅ สถานะ: มีในสต็อก
        └─> 📚 สถานะ: ฐานข้อมูล FDA
```

---

## 📦 Data Structure in Pinecone

### **Each Vector Contains:**

```typescript
{
  id: "document_id_chunk_type",
  values: [3072-dimensional embedding],
  metadata: {
    // Original document fields
    rm_code: "RM000001",
    trade_name: "Hyaluronic Acid",
    inci_name: "Sodium Hyaluronate",
    supplier: "ABC Chemicals",
    company_name: "ABC Corp",
    rm_cost: "500",
    benefits: "Moisturizing...",
    details: "Details...",

    // Migration metadata
    source: "raw_materials_real_stock",     // Which MongoDB collection
    namespace: "in_stock",                  // Which namespace in Pinecone
    collection: "raw_materials_real_stock", // Collection name
    availability: "in_stock",               // Availability status

    // Chunk metadata
    chunk_type: "primary_identifier",       // Type of chunk
    priority: 1.0,                          // Search priority
    field_source: ["rm_code", "trade_name"] // Source fields
  }
}
```

---

## 🔍 Search Routing Logic

### **Query → Namespace Mapping:**

| User Query | Detected Keywords | Namespaces Searched | MongoDB Collections |
|------------|-------------------|---------------------|---------------------|
| "RM000001" | (exact code) | `in_stock` only | `raw_materials_real_stock` |
| "วัตถุดิบทั้งหมดที่มี vitamin C" | "ทั้งหมด" | `all_fda` only | `raw_meterials_console` |
| "มี Hyaluronic Acid ไหม" | "มีไหม" | Both (`in_stock` first) | Both collections |
| "moisturizing ingredient" | (default) | Both (`in_stock` first) | Both collections |
| "all FDA ingredients" | "all", "fda" | `all_fda` only | `raw_meterials_console` |
| "ingredients in stock" | "in stock" | `in_stock` only | `raw_materials_real_stock` |

---

## 🎯 Configuration Summary

### **Agent:** `/ai/agents/raw-materials-ai`

**Service Name:** `rawMaterialsAI`
**Pinecone Index:** `raw-materials-stock`
**Namespaces:** `in_stock` + `all_fda`

### **Data Sources:**

1. **In-Stock Materials (3,111 items)**
   - MongoDB Collection: `raw_materials_real_stock`
   - Pinecone Namespace: `in_stock`
   - ~18,666 chunks (6 per document)
   - Metadata tag: `availability: 'in_stock'`

2. **All FDA Ingredients (31,179 items)**
   - MongoDB Collection: `raw_meterials_console`
   - Pinecone Namespace: `all_fda`
   - ~187,074 chunks (6 per document)
   - Metadata tag: `availability: 'fda_only'`

### **Total in Pinecone Index:**
- Index Name: `raw-materials-stock`
- Total Vectors: ~205,740 (18,666 + 187,074)
- Dimensions: 3072 (Gemini embeddings)
- Metric: Cosine similarity

---

## 🔧 How to Verify After Migration

### **1. Check Pinecone Index:**
```bash
# Visit Pinecone Console
# Index: raw-materials-stock
# Should show:
# - Total vectors: ~205,740
# - Namespaces: in_stock, all_fda
```

### **2. Check Namespace Sizes:**
```typescript
// In console or script:
const index = pinecone.Index('raw-materials-stock');

// Check in_stock namespace
const statsInStock = await index.namespace('in_stock').describeIndexStats();
console.log('in_stock vectors:', statsInStock.totalVectorCount); // ~18,666

// Check all_fda namespace
const statsAllFda = await index.namespace('all_fda').describeIndexStats();
console.log('all_fda vectors:', statsAllFda.totalVectorCount); // ~187,074
```

### **3. Test Query Routing:**
```bash
# Test in-stock query
curl -X POST http://localhost:3000/api/rag/unified-search \
  -H "Content-Type: application/json" \
  -d '{"query": "ingredients in stock", "serviceName": "rawMaterialsAI"}'

# Should return:
# - routing.collections: ["in_stock"]
# - stats.in_stock: > 0

# Test FDA query
curl -X POST http://localhost:3000/api/rag/unified-search \
  -H "Content-Type: application/json" \
  -d '{"query": "all FDA vitamin C", "serviceName": "rawMaterialsAI"}'

# Should return:
# - routing.collections: ["all_fda"]
# - stats.fda_only: > 0
```

---

## 📝 Summary

**The raw-materials-ai agent connects to:**
- ✅ **1 Pinecone Index:** `raw-materials-stock`
- ✅ **2 Namespaces:** `in_stock` and `all_fda`
- ✅ **2 MongoDB Collections:** `raw_materials_real_stock` and `raw_meterials_console`
- ✅ **Smart Routing:** Automatically selects namespace based on query keywords
- ✅ **Unified Results:** Merges results from both sources with clear indicators

**Data Flow:** MongoDB → Migration Script → Pinecone Namespaces → Unified Search → User
