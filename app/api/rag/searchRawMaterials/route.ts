import { NextRequest, NextResponse } from 'next/server';
import { PineconeRAGService } from '@/ai/services/rag/pinecone-service';

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

    // Check if Pinecone credentials are available
    if (!process.env.PINECONE_API_KEY) {
      console.warn('⚠️ Pinecone API key not configured. RAG search unavailable.');
      return NextResponse.json({
        success: true,
        matches: [],
        query,
        totalResults: 0,
        warning: 'Vector search is not configured. Please set PINECONE_API_KEY environment variable.'
      });
    }

    // Initialize RAG service
    const ragService = new PineconeRAGService();

    // Search for similar materials
    const matches = await ragService.searchSimilar(query, {
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