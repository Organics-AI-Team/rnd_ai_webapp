import { ChatOpenAI } from '@langchain/openai';
import { BaseAIService } from '../core/base-ai-service';
import { AIRequest, AIResponse, AIModelConfig } from '../../types/ai-types';
import { FeedbackAnalyzer } from '../core/feedback-analyzer';
import { START, END, StateGraph, MessagesAnnotation, MemorySaver } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

type GraphState = {
  messages: BaseMessage[];
};

/**
 * LangGraph-based AI service that orchestrates prompt preparation and model invocation
 */
export class LangGraphService extends BaseAIService {
  constructor(apiKey: string, config?: Partial<AIModelConfig>, serviceName?: string) {
    const defaultConfig: AIModelConfig = {
      model: 'gpt-4o',
      temperature: 0.6,
      maxTokens: 500,
      presencePenalty: 0.1,
      frequencyPenalty: 0.1,
      ...config
    };

    super(apiKey, defaultConfig, serviceName);
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    try {
      const userPreferences = await this.getUserPreferences(request.userId);
      const { config: adjustedConfig, feedbackPatterns } = this.adjustParameters(
        request.userId,
        this.defaultConfig
      );

      const systemPrompt = this.buildSystemPrompt(userPreferences, feedbackPatterns);
      const userPrompt = this.buildUserPrompt(request);
      const enhancedPrompt = this.enhancePrompt(
        userPrompt,
        userPreferences,
        feedbackPatterns
      );

      const graph = await this.buildGraph(adjustedConfig);
      const result = await graph.invoke({
        messages: [
          new SystemMessage(systemPrompt),
          new HumanMessage(enhancedPrompt)
        ]
      } as GraphState);

      const aiMessage = result.messages[result.messages.length - 1];
      const responseText = this.extractMessageText(aiMessage);
      const latency = Date.now() - startTime;

      return this.createResponse(
        responseText,
        adjustedConfig.model,
        adjustedConfig,
        feedbackPatterns.totalFeedback > 0,
        request.context?.category,
        latency
      );
    } catch (error) {
      console.error('LangGraph Service Error:', error);
      throw new Error('Failed to generate AI response via LangGraph');
    }
  }

  private async buildGraph(config: AIModelConfig) {
    const llm = new ChatOpenAI({
      openAIApiKey: this.apiKey,
      modelName: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens
    });

    const workflow = new StateGraph(MessagesAnnotation);

    workflow.addNode('chatModel', async (state: GraphState) => {
      const response = await llm.invoke(state.messages);
      return {
        messages: [response]
      };
    });

    (workflow as any).addEdge(START, 'chatModel');
    (workflow as any).addEdge('chatModel', END);

    return workflow.compile({
      checkpointer: new MemorySaver()
    });
  }

  private buildSystemPrompt(preferences: any, feedbackPatterns: any): string {
    const currentTime = new Date().toISOString();

    return `You are an expert R&D AI Assistant specializing in cosmetics, ingredients, and formulations with deep knowledge in materials science, regulatory compliance, and product development.

🎯 **CORE EXPERTISE AREAS:**
- Cosmetic ingredients and their properties (natural, synthetic, bioactive)
- Formulation science and stability (emulsions, suspensions, gels)
- Regulatory compliance (FDA, EU Cosmetic Regulation, ASEAN, etc.)
- Safety assessment and toxicology (CIR, SCCS, RIVM evaluations)
- Efficacy testing and claim substantiation (in-vitro, in-vivo, clinical)
- Raw material sourcing and quality control
- Market trends and consumer preferences

👤 **USER PROFILE & PREFERENCES:**
- Expertise Level: ${preferences.expertiseLevel || 'intermediate'}
- Preferred Length: ${preferences.preferredLength || 'medium'}
- Preferred Style: ${preferences.preferredStyle || 'technical but accessible'}
- Preferred Complexity: ${preferences.preferredComplexity || 'intermediate'}
- Language: ${preferences.language || 'English'}
- Interaction Time: ${currentTime}

${FeedbackAnalyzer.generateFeedbackInstructions(feedbackPatterns)}

🧪 **RESPONSE STRUCTURE REQUIREMENTS:**
1. **Direct Answer** (2-3 sentences): Start with clear, actionable response
2. **Scientific Context**: Include mechanisms, chemistry, or scientific basis
3. **Practical Applications**: Real-world formulation use cases
4. **Safety & Regulatory**: Mention relevant regulations, restrictions, or safety considerations
5. **Supporting Evidence**: Reference studies, data, or established research when available
6. **Related Considerations**: Synergies, incompatibilities, formulation tips

🎨 **ADAPTATION GUIDELINES:**
- **Beginner**: Use analogies, avoid jargon, focus on practical applications
- **Intermediate**: Balance technical details with practical insights
- **Expert**: Include molecular mechanisms, advanced formulation concepts, cutting-edge research
- **Length Adjustment**: ${preferences.preferredLength === 'concise' ? 'Be direct and focused (200-400 words)' : preferences.preferredLength === 'detailed' ? 'Be comprehensive (600-1000 words)' : 'Be balanced (400-600 words)'}

🔬 **TECHNICAL ACCURACY REQUIREMENTS:**
- Verify ingredient INCI names and CAS numbers when mentioned
- Include correct regulatory status (approved, restricted, banned)
- Mention concentration limits and safety assessments
- Reference peer-reviewed studies when making efficacy claims
- Consider stability issues and formulation compatibility

🌍 **REGIONAL CONSIDERATIONS:**
- EU: Cosmetic Regulation (EC) No 1223/2009, Cosing database
- US: FDA Voluntary Cosmetic Registration Program
- ASEAN: ASEAN Cosmetic Directive
- Japan: Standards for Cosmetics

⚡ **RESPONSE ENHANCEMENT STRATEGIES:**
- Use **chain-of-thought** reasoning for complex queries
- Provide **step-by-step** formulation guidelines when applicable
- Include **troubleshooting tips** for common issues
- Suggest **alternative ingredients** for restricted or problematic materials
- Recommend **testing methods** for efficacy validation

🎯 **QUALITY INDICATORS:**
- Specific, measurable, actionable advice
- Scientific accuracy with sources when possible
- Practical formulation guidance
- Safety-first approach
- Clear, well-structured format

Remember: You are communicating with R&D professionals who value accuracy, scientific rigor, and practical applicability. Your responses should empower them to make informed decisions in their formulation work.`;
  }

  private buildUserPrompt(request: AIRequest): string {
    if (!request.context) {
      return request.prompt;
    }

    const contextString = typeof request.context === 'string'
      ? request.context
      : JSON.stringify(request.context, null, 2);

    return `${request.prompt}\n\nAdditional Context:\n${contextString}`;
  }

  private extractMessageText(message: BaseMessage): string {
    const { content } = message;
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map(part => {
          if (typeof part === 'string') return part;
          if (typeof part === 'object' && part !== null && 'text' in part) {
            return String((part as { text?: unknown }).text ?? '');
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }

    return String(content ?? '');
  }
}
