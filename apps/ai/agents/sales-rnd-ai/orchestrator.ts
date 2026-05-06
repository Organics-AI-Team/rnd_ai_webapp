/**
 * Sales RND AI Orchestrator
 * Handles delegation between main agent, sub-agents, and tools
 */

import { generateFollowUp, followUpGeneratorTool, FollowUpInputs } from './tools/follow-up-generator';
import { draftSlide, slideDrafterTool, SlideInputs } from './tools/slide-drafter';

/**
 * Orchestrator for Sales RND AI
 * Analyzes user requests and delegates to appropriate sub-agents or tools
 */
export class SalesAgentOrchestrator {
  /**
   * Analyze user request and determine delegation strategy
   */
  async processRequest(userMessage: string, context?: any): Promise<OrchestratorResponse> {
    console.log('🎯 [Orchestrator] Processing user request', { message: userMessage.substring(0, 100) });

    const intent = this.detectIntent(userMessage);
    console.log('🔍 [Orchestrator] Detected intent:', intent);

    switch (intent.type) {
      case 'pitch_deck':
        return await this.delegateToPitchDeckCreator(userMessage, intent.params);

      case 'follow_up_email':
        return await this.delegateToFollowUpTool(intent.params);

      case 'single_slide':
        return await this.delegateToSlideDrafter(intent.params);

      case 'formula_creation':
        return this.delegateToMainAgent(userMessage, 'formula');

      case 'swot_analysis':
      case 'competitor_analysis':
      case 'product_analysis':
      case 'brand_analysis':
      case 'ingredient_analysis':
        return await this.delegateToMarketIntelligence(userMessage, intent.type, intent.params);

      case 'general_query':
      default:
        return this.delegateToMainAgent(userMessage, 'general');
    }
  }

  /**
   * Detect user intent from message
   */
  private detectIntent(message: string): DetectedIntent {
    const lowerMessage = message.toLowerCase();

    // Pitch deck keywords
    const pitchDeckKeywords = [
      'pitch deck', 'presentation', 'slides', 'deck',
      'create a pitch', 'make a presentation', 'full deck'
    ];
    if (pitchDeckKeywords.some(kw => lowerMessage.includes(kw))) {
      return {
        type: 'pitch_deck',
        params: this.extractPitchDeckParams(message)
      };
    }

    // Follow-up email keywords
    const followUpKeywords = [
      'follow up', 'follow-up', 'email after meeting',
      'write email', 'send email', 'meeting recap'
    ];
    if (followUpKeywords.some(kw => lowerMessage.includes(kw))) {
      return {
        type: 'follow_up_email',
        params: this.extractFollowUpParams(message)
      };
    }

    // Single slide keywords
    const slideKeywords = [
      'draft a slide', 'create slide', 'single slide',
      'make a slide', 'slide about', 'slide for'
    ];
    if (slideKeywords.some(kw => lowerMessage.includes(kw))) {
      return {
        type: 'single_slide',
        params: this.extractSlideParams(message)
      };
    }

    // Analysis keywords (Market Intelligence)

    // SWOT Analysis
    const swotKeywords = [
      'swot', 'swot analysis', 'strengths weaknesses', 'strengths and weaknesses',
      'opportunities threats', 'strategic analysis'
    ];
    if (swotKeywords.some(kw => lowerMessage.includes(kw))) {
      return {
        type: 'swot_analysis',
        params: this.extractAnalysisParams(message, 'swot')
      };
    }

    // Competitor Analysis
    const competitorKeywords = [
      'competitor analysis', 'competitive analysis', 'analyze competitor',
      'compare with competitor', 'benchmark against', 'vs competitor',
      'competition analysis', 'as a competitor', 'as competitor'
    ];
    if (competitorKeywords.some(kw => lowerMessage.includes(kw))) {
      return {
        type: 'competitor_analysis',
        params: this.extractAnalysisParams(message, 'competitor')
      };
    }

    // Product Analysis
    const productAnalysisKeywords = [
      'product analysis', 'analyze product', 'market fit',
      'product assessment', 'evaluate product', 'product viability'
    ];
    if (productAnalysisKeywords.some(kw => lowerMessage.includes(kw))) {
      return {
        type: 'product_analysis',
        params: this.extractAnalysisParams(message, 'product')
      };
    }

    // Brand Analysis
    const brandKeywords = [
      'brand analysis', 'analyze brand', 'brand positioning',
      'brand strategy', 'brand assessment', 'evaluate brand'
    ];
    if (brandKeywords.some(kw => lowerMessage.includes(kw))) {
      return {
        type: 'brand_analysis',
        params: this.extractAnalysisParams(message, 'brand')
      };
    }

    // Ingredient Analysis
    const ingredientKeywords = [
      'ingredient analysis', 'analyze ingredient', 'compare ingredients',
      'ingredient comparison', 'vs ingredient', 'ingredient assessment'
    ];
    if (ingredientKeywords.some(kw => lowerMessage.includes(kw))) {
      return {
        type: 'ingredient_analysis',
        params: this.extractAnalysisParams(message, 'ingredient')
      };
    }

    // Formula creation keywords
    const formulaKeywords = [
      'create formula', 'formulate', 'formulation',
      'product concept', 'develop product'
    ];
    if (formulaKeywords.some(kw => lowerMessage.includes(kw))) {
      return {
        type: 'formula_creation',
        params: {}
      };
    }

    return {
      type: 'general_query',
      params: {}
    };
  }

  /**
   * Extract parameters for pitch deck creation
   */
  private extractPitchDeckParams(message: string): any {
    // Extract product name, target audience, etc.
    const params: any = {};

    // Product type extraction
    const productTypes = ['serum', 'cream', 'cleanser', 'toner', 'mask', 'sunscreen', 'lotion'];
    for (const type of productTypes) {
      if (message.toLowerCase().includes(type)) {
        params.productCategory = type;
        break;
      }
    }

    // Audience extraction
    const audiences = ['sephora', 'ulta', 'retailer', 'oem', 'odm', 'brand', 'distributor'];
    for (const audience of audiences) {
      if (message.toLowerCase().includes(audience)) {
        params.targetAudience = audience;
        break;
      }
    }

    // Benefit extraction
    const benefits = ['anti-aging', 'brightening', 'acne', 'hydrating', 'anti-pollution'];
    for (const benefit of benefits) {
      if (message.toLowerCase().includes(benefit)) {
        params.keyBenefit = benefit;
        break;
      }
    }

    return params;
  }

  /**
   * Extract parameters for follow-up email
   */
  private extractFollowUpParams(message: string): any {
    const params: any = {};

    // Try to extract client name (simple heuristic)
    const withMatch = message.match(/with\s+([A-Z][a-zA-Z\s]+?)(?:\s+about|\s+regarding|$)/);
    if (withMatch) {
      params.client_name = withMatch[1].trim();
    }

    // Detect urgency
    if (message.toLowerCase().includes('urgent') || message.toLowerCase().includes('asap')) {
      params.urgency = 'high';
    } else if (message.toLowerCase().includes('important')) {
      params.urgency = 'medium';
    }

    return params;
  }

  /**
   * Extract parameters for slide content
   */
  private extractSlideParams(message: string): any {
    const params: any = {};

    // Detect slide type
    const slideTypes = ['title', 'problem', 'solution', 'science', 'benefits', 'pricing', 'cta'];
    for (const type of slideTypes) {
      if (message.toLowerCase().includes(type)) {
        params.slide_type = type;
        break;
      }
    }

    // Extract topic (anything after "about" or "for")
    const topicMatch = message.match(/(?:about|for)\s+(.+?)(?:\s+with|\s+that|$)/i);
    if (topicMatch) {
      params.topic = topicMatch[1].trim();
    }

    return params;
  }

  /**
   * Extract parameters for analysis requests
   * @param message - User's original message
   * @param analysisType - Type of analysis (swot, competitor, product, brand, ingredient)
   */
  private extractAnalysisParams(message: string, analysisType: string): any {
    console.log('📋 [Orchestrator] Extracting analysis parameters', { analysisType, message: message.substring(0, 100) });

    const params: any = {
      analysisType,
      originalMessage: message
    };

    // Extract subject (what to analyze)
    // Pattern: "analyze [subject]", "[subject] analysis", "swot for [subject]"
    const subjectPatterns = [
      /analyze\s+(?:the\s+)?(.+?)(?:\s+as|\s+vs|\s+and|\s+in|\s+at|\s+for|\s+-|$)/i,
      /(?:analysis|swot|compare|evaluate)\s+(?:of|for|on)\s+(?:the\s+)?(.+?)(?:\s+as|\s+vs|\s+and|\s+in|\s+at|\s+-|$)/i,
      /(.+?)\s+(?:analysis|swot|comparison|assessment)/i
    ];

    for (const pattern of subjectPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        params.subject = match[1].trim();
        break;
      }
    }

    // Extract depth/scope indicators
    if (message.toLowerCase().includes('quick') || message.toLowerCase().includes('brief')) {
      params.depth = 'quick';
    } else if (message.toLowerCase().includes('comprehensive') || message.toLowerCase().includes('detailed') || message.toLowerCase().includes('deep-dive')) {
      params.depth = 'comprehensive';
    } else {
      params.depth = 'standard';
    }

    // Extract specific focus areas
    const focusKeywords = {
      pricing: ['price', 'pricing', 'cost', 'value'],
      efficacy: ['efficacy', 'effectiveness', 'performance', 'clinical'],
      positioning: ['positioning', 'market position', 'competitive position'],
      formulation: ['formulation', 'formula', 'ingredients', 'composition'],
      regulatory: ['regulatory', 'compliance', 'regulations', 'restrictions']
    };

    params.focusAreas = [];
    for (const [area, keywords] of Object.entries(focusKeywords)) {
      if (keywords.some(kw => message.toLowerCase().includes(kw))) {
        params.focusAreas.push(area);
      }
    }

    // Extract competitor/comparison subject (for "X vs Y" patterns)
    const vsMatch = message.match(/(.+?)\s+vs\.?\s+(.+?)(?:\s+analysis|\s+comparison|$)/i);
    if (vsMatch) {
      params.subject = vsMatch[1].trim();
      params.comparisonSubject = vsMatch[2].trim();
    }

    // Extract target market/audience context
    const marketKeywords = ['sephora', 'ulta', 'mass market', 'premium', 'luxury', 'drugstore', 'prestige'];
    for (const market of marketKeywords) {
      if (message.toLowerCase().includes(market)) {
        params.targetMarket = market;
        break;
      }
    }

    console.log('✅ [Orchestrator] Extracted analysis parameters:', params);
    return params;
  }

  /**
   * Delegate to Pitch Deck Creator sub-agent
   */
  private async delegateToPitchDeckCreator(message: string, params: any): Promise<OrchestratorResponse> {
    console.log('🎨 [Orchestrator] Delegating to Pitch Deck Creator sub-agent');

    return {
      delegatedTo: 'pitch_deck_creator_subagent',
      action: 'create_pitch_deck',
      params,
      instructions: `Create a complete pitch deck with the following requirements:
        - Product Category: ${params.productCategory || 'not specified'}
        - Target Audience: ${params.targetAudience || 'mixed'}
        - Key Benefit: ${params.keyBenefit || 'not specified'}

        User's full request: ${message}

        Please create a full 12-slide pitch deck following the standard structure.`,
      requiresSubAgent: true,
      subAgentConfig: 'pitch-deck-creator'
    };
  }

  /**
   * Delegate to Market Intelligence sub-agent
   * @param message - User's original message
   * @param analysisType - Type of analysis (swot_analysis, competitor_analysis, etc.)
   * @param params - Extracted parameters
   */
  private async delegateToMarketIntelligence(
    message: string,
    analysisType: string,
    params: any
  ): Promise<OrchestratorResponse> {
    console.log('📊 [Orchestrator] Delegating to Market Intelligence sub-agent', { analysisType });

    // Map analysis type to readable action
    const actionMap: { [key: string]: string } = {
      'swot_analysis': 'SWOT Analysis',
      'competitor_analysis': 'Competitor Analysis',
      'product_analysis': 'Product Analysis',
      'brand_analysis': 'Brand Analysis',
      'ingredient_analysis': 'Ingredient Analysis'
    };

    const analysisName = actionMap[analysisType] || 'Market Analysis';

    // Build structured instructions for the sub-agent
    const instructions = `Perform a ${analysisName} with the following context:

**Analysis Type**: ${analysisName}
**Subject**: ${params.subject || 'Not specified - please extract from user message'}
**Depth**: ${params.depth || 'standard'} (quick/standard/comprehensive)
${params.comparisonSubject ? `**Comparison With**: ${params.comparisonSubject}` : ''}
${params.focusAreas && params.focusAreas.length > 0 ? `**Focus Areas**: ${params.focusAreas.join(', ')}` : ''}
${params.targetMarket ? `**Target Market**: ${params.targetMarket}` : ''}

**User's Full Request**: ${message}

**Instructions**:
1. Use RAG database queries to gather ingredient, formulation, and pricing data
2. Apply the appropriate analysis framework (${analysisName})
3. Provide structured output with:
   - Executive Summary
   - Detailed Analysis
   - Data Sources and Confidence Levels
   - Strategic Recommendations
   - Risk Assessment and Limitations
4. Be transparent about data availability and confidence levels
5. Cite all sources and indicate when using estimates vs. verified data

Please proceed with the ${analysisName}.`;

    return {
      delegatedTo: 'market_intelligence_subagent',
      action: analysisType,
      params,
      instructions,
      requiresSubAgent: true,
      subAgentConfig: 'market-intelligence'
    };
  }

  /**
   * Delegate to Follow-up Generator tool
   */
  private async delegateToFollowUpTool(params: any): Promise<OrchestratorResponse> {
    console.log('📧 [Orchestrator] Delegating to Follow-up Generator tool');

    // If we have enough params, generate immediately
    if (params.client_name) {
      const followUpInput: FollowUpInputs = {
        meeting_summary: params.meeting_summary || 'Discussed product collaboration opportunities',
        client_name: params.client_name,
        key_discussion_points: params.key_discussion_points || ['Product requirements', 'Timeline', 'Pricing'],
        next_steps: params.next_steps || ['Send proposal', 'Schedule follow-up call'],
        tone: params.tone || 'professional',
        urgency: params.urgency || 'medium'
      };

      const result = await generateFollowUp(followUpInput);

      return {
        delegatedTo: 'follow_up_generator_tool',
        action: 'generate_email',
        params,
        result,
        requiresSubAgent: false
      };
    }

    // Otherwise, request more information
    return {
      delegatedTo: 'follow_up_generator_tool',
      action: 'request_info',
      params,
      instructions: `I need more information to create the follow-up email:
        - Who was the meeting with? (client name)
        - What was discussed? (key discussion points)
        - What are the next steps?`,
      requiresSubAgent: false
    };
  }

  /**
   * Delegate to Slide Drafter tool
   */
  private async delegateToSlideDrafter(params: any): Promise<OrchestratorResponse> {
    console.log('📄 [Orchestrator] Delegating to Slide Drafter tool');

    // If we have enough params, generate immediately
    if (params.slide_type && params.topic) {
      const slideInput: SlideInputs = {
        slide_type: params.slide_type,
        topic: params.topic,
        key_points: params.key_points || ['Key point 1', 'Key point 2', 'Key point 3'],
        target_audience: params.target_audience || 'mixed'
      };

      const result = await draftSlide(slideInput);

      return {
        delegatedTo: 'slide_drafter_tool',
        action: 'draft_slide',
        params,
        result,
        requiresSubAgent: false
      };
    }

    // Request more information
    return {
      delegatedTo: 'slide_drafter_tool',
      action: 'request_info',
      params,
      instructions: `I need more information to draft the slide:
        - What type of slide? (title, problem, solution, benefits, etc.)
        - What's the topic/subject?
        - What key points should be included?`,
      requiresSubAgent: false
    };
  }

  /**
   * Delegate back to main agent (for formula creation or general queries)
   */
  private delegateToMainAgent(message: string, type: 'formula' | 'general'): OrchestratorResponse {
    console.log('🤖 [Orchestrator] Delegating to main Sales RND AI agent');

    return {
      delegatedTo: 'main_agent',
      action: type === 'formula' ? 'create_formula' : 'answer_query',
      params: { originalMessage: message },
      instructions: message,
      requiresSubAgent: false
    };
  }

  /**
   * Get available tools schema for agent
   */
  getToolsSchema(): any[] {
    return [
      followUpGeneratorTool,
      slideDrafterTool
    ];
  }
}

/**
 * Response from orchestrator
 */
export interface OrchestratorResponse {
  delegatedTo: string;
  action: string;
  params: any;
  instructions?: string;
  result?: any;
  requiresSubAgent: boolean;
  subAgentConfig?: string;
}

/**
 * Detected user intent
 */
interface DetectedIntent {
  type: 'pitch_deck' | 'follow_up_email' | 'single_slide' | 'formula_creation' |
        'swot_analysis' | 'competitor_analysis' | 'product_analysis' | 'brand_analysis' | 'ingredient_analysis' |
        'general_query';
  params: any;
}

/**
 * Export singleton instance
 */
export const salesOrchestrator = new SalesAgentOrchestrator();
