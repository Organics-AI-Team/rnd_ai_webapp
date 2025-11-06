# Unified RAG System - Multi-Collection Guide

**Created**: 2025-11-05
**Status**: ✅ Ready for Implementation

---

## Overview

This system provides **intelligent routing** between two MongoDB collections in a single Pinecone index using **namespaces**, allowing users to query either:
1. **In-stock materials** (what we actually have)
2. **All FDA ingredients** (complete database)
3. **Both** (unified search with smart prioritization)

### Collections

| Collection | Count | Description | Namespace |
|------------|-------|-------------|-----------|
| `raw_materials_real_stock` | 3,111 | Materials currently in stock | `in_stock` |
| `raw_materials_console` | 31,179 | All FDA-registered ingredients | `all_fda` |
| **TOTAL** | **34,290** | **All materials** | - |

### Expected Output
- **Documents**: 34,290
- **Chunks**: ~205,740 (6 chunks per document)
- **Pinecone Index**: `raw-materials-stock`
- **Namespaces**: 2 (`in_stock`, `all_fda`)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Query                              │
│         "Do we have Hyaluronic Acid in stock?"               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Collection Router                               │
│   Detects intent: stock, FDA, or both                       │
│   Keywords: "in stock", "มีในสต็อก", "all ingredients"      │
└──────────────────────┬──────────────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
           ▼                       ▼
┌──────────────────────┐  ┌──────────────────────┐
│  Namespace:          │  │  Namespace:          │
│  'in_stock'          │  │  'all_fda'           │
│                      │  │                      │
│  3,111 materials     │  │  31,179 ingredients  │
│  ~18,666 chunks      │  │  ~187,074 chunks     │
└──────────┬───────────┘  └───────────┬──────────┘
           │                          │
           └────────┬─────────────────┘
                    │
                    ▼
      ┌─────────────────────────────┐
      │  Merge & Deduplicate         │
      │  Prioritize in-stock items   │
      └─────────────┬────────────────┘
                    │
                    ▼
      ┌─────────────────────────────┐
      │  Unified Results             │
      │  + Availability Context      │
      └──────────────────────────────┘
```

---

## Files Created

### 1. Collection Router
**File**: `ai/utils/collection-router.ts`

**Purpose**: Intelligent query routing to appropriate collections

**Key Functions**:
```typescript
// Route query to collections based on intent
route_query_to_collections(query: string, explicit_collection?: CollectionType): CollectionRoutingResult

// Merge results from multiple collections
merge_collection_results(stock_results: any[], fda_results: any[], search_mode: string): any[]

// Format response with availability context
format_response_with_source_context(results: any[], search_mode: string): string
```

**Detection Logic**:
- **In-Stock Keywords**: "in stock", "มีในสต็อก", "available", "inventory", "ซื้อได้"
- **All FDA Keywords**: "all ingredients", "fda", "registered", "วัตถุดิบทั้งหมด"
- **Availability Keywords**: "do we have", "มีไหม", "can we get"

### 2. Unified Search Service
**File**: `ai/services/rag/unified-search-service.ts`

**Purpose**: Enhanced search service with collection routing

**Key Methods**:
```typescript
// Auto-routing search
unified_search(query: string, options?: UnifiedSearchOptions): Promise<UnifiedSearchResult[]>

// Stock-only search
search_in_stock(query: string, options?: HybridSearchOptions): Promise<UnifiedSearchResult[]>

// FDA-only search
search_all_fda(query: string, options?: HybridSearchOptions): Promise<UnifiedSearchResult[]>

// Check availability
check_availability(ingredient: string): Promise<{ in_stock: boolean; details?: any; alternatives?: any[] }>

// Get statistics
get_collection_stats(results: UnifiedSearchResult[]): { total: number; in_stock: number; fda_only: number }
```

### 3. Migration Script
**File**: `scripts/migrate-unified-collections.ts`

**Purpose**: Migrate both collections to Pinecone with namespaces

**Process**:
1. Connect to MongoDB `rnd_ai` database
2. For each collection:
   - Read documents
   - Create 6 dynamic chunks per document
   - Generate embeddings (3072 dimensions)
   - Upload to Pinecone with namespace tag
3. Add metadata: `source`, `namespace`, `collection`, `availability`

### 4. Updated RAG Config
**File**: `ai/config/rag-config.ts`

**Changes**:
- Updated `rawMaterialsAI` to use unified index with namespace routing
- Updated `rawMaterialsAllAI` to target `all_fda` namespace
- Added namespace metadata to default filters

---

## Usage Examples

### Example 1: Auto-Routing Search
```typescript
import { getUnifiedSearchService } from '@/ai/services/rag/unified-search-service';

const searchService = getUnifiedSearchService();

// Query automatically routes based on intent
const results = await searchService.unified_search(
  "วัตถุดิบที่ช่วยเรื่องความชุ่มชื้นที่มีในสต็อก"
);

// Results include availability info
results.forEach(result => {
  console.log(`${result.document.rm_code} - ${result.document.trade_name}`);
  console.log(`Availability: ${result.availability}`);
  console.log(`In Stock: ${result.source_collection === 'in_stock'}`);
});
```

**Query Analysis**:
- Keywords: "ที่มีในสต็อก" (in stock)
- **Routes to**: `in_stock` namespace only
- **Returns**: Materials currently available in inventory

---

### Example 2: Availability Check
```typescript
const availability = await searchService.check_availability("Hyaluronic Acid");

if (availability.in_stock) {
  console.log("✅ In stock:", availability.details);
} else {
  console.log("❌ Not in stock");
  console.log("📚 FDA alternatives:", availability.alternatives);
}
```

**Output**:
```
✅ In stock: {
  rm_code: "RC00A015",
  trade_name: "Hyaluronic Acid Powder",
  availability: "in_stock",
  supplier: "XYZ Chemicals"
}
```

---

### Example 3: Explicit Collection Selection
```typescript
// Search only in-stock materials
const stockResults = await searchService.search_in_stock("Vitamin C");

// Search all FDA ingredients
const fdaResults = await searchService.search_all_fda("Vitamin C");

// Or use unified search with explicit collection
const unified = await searchService.unified_search("Vitamin C", {
  collection: 'both',  // 'in_stock' | 'all_fda' | 'both'
  include_availability_context: true
});
```

---

### Example 4: Statistics and Analytics
```typescript
const results = await searchService.unified_search("moisturizing ingredients");

const stats = searchService.get_collection_stats(results);

console.log(`Total results: ${stats.total}`);
console.log(`In stock: ${stats.in_stock} (${stats.in_stock_percentage.toFixed(1)}%)`);
console.log(`FDA only: ${stats.fda_only}`);
```

**Output**:
```
Total results: 10
In stock: 3 (30.0%)
FDA only: 7
```

---

## Query Routing Examples

| Query | Detected Intent | Collections | Reasoning |
|-------|----------------|-------------|-----------|
| "Do we have Vitamin C in stock?" | In-stock check | `in_stock` → `all_fda` | "in stock" keyword → prioritize stock |
| "วัตถุดิบที่มีในสต็อก" | In-stock | `in_stock` | "ที่มีในสต็อก" → stock only |
| "Show all FDA approved whitening agents" | All FDA | `all_fda` | "all FDA" keyword → FDA only |
| "Hyaluronic Acid" | General query | `in_stock` → `all_fda` | No keywords → unified with stock priority |
| "All moisturizing ingredients" | All FDA | `all_fda` | "All ingredients" → FDA database |

---

## Migration Process

### Step 1: Check Current Index
```bash
# Verify current index status
npx tsx --env-file=.env.local scripts/verify-migration.ts
```

**Expected**: 18,666 vectors in default namespace (from previous migration)

### Step 2: Run Unified Migration
```bash
# Migrate both collections with namespaces
npx tsx --env-file=.env.local scripts/migrate-unified-collections.ts
```

**Expected Output**:
```
📦 Migrating: raw_materials_real_stock
   Namespace: in_stock
   Total documents: 3,111
   Expected chunks: ~18,666

✅ raw_materials_real_stock migration completed!
   Documents: 3,111
   Chunks: 18,666
   Duration: ~15 minutes

📦 Migrating: raw_materials_console
   Namespace: all_fda
   Total documents: 31,179
   Expected chunks: ~187,074

✅ raw_materials_console migration completed!
   Documents: 31,179
   Chunks: 187,074
   Duration: ~120 minutes

📊 MIGRATION SUMMARY
TOTAL DOCUMENTS: 34,290
TOTAL CHUNKS: 205,740
PINECONE INDEX: raw-materials-stock
NAMESPACES: in_stock, all_fda
```

### Step 3: Verify Namespaces
```typescript
import { Pinecone } from '@pinecone-database/pinecone';

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index('raw-materials-stock');

// Check in_stock namespace
const inStockStats = await index.namespace('in_stock').describeIndexStats();
console.log('In Stock:', inStockStats.totalRecordCount); // ~18,666

// Check all_fda namespace
const fdaStats = await index.namespace('all_fda').describeIndexStats();
console.log('All FDA:', fdaStats.totalRecordCount); // ~187,074
```

---

## API Integration

### Update Chat API Endpoint
**File**: `app/api/ai-chat/route.ts`

```typescript
import { getUnifiedSearchService } from '@/ai/services/rag/unified-search-service';

export async function POST(request: Request) {
  const { message } = await request.json();

  const searchService = getUnifiedSearchService();

  // Auto-routing search
  const context = await searchService.unified_search(message, {
    topK: 5,
    include_availability_context: true
  });

  // Generate response with availability info
  const response = await generateAIResponse(message, context);

  return Response.json({ response, context });
}
```

### Add Availability Filter to UI
**File**: `ai/components/chat/raw-materials-chat.tsx`

```typescript
const [collectionFilter, setCollectionFilter] = useState<CollectionType>('both');

// Add filter dropdown
<select value={collectionFilter} onChange={e => setCollectionFilter(e.target.value)}>
  <option value="both">All Materials</option>
  <option value="in_stock">In Stock Only</option>
  <option value="all_fda">All FDA Ingredients</option>
</select>

// Use in query
const results = await searchService.unified_search(query, {
  collection: collectionFilter
});
```

---

## Performance Expectations

### Search Performance
| Query Type | Collections | Expected Time |
|------------|-------------|---------------|
| Stock only | 1 namespace | ~100ms |
| FDA only | 1 namespace | ~150ms |
| Unified (both) | 2 namespaces | ~200ms |
| Availability check | 2 namespaces (sequential) | ~300ms |

### Migration Performance
| Collection | Documents | Chunks | Est. Time |
|------------|-----------|--------|-----------|
| In-stock | 3,111 | ~18,666 | ~15 min |
| All FDA | 31,179 | ~187,074 | ~120 min |
| **Total** | **34,290** | **~205,740** | **~135 min** |

---

## Benefits

### 1. **Intelligent Auto-Routing**
- Users don't need to specify which database
- System detects intent from keywords
- Thai and English support

### 2. **Unified Index**
- Single Pinecone index (`raw-materials-stock`)
- Namespaces for logical separation
- No duplicate infrastructure

### 3. **Availability Context**
- Results tagged with `in_stock` or `fda_only`
- Automatic prioritization of in-stock materials
- Clear UI indicators

### 4. **Flexible Queries**
- "Show me whitening agents **in stock**" → Stock only
- "What are **all** moisturizing ingredients?" → FDA database
- "Do we have Vitamin C?" → Check stock first, then FDA

### 5. **Deduplication**
- Same ingredient in both collections → merged by `rm_code`
- In-stock version prioritized in results
- Prevents duplicate answers

---

## Monitoring & Analytics

### Track Collection Usage
```typescript
// Log which collections were searched
console.log('[analytics] Query routed to:', routing.collections);
console.log('[analytics] Search mode:', routing.search_mode);
console.log('[analytics] Confidence:', routing.confidence);

// Track result distribution
const stats = searchService.get_collection_stats(results);
console.log('[analytics] In-stock percentage:', stats.in_stock_percentage);
```

### User Feedback
```typescript
// Add feedback mechanism
interface SearchFeedback {
  query: string;
  routing: CollectionRoutingResult;
  was_correct: boolean;
  expected_collection?: CollectionType;
}

// Improve routing logic based on feedback
```

---

## Future Enhancements

### 1. **Automatic Stock Sync**
- Detect when materials go out of stock
- Move from `in_stock` to `all_fda` namespace
- Update availability metadata

### 2. **Cross-Collection Recommendations**
- "Not in stock, but similar alternatives are available"
- Suggest FDA ingredients as substitutes

### 3. **Inventory Alerts**
- "Low stock on Hyaluronic Acid (3 units left)"
- Proactive reorder suggestions

### 4. **Price Comparison**
- Compare costs between in-stock and potential FDA alternatives
- Show cost savings

---

## Troubleshooting

### Issue: Wrong Collection Routed
**Symptoms**: Query routes to FDA when user wants stock

**Solution**: Add more keywords to `IN_STOCK_KEYWORDS` in `collection-router.ts`

### Issue: Duplicate Results
**Symptoms**: Same ingredient appears twice

**Solution**: Check `merge_collection_results()` deduplication logic

### Issue: Slow Searches
**Symptoms**: Queries take >500ms

**Solution**:
- Check Pinecone namespace query performance
- Consider caching frequent queries
- Reduce `topK` value

---

## Summary

✅ **Single unified RAG** with intelligent routing
✅ **Two namespaces** for logical separation
✅ **Auto-detection** of user intent (stock vs FDA)
✅ **Availability context** in all responses
✅ **Deduplication** and smart prioritization
✅ **Thai + English** keyword support
✅ **~205,740 chunks** total from 34,290 documents

**Next Steps**:
1. Run unified migration script
2. Update chat API to use `UnifiedSearchService`
3. Add collection filter to UI
4. Test with sample queries
5. Monitor routing accuracy

---

**Documentation Version**: 1.0
**Last Updated**: 2025-11-05
