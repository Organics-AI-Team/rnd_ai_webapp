// Main AI module exports

// Types
export * from './types/ai-types';
export * from './types/feedback-types';
export * from './types/conversation-types';

// Services
export { BaseAIService } from './services/core/base-ai-service';
export * from './services/core/ai-service-interface';
export * from './services/core/ai-service-factory';
export * from './services/core/feedback-analyzer';

export { OpenAIService } from './services/providers/openai-service';
export { GeminiService } from './services/providers/gemini-service';
export { LangChainService } from './services/providers/langchain-service';

export { PineconeRAGService } from './services/rag/pinecone-service';

// Components
export { BaseChat } from './components/chat/base-chat';
export { AIChat } from './components/chat/ai-chat';
export { RawMaterialsChat } from './components/chat/raw-materials-chat';
export { FeedbackCollector } from './components/feedback/feedback-collector';

// Hooks
export { useChat } from './hooks/use-chat';
export { useFeedback } from './hooks/use-feedback';
export { useAIService } from './hooks/use-ai-service';

// Utils
export { ResponseAnalyzer } from './utils/response-analyzer';

// Factory function
export { getAIServiceFactory } from './services/core/ai-service-factory';

// Agent management
export * from './agents/agent-manager';
export * from './agents/configs/agent-configs';
export * from './agents/prompts/system-prompts';

// RAG indices
export * from './rag/indices/index-config';

// Prompt management
export { PromptManager } from './prompts/prompt-manager';