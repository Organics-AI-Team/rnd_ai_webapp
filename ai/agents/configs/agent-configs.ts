/**
 * AI Agent configurations
 * Each agent combines a system prompt, RAG indices, and specific parameters
 */

import { SystemPrompt } from '../prompts/system-prompts';
import { RAGIndexConfig } from '../../rag/indices/index-config';
import { AIProvider } from '../../types/ai-types';

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  systemPromptId: string;
  ragIndexIds: string[];
  provider: AIProvider;
  modelConfig: {
    temperature: number;
    maxTokens: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
  capabilities: string[];
  category: string;
  version: string;
  enabled: boolean;
  metadata?: {
    author?: string;
    createdAt?: Date;
    updatedAt?: Date;
    usageCount?: number;
    avgRating?: number;
  };
}

export const AGENT_CONFIGS: Record<string, AgentConfig> = {
  // General Assistant
  'general-assistant': {
    id: 'general-assistant',
    name: 'General AI Assistant',
    description: 'Versatile AI assistant for general inquiries and tasks',
    systemPromptId: 'general-assistant',
    ragIndexIds: [], // No RAG for general assistant
    provider: 'openai',
    modelConfig: {
      temperature: 0.7,
      maxTokens: 500,
      topP: 0.9,
      frequencyPenalty: 0.1,
      presencePenalty: 0.1
    },
    capabilities: [
      'general-qa',
      'conversation',
      'creative-writing',
      'analysis',
      'problem-solving'
    ],
    category: 'general',
    version: '1.0.0',
    enabled: true,
    metadata: {
      author: 'AI Team',
      createdAt: new Date(),
      usageCount: 0,
      avgRating: 0
    }
  },

  // Raw Materials Specialist
  'raw-materials-specialist': {
    id: 'raw-materials-specialist',
    name: 'ผู้เชี่ยวชาญวัตถุดิบ',
    description: 'เชี่ยวชาญวัตถุดิบเครื่องสำอาง สูตร และข้อมูลซัพพลายเออร์',
    systemPromptId: 'raw-materials-specialist',
    ragIndexIds: ['raw-materials-db', 'suppliers-db', 'safety-db'],
    provider: 'gemini',
    modelConfig: {
      temperature: 0.6,
      maxTokens: 600,
      topP: 0.8,
      frequencyPenalty: 0.1,
      presencePenalty: 0.1
    },
    capabilities: [
      'ingredient-analysis',
      'supplier-information',
      'safety-assessment',
      'cost-analysis',
      'technical-specifications'
    ],
    category: 'raw-materials',
    version: '1.3.0',
    enabled: true,
    metadata: {
      author: 'R&D Team',
      createdAt: new Date(),
      usageCount: 0,
      avgRating: 0
    }
  },

  // Formulation Advisor
  'formulation-advisor': {
    id: 'formulation-advisor',
    name: 'ที่ปรึกษาสูตรผลิตภัณฑ์',
    description: 'เชี่ยวชาญการพัฒนาและปรับแต่งสูตรเครื่องสำอาง',
    systemPromptId: 'formulation-advisor',
    ragIndexIds: ['formulations-db', 'raw-materials-db', 'safety-db', 'research-db'],
    provider: 'gemini',
    modelConfig: {
      temperature: 0.5,
      maxTokens: 700,
      topP: 0.7,
      frequencyPenalty: 0.2,
      presencePenalty: 0.1
    },
    capabilities: [
      'formula-development',
      'ingredient-compatibility',
      'stability-testing',
      'optimization',
      'scale-up-guidance'
    ],
    category: 'raw-materials',
    version: '1.2.0',
    enabled: true,
    metadata: {
      author: 'Formulation Team',
      createdAt: new Date(),
      usageCount: 0,
      avgRating: 0
    }
  },

  // Regulatory Compliance Expert
  'regulatory-expert': {
    id: 'regulatory-expert',
    name: 'Regulatory Compliance Expert',
    description: 'Specialist in global cosmetic regulations with access to regulatory database',
    systemPromptId: 'regulatory-expert',
    ragIndexIds: ['regulations-db', 'safety-db', 'research-db'],
    provider: 'openai',
    modelConfig: {
      temperature: 0.4,
      maxTokens: 800,
      topP: 0.6,
      frequencyPenalty: 0.0,
      presencePenalty: 0.0
    },
    capabilities: [
      'regulatory-compliance',
      'labeling-requirements',
      'safety-assessments',
      'documentation',
      'market-entry-guidance'
    ],
    category: 'raw-materials',
    version: '1.0.0',
    enabled: true,
    metadata: {
      author: 'Regulatory Team',
      createdAt: new Date(),
      usageCount: 0,
      avgRating: 0
    }
  },

  // Market Research Analyst
  'market-analyst': {
    id: 'market-analyst',
    name: 'นักวิเคราะห์ตลาด & เทรนด์',
    description: 'เชี่ยวชาญเทรนด์ตลาด ความต้องการที่ยังไม่ได้รับการตอบสนอง และโอกาสทางธุรกิจ',
    systemPromptId: 'market-analyst',
    ragIndexIds: ['market-research-db', 'research-db'],
    provider: 'openai',
    modelConfig: {
      temperature: 0.6,
      maxTokens: 600,
      topP: 0.8,
      frequencyPenalty: 0.1,
      presencePenalty: 0.1
    },
    capabilities: [
      'market-analysis',
      'trend-forecasting',
      'consumer-insights',
      'competitive-analysis',
      'strategic-planning'
    ],
    category: 'analytics',
    version: '1.1.0',
    enabled: true,
    metadata: {
      author: 'Marketing Team',
      createdAt: new Date(),
      usageCount: 0,
      avgRating: 0
    }
  },

  // Creative Concept Developer
  'creative-developer': {
    id: 'creative-developer',
    name: 'Creative Concept Developer',
    description: 'Specialist in product concept development and brand storytelling',
    systemPromptId: 'creative-developer',
    ragIndexIds: ['market-research-db', 'formulations-db'],
    provider: 'openai',
    modelConfig: {
      temperature: 0.8,
      maxTokens: 600,
      topP: 0.9,
      frequencyPenalty: 0.3,
      presencePenalty: 0.2
    },
    capabilities: [
      'concept-development',
      'brand-storytelling',
      'creative-ideation',
      'innovation-consulting',
      'design-thinking'
    ],
    category: 'creative',
    version: '1.0.0',
    enabled: true,
    metadata: {
      author: 'Creative Team',
      createdAt: new Date(),
      usageCount: 0,
      avgRating: 0
    }
  },

  // Technical Support Specialist
  'technical-support': {
    id: 'technical-support',
    name: 'Technical Support Specialist',
    description: 'Expert in technical troubleshooting and manufacturing optimization',
    systemPromptId: 'technical-support',
    ragIndexIds: ['product-docs-db', 'research-db', 'raw-materials-db'],
    provider: 'openai',
    modelConfig: {
      temperature: 0.3,
      maxTokens: 800,
      topP: 0.5,
      frequencyPenalty: 0.0,
      presencePenalty: 0.0
    },
    capabilities: [
      'troubleshooting',
      'process-optimization',
      'quality-control',
      'technical-documentation',
      'manufacturing-guidance'
    ],
    category: 'technical',
    version: '1.0.0',
    enabled: true,
    metadata: {
      author: 'Technical Team',
      createdAt: new Date(),
      usageCount: 0,
      avgRating: 0
    }
  }
};

/**
 * Get agent configuration by ID
 */
export function getAgentConfig(id: string): AgentConfig | undefined {
  return AGENT_CONFIGS[id];
}

/**
 * Get agent configurations by category
 */
export function getAgentConfigsByCategory(category: string): AgentConfig[] {
  return Object.values(AGENT_CONFIGS).filter(agent => agent.category === category);
}

/**
 * Get enabled agent configurations
 */
export function getEnabledAgentConfigs(): AgentConfig[] {
  return Object.values(AGENT_CONFIGS).filter(agent => agent.enabled);
}

/**
 * Search agent configurations by name, description, or capabilities
 */
export function searchAgentConfigs(query: string): AgentConfig[] {
  const searchTerms = query.toLowerCase().split(' ');
  return Object.values(AGENT_CONFIGS).filter(agent =>
    searchTerms.every(term =>
      agent.name.toLowerCase().includes(term) ||
      agent.description.toLowerCase().includes(term) ||
      agent.capabilities.some(cap => cap.toLowerCase().includes(term))
    )
  );
}

/**
 * Get agent configurations by provider
 */
export function getAgentConfigsByProvider(provider: AIProvider): AgentConfig[] {
  return Object.values(AGENT_CONFIGS).filter(agent => agent.provider === provider);
}

/**
 * Get agent configurations by capability
 */
export function getAgentConfigsByCapability(capability: string): AgentConfig[] {
  return Object.values(AGENT_CONFIGS).filter(agent =>
    agent.capabilities.includes(capability)
  );
}