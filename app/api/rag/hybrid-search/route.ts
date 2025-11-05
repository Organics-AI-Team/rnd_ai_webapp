/**
 * Hybrid Search API Route
 * Server-side endpoint for hybrid search to avoid client-side module issues
 */

import { NextRequest, NextResponse } from 'next/server';
import { HybridSearchService } from '@/ai/services/rag/hybrid-search-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      query,
      serviceName = 'rawMaterialsAI',
      topK = 10,
      similarityThreshold = 0.5,
      enable_exact_match = true,
      enable_fuzzy_match = true,
      enable_semantic_search = true,
      enable_metadata_filter = true,
      max_results = 10,
      min_score = 0.5
    } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required and must be a string' },
        { status: 400 }
      );
    }

    // Check if Pinecone credentials are available
    if (!process.env.PINECONE_API_KEY) {
      console.warn('⚠️ Pinecone API key not configured. Hybrid search unavailable.');
      return NextResponse.json({
        success: true,
        results: [],
        formatted: '\n\n❌ Vector search is not configured. Please set PINECONE_API_KEY environment variable.',
        query,
        totalResults: 0,
        warning: 'Vector search is not configured.'
      });
    }

    console.log('🔍 [hybrid-search-api] Received search request:', {
      query,
      serviceName,
      topK,
      similarityThreshold
    });

    // Initialize hybrid search service
    const hybridService = new HybridSearchService(serviceName, {
      topK,
      similarityThreshold,
      includeMetadata: true
    });

    // Perform hybrid search
    const results = await hybridService.hybrid_search(query, {
      topK,
      similarityThreshold,
      enable_exact_match,
      enable_fuzzy_match,
      enable_semantic_search,
      enable_metadata_filter,
      max_results,
      min_score
    });

    // Format results for AI context
    const formatted = hybridService.format_hybrid_results(results);

    console.log(`✅ [hybrid-search-api] Found ${results.length} results`);

    return NextResponse.json({
      success: true,
      results,
      formatted,
      query,
      totalResults: results.length,
      metadata: {
        serviceName,
        topK,
        similarityThreshold,
        strategies_used: {
          exact_match: enable_exact_match,
          fuzzy_match: enable_fuzzy_match,
          semantic_search: enable_semantic_search,
          metadata_filter: enable_metadata_filter
        }
      }
    });

  } catch (error) {
    console.error('❌ [hybrid-search-api] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to perform hybrid search',
        results: [],
        formatted: '\n\n⚠️ Database search temporarily unavailable.',
        details: error.message
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json(
    { error: 'GET method not supported. Please use POST.' },
    { status: 405 }
  );
}
