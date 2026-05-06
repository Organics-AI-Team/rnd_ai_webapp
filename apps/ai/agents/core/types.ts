/**
 * Core Agent Types
 * Re-exports types from agent-system for cleaner imports
 */

// Re-export shared types from ai-types
export type { AIRequest } from '../../types/ai-types';

// Export agent-specific types
export type {
  AIModelConfig,
  PromptsConfig,
  DatabaseConfig,
  VectorDbConfig,
  EmbeddingConfig,
  RAGConfig,
  SimpleAgentConfig,
  AgentResponse
} from './agent-system';

export { BaseAgent, UniversalAgentSystem, AgentRegistry, agentRegistry, createAgent, DEFAULT_AGENT_CONFIGS } from './agent-system';
