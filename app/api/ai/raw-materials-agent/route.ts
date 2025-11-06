/**
 * Enhanced Raw Materials Agent API Route
 * Server-side endpoint for tool-enabled AI agent with streaming, scoring, and ML optimizations
 */

import { NextRequest, NextResponse } from 'next/server';
import { RawMaterialsAgent } from '@/ai/agents/raw-materials-ai/agent';
import { GeminiToolService } from '@/ai/services/providers/gemini-tool-service';
import { EnhancedAIService } from '@/ai/services/enhanced/enhanced-ai-service';
import { ResponseReranker } from '@/ai/services/response/response-reranker';
import { EnhancedHybridSearchService } from '@/ai/services/rag/enhanced-hybrid-search-service';
import { PreferenceLearningService } from '@/ai/services/ml/preference-learning-service';

const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;

// Initialize services once on server
let toolService: GeminiToolService | null = null;
let enhancedService: EnhancedAIService | null = null;
let responseReranker: ResponseReranker | null = null;
let searchService: EnhancedHybridSearchService | null = null;
let mlService: PreferenceLearningService | null = null;

function initialize_services() {
  if (toolService && enhancedService) return { toolService, enhancedService, responseReranker, searchService, mlService };

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log('🚀 [RawMaterialsAgentAPI] Initializing enhanced services');

  // Initialize original agent and tools
  const toolRegistry = RawMaterialsAgent.initialize();
  const systemPrompt = RawMaterialsAgent.getInstructions();

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

  // Initialize enhanced services if API keys are available
  if (OPENAI_API_KEY && PINECONE_API_KEY) {
    try {
      enhancedService = new EnhancedAIService(OPENAI_API_KEY, 'gpt-4');
      responseReranker = new ResponseReranker(PINECONE_API_KEY);
      searchService = new EnhancedHybridSearchService(PINECONE_API_KEY);
      mlService = new PreferenceLearningService();

      console.log('✅ [RawMaterialsAgentAPI] Enhanced services initialized successfully');
    } catch (error) {
      console.warn('⚠️ [RawMaterialsAgentAPI] Enhanced services initialization failed:', error);
    }
  } else {
    console.warn('⚠️ [RawMaterialsAgentAPI] Missing API keys for enhanced features');
  }

  console.log('✅ [RawMaterialsAgentAPI] All services initialized');
  return { toolService, enhancedService, responseReranker, searchService, mlService };
}

/**
 * Handle enhanced AI response with all optimizations
 */
async function handleEnhancedResponse(
  services: any,
  body: any
): Promise<NextResponse> {
  const {
    prompt,
    userId,
    conversationHistory,
    enableMLOptimizations = false,
    enableSearch = false,
    preferences = {}
  } = body;

  console.log('🚀 [RawMaterialsAgentAPI] Generating enhanced response for:', prompt);

  try {
    // Get user preferences if ML is enabled
    let userPreferences = preferences;
    if (enableMLOptimizations && services.mlService) {
      try {
        userPreferences = await services.mlService.getUserPreferences(userId);
        console.log('🧠 [RawMaterialsAgentAPI] Loaded user preferences for ML optimization');
      } catch (error) {
        console.warn('⚠️ [RawMaterialsAgentAPI] Failed to load user preferences:', error);
      }
    }

    // Perform hybrid search if enabled
    let searchResults: any[] = [];
    if (enableSearch && services.searchService) {
      try {
        searchResults = await services.searchService.hybridSearch(prompt, {
          userId,
          category: 'raw-materials',
          limit: 10,
          includeMetadata: true
        });
        console.log(`🔍 [RawMaterialsAgentAPI] Found ${searchResults.length} search results`);
      } catch (error) {
        console.warn('⚠️ [RawMaterialsAgentAPI] Search failed:', error);
      }
    }

    // Generate enhanced response
    const enhancedResponse = await services.enhancedService!.generateEnhancedResponse({
      prompt,
      userId,
      context: {
        conversationHistory: conversationHistory || [],
        category: 'raw-materials',
        searchResults,
        userPreferences
      }
    });

    // Score response if reranker is available
    let responseScore: any = null;
    if (services.responseReranker && searchResults.length > 0) {
      try {
        responseScore = await services.responseReranker.scoreResponse(
          prompt,
          enhancedResponse.response,
          searchResults,
          {
            enableFactCheck: true,
            enablePersonalization: enableMLOptimizations,
            userPreferences
          }
        );
        console.log('📊 [RawMaterialsAgentAPI] Response scored:', {
          overall: responseScore.overallScore.toFixed(3),
          relevance: responseScore.relevanceScore.toFixed(3),
          accuracy: responseScore.factualAccuracy.toFixed(3)
        });
      } catch (error) {
        console.warn('⚠️ [RawMaterialsAgentAPI] Response scoring failed:', error);
      }
    }

    // Learn from user interaction if ML is enabled
    if (enableMLOptimizations && services.mlService) {
      try {
        await services.mlService.recordInteraction({
          userId,
          prompt,
          response: enhancedResponse.response,
          context: {
            category: 'raw-materials',
            hasSearchResults: searchResults.length > 0,
            responseScore: responseScore?.overallScore || 0.8
          }
        });
        console.log('📚 [RawMaterialsAgentAPI] Recorded interaction for ML learning');
      } catch (error) {
        console.warn('⚠️ [RawMaterialsAgentAPI] Failed to record interaction:', error);
      }
    }

    console.log('✅ [RawMaterialsAgentAPI] Enhanced response generated successfully');

    return NextResponse.json({
      success: true,
      response: enhancedResponse.response,
      model: enhancedResponse.model || 'gpt-4-enhanced',
      id: enhancedResponse.id,
      type: 'enhanced',
      structuredData: enhancedResponse.structuredData,
      performance: enhancedResponse.performance,
      searchResults: searchResults.slice(0, 5), // Limit to top 5
      responseScore,
      userPreferences: enableMLOptimizations ? userPreferences : undefined
    });

  } catch (error: any) {
    console.error('❌ [RawMaterialsAgentAPI] Enhanced response failed:', error);

    // Fallback to original response
    console.log('🔄 [RawMaterialsAgentAPI] Falling back to original response');
    const fallbackResponse = await services.toolService!.generateResponse({
      prompt: body.prompt,
      userId: body.userId,
      context: {
        conversationHistory: body.conversationHistory || [],
        category: 'raw-materials'
      }
    });

    return NextResponse.json({
      success: true,
      response: fallbackResponse.response,
      model: fallbackResponse.model,
      id: fallbackResponse.id,
      type: 'fallback',
      warning: 'Enhanced features failed, used original response'
    });
  }
}

/**
 * Handle streaming response
 */
function handleStreamingResponse(
  request: NextRequest,
  services: any,
  body: any
): NextResponse {
  const { prompt, userId, conversationHistory, enableMLOptimizations = false } = body;

  console.log('🌊 [RawMaterialsAgentAPI] Starting streaming response for:', prompt);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Generate enhanced response with streaming
        await services.enhancedService!.generateStreamingResponse({
          prompt,
          userId,
          context: {
            conversationHistory: conversationHistory || [],
            category: 'raw-materials'
          },
          onProgress: (chunk: string) => {
            const data = JSON.stringify({
              type: 'chunk',
              content: chunk,
              timestamp: Date.now()
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          },
          onComplete: async (fullResponse: any) => {
            // Send final response with metadata
            const finalData = JSON.stringify({
              type: 'complete',
              response: fullResponse.response,
              model: fullResponse.model || 'gpt-4-streaming',
              id: fullResponse.id,
              type: 'streaming',
              structuredData: fullResponse.structuredData,
              performance: fullResponse.performance,
              timestamp: Date.now()
            });
            controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
            controller.close();
          },
          onError: (error: Error) => {
            const errorData = JSON.stringify({
              type: 'error',
              error: error.message,
              timestamp: Date.now()
            });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
            controller.close();
          }
        });

        // Learn from interaction if ML is enabled
        if (enableMLOptimizations && services.mlService) {
          try {
            await services.mlService.recordInteraction({
              userId,
              prompt,
              response: '', // Will be updated when complete
              context: { category: 'raw-materials', isStreaming: true }
            });
          } catch (error) {
            console.warn('⚠️ [RawMaterialsAgentAPI] Failed to record streaming interaction:', error);
          }
        }

      } catch (error: any) {
        console.error('❌ [RawMaterialsAgentAPI] Streaming error:', error);
        const errorData = JSON.stringify({
          type: 'error',
          error: error.message,
          timestamp: Date.now()
        });
        controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
        controller.close();
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

/**
 * GET /api/ai/raw-materials-agent
 * Health check and metrics endpoint
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    const services = initialize_services();

    switch (action) {
      case 'health':
        return NextResponse.json({
          status: 'healthy',
          services: {
            toolService: !!services.toolService,
            enhancedService: !!services.enhancedService,
            responseReranker: !!services.responseReranker,
            searchService: !!services.searchService,
            mlService: !!services.mlService
          },
          timestamp: new Date().toISOString()
        });

      case 'metrics':
        // Return performance metrics if enhanced service is available
        if (services.enhancedService) {
          const metrics = await services.enhancedService.getPerformanceMetrics();
          return NextResponse.json({
            metrics,
            timestamp: new Date().toISOString()
          });
        } else {
          return NextResponse.json({
            metrics: null,
            message: 'Enhanced service not available'
          });
        }

      default:
        return NextResponse.json({
          message: 'Raw Materials Agent API Enhanced',
          version: '2.0.0',
          endpoints: {
            'POST /': 'Generate response (original/enhanced/streaming)',
            'GET /?action=health': 'Health check',
            'GET /?action=metrics': 'Performance metrics'
          },
          features: [
            'Tool-based AI agent',
            'Enhanced responses with structured data',
            'Streaming responses',
            'Response quality scoring',
            'ML-based preference learning',
            'Hybrid semantic search'
          ]
        });
    }

  } catch (error: any) {
    console.error('❌ [RawMaterialsAgentAPI] GET error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ai/raw-materials-agent
 * Generate AI response with tool calling and enhanced features
 */
export async function POST(request: NextRequest) {
  console.log('📥 [RawMaterialsAgentAPI] Received request');

  try {
    const body = await request.json();
    const {
      prompt,
      userId,
      conversationHistory,
      enableEnhancements = false,
      enableStreaming = false,
      enableMLOptimizations = false,
      enableSearch = false,
      preferences = {}
    } = body;

    if (!prompt || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: prompt, userId' },
        { status: 400 }
      );
    }

    // Initialize services
    const services = initialize_services();

    // Check if streaming is requested
    if (enableStreaming && enhancedService) {
      return handleStreamingResponse(request, services, body);
    }

    // Generate enhanced response if requested
    if (enableEnhancements && enhancedService) {
      return await handleEnhancedResponse(services, body);
    }

    // Fallback to original tool-based response
    console.log('🤖 [RawMaterialsAgentAPI] Generating original response for:', prompt);

    const response = await services.toolService!.generateResponse({
      prompt,
      userId,
      context: {
        conversationHistory: conversationHistory || [],
        category: 'raw-materials'
      }
    });

    console.log('✅ [RawMaterialsAgentAPI] Original response generated successfully');

    return NextResponse.json({
      success: true,
      response: response.response,
      model: response.model,
      id: response.id,
      type: 'original'
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
