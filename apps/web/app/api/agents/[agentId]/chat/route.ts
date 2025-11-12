/**
 * Universal Agent Chat API - Plug and Play
 * Single endpoint works for all agents
 */

import { NextRequest, NextResponse } from 'next/server';
import { AgentFactory } from '@/ai/agents/core/agent-factory';
import { getRawMaterialsAIAgent } from '@/ai/agents/core/agent-usage-example';
import { getSalesRndAIAgent } from '@/ai/agents/core/agent-usage-example';

// Agent registry for easy lookup
const AGENT_MAP: Record<string, () => any> = {
  'raw-materials-ai': getRawMaterialsAIAgent,
  'sales-rnd-ai': getSalesRndAIAgent
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const { message, userId } = await request.json();

    if (!message || !userId) {
      return NextResponse.json(
        { error: 'Message and userId are required' },
        { status: 400 }
      );
    }

    // Get agent instance (plug and play)
    const agentFunction = AGENT_MAP[agentId];
    if (!agentFunction) {
      return NextResponse.json(
        { error: `Agent ${agentId} not found` },
        { status: 404 }
      );
    }

    const agent = agentFunction();

    // Perform RAG search if enabled
    let ragContext = '';
    const config = agent.getConfig();

    if (config.rag.enabled) {
      ragContext = await agent.performRAGSearch(message);
    }

    // Generate AI response
    const aiService = agent.getAIService();
    const enhancedPrompt = message + ragContext;

    const response = await aiService.generateResponse({
      prompt: enhancedPrompt,
      userId
    });

    // Save conversation to agent's database
    const collections = await agent.getCollections();
    await collections.conversations.insertOne({
      userId,
      prompt: message,
      response: response.response,
      ragContext,
      timestamp: new Date(),
      agentId,
      model: response.model,
      latency: response.latency
    });

    return NextResponse.json({
      response: response.response,
      ragContext,
      agentConfig: {
        id: config.id,
        displayName: config.displayName,
        description: config.description
      },
      model: response.model,
      latency: response.latency
    });

  } catch (error: any) {
    console.error('Agent chat error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Get agent information
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    const agentFunction = AGENT_MAP[agentId];
    if (!agentFunction) {
      return NextResponse.json(
        { error: `Agent ${agentId} not found` },
        { status: 404 }
      );
    }

    const agent = agentFunction();
    const config = agent.getConfig();

    // Get index statistics
    let indexStats = null;
    try {
      indexStats = await agent.getVectorIndex().describeIndexStats();
    } catch (error) {
      console.warn('Could not get index stats:', error);
    }

    return NextResponse.json({
      agent: {
        id: config.id,
        displayName: config.displayName,
        description: config.description,
        aiModel: config.aiModel,
        database: config.database,
        vectorDb: config.vectorDb,
        embedding: config.embedding,
        rag: config.rag
      },
      indexStats,
      prompts: {
        welcomeMessage: config.prompts.welcomeMessage,
        userInstructions: config.prompts.userInstructions
      }
    });

  } catch (error: any) {
    console.error('Agent info error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}