/**
 * Enhanced AI Chat API Route
 * Integrates all optimization features: structured outputs, caching, ML learning, streaming
 * Now supports both OpenAI and Gemini APIs
 */

import { NextRequest, NextResponse } from 'next/server';
import { GeminiService } from '@/ai/services/providers/gemini-service';
import { EnhancedHybridSearchService } from '@/ai/services/rag/enhanced-hybrid-search-service';
import { PreferenceLearningService } from '@/ai/services/ml/preference-learning-service';
import { AIRequest } from '@/ai/types/ai-types';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Lazy initialization of services to avoid build-time errors
let geminiService: GeminiService | null = null;
let searchService: EnhancedHybridSearchService | null = null;
let learningService: PreferenceLearningService | null = null;

// Initialize services on startup
let servicesInitialized = false;
async function initializeServices() {
  if (!servicesInitialized) {
    try {
      // Initialize Gemini service (primary)
      const geminiApiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (geminiApiKey) {
        geminiService = new GeminiService(geminiApiKey, {
          model: 'gemini-2.0-flash-exp',
          temperature: 0.7,
          maxTokens: 9000
        }, 'enhanced-chat');
        console.log('✅ [EnhancedChatAPI] Gemini service initialized');
      }

      // Initialize search service
      if (process.env.PINECONE_API_KEY && process.env.MONGODB_URI) {
        searchService = new EnhancedHybridSearchService(
          process.env.PINECONE_API_KEY,
          process.env.MONGODB_URI,
          'rnd_ai',
          'raw_materials_console',
          'raw-materials-stock'
        );
        await searchService.initialize();
        console.log('✅ [EnhancedChatAPI] Search service initialized');
      }

      // Initialize ML learning service
      learningService = new PreferenceLearningService();
      await learningService.initializeModels();
      console.log('✅ [EnhancedChatAPI] ML learning service initialized');

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

    // Handle streaming requests (currently disabled for Gemini, use non-streaming)
    if (stream) {
      console.warn('⚠️ [EnhancedChatAPI] Streaming not yet implemented for Gemini, using non-streaming mode');
      // Fall through to non-streaming handler
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

    // Generate enhanced AI response using Gemini
    if (!geminiService) {
      return NextResponse.json(
        { error: 'Gemini AI service not available - check GEMINI_API_KEY configuration' },
        { status: 503 }
      );
    }

    // Generate response using Gemini
    const startTime = Date.now();
    const geminiResponse = await geminiService.generateResponse(aiRequest);
    const responseTime = Date.now() - startTime;

    // Record interaction for ML learning
    if (learningService) {
      try {
        await learningService.recordInteraction({
          userId,
          prompt,
          response: geminiResponse.response,
          feedback: {
            type: 'pending', // Will be updated when user provides feedback
            score: 0,
            timestamp: new Date(),
          },
          context: {
            category: context?.category || 'general',
            complexity: 'medium',
            expertiseLevel: preferences?.expertiseLevel || 'intermediate',
          },
        });
      } catch (learningError) {
        console.warn('⚠️ [EnhancedChatAPI] Learning service error:', learningError);
      }
    }

    // Return comprehensive response with enhanced features
    const response = {
      success: true,
      data: {
        response: geminiResponse.response,
        confidence: geminiResponse.confidence || 0.8,
        sources: geminiResponse.sources || [],
        metadata: geminiResponse.metadata || {},
        searchResults: searchResults.length > 0 ? searchResults : undefined,
      },
      performance: {
        responseTime,
        cacheHit: false,
        searchPerformed: useSearch,
        searchResultCount: searchResults.length,
      },
      recommendations: {
        followUpQuestions: [],
        relatedTopics: [],
      },
    };

    console.log(`✅ [EnhancedChatAPI] Gemini response generated in ${responseTime}ms`);

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