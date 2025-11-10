/**
 * LangGraph-powered Raw Materials AI Agent
 * Implements state-based workflow with conditional routing and tool orchestration
 */

import { StateGraph, END, START } from '@langchain/langgraph';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { separatedSearchTools } from './tools/separated-search-tools';

// Define the state schema for our agent workflow
export const RawMaterialsStateSchema = z.object({
  messages: z.array(z.any()),
  query: z.string().optional(),
  queryType: z.enum(['search', 'stock_check', 'profile', 'usecase_search', 'general']).optional(),
  searchResults: z.array(z.any()).optional(),
  stockResults: z.array(z.any()).optional(),
  profileResults: z.array(z.any()).optional(),
  usecaseResults: z.array(z.any()).optional(),
  needsTools: z.boolean().optional(),
  toolCalls: z.array(z.any()).optional(),
  response: z.string().optional(),
  confidence: z.number().optional(),
  error: z.string().optional()
});

export type RawMaterialsState = z.infer<typeof RawMaterialsStateSchema>;

/**
 * Initialize LangGraph-powered Raw Materials Agent
 */
export class LangGraphRawMaterialsAgent {
  private llm: ChatGoogleGenerativeAI;
  private graph: StateGraph<RawMaterialsState>;
  private tools: Record<string, any>;

  constructor(geminiApiKey: string) {
    // Initialize the LLM
    this.llm = new ChatGoogleGenerativeAI({
      model: 'gemini-2.0-flash-exp',
      apiKey: geminiApiKey,
      temperature: 0.7,
      maxOutputTokens: 4000
    });

    // Initialize tools
    this.tools = {
      search_fda_database: separatedSearchTools.search_fda_database,
      check_stock_availability: separatedSearchTools.check_stock_availability,
      get_material_profile: separatedSearchTools.get_material_profile,
      search_materials_by_usecase: separatedSearchTools.search_materials_by_usecase
    };

    // Build the state graph
    this.graph = this.buildGraph();
  }

  /**
   * Build the LangGraph state machine
   */
  private buildGraph(): StateGraph<RawMaterialsState> {
    const workflow = new StateGraph({
      channels: RawMaterialsStateSchema
    });

    // Add nodes
    workflow.addNode('classify_query', this.classifyQuery.bind(this));
    workflow.addNode('search_database', this.searchDatabase.bind(this));
    workflow.addNode('check_stock', this.checkStock.bind(this));
    workflow.addNode('get_profile', this.getProfile.bind(this));
    workflow.addNode('search_usecase', this.searchUsecase.bind(this));
    workflow.addNode('synthesize_results', this.synthesizeResults.bind(this));
    workflow.addNode('generate_response', this.generateResponse.bind(this));
    workflow.addNode('handle_error', this.handleError.bind(this));

    // Set entry point - connect START to classify_query
    workflow.setEntryPoint('classify_query');

    // Add conditional edges for routing directly from classify_query
    workflow.addConditionalEdges(
      'classify_query',
      this.routeBasedOnType.bind(this),
      {
        search: 'search_database',
        stock_check: 'check_stock',
        profile: 'get_profile',
        usecase_search: 'search_usecase',
        general: 'search_database',
        direct_response: 'generate_response'
      }
    );

    // Connect tool nodes to synthesis
    workflow.addEdge('search_database', 'synthesize_results');
    workflow.addEdge('check_stock', 'synthesize_results');
    workflow.addEdge('get_profile', 'synthesize_results');
    workflow.addEdge('search_usecase', 'synthesize_results');

    // Connect synthesis to response generation
    workflow.addConditionalEdges(
      'synthesize_results',
      this.hasResults.bind(this),
      {
        has_results: 'generate_response',
        no_results: 'handle_error'
      }
    );

    // Final edges
    workflow.addEdge('generate_response', END);
    workflow.addEdge('handle_error', END);

    return workflow.compile() as any;
  }

  /**
   * Classify the user query to determine intent and required tools
   */
  private async classifyQuery(state: RawMaterialsState): Promise<Partial<RawMaterialsState>> {
    try {
      const lastMessage = state.messages[state.messages.length - 1];
      const query = typeof lastMessage === 'string' ? lastMessage : lastMessage.content;

      const classificationPrompt = `
Classify this raw materials query into one of these categories:
- "search": General search for ingredients/materials (แนะนำ, หา, ค้นหา)
- "stock_check": Check if we have specific materials in stock (มีไหม, สั่งได้)
- "profile": Get detailed profile of a specific material (สารนี้ทำอะไร)
- "usecase_search": Find materials for specific use cases (สารสำหรับ)
- "general": General questions about raw materials

Query: "${query}"

Respond with just the category name.
      `;

      const response = await this.llm.invoke([
        new SystemMessage("You are a query classifier for raw materials database."),
        new HumanMessage(classificationPrompt)
      ]);

      const queryType = response.content.toString().toLowerCase().trim();
      const validTypes = ['search', 'stock_check', 'profile', 'usecase_search', 'general'];
      const normalizedType = validTypes.includes(queryType) ? queryType : 'general';

      return {
        query,
        queryType: normalizedType as any,
        needsTools: true
      };
    } catch (error) {
      console.error('❌ [LangGraphAgent] Query classification failed:', error);
      return {
        query: state.messages[state.messages.length - 1]?.content || '',
        queryType: 'general',
        needsTools: true,
        error: 'Classification failed'
      };
    }
  }

  /**
   * Determine if tools are needed based on query classification
   */
  private async shouldUseTools(state: RawMaterialsState): Promise<string> {
    return state.needsTools ? 'use_tools' : 'direct_response';
  }

  /**
   * Route to appropriate tool based on query type
   */
  private async routeBasedOnType(state: RawMaterialsState): Promise<string> {
    // If tools are not needed, go directly to response generation
    if (!state.needsTools) {
      return 'direct_response';
    }

    const routing = {
      'search': 'search',
      'stock_check': 'stock_check',
      'profile': 'profile',
      'usecase_search': 'usecase_search',
      'general': 'search'
    };
    return routing[state.queryType || 'general'] as string;
  }

  /**
   * Search FDA database tool node
   */
  private async searchDatabase(state: RawMaterialsState): Promise<Partial<RawMaterialsState>> {
    try {
      const query = state.query || '';
      console.log(`🔍 [LangGraphAgent] Searching database for: ${query}`);

      // Extract parameters from query
      const params = this.extractSearchParameters(query);

      const results = await this.tools.search_fda_database.invoke({
        query: params.query || query,
        limit: params.limit || 10,
        benefit: params.benefit,
        exclude_codes: params.exclude_codes,
        offset: params.offset || 0
      });

      return {
        searchResults: results.results || [],
        toolCalls: ['search_fda_database'],
        confidence: 0.85
      };
    } catch (error) {
      console.error('❌ [LangGraphAgent] Database search failed:', error);
      return {
        error: `Database search failed: ${error.message}`,
        confidence: 0.1
      };
    }
  }

  /**
   * Check stock availability tool node
   */
  private async checkStock(state: RawMaterialsState): Promise<Partial<RawMaterialsState>> {
    try {
      const query = state.query || '';
      console.log(`📦 [LangGraphAgent] Checking stock for: ${query}`);

      const params = this.extractSearchParameters(query);

      const results = await this.tools.check_stock_availability.invoke({
        query: params.query || query,
        limit: params.limit || 10,
        offset: params.offset || 0,
        exclude_patterns: params.exclude_patterns
      });

      return {
        stockResults: results.results || [],
        toolCalls: ['check_stock_availability'],
        confidence: 0.9
      };
    } catch (error) {
      console.error('❌ [LangGraphAgent] Stock check failed:', error);
      return {
        error: `Stock check failed: ${error.message}`,
        confidence: 0.1
      };
    }
  }

  /**
   * Get material profile tool node
   */
  private async getProfile(state: RawMaterialsState): Promise<Partial<RawMaterialsState>> {
    try {
      const query = state.query || '';
      console.log(`📋 [LangGraphAgent] Getting profile for: ${query}`);

      // Extract material name from query
      const materialMatch = query.match(/(?:สาร|วัตถุดิบ|วัสดุ)?\s*([^\s]+(?:\s+[^\s]+)*)/);
      const material = materialMatch ? materialMatch[1] : query;

      const results = await this.tools.get_material_profile.invoke({
        material: material,
        limit: 3
      });

      return {
        profileResults: results.results || [],
        toolCalls: ['get_material_profile'],
        confidence: 0.95
      };
    } catch (error) {
      console.error('❌ [LangGraphAgent] Profile lookup failed:', error);
      return {
        error: `Profile lookup failed: ${error.message}`,
        confidence: 0.1
      };
    }
  }

  /**
   * Search by use case tool node
   */
  private async searchUsecase(state: RawMaterialsState): Promise<Partial<RawMaterialsState>> {
    try {
      const query = state.query || '';
      console.log(`🎯 [LangGraphAgent] Searching use case for: ${query}`);

      const params = this.extractUsecaseParameters(query);

      const results = await this.tools.search_materials_by_usecase.invoke({
        usecase: params.usecase || query,
        benefit: params.benefit,
        prioritize_stock: params.prioritize_stock !== false,
        limit: params.limit || 10,
        offset: params.offset || 0,
        exclude_codes: params.exclude_codes
      });

      return {
        usecaseResults: results.results || [],
        toolCalls: ['search_materials_by_usecase'],
        confidence: 0.9
      };
    } catch (error) {
      console.error('❌ [LangGraphAgent] Use case search failed:', error);
      return {
        error: `Use case search failed: ${error.message}`,
        confidence: 0.1
      };
    }
  }

  /**
   * Synthesize results from multiple tool calls
   */
  private async synthesizeResults(state: RawMaterialsState): Promise<Partial<RawMaterialsState>> {
    try {
      const allResults = [
        ...(state.searchResults || []),
        ...(state.stockResults || []),
        ...(state.profileResults || []),
        ...(state.usecaseResults || [])
      ];

      // Remove duplicates based on rm_code
      const uniqueResults = allResults.reduce((acc: any[], current) => {
        const exists = acc.find(item => item.rm_code === current.rm_code);
        if (!exists) {
          acc.push(current);
        }
        return acc;
      }, []);

      return {
        searchResults: uniqueResults,
        confidence: Math.max(
          state.confidence || 0,
          state.searchResults?.length ? 0.85 : 0,
          state.stockResults?.length ? 0.9 : 0,
          state.profileResults?.length ? 0.95 : 0,
          state.usecaseResults?.length ? 0.9 : 0
        )
      };
    } catch (error) {
      console.error('❌ [LangGraphAgent] Result synthesis failed:', error);
      return {
        error: `Result synthesis failed: ${error.message}`,
        confidence: 0.1
      };
    }
  }

  /**
   * Generate final response based on results
   */
  private async generateResponse(state: RawMaterialsState): Promise<Partial<RawMaterialsState>> {
    try {
      const results = state.searchResults || [];
      const query = state.query || '';
      const toolCalls = state.toolCalls || [];

      if (results.length === 0) {
        return {
          response: `ขออภัยค่ะ ไม่พบข้อมูลวัตถุดิบที่ตรงกับการค้นหา "${query}" ค่ะ\n\nลอง:\n- เปลี่ยนคำค้นหาเป็นภาษาอื่น\n- ใช้คำศัพท์ทั่วไปกว่านี้\n- ตรวจสอบการสะกดคำ\n\nหรือจะถามคำถามอื่นๆ เกี่ยวกับวัตถุดิบคอสเมติก็ได้ค่ะ`,
          confidence: 0.3
        };
      }

      const responsePrompt = `
คุณเป็น Dr. Ake, ผู้เชี่ยวชาญด้านวัตถุดิบคอสเมติกส

จากการค้นหา "${query}" พบข้อมูลดังนี้:

${this.formatResultsForLLM(results)}

กรุณา:
1. สรุปผลการค้นหาเป็นตารางที่ชัดเจน
2. แนะนำวัตถุดิบที่เหมาะสมที่สุด 3-5 อัน
3. อธิบายเหตุผลการแนะนำพร้อม benefit/use case ที่เกี่ยวข้อง
4. ใช้ภาษาที่เป็นกันเอง เป็นมิตร
5. เพิ่มข้อมูลเชิงลึกเฉพาะที่เกี่ยวข้องกับคำถาม

**สำคัญ:** ตอบตามข้อมูลที่ได้จากการค้นหาเท่านั้น อย่าใส่ข้อมูลที่ไม่มีในผลลัพธ์
      `;

      const response = await this.llm.invoke([
        new SystemMessage("คุณเป็น Dr. Ake, ผู้เชี่ยวชาญด้านวัตถุดิบคอสเมติกส ให้คำแนะนำที่แม่นยำและเป็นประโยชน์"),
        new HumanMessage(responsePrompt)
      ]);

      return {
        response: response.content.toString(),
        confidence: state.confidence || 0.8
      };
    } catch (error) {
      console.error('❌ [LangGraphAgent] Response generation failed:', error);
      return {
        response: 'ขออภัยค่ะ เกิดข้อผิดพลาดในการสร้างคำตอบ กรุณาลองใหม่ภายหลังค่ะ',
        confidence: 0.1,
        error: `Response generation failed: ${error.message}`
      };
    }
  }

  /**
   * Handle errors gracefully
   */
  private async handleError(state: RawMaterialsState): Promise<Partial<RawMaterialsState>> {
    return {
      response: `ขออภัยค่ะ ไม่พบข้อมูลที่ตรงกับการค้นหา "${state.query}" ค่ะ\n\nกรุณาลอง:\n• เปลี่ยนคำค้นหา\n• ใช้คำศัพท์ทั่วไปกว่านี้\n• ตรวจสอบการสะกดคำ\n\nหรือสอบถามข้อมูลอื่นๆ เกี่ยวกับวัตถุดิบคอสเมติกสได้ค่ะ`,
      confidence: 0.2,
      error: 'No results found'
    };
  }

  /**
   * Check if we have any results
   */
  private async hasResults(state: RawMaterialsState): Promise<string> {
    const totalResults =
      (state.searchResults?.length || 0) +
      (state.stockResults?.length || 0) +
      (state.profileResults?.length || 0) +
      (state.usecaseResults?.length || 0);

    return totalResults > 0 ? 'has_results' : 'no_results';
  }

  /**
   * Extract search parameters from user query
   */
  private extractSearchParameters(query: string): Record<string, any> {
    const params: Record<string, any> = { query };

    // Extract limit
    const limitMatch = query.match(/(\d+)\s*(อัน|ตัว|ชิ้น)/);
    if (limitMatch) {
      params.limit = parseInt(limitMatch[1]);
    }

    // Extract benefit
    const benefitMatch = query.match(/benefit[:\s]+([^\n]+)/i) || query.match(/(ประโยชน์|benefit)[:\s]+([^\n]+)/i);
    if (benefitMatch) {
      params.benefit = benefitMatch[1].trim();
    }

    // Extract exclude codes
    const excludeMatch = query.match(/exclude[:\s]+([^\n]+)/i) || query.match(/(ไม่เอา|ยกเว้น)[:\s]+([^\n]+)/i);
    if (excludeMatch) {
      params.exclude_codes = excludeMatch[1].split(/[,|\s]+/).map((s: string) => s.trim()).filter(Boolean);
    }

    return params;
  }

  /**
   * Extract use case search parameters
   */
  private extractUsecaseParameters(query: string): Record<string, any> {
    const params = this.extractSearchParameters(query);

    // Extract use case
    const usecaseMatch = query.match(/สำหรับ|เพื่อ|สำหรับทำ|ใช้กับ\s+(.+)/i);
    if (usecaseMatch) {
      params.usecase = usecaseMatch[1].trim();
    }

    // Default prioritize_stock to true unless explicitly disabled
    if (query.includes('ไม่จำกัดสต็อก') || query.includes('all available')) {
      params.prioritize_stock = false;
    } else {
      params.prioritize_stock = true;
    }

    return params;
  }

  /**
   * Format results for LLM consumption
   */
  private formatResultsForLLM(results: any[]): string {
    return results.slice(0, 10).map((item, index) => {
      const benefits = Array.isArray(item.benefits)
        ? item.benefits.slice(0, 3).join(', ')
        : (item.benefits || 'N/A');

      const usecase = Array.isArray(item.usecase)
        ? item.usecase.slice(0, 2).join(', ')
        : (item.usecase || 'N/A');

      return `${index + 1}. **${item.rm_code}** - ${item.trade_name}
   ซัพพลายเออร์: ${item.supplier || 'N/A'}
   ประโยชน์: ${benefits}
   การใช้งาน: ${usecase}
   ราคา: ${item.rm_cost || 'N/A'}`;
    }).join('\n\n');
  }

  /**
   * Process user message through the LangGraph workflow
   */
  async processMessage(message: string): Promise<{
    response: string;
    confidence: number;
    toolCalls?: string[];
    results?: any[];
  }> {
    try {
      const initialState: RawMaterialsState = {
        messages: [new HumanMessage(message)],
        query: message
      };

      const result = await (this.graph as any).invoke(initialState);

      return {
        response: result.response || 'ขออภัยค่ะ เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่ค่ะ',
        confidence: result.confidence || 0.5,
        toolCalls: result.toolCalls,
        results: result.searchResults
      };
    } catch (error: any) {
      console.error('❌ [LangGraphAgent] Workflow execution failed:', error);
      return {
        response: 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว กรุณาลองใหม่ภายหลังค่ะ',
        confidence: 0.1
      };
    }
  }

  /**
   * Get the compiled graph for external use
   */
  getGraph() {
    return this.graph;
  }
}

/**
 * Factory function to create and configure the agent
 */
export function createLangGraphRawMaterialsAgent(geminiApiKey: string): LangGraphRawMaterialsAgent {
  console.log('🚀 [LangGraphAgent] Initializing LangGraph-powered Raw Materials Agent');
  return new LangGraphRawMaterialsAgent(geminiApiKey);
}