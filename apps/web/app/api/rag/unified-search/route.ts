/**
 * Unified Search API Endpoint
 * Provides client-side access to UnifiedSearchService with intelligent collection routing
 */

import { NextRequest, NextResponse } from 'next/server';
import { with_request_principal } from '@/lib/server/with-request-principal';
import { getUnifiedSearchService } from '@/ai/services/rag/unified-search-service';
import { route_query_to_collections } from '@/ai/utils/collection-router';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return with_request_principal(request, 'tenant:read', async (_principal, guarded_body) => {
  console.log('📨 [unified-search-api] Received request');

  try {
    const body = (guarded_body ?? {}) as any;
    const {
      query,
      serviceName = 'rawMaterialsAI',
      collection,
      topK = 10,
      similarityThreshold = 0.5,
      enable_exact_match = true,
      enable_fuzzy_match = true,
      enable_semantic_search = true,
      enable_metadata_filter = true,
      max_results = 10,
      min_score = 0.5,
      include_availability_context = true
    } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Query parameter is required and must be a string',
          results: [],
          formatted: '',
          query: '',
          totalResults: 0
        },
        { status: 400 }
      );
    }

    console.log('🔍 [unified-search-api] Query:', query);
    console.log('🎯 [unified-search-api] Collection:', collection || 'auto-route');

    // Initialize unified search service
    const searchService = getUnifiedSearchService();

    // Get routing decision for logging
    const routing = route_query_to_collections(query, collection);
    console.log('🔀 [unified-search-api] Routing:', routing);

    // Perform unified search
    const results = await searchService.unified_search(query, {
      collection,
      topK,
      similarityThreshold,
      enable_exact_match,
      enable_fuzzy_match,
      enable_semantic_search,
      enable_metadata_filter,
      max_results,
      min_score,
      include_availability_context
    });

    console.log(`✅ [unified-search-api] Found ${results.length} results`);

    // Get collection stats
    const stats = searchService.get_collection_stats(results);
    console.log('📊 [unified-search-api] Stats:', stats);

    // Format results for display
    const formatted = format_unified_results(results, routing.search_mode);

    return NextResponse.json({
      success: true,
      results,
      formatted,
      query,
      totalResults: results.length,
      routing: {
        collections: routing.collections,
        search_mode: routing.search_mode,
        reasoning: routing.reasoning,
        confidence: routing.confidence
      },
      stats,
      metadata: {
        serviceName,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('❌ [unified-search-api] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Unknown error occurred',
        results: [],
        formatted: '\n\n⚠️ Database search temporarily unavailable. Please try again later.',
        query: '',
        totalResults: 0
      },
      { status: 500 }
    );
  }
  });
}

/**
 * Format unified search results for AI context
 */
function format_unified_results(results: any[], search_mode: string): string {
  if (results.length === 0) {
    if (search_mode === 'stock_only') {
      return '\n\n❌ ไม่พบวัตถุดิบที่ต้องการในสต็อกปัจจุบัน แต่สามารถค้นหาในฐานข้อมูล FDA ทั้งหมดได้';
    }
    return '\n\n❌ ไม่พบวัตถุดิบที่ต้องการในฐานข้อมูล';
  }

  // Group results by availability
  const in_stock_results = results.filter(r => r.availability === 'in_stock');
  const fda_results = results.filter(r => r.availability === 'fda_only');

  let formatted = '\n\n✅ **ผลการค้นหาจากฐานข้อมูล (Unified Search with Intelligent Routing)**:\n\n';

  // In-stock section
  if (in_stock_results.length > 0) {
    formatted += `### ✅ **พบในสต็อก (${in_stock_results.length} รายการ)** - สามารถสั่งซื้อได้ทันที\n\n`;

    in_stock_results.forEach((result, index) => {
      const doc = result.document;
      formatted += `${index + 1}. **${doc.trade_name || 'Unknown Material'}** (Score: ${result.score.toFixed(3)})\n`;
      if (doc.rm_code) formatted += `   📦 **รหัสวัตถุดิบ:** ${doc.rm_code}\n`;
      if (doc.inci_name) formatted += `   🧪 **INCI Name:** ${doc.inci_name}\n`;
      if (doc.supplier) formatted += `   🏢 **Supplier:** ${doc.supplier}\n`;
      if (doc.rm_cost) formatted += `   💰 **ราคา:** ${doc.rm_cost}\n`;
      if (doc.benefits) formatted += `   ✨ **ประโยชน์:** ${doc.benefits.substring(0, 150)}${doc.benefits.length > 150 ? '...' : ''}\n`;
      formatted += `   🔍 **Match Type:** ${result.match_type}\n`;
      formatted += `   ✅ **สถานะ:** มีในสต็อก\n\n`;
    });
  }

  // FDA section
  if (fda_results.length > 0 && search_mode !== 'stock_only') {
    formatted += `### 📚 **ฐานข้อมูล FDA (${fda_results.length} รายการ)** - อาจต้องสั่งซื้อเพิ่มเติม\n\n`;

    fda_results.slice(0, 5).forEach((result, index) => {
      const doc = result.document;
      formatted += `${index + 1}. **${doc.trade_name || 'Unknown Material'}** (Score: ${result.score.toFixed(3)})\n`;
      if (doc.rm_code) formatted += `   📦 **รหัสวัตถุดิบ:** ${doc.rm_code}\n`;
      if (doc.inci_name) formatted += `   🧪 **INCI Name:** ${doc.inci_name}\n`;
      if (doc.supplier) formatted += `   🏢 **Supplier:** ${doc.supplier}\n`;
      if (doc.benefits) formatted += `   ✨ **ประโยชน์:** ${doc.benefits.substring(0, 100)}${doc.benefits.length > 100 ? '...' : ''}\n`;
      formatted += `   🔍 **Match Type:** ${result.match_type}\n`;
      formatted += `   📚 **สถานะ:** ฐานข้อมูล FDA\n\n`;
    });

    if (fda_results.length > 5) {
      formatted += `   *(แสดง 5 จาก ${fda_results.length} รายการ)*\n\n`;
    }
  }

  // Summary
  formatted += `---\n`;
  formatted += `**สรุป:** พบทั้งหมด ${results.length} รายการ`;
  if (in_stock_results.length > 0) {
    formatted += ` | ✅ มีในสต็อก: ${in_stock_results.length} รายการ`;
  }
  if (fda_results.length > 0 && search_mode !== 'stock_only') {
    formatted += ` | 📚 ฐานข้อมูล FDA: ${fda_results.length} รายการ`;
  }
  formatted += '\n';

  return formatted;
}
