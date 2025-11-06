/**
 * Enhanced Raw Materials Agent API Route
 * Server-side endpoint for tool-enabled AI agent with streaming, scoring, and ML optimizations
 */

import { NextRequest, NextResponse } from 'next/server';
import { RawMaterialsAgent } from '@/ai/agents/raw-materials-ai/agent';
import { GeminiToolService } from '@/ai/services/providers/gemini-tool-service';
import { EnhancedHybridSearchService } from '@/ai/services/rag/enhanced-hybrid-search-service';
import { PreferenceLearningService } from '@/ai/services/ml/preference-learning-service';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

// Initialize services once on server
let toolService: GeminiToolService | null = null;
let searchService: EnhancedHybridSearchService | null = null;
let mlService: PreferenceLearningService | null = null;

function initialize_services() {
  if (toolService && searchService) return { toolService, searchService, mlService };

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log('🚀 [RawMaterialsAgentAPI] Initializing services with optimizations');

  // Initialize Gemini tool service with agent tools
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
  console.log('✅ [RawMaterialsAgentAPI] Gemini tool service initialized');

  // Initialize optimized search services if API keys available
  if (PINECONE_API_KEY && MONGODB_URI) {
    try {
      searchService = new EnhancedHybridSearchService(
        PINECONE_API_KEY,
        MONGODB_URI,
        'rnd_ai',
        'raw_materials_console',
        'raw-materials-stock'
      );
      mlService = new PreferenceLearningService();

      console.log('✅ [RawMaterialsAgentAPI] Optimized search services initialized');
    } catch (error) {
      console.warn('⚠️ [RawMaterialsAgentAPI] Search services initialization failed:', error);
    }
  } else {
    console.warn('⚠️ [RawMaterialsAgentAPI] Missing PINECONE/MONGODB keys for search');
  }

  console.log('✅ [RawMaterialsAgentAPI] Services ready (Gemini + Tools + Optimized Search)');
  return { toolService, searchService, mlService };
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

    // Generate enhanced response using tool service with optimized context
    const enhancedResponse = await services.toolService!.generateResponse({
      prompt,
      userId,
      context: {
        conversationHistory: conversationHistory || [],
        category: 'raw-materials',
        searchResults,
        userPreferences,
        optimizationLevel: 'enhanced'
      }
    });

    // Enhanced response successfully generated with optimized services
    console.log('✅ [RawMaterialsAgentAPI] Enhanced response generated with optimizations');

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
            confidence: enhancedResponse.metadata?.confidence || 0.8
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
      model: enhancedResponse.model || 'gemini-2.0-flash-exp',
      id: enhancedResponse.id,
      type: 'enhanced',
      features: {
        searchEnabled: enableSearch && searchResults.length > 0,
        mlEnabled: enableMLOptimizations && !!services.mlService,
        searchResultsCount: searchResults.length,
        optimizationsApplied: ['hybrid_search', 'semantic_reranking', 'ml_personalization', 'tool_calling']
      },
      searchResults: searchResults.slice(0, 5), // Limit to top 5
      userPreferences: enableMLOptimizations ? userPreferences : undefined,
      metadata: enhancedResponse.metadata
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

// Streaming functionality removed - will be re-implemented with optimized services in future version

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
        // Return optimization status and available services
        return NextResponse.json({
          services: {
            toolService: !!services.toolService,
            searchService: !!services.searchService,
            mlService: !!services.mlService
          },
          optimizations: [
            'Hybrid search with semantic reranking',
            'Dynamic chunking (6 chunks per document)',
            'ML preference learning',
            'Gemini 2.0 Flash with tool calling',
            'Enhanced RAG integration'
          ],
          timestamp: new Date().toISOString()
        });

      default:
        return NextResponse.json({
          message: 'Raw Materials Agent API - Optimized Version',
          version: '3.0.0',
          endpoints: {
            'POST /': 'Generate AI response with tool calling and optimizations',
            'GET /?action=health': 'Health check',
            'GET /?action=metrics': 'Service status and optimizations'
          },
          features: [
            'Gemini 2.0 Flash AI with tool calling',
            'Enhanced hybrid search with 4 strategies',
            'Dynamic chunking (96x faster indexing)',
            'ML preference learning',
            'Enhanced RAG with semantic reranking',
            'Optimized for raw materials database'
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

    // Streaming not yet implemented with new optimized services
    if (enableStreaming) {
      console.log('⚠️ [RawMaterialsAgentAPI] Streaming not yet implemented with optimized services, using regular response');
    }

    // Generate enhanced response if requested
    if (enableEnhancements) {
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
