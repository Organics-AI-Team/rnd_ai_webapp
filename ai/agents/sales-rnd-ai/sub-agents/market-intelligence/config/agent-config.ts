/**
 * Market Intelligence Sub-Agent Configuration
 * Specialized agent for competitive analysis, SWOT, and market research
 */

import { SimpleAgentConfig } from '@/ai/agents/core/types';

export const MARKET_INTELLIGENCE_CONFIG: SimpleAgentConfig = {
  // Basic identification
  id: 'market-intelligence',
  name: 'marketIntelligence',
  displayName: 'Market Intelligence Agent',
  description: 'Specialized sub-agent for competitive analysis, SWOT analysis, and market research for cosmetic products, brands, and ingredients',

  // AI Model configuration
  aiModel: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.7,  // Balanced for analytical accuracy with some creativity
    maxTokens: 15000   // Large enough for comprehensive reports
  },

  // Prompt files
  prompts: {
    systemPromptPath: './prompts/system-prompt.md',
    welcomeMessagePath: './prompts/welcome-message.md',
    userInstructionsPath: './prompts/user-instructions.md',
    ragInstructionsPath: './prompts/rag-instructions.md'
  },

  // Database configuration (inherited from parent)
  database: {
    name: 'sales_rnd_ai_db',
    collections: {
      conversations: 'market_intelligence_conversations',
      feedback: 'market_intelligence_feedback',
      ragData: 'raw_materials_real_stock'  // Shared with parent
    }
  },

  // SHARED vector database with parent agent and other sub-agents
  vectorDb: {
    indexName: 'raw-materials-stock-vectors',  // Same as parent
    dimensions: 3072,
    metric: 'cosine'
  },

  // Embedding configuration (SHARED with parent)
  embedding: {
    provider: 'gemini',
    model: 'text-embedding-004',
    dimensions: 3072
  },

  // RAG configuration
  rag: {
    enabled: true,
    topK: 15,  // More context for comprehensive analysis
    similarityThreshold: 0.60,  // Slightly lower for broader competitive data
    includeMetadata: true
  }
};

export default MARKET_INTELLIGENCE_CONFIG;
