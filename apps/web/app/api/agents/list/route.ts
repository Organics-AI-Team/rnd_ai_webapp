import { NextRequest, NextResponse } from 'next/server';
import { getEnabledAgentConfigs } from '@/ai/agents/configs/agent-configs';
import { with_request_principal } from '@/lib/server/with-request-principal';

/**
 * List enabled agent configurations for the authenticated caller.
 *
 * @param request - Incoming request; requires a verified session (ai:run).
 * @returns JSON list of enabled agents, or a guard error response.
 */
export async function GET(request: NextRequest) {
  return with_request_principal(request, 'ai:run', async () => {
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
  });
}

/**
 * POST is unsupported for the agent list.
 *
 * @param request - Incoming request; requires a verified session (ai:run).
 * @returns 405 response.
 */
export async function POST(request: NextRequest) {
  return with_request_principal(request, 'ai:run', async () => {
    return NextResponse.json(
      { error: 'POST method not supported. Please use GET.' },
      { status: 405 }
    );
  });
}
