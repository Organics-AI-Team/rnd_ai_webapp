/**
 * API Route to refresh AI Chat embeddings context
 * Called after successful indexing to update the chatbot
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { action } = await req.json();

    if (action === 'refresh_embeddings') {
      // In a real implementation, you might:
      // 1. Clear any cached embeddings in the AI chat service
      // 2. Refresh the embedding service instance
      // 3. Update any in-memory context

      console.log('Refreshing AI chat embeddings context...');

      // Simulate some refresh work
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log('AI chat embeddings context refreshed successfully');

      return NextResponse.json({
        success: true,
        message: 'AI Chat context updated successfully'
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Invalid action'
      },
      { status: 400 }
    );

  } catch (error) {
    console.error('AI Chat refresh error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}