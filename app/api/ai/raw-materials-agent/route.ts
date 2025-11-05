/**
 * Raw Materials Agent API Route
 * Server-side endpoint for tool-enabled AI agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { RawMaterialsAgent } from '@/ai/agents/raw-materials-ai/agent';
import { GeminiToolService } from '@/ai/services/providers/gemini-tool-service';

const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

// Initialize agent once on server
let toolService: GeminiToolService | null = null;

function initialize_agent() {
  if (toolService) return toolService;

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log('🚀 [RawMaterialsAgentAPI] Initializing agent with tools');

  // Initialize agent and register tools
  const toolRegistry = RawMaterialsAgent.initialize();

  // Get enhanced system prompt with tool instructions
  const systemPrompt = RawMaterialsAgent.getInstructions();

  // Create Gemini tool service with enhanced prompt
  toolService = new GeminiToolService(
    GEMINI_API_KEY,
    toolRegistry,
    {
      model: 'gemini-2.0-flash-exp',
      temperature: 0.7,
      maxTokens: 9000
    },
    'rawMaterialsAI'
  );

  // Note: System prompt will be used in the enhancePrompt method
  console.log('✅ [RawMaterialsAgentAPI] Agent initialized successfully with enhanced prompt');
  return toolService;
}

/**
 * POST /api/ai/raw-materials-agent
 * Generate AI response with tool calling
 */
export async function POST(request: NextRequest) {
  console.log('📥 [RawMaterialsAgentAPI] Received request');

  try {
    const body = await request.json();
    const { prompt, userId, conversationHistory } = body;

    if (!prompt || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: prompt, userId' },
        { status: 400 }
      );
    }

    // Initialize agent if needed
    const service = initialize_agent();

    // Generate response with tool calling
    console.log('🤖 [RawMaterialsAgentAPI] Generating response for:', prompt);

    const response = await service.generateResponse({
      prompt,
      userId,
      context: {
        conversationHistory: conversationHistory || [],
        category: 'raw-materials'
      }
    });

    console.log('✅ [RawMaterialsAgentAPI] Response generated successfully');

    return NextResponse.json({
      success: true,
      response: response.response,
      model: response.model,
      id: response.id
    });

  } catch (error: any) {
    console.error('❌ [RawMaterialsAgentAPI] Error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Internal server error',
        success: false
      },
      { status: 500 }
    );
  }
}
