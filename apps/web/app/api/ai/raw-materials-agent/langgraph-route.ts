/**
 * LangGraph-powered Raw Materials Agent API Route
 * Advanced state-based workflow with conditional routing and tool orchestration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLangGraphRawMaterialsAgent } from '@/ai/agents/raw-materials-ai/langgraph-agent';
import { PreferenceLearningService } from '@/ai/services/ml/preference-learning-service';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

// Initialize LangGraph agent once on server
let langGraphAgent: any = null;
let mlService: PreferenceLearningService | null = null;

function initializeLangGraphServices() {
  if (langGraphAgent) return { langGraphAgent, mlService };

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log('🚀 [LangGraphRoute] Initializing LangGraph-powered services');

  try {
    // Initialize LangGraph agent
    langGraphAgent = createLangGraphRawMaterialsAgent(GEMINI_API_KEY);
    console.log('✅ [LangGraphRoute] LangGraph agent initialized');

    // Initialize ML service for preference learning
    mlService = new PreferenceLearningService();
    console.log('✅ [LangGraphRoute] ML preference service initialized');

    console.log('✅ [LangGraphRoute] LangGraph services ready');
    return { langGraphAgent, mlService };
  } catch (error) {
    console.error('❌ [LangGraphRoute] Service initialization failed:', error);
    throw error;
  }
}

/**
 * Handle LangGraph-powered AI response
 */
async function handleLangGraphResponse(
  services: any,
  body: any
): Promise<NextResponse> {
  const { prompt, userId, conversationHistory, enableML = true } = body;

  try {
    console.log(`🔄 [LangGraphRoute] Processing message: "${prompt.substring(0, 100)}..."`);

    // Process message through LangGraph workflow
    const startTime = Date.now();
    const result = await services.langGraphAgent.processMessage(prompt);
    const processingTime = Date.now() - startTime;

    console.log(`✅ [LangGraphRoute] LangGraph response completed in ${processingTime}ms`);

    // Prepare response data
    const responseData = {
      success: true,
      response: result.response,
      confidence: result.confidence,
      toolCalls: result.toolCalls || [],
      results: result.results || [],
      processingTime,
      agent: 'langgraph',
      timestamp: new Date().toISOString(),
      metadata: {
        workflowType: 'state_graph',
        nodesExecuted: result.toolCalls?.length || 0,
        queryType: result.queryType,
        stateTransitions: result.stateTransitions
      }
    };

    // Store interaction for ML learning if enabled
    if (enableML && services.mlService && userId) {
      try {
        await services.mlService.recordInteraction({
          userId,
          query: prompt,
          response: result.response,
          toolCalls: result.toolCalls || [],
          confidence: result.confidence,
          resultsCount: result.results?.length || 0,
          timestamp: new Date(),
          processingTime,
          agent: 'langgraph'
        });
        console.log('📊 [LangGraphRoute] Interaction recorded for ML learning');
      } catch (mlError) {
        console.warn('⚠️ [LangGraphRoute] ML recording failed:', mlError);
      }
    }

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('❌ [LangGraphRoute] LangGraph processing failed:', error);

    return NextResponse.json({
      success: false,
      error: 'Processing failed',
      details: error.message,
      agent: 'langgraph',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

/**
 * Get workflow statistics and health
 */
async function getWorkflowStats(services: any): Promise<NextResponse> {
  try {
    const graph = services.langraphAgent.getGraph();

    // Get graph information
    const graphInfo = {
      nodes: graph.nodes.map((node: any) => node.id),
      edges: graph.edges.length,
      isCompiled: !!graph.compiled
    };

    return NextResponse.json({
      success: true,
      agent: 'langgraph',
      status: 'healthy',
      graph: graphInfo,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [LangGraphRoute] Stats failed:', error);

    return NextResponse.json({
      success: false,
      error: 'Stats retrieval failed',
      details: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

/**
 * Main POST handler
 */
export async function POST(request: NextRequest) {
  try {
    // Initialize services
    const services = initializeLangGraphServices();

    // Parse request body
    const body = await request.json();
    const { action = 'process' } = body;

    console.log(`📥 [LangGraphRoute] ${action} request received`);

    switch (action) {
      case 'process':
        return await handleLangGraphResponse(services, body);

      case 'stats':
        return await getWorkflowStats(services);

      default:
        return NextResponse.json({
          success: false,
          error: 'Invalid action',
          availableActions: ['process', 'stats'],
          timestamp: new Date().toISOString()
        }, { status: 400 });
    }

  } catch (error) {
    console.error('❌ [LangGraphRoute] Request handling failed:', error);

    return NextResponse.json({
      success: false,
      error: 'Request failed',
      details: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

/**
 * GET handler for health check and basic info
 */
export async function GET() {
  try {
    const services = initializeLangGraphServices();

    return NextResponse.json({
      success: true,
      agent: 'langgraph',
      status: 'ready',
      version: '1.0.0',
      features: [
        'State-based workflow',
        'Conditional routing',
        'Tool orchestration',
        'Confidence scoring',
        'Error handling',
        'ML preference learning'
      ],
      endpoints: {
        POST: '/api/ai/raw-materials-agent/langgraph-route',
        actions: ['process', 'stats']
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [LangGraphRoute] Health check failed:', error);

    return NextResponse.json({
      success: false,
      error: 'Service unavailable',
      details: error.message,
      timestamp: new Date().toISOString()
    }, { status: 503 });
  }
}