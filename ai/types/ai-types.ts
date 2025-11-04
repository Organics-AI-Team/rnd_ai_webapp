// Core AI types and interfaces used across all AI services

export interface AIRequest {
  prompt: string;
  userId: string;
  context?: {
    previousResponses?: string[];
    userPreferences?: UserPreferences;
    category?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
  };
}

export interface AIResponse {
  id: string;
  response: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timestamp: Date;
  context: {
    length: number;
    complexity: 'simple' | 'moderate' | 'complex';
    category?: string;
    feedbackAdjusted?: boolean;
  };
  metadata?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latency: number;
  };
}

export interface UserPreferences {
  preferredLength: 'short' | 'medium' | 'long';
  preferredStyle: 'formal' | 'casual' | 'technical';
  avoidTopics: string[];
  preferredComplexity: 'simple' | 'moderate' | 'complex';
  feedbackPatterns?: {
    averageScore: number;
    commonIssues: string[];
    preferredLength: string;
    preferredComplexity: string;
  };
}

export interface FeedbackPatterns {
  averageScore: number;
  commonIssues: string[];
  preferredLength: 'short' | 'medium' | 'long';
  preferredComplexity: 'simple' | 'moderate' | 'complex';
  totalFeedback: number;
}

export interface AIModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

export type AIProvider = 'openai' | 'gemini' | 'langchain';

export interface AIServiceConfig {
  provider: AIProvider;
  apiKey: string;
  defaultConfig: AIModelConfig;
}