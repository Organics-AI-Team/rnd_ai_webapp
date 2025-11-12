/**
 * Agent Usage Examples - Plug and Play
 * Shows how easy it is to create and use AI agents
 */

import { AgentFactory } from './agent-factory';
import { RAW_MATERIALS_AI_CONFIG } from '../raw-materials-ai/config/agent-config';
import { SALES_RND_AI_CONFIG } from '../sales-rnd-ai/config/agent-config';

// ==============================================
// EXAMPLE 1: Using Pre-configured Agents
// ==============================================

/**
 * Get Raw Materials AI (Stock) Agent - Ready to Use
 */
export function getRawMaterialsAIAgent() {
  return AgentFactory.getAgent(RAW_MATERIALS_AI_CONFIG);
}

/**
 * Get Sales RND AI Agent - Ready to Use
 */
export function getSalesRndAIAgent() {
  return AgentFactory.getAgent(SALES_RND_AI_CONFIG);
}

// ==============================================
// EXAMPLE 2: Quick Agent Creation
// ==============================================

/**
 * Create a new agent instantly with minimal configuration
 */
export function createCustomAgent(id: string, displayName: string) {
  const config = AgentFactory.createQuickAgent({
    id,
    displayName,
    prompts: {
      systemPromptPath: './prompts/system-prompt.md',
      welcomeMessagePath: './prompts/welcome-message.md',
      userInstructionsPath: './prompts/user-instructions.md',
      ragInstructionsPath: './prompts/rag-instructions.md'
    }
  });

  return AgentFactory.getAgent(config);
}

// ==============================================
// EXAMPLE 3: Complete Agent Usage
// ==============================================

/**
 * Complete example of using an agent
 */
export async function useAgentExample() {
  // Get the agent
  const agent = getRawMaterialsAIAgent();

  try {
    // Get AI service for generating responses
    const aiService = agent.getAIService();

    // Perform RAG search
    const ragResults = await agent.performRAGSearch("What is benzothiazine used for?");
    console.log("RAG Results:", ragResults);

    // Generate AI response with RAG context
    const enhancedPrompt = agent.getEnhancedSystemPrompt() + ragResults;
    const response = await aiService.generateResponse({
      prompt: "What is benzothiazine used for?",
      userId: "user123"
    });

    console.log("AI Response:", response.response);

    // Save conversation to agent's database
    const collections = await agent.getCollections();
    await collections.conversations.insertOne({
      userId: "user123",
      prompt: "What is benzothiazine used for?",
      response: response.response,
      ragContext: ragResults,
      timestamp: new Date(),
      agentId: agent.getConfig().id
    });

  } catch (error) {
    console.error("Error using agent:", error);
  }
}

// ==============================================
// EXAMPLE 4: RAG Operations
// ==============================================

/**
 * Example of RAG operations
 */
export async function ragOperationsExample() {
  const agent = getRawMaterialsAIAgent();

  // Vector search
  const vectorResults = await agent.searchVectorDatabase("chemical compounds", {
    topK: 3,
    threshold: 0.7
  });

  // Hybrid search (vector + keyword fallback)
  const hybridResults = await agent.hybridSearch("raw materials pricing", {
    topK: 5
  });

  // Format results for AI context
  const formattedResults = agent.formatSearchResults(vectorResults, "chemical compounds");

  console.log("Vector Results:", vectorResults);
  console.log("Hybrid Results:", hybridResults);
  console.log("Formatted Results:", formattedResults);
}

// ==============================================
// EXAMPLE 5: Multiple Agent Management
// ==============================================

/**
 * Managing multiple agents
 */
export function manageMultipleAgentsExample() {
  // Get all agents
  const allAgents = AgentFactory.getAllAgents();
  console.log("All agents:", allAgents.map(agent => agent.getConfig().displayName));

  // Get specific agent by ID
  const stockAgent = AgentFactory.getAgentById('raw-materials-ai');
  if (stockAgent) {
    console.log("Stock agent found:", stockAgent.getConfig().displayName);
  }

  // Create a new agent on the fly
  const customAgent = createCustomAgent('custom-agent', 'Custom AI Assistant');
  console.log("Custom agent created:", customAgent.getConfig().displayName);
}

// ==============================================
// EXAMPLE 6: Easy Agent Registry
// ==============================================

/**
 * Simple registry for easy agent access
 */
export const AgentRegistrySimple = {
  rawMaterialsAI: () => getRawMaterialsAIAgent(),
  salesRndAI: () => getSalesRndAIAgent(),
  create: (id: string, displayName: string) => createCustomAgent(id, displayName),
  get: (id: string) => AgentFactory.getAgentById(id),
  list: () => AgentFactory.getAllAgents()
} as const;

// ==============================================
// EXAMPLE 7: Frontend Usage Pattern
// ==============================================

/**
 * How to use in React components or API routes
 */
export class AgentManager {
  private agents = new Map<string, any>();

  /**
   * Initialize agent for frontend use
   */
  async initializeAgent(agentId: 'raw-materials-ai' | 'sales-rnd-ai') {
    if (this.agents.has(agentId)) {
      return this.agents.get(agentId);
    }

    const agent = agentId === 'raw-materials-ai'
      ? getRawMaterialsAIAgent()
      : getSalesRndAIAgent();

    this.agents.set(agentId, agent);
    return agent;
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string) {
    return this.agents.get(agentId);
  }

  /**
   * Chat with agent
   */
  async chatWithAgent(agentId: string, message: string, userId: string) {
    const agent = this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Perform RAG search
    const ragResults = await agent.performRAGSearch(message);

    // Generate response
    const aiService = agent.getAIService();
    const response = await aiService.generateResponse({
      prompt: message + ragResults,
      userId
    });

    // Save conversation
    const collections = await agent.getCollections();
    await collections.conversations.insertOne({
      userId,
      prompt: message,
      response: response.response,
      ragContext: ragResults,
      timestamp: new Date(),
      agentId
    });

    return {
      response: response.response,
      ragContext: ragResults,
      agentConfig: agent.getConfig()
    };
  }
}

// ==============================================
// EXPORT FOR EASY IMPORT
// ==============================================
// AgentRegistrySimple is already exported above