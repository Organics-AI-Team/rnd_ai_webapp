/**
 * Raw Materials AI (Stock) - Simple Plug and Play Configuration
 * Just import and use - everything else is handled automatically
 */

import { SimpleAgentConfig } from '../../core/agent-system';

export const RAW_MATERIALS_AI_CONFIG: SimpleAgentConfig = {
  // Basic Agent Info
  id: 'raw-materials-ai',
  name: 'rawMaterialsAI',
  displayName: 'Raw Materials AI (Stock)',
  description: 'AI assistant for specific raw materials stock database queries and inventory management',

  // AI Model Settings
  aiModel: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.6,
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
    name: 'raw_materials_stock_db',
    collections: {
      conversations: 'conversations',
      feedback: 'feedback',
      ragData: 'raw_materials_real_stock' // Vector indexing from this collection
    }
  },

  // Vector Database
  vectorDb: {
    indexName: 'raw-materials-stock-vectors',
    dimensions: 3072,
    metric: 'cosine'
  },

  // Embedding Settings
  embedding: {
    provider: 'gemini',
    model: 'text-embedding-004',
    dimensions: 3072
  },

  // RAG Settings
  rag: {
    enabled: true,
    topK: 5,
    similarityThreshold: 0.7,
    includeMetadata: true,
    filters: {
      collection: 'raw_materials_real_stock',
      source: 'stock_database'
    }
  }
};