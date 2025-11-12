/**
 * Pitch Deck Creator Sub-agent Configuration
 * Specialized agent for creating compelling sales presentations
 */

import { SimpleAgentConfig } from '../../../../core/agent-system';

export const PITCH_DECK_CREATOR_CONFIG: SimpleAgentConfig = {
  // Basic Agent Info
  id: 'pitch-deck-creator',
  name: 'pitchDeckCreator',
  displayName: 'Pitch Deck Creator',
  description: 'Specialized sub-agent for creating compelling sales pitch decks and presentations',

  // AI Model Settings
  aiModel: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.85, // High creativity for presentations
    maxTokens: 12000   // Larger for multi-slide output
  },

  // Agent Prompts - File Paths
  prompts: {
    systemPromptPath: './prompts/system-prompt.md',
    welcomeMessagePath: './prompts/welcome-message.md',
    userInstructionsPath: './prompts/user-instructions.md',
    ragInstructionsPath: './prompts/rag-instructions.md'
  },

  // Database Names (inherits from parent)
  database: {
    name: 'sales_rnd_ai_db',
    collections: {
      conversations: 'pitch_deck_conversations',
      feedback: 'pitch_deck_feedback',
      ragData: 'raw_materials_real_stock'
    }
  },

  // Vector Database (SHARED with parent agent)
  vectorDb: {
    indexName: 'raw-materials-stock-vectors',
    dimensions: 3072,
    metric: 'cosine'
  },

  // Embedding Settings (SHARED with parent agent)
  embedding: {
    provider: 'gemini',
    model: 'text-embedding-004',
    dimensions: 3072
  },

  // RAG Settings
  rag: {
    enabled: true,
    topK: 10, // More context for comprehensive pitch decks
    similarityThreshold: 0.65,
    includeMetadata: true,
    filters: {
      collection: 'raw_materials_real_stock',
      source: 'pitch_deck_intelligence'
    }
  }
};
