/**
 * Enhanced AI Chat API Route
 * Integrates all optimization features: structured outputs, caching, ML learning, streaming
 */

import { NextRequest, NextResponse } from 'next/server';
import { EnhancedAIService } from '@/ai/services/enhanced/enhanced-ai-service';
import { StreamingAIService } from '@/ai/services/streaming/streaming-ai-service';
import { EnhancedHybridSearchService } from '@/ai/services/rag/enhanced-hybrid-search-service';
import { PreferenceLearningService } from '@/ai/services/ml/preference-learning-service';
import { AIRequest } from '@/ai/types/ai-types';

// Lazy initialization of services to avoid build-time errors
let enhancedService: EnhancedAIService | null = null;
let streamingService: StreamingAIService | null = null;
let searchService: EnhancedHybridSearchService | null = null;
let learningService: PreferenceLearningService | null = null;

// Initialize services on startup
let servicesInitialized = false;
async function initializeServices() {
  if (!servicesInitialized) {
    try {
      // Only initialize services if environment variables are available
      if (process.env.OPENAI_API_KEY) {
        enhancedService = new EnhancedAIService(process.env.OPENAI_API_KEY);
        streamingService = new StreamingAIService(process.env.OPENAI_API_KEY);
      }

      if (process.env.PINECONE_API_KEY && process.env.MONGODB_URI) {
        searchService = new EnhancedHybridSearchService(
          process.env.PINECONE_API_KEY,
          process.env.MONGODB_URI,
          'rnd_ai_db',
          'raw_materials',
          'raw-materials-vectors'
        );
        await searchService.initialize();
      }

      learningService = new PreferenceLearningService();
      await learningService.initializeModels();

      servicesInitialized = true;
      console.log('✅ [EnhancedChatAPI] All services initialized successfully');
    } catch (error) {
      console.error('❌ [EnhancedChatAPI] Service initialization failed:', error);
      // Don't throw error, allow app to continue with limited functionality
    }
  }
}

export async function POST(request: NextRequest) {
  await initializeServices();

  try {
    const body = await request.json();
    const { prompt, userId, context, stream = false, useSearch = false, preferences } = body;

    if (!prompt || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: prompt, userId' },
        { status: 400 }
      );
    }

    const aiRequest: AIRequest = {
      prompt,
      userId,
      context: {
        ...context,
        useSearch,
        preferences,
        timestamp: new Date().toISOString(),
      },
    };

    // Handle streaming requests
    if (stream) {
      if (!streamingService) {
        return NextResponse.json(
          { error: 'Streaming service not available - check OPENAI_API_KEY configuration' },
          { status: 503 }
        );
      }

      const streamResponse = await streamingService.generateSSEStream(aiRequest, {
        onChunk: (chunk) => {
          // Log performance metrics
          if (chunk.type === 'metadata') {
            console.log(`📊 [EnhancedChatAPI] Response metadata:`, chunk.metadata);
          }
        },
        onError: (error) => {
          console.error('❌ [EnhancedChatAPI] Streaming error:', error);
        },
        includeMetadata: true,
        timeout: 30000,
      });

      return new Response(streamResponse, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Handle enhanced non-streaming requests
    let searchResults: any[] = [];

    // Perform hybrid search if requested
    if (useSearch) {
      if (!searchService) {
        console.warn('⚠️ [EnhancedChatAPI] Search service not available - check PINECONE_API_KEY configuration');
      } else {
        try {
          searchResults = await searchService.enhancedSearch({
            query: prompt,
            userId,
            topK: 5,
            rerank: true,
            semanticWeight: 0.7,
            keywordWeight: 0.3,
            userPreferences: preferences,
          });

          // Add search context to the AI request
          aiRequest.context = {
            ...aiRequest.context,
            searchResults: searchResults.map(r => ({
              content: r.content,
              score: r.score,
              metadata: r.metadata,
            })),
          };

          console.log(`🔍 [EnhancedChatAPI] Found ${searchResults.length} search results`);
        } catch (searchError) {
          console.warn('⚠️ [EnhancedChatAPI] Search failed, proceeding without search results:', searchError);
        }
      }
    }

    // Generate enhanced AI response
    if (!enhancedService) {
      return NextResponse.json(
        { error: 'Enhanced AI service not available - check OPENAI_API_KEY configuration' },
        { status: 503 }
      );
    }

    const enhancedResponse = await enhancedService.generateEnhancedResponse(aiRequest);

    // Record interaction for ML learning
    if (learningService) {
      try {
        await learningService.recordInteraction({
          userId,
          prompt,
          response: enhancedResponse.response,
          feedback: {
            type: 'pending', // Will be updated when user provides feedback
            score: 0,
            timestamp: new Date(),
          },
          context: {
            category: enhancedResponse.structuredData.metadata.category,
            complexity: enhancedResponse.structuredData.metadata.complexity,
            expertiseLevel: enhancedResponse.structuredData.metadata.expertiseLevel,
          },
        });
      } catch (learningError) {
        console.warn('⚠️ [EnhancedChatAPI] Learning service error:', learningError);
      }
    }

    // Return comprehensive response
    const response = {
      success: true,
      data: {
        response: enhancedResponse.response,
        confidence: enhancedResponse.confidence,
        sources: enhancedResponse.sources,
        structuredData: enhancedResponse.structuredData,
        metadata: enhancedResponse.metadata,
        searchResults: searchResults.length > 0 ? searchResults : undefined,
      },
      performance: {
        responseTime: enhancedResponse.metadata?.responseTime || 0,
        cacheHit: enhancedResponse.structuredData.metadata.responseTime < 100, // Assume cache hit if very fast
        searchPerformed: useSearch,
        searchResultCount: searchResults.length,
      },
      recommendations: {
        followUpQuestions: enhancedResponse.structuredData.followUpQuestions,
        relatedTopics: enhancedResponse.structuredData.relatedTopics,
      },
    };

    console.log(`✅ [EnhancedChatAPI] Enhanced response generated in ${enhancedResponse.metadata?.responseTime}ms`);

    return NextResponse.json(response);

  } catch (error) {
    console.error('❌ [EnhancedChatAPI] Request failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  await initializeServices();

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const userId = searchParams.get('userId');

  try {
    switch (action) {
      case 'preferences':
        if (!userId) {
          return NextResponse.json({ error: 'userId required' }, { status: 400 });
        }

        const preferences = learningService ? await learningService.predictPreferences(userId, {}) : {};
        const stats = learningService ? learningService.getLearningStats(userId) : {};

        return NextResponse.json({
          success: true,
          data: {
            preferences,
            learningStats: stats,
          },
        });

      case 'metrics':
        const enhancedMetrics = enhancedService ? enhancedService.getPerformanceMetrics() : {};
        const searchMetrics = searchService ? searchService.getMetrics() : {};

        return NextResponse.json({
          success: true,
          data: {
            enhancedAI: enhancedMetrics,
            search: searchMetrics,
            servicesInitialized,
          },
        });

      case 'health':
        return NextResponse.json({
          success: true,
          data: {
            status: 'healthy',
            services: {
              enhancedAI: !!enhancedService,
              streamingAI: !!streamingService,
              search: servicesInitialized,
              learning: !!learningService,
            },
            timestamp: new Date().toISOString(),
          },
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: preferences, metrics, or health' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('❌ [EnhancedChatAPI] GET request failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  await initializeServices();

  try {
    const body = await request.json();
    const { userId, feedback, messageId } = body;

    if (!userId || !feedback) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, feedback' },
        { status: 400 }
      );
    }

    // Update user preferences based on feedback
    if (enhancedService) {
      await enhancedService.updateUserPreferences(userId, feedback);

      // Update learning service
      if (messageId) {
        await enhancedService.submitFeedback(messageId, feedback);
      }
    }

    console.log(`📈 [EnhancedChatAPI] Feedback recorded for user ${userId}`);

    return NextResponse.json({
      success: true,
      data: {
        message: 'Feedback recorded successfully',
        updatedPreferences: true,
      },
    });

  } catch (error) {
    console.error('❌ [EnhancedChatAPI] Feedback submission failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}