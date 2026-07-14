import { NextRequest, NextResponse } from 'next/server';
import { AgentManager } from '@/ai/agents/agent-manager';
import { GeminiService } from '@/ai/services/providers/gemini-service';
import { with_request_principal } from '@/lib/server/with-request-principal';

/**
 * Execute a configured agent for the authenticated caller. The acting user
 * always derives from the verified principal, never from the request body.
 *
 * @param request - Incoming request; requires a verified session (ai:run).
 * @returns Agent execution result, or a guard error response.
 */
export async function POST(request: NextRequest) {
  return with_request_principal(request, 'ai:run', async (principal, body) => {
    try {
      const { agentId, request: userRequest, context, options } = (body ?? {}) as {
        agentId?: string;
        request?: string;
        context?: unknown;
        options?: unknown;
      };

      if (!agentId || !userRequest) {
        return NextResponse.json(
          { error: 'agentId and request are required' },
          { status: 400 }
        );
      }

      // Initialize AI service
      const aiService = new GeminiService(process.env.GEMINI_API_KEY!);

      // Initialize agent manager
      const agentManager = new AgentManager(aiService);

      // Execute the agent as the verified principal
      const result = await agentManager.executeAgent({
        agentId,
        userId: principal.internal_user_id,
        request: userRequest,
        context: context as any,
        options: options as any
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
  });
}

/**
 * GET is unsupported for agent execution.
 *
 * @param request - Incoming request; requires a verified session (ai:run).
 * @returns 405 response.
 */
export async function GET(request: NextRequest) {
  return with_request_principal(request, 'ai:run', async () => {
    return NextResponse.json(
      { error: 'GET method not supported. Please use POST.' },
      { status: 405 }
    );
  });
}
