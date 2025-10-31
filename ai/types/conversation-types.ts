export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: {
    model?: string;
    responseId?: string;
    category?: string;
  };
}

export interface Conversation {
  id: string;
  userId: string;
  title?: string;
  messages: ConversationMessage[];
  category?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: {
    totalMessages: number;
    averageScore?: number;
    lastActivity: Date;
  };
}

export interface ConversationMemory {
  saveConversation(conversation: Conversation): Promise<void>;
  getConversation(conversationId: string, userId: string): Promise<Conversation | null>;
  getUserConversations(userId: string, limit?: number): Promise<Conversation[]>;
  updateConversation(conversationId: string, userId: string, updates: Partial<Conversation>): Promise<void>;
  deleteConversation(conversationId: string, userId: string): Promise<void>;
  clearUserConversations(userId: string): Promise<void>;
}

export interface ConversationContext {
  previousMessages?: ConversationMessage[];
  userPreferences?: any;
  category?: string;
  conversationId?: string;
}