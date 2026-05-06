/**
 * Collection Router for Multi-Source RAG
 * Routes queries to appropriate MongoDB collections and Qdrant collections
 *
 * Collections:
 * 1. raw_materials_stock (3,111 items) - Materials we actually have in stock
 * 2. raw_materials_fda  (31,179 items) - All FDA-registered ingredients
 */

export type CollectionType = 'in_stock' | 'all_fda' | 'both';

export interface CollectionRoutingResult {
  collections: CollectionType[];
  qdrant_collections: string[];
  confidence: number;
  reasoning: string;
  search_mode: 'stock_only' | 'fda_only' | 'unified' | 'prioritize_stock';
}

/**
 * Keywords indicating user wants in-stock materials only
 */
const IN_STOCK_KEYWORDS = [
  'in stock',
  'มีในสต็อก',
  'มีอยู่',
  'สารที่มีอยู่',
  'ที่เรามี',
  'ที่มีอยู่ใน stock',
  'สารที่เรามี',
  'available',
  'can buy',
  'purchase',
  'order',
  'inventory',
  'stock',
  'สต็อก',
  'real stock',
  'actual stock',
  'ของที่มี',
  'ซื้อได้',
  'สั่งได้'
];

/**
 * Keywords indicating user wants all FDA ingredients
 */
const ALL_FDA_KEYWORDS = [
  'all ingredients',
  'fda',
  'registered',
  'approved',
  'วัตถุดิบทั้งหมด',
  'ทุกวัตถุดิบ',
  'any ingredient',
  'explore',
  'search all',
  'หาทั้งหมด',
  'ค้นหาทั้งหมด'
];

/**
 * Keywords indicating user wants availability check
 */
const AVAILABILITY_KEYWORDS = [
  'do we have',
  'มีไหม',
  'available',
  'in stock',
  'can we get',
  'หาได้ไหม'
];

/**
 * Route query to appropriate collections based on user intent
 *
 * @param query - User query string
 * @param explicit_collection - Explicitly specified collection (overrides detection)
 * @returns Collection routing decision with reasoning
 */
export function route_query_to_collections(
  query: string,
  explicit_collection?: CollectionType
): CollectionRoutingResult {
  console.log('🔀 [collection-router] Routing query:', query);

  const query_lower = query.toLowerCase();

  // If explicitly specified, use that
  if (explicit_collection) {
    if (explicit_collection === 'both') {
      return {
        collections: ['in_stock', 'all_fda'],
        qdrant_collections: ['raw_materials_stock', 'raw_materials_fda'],
        confidence: 1.0,
        reasoning: 'Explicitly requested both collections',
        search_mode: 'unified'
      };
    }

    return {
      collections: [explicit_collection],
      qdrant_collections: [explicit_collection === 'in_stock' ? 'raw_materials_stock' : 'raw_materials_fda'],
      confidence: 1.0,
      reasoning: `Explicitly requested ${explicit_collection} collection`,
      search_mode: explicit_collection === 'in_stock' ? 'stock_only' : 'fda_only'
    };
  }

  // Check for in-stock keywords
  const has_stock_keywords = IN_STOCK_KEYWORDS.some(keyword =>
    query_lower.includes(keyword)
  );

  // Check for FDA/all ingredients keywords
  const has_fda_keywords = ALL_FDA_KEYWORDS.some(keyword =>
    query_lower.includes(keyword)
  );

  // Check for availability questions
  const is_availability_query = AVAILABILITY_KEYWORDS.some(keyword =>
    query_lower.includes(keyword)
  );

  // Decision logic
  if (has_stock_keywords && !has_fda_keywords) {
    return {
      collections: ['in_stock'],
      qdrant_collections: ['raw_materials_stock'],
      confidence: 0.9,
      reasoning: 'Query explicitly mentions stock/inventory',
      search_mode: 'stock_only'
    };
  }

  if (has_fda_keywords && !has_stock_keywords) {
    return {
      collections: ['all_fda'],
      qdrant_collections: ['raw_materials_fda'],
      confidence: 0.9,
      reasoning: 'Query asks for all FDA ingredients',
      search_mode: 'fda_only'
    };
  }

  if (is_availability_query) {
    // For availability queries, search both but prioritize stock
    return {
      collections: ['in_stock', 'all_fda'],
      qdrant_collections: ['raw_materials_stock', 'raw_materials_fda'],
      confidence: 0.85,
      reasoning: 'Availability query - checking stock first, then FDA database',
      search_mode: 'prioritize_stock'
    };
  }

  // Default: Search all FDA ingredients (comprehensive database)
  // Use stock-only when explicitly requested
  return {
    collections: ['all_fda'],
    qdrant_collections: ['raw_materials_fda'],
    confidence: 0.7,
    reasoning: 'Default search using comprehensive FDA database (raw_materials_fda)',
    search_mode: 'fda_only'
  };
}

/**
 * Format response based on collection source
 * Adds context about material availability
 */
export function format_response_with_source_context(
  results: any[],
  search_mode: string
): string {
  if (results.length === 0) {
    if (search_mode === 'stock_only') {
      return 'ไม่พบวัตถุดิบที่ต้องการในสต็อกปัจจุบัน แต่สามารถค้นหาในฐานข้อมูล FDA ทั้งหมดได้';
    }
    return 'ไม่พบวัตถุดิบที่ต้องการในฐานข้อมูล FDA';
  }

  // Group results by source
  const in_stock_results = results.filter(r =>
    r.metadata?.source === 'raw_materials_real_stock' ||
    r.document?.source === 'raw_materials_real_stock'
  );

  const fda_results = results.filter(r =>
    r.metadata?.source === 'raw_materials_console' ||
    r.document?.source === 'raw_materials_console'
  );

  let context = '';

  if (fda_results.length > 0) {
    context += `\n\n📚 **พบ ${fda_results.length} รายการในฐานข้อมูล FDA** (31,179 รายการทั้งหมด):\n`;
  }

  if (in_stock_results.length > 0) {
    context += `\n\n✅ **พบ ${in_stock_results.length} รายการในสต็อก** (สามารถสั่งซื้อได้ทันที):\n`;
  }

  return context;
}

/**
 * Merge and deduplicate results from multiple collections
 * Prioritizes in-stock materials when same ingredient found in both
 */
export function merge_collection_results(
  stock_results: any[],
  fda_results: any[],
  search_mode: string
): any[] {
  console.log(`🔄 [collection-router] Merging results - Stock: ${stock_results.length}, FDA: ${fda_results.length}`);

  // Add source tags
  const tagged_stock = stock_results.map(r => ({
    ...r,
    source: 'in_stock',
    availability: 'in_stock',
    priority_boost: 0.2 // Boost in-stock materials
  }));

  const tagged_fda = fda_results.map(r => ({
    ...r,
    source: 'all_fda',
    availability: 'fda_only'
  }));

  // Different merge strategies based on search mode
  switch (search_mode) {
    case 'stock_only':
      return tagged_stock;

    case 'fda_only':
      return tagged_fda;

    case 'prioritize_stock':
      // Show stock first, then FDA
      return [...tagged_stock, ...tagged_fda].slice(0, 10);

    case 'unified':
    default:
      // Merge and deduplicate by rm_code
      const merged = [...tagged_stock, ...tagged_fda];
      const seen = new Set();
      const unique = merged.filter(item => {
        const code = item.document?.rm_code || item.metadata?.rm_code;
        if (!code || seen.has(code)) return false;
        seen.add(code);
        return true;
      });

      // Sort by priority (in-stock first, then by score)
      return unique
        .sort((a, b) => {
          const priority_diff = (b.priority_boost || 0) - (a.priority_boost || 0);
          if (priority_diff !== 0) return priority_diff;
          return (b.score || 0) - (a.score || 0);
        })
        .slice(0, 10);
  }
}
