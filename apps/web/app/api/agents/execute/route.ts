import { NextRequest, NextResponse } from 'next/server';
import { AgentManager } from '@/ai/agents/agent-manager';
import { GeminiService } from '@/ai/services/providers/gemini-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, userId, request: userRequest, context, options } = body;

    if (!agentId || !userId || !userRequest) {
      return NextResponse.json(
        { error: 'agentId, userId, and request are required' },
        { status: 400 }
      );
    }

    // Initialize AI service
    const aiService = new GeminiService(process.env.GEMINI_API_KEY!);

    // Initialize agent manager
    const agentManager = new AgentManager(aiService);

    // Execute the agent
    const result = await agentManager.executeAgent({
      agentId,
      userId,
      request: userRequest,
      context,
      options
    });

    return NextResponse.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Error in agent execution API:', error);
    return NextResponse.json(
      {
        error: 'Failed to execute agent',
        details: error instanceof Error ? error.message : 'Unknown error'
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