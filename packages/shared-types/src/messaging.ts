/**
 * Messaging and Conversation Types
 *
 * Consolidated types for all chat/messaging functionality across the monorepo.
 * Provides base types and extensions for different contexts.
 *
 * @module messaging
 */

import { z } from "zod";

// ============================================
// AGENT TYPES
// ============================================

export type AgentType =
  | 'chemical_compound'
  | 'formula_consultant'
  | 'safety_advisor'
  | 'general_chemistry'
  | 'raw_materials'
  | 'sales_rnd';

// ============================================
// MESSAGE ROLE
// ============================================

export type MessageRole = 'user' | 'assistant' | 'system';

// ============================================
// BASE MESSAGE SCHEMA
// ============================================

/**
 * Base message schema - minimal required fields
 */
export const BaseMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.date(),
});

export type BaseMessage = z.infer<typeof BaseMessageSchema>;

// ============================================
// CHAT MESSAGE SCHEMA (Extended)
// ============================================

/**
 * Extended message schema with AI-specific metadata
 */
export const ChatMessageSchema = BaseMessageSchema.extend({
  agent_type: z.enum([
    'chemical_compound',
    'formula_consultant',
    'safety_advisor',
    'general_chemistry',
    'raw_materials',
    'sales_rnd'
  ]).optional(),
  tokens_used: z.number().optional(),
  model: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ============================================
// CONVERSATION MESSAGE SCHEMA (Most Comprehensive)
// ============================================

/**
 * Most comprehensive message schema with full metadata
 * Used for persisted conversations
 */
export const ConversationMessageSchema = BaseMessageSchema.extend({
  metadata: z.object({
    model: z.string().optional(),
    responseId: z.string().optional(),
    category: z.string().optional(),
    ragUsed: z.boolean().optional(),
    ragSources: z.array(z.any()).optional(),
    error: z.boolean().optional(),
    tokens_used: z.number().optional(),
    agent_type: z.enum([
      'chemical_compound',
      'formula_consultant',
      'safety_advisor',
      'general_chemistry',
      'raw_materials',
      'sales_rnd'
    ]).optional(),
  }).optional(),
});

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

// ============================================
// CONVERSATION SCHEMA
// ============================================

/**
 * Conversation container with messages and metadata
 */
export const ConversationSchema = z.object({
  _id: z.string().optional(),
  id: z.string(),
  userId: z.string(),
  agentType: z.enum([
    'chemical_compound',
    'formula_consultant',
    'safety_advisor',
    'general_chemistry',
    'raw_materials',
    'sales_rnd'
  ]),
  title: z.string(),
  messages: z.array(ConversationMessageSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Convert a BaseMessage to ChatMessage
 */
export function toChatMessage(
  message: BaseMessage,
  metadata?: { agent_type?: AgentType; tokens_used?: number; model?: string }
): ChatMessage {
  return {
    ...message,
    ...metadata,
  };
}

/**
 * Convert a ChatMessage to ConversationMessage
 */
export function toConversationMessage(
  message: ChatMessage,
  additionalMetadata?: {
    responseId?: string;
    category?: string;
    ragUsed?: boolean;
    ragSources?: any[];
    error?: boolean;
  }
): ConversationMessage {
  const { agent_type, tokens_used, model, ...baseMessage } = message;

  return {
    ...baseMessage,
    metadata: {
      model,
      tokens_used,
      agent_type,
      ...additionalMetadata,
    },
  };
}

/**
 * Extract base message from any message type
 */
export function toBaseMessage(
  message: ChatMessage | ConversationMessage
): BaseMessage {
  const { id, role, content, timestamp } = message;
  return { id, role, content, timestamp };
}
