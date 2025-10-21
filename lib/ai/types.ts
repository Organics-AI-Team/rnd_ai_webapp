/**
 * AI Types for Chemical Chat System
 */

export type AgentType =
  | 'chemical_compound'
  | 'formula_consultant'
  | 'safety_advisor'
  | 'general_chemistry';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  agent_type?: AgentType;
  tokens_used?: number;
  model?: string;
}

export interface ChemicalAgent {
  type: AgentType;
  name: string;
  description: string;
  capabilities: string[];
}