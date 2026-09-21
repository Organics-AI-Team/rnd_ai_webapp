/**
 * Canonical API route for the unified R&D AI Agent.
 *
 * This is the sole active agent execution path for materials, formula,
 * costing, market research, and sales planning. The former raw-materials URL
 * re-exports this route only for backwards compatibility.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createTRPCContext } from '@/server/trpc';
import { ReactAgentService } from '@/ai/agents/react/react-agent-service';
import { PreferenceLearningService } from '@/ai/services/ml/preference-learning-service';

let react_agent_singleton: ReactAgentService | null = null;
let preference_learning_service: PreferenceLearningService | null = null;
const REACT_AGENT_TIMEOUT_MS = Number(process.env.REACT_AGENT_TIMEOUT_MS || 52_000);

/**
 * Resolve the acting user from the session cookie.
 *
 * The caller's `userId` is never read from the request body: a signed-in user
 * could otherwise act as any other user by changing one field (the body is
 * attacker-controlled, the session cookie is not). The edge middleware already
 * rejects requests with no cookie; this re-resolves it so the handler acts on a
 * verified identity rather than a claimed one.
 *
 * @returns The authenticated user and organization ids, or null when the
 *          session is absent or expired.
 */
async function resolve_session_actor(): Promise<
  { user_id: string; organization_id: string | null } | null
> {
  const context = await createTRPCContext();
  if (!context.userId) {
    return null;
  }
  return { user_id: context.userId, organization_id: context.organizationId };
}

/** Report configuration readiness without exposing connection values or secrets. */
function get_agent_readiness(): { configured: boolean; missing: string[] } {
  const required = [
    // No NEXT_PUBLIC_* fallback: that prefix is inlined into client bundles,
    // so reading one here would ship the provider credential to every browser.
    ['GEMINI_API_KEY', process.env.GEMINI_API_KEY],
    ['MONGODB_URI', process.env.MONGODB_URI],
    ['RAW_MATERIALS_REAL_STOCK_MONGODB_URI', process.env.RAW_MATERIALS_REAL_STOCK_MONGODB_URI],
    ['QDRANT_URL', process.env.QDRANT_URL],
  ] as const;
  const missing = required
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return { configured: missing.length === 0, missing };
}

/** Return the singleton unified agent without initializing retired pipelines. */
function get_react_agent(): ReactAgentService {
  console.log('[R&DAgentAPI] get_react_agent — start');

  if (!react_agent_singleton) {
    react_agent_singleton = new ReactAgentService();
    console.log('[R&DAgentAPI] get_react_agent — created singleton');
  }

  console.log('[R&DAgentAPI] get_react_agent — complete');
  return react_agent_singleton;
}

/** Return the feedback learner only when a user submits feedback. */
function get_preference_learning_service(): PreferenceLearningService {
  console.log('[R&DAgentAPI] get_preference_learning_service — start');

  if (!preference_learning_service) {
    preference_learning_service = new PreferenceLearningService();
    console.log('[R&DAgentAPI] get_preference_learning_service — created singleton');
  }

  console.log('[R&DAgentAPI] get_preference_learning_service — complete');
  return preference_learning_service;
}

/** Reject an agent request that exceeds the configured processing deadline. */
function with_timeout<T>(promise: Promise<T>, timeout_ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeout_ms);
    }),
  ]);
}

/** Provide a compact health response for the sole production R&D agent. */
export async function GET(): Promise<NextResponse> {
  console.log('[R&DAgentAPI] GET — start');
  const readiness = get_agent_readiness();

  return NextResponse.json({
    status: readiness.configured ? 'configured' : 'degraded',
    agent: 'rnd_ai',
    capabilities: ['materials', 'stock', 'formula', 'costing', 'market', 'sales'],
    readiness,
    timestamp: new Date().toISOString(),
  });
}

/** Execute a unified R&D agent request with the current chat context. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  console.log('[R&DAgentAPI] POST — start');

  try {
    const actor = await resolve_session_actor();
    if (!actor) {
      console.warn('[R&DAgentAPI] POST — rejected: no valid session');
      return NextResponse.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    const body = await request.json();
    if (!body.prompt) {
      return NextResponse.json(
        { error: 'Missing required field: prompt', success: false },
        { status: 400 },
      );
    }

    const react_result = await with_timeout(
      get_react_agent().execute({
        prompt: String(body.prompt),
        user_id: actor.user_id,
        organization_id: actor.organization_id ?? undefined,
        session_id: body.sessionId ? String(body.sessionId) : undefined,
        persist_formula: body.persistFormula,
        conversation_history: Array.isArray(body.conversationHistory)
          ? body.conversationHistory.slice(-30).map((message: any) => ({
              role: message?.role || 'user',
              content: String(message?.content || ''),
            }))
          : undefined,
      }),
      REACT_AGENT_TIMEOUT_MS,
      'AI processing timed out. Please try a narrower request.',
    );

    if (!react_result.success) {
      throw new Error(react_result.response || 'The R&D agent could not complete the request.');
    }

    console.log('[R&DAgentAPI] POST — complete', {
      iterations: react_result.iterations,
      tool_call_count: react_result.tool_calls.length,
      processing_time_ms: react_result.processing_time,
    });

    return NextResponse.json({
      success: true,
      response: react_result.response,
      model: react_result.model,
      id: `rnd-${Date.now()}`,
      type: 'react-agent',
      features: {
        searchEnabled: react_result.tool_calls.some((tool_call) => (
          tool_call.name === 'qdrant_search' || tool_call.name === 'web_search'
        )),
        mlEnabled: false,
        searchResultsCount: react_result.tool_calls.filter((tool_call) => (
          tool_call.name === 'qdrant_search' || tool_call.name === 'web_search'
        )).length,
        optimizationsApplied: react_result.tool_calls.map((tool_call) => tool_call.name),
      },
      toolCalls: react_result.tool_calls,
      metadata: {
        iterations: react_result.iterations,
        processingTime: react_result.processing_time,
        agent: 'rnd_ai',
        artifacts: react_result.artifacts,
      },
    });
  } catch (error) {
    const error_message = error instanceof Error ? error.message : String(error);
    console.error('[R&DAgentAPI] POST — error', { error: error_message });
    return NextResponse.json({ success: false, error: error_message }, { status: 500 });
  }
}

/** Record user feedback without re-entering an agent execution pipeline. */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  console.log('[R&DAgentAPI] PUT — start');

  try {
    const actor = await resolve_session_actor();
    if (!actor) {
      console.warn('[R&DAgentAPI] PUT — rejected: no valid session');
      return NextResponse.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    const body = await request.json();
    if (!body.feedback) {
      return NextResponse.json(
        { error: 'Missing required field: feedback', success: false },
        { status: 400 },
      );
    }

    await get_preference_learning_service().recordInteraction({
      userId: actor.user_id,
      prompt: '',
      response: '',
      feedback: {
        type: body.feedback.type || 'positive',
        score: Number(body.feedback.score || 1),
        timestamp: new Date(),
      },
      context: {
        category: 'rnd_ai',
        complexity: 'medium',
        expertiseLevel: 'intermediate',
      },
    });

    console.log('[R&DAgentAPI] PUT — complete', { user_id: actor.user_id });
    return NextResponse.json({
      success: true,
      data: { message: 'Feedback recorded successfully', updatedPreferences: true },
    });
  } catch (error) {
    const error_message = error instanceof Error ? error.message : String(error);
    console.error('[R&DAgentAPI] PUT — error', { error: error_message });
    return NextResponse.json({ success: false, error: error_message }, { status: 500 });
  }
}
