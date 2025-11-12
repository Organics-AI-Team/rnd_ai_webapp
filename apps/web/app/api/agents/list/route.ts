import { NextRequest, NextResponse } from 'next/server';
import { getEnabledAgentConfigs } from '@/ai/agents/configs/agent-configs';

export async function GET(request: NextRequest) {
  try {
    const agents = getEnabledAgentConfigs();

    return NextResponse.json({
      success: true,
      agents: agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        category: agent.category,
        provider: agent.provider,
        capabilities: agent.capabilities,
        enabled: agent.enabled,
        ragIndexIds: agent.ragIndexIds,
        version: agent.version
      }))
    });

  } catch (error) {
    console.error('Error getting agent list:', error);
    return NextResponse.json(
      { error: 'Failed to get agent list' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: 'POST method not supported. Please use GET.' },
    { status: 405 }
  );
}