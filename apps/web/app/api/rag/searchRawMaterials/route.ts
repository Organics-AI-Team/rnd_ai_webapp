import { NextRequest, NextResponse } from 'next/server';
import { PineconeRAGService } from '@/ai/services/rag/qdrant-rag-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, topK = 5, similarityThreshold = 0.7 } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required and must be a string' },
        { status: 400 }
      );
    }

    // Check if Qdrant is available (required for vector/RAG search)
    if (!process.env.QDRANT_URL) {
      console.warn('[searchRawMaterials-api] QDRANT_URL not configured. RAG search unavailable.');
      return NextResponse.json({
        success: true,
        matches: [],
        query,
        totalResults: 0,
        warning: 'Vector search is not configured. Please set QDRANT_URL environment variable.'
      });
    }

    // Initialize RAG service (PineconeRAGService is an alias for QdrantRAGService)
    const ragService = new PineconeRAGService();

    // Search for similar materials using snake_case method per QdrantRAGService convention
    const matches = await ragService.search_similar(query, {
      topK,
      similarityThreshold
    });

    return NextResponse.json({
      success: true,
      matches,
      query,
      totalResults: matches.length
    });

  } catch (error) {
    console.error('Error in RAG search API:', error);
    return NextResponse.json(
      {
        error: 'Failed to search raw materials',
        matches: [],
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