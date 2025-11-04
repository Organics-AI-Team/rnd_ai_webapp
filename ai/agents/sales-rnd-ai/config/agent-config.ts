/**
 * Sales RND AI - Simple Plug and Play Configuration
 * Just import and use - everything else is handled automatically
 */

import { SimpleAgentConfig } from '../../core/agent-system';

export const SALES_RND_AI_CONFIG: SimpleAgentConfig = {
  // Basic Agent Info
  id: 'sales-rnd-ai',
  name: 'salesRndAI',
  displayName: 'Sales RND AI',
  description: 'AI assistant for sales, marketing, and business development in raw materials and cosmetics industry',

  // AI Model Settings
  aiModel: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.8,
    maxTokens: 9000
  },

  // Agent Prompts - File Paths
  prompts: {
    systemPromptPath: './prompts/system-prompt.md',
    welcomeMessagePath: './prompts/welcome-message.md',
    userInstructionsPath: './prompts/user-instructions.md',
    ragInstructionsPath: './prompts/rag-instructions.md'
  },

  // Database Names
  database: {
    name: 'sales_rnd_ai_db',
    collections: {
      conversations: 'conversations',
      feedback: 'feedback',
      ragData: 'raw_materials_real_stock' // Vector indexing from this collection (sales perspective)
    }
  },

  // Vector Database
  vectorDb: {
    indexName: 'sales-rnd-intelligence-vectors',
    dimensions: 768,
    metric: 'cosine'
  },

  // Embedding Settings
  embedding: {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    dimensions: 768
  },

  // RAG Settings
  rag: {
    enabled: true,
    topK: 5,
    similarityThreshold: 0.7,
    includeMetadata: true,
    filters: {
      collection: 'raw_materials_real_stock',
      source: 'sales_intelligence'
    }
  }
};