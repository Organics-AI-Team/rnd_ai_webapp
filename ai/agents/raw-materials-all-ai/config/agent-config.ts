/**
 * Raw Materials All AI - Simple Plug and Play Configuration
 * Just import and use - everything else is handled automatically
 */

import { SimpleAgentConfig } from '../../core/agent-system';

export const RAW_MATERIALS_ALL_AI_CONFIG: SimpleAgentConfig = {
  // Basic Agent Info
  id: 'raw-materials-all-ai',
  name: 'rawMaterialsAllAI',
  displayName: 'Raw Materials All AI',
  description: 'AI assistant for general raw materials knowledge and conversations',

  // AI Model Settings
  aiModel: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.7,
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
    name: 'raw_materials_all_ai_db',
    collections: {
      conversations: 'conversations',
      feedback: 'feedback',
      ragData: 'raw_materials_console' // Vector indexing from this collection
    }
  },

  // Vector Database
  vectorDb: {
    indexName: 'raw-materials-general-vectors',
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
      collection: 'raw_materials_console',
      source: 'console_data'
    }
  }
};