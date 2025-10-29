import { trpc } from '@/lib/trpc-client';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  responseId?: string;
  feedbackSubmitted?: boolean;
}

interface ConversationMemory {
  userId: string;
  messages: Message[];
  lastUpdated: Date;
}

export class HybridConversationMemoryManager {
  private localStorage: Map<string, ConversationMemory> = new Map();
  private readonly MAX_MESSAGES = 40;
  private userId: string | null = null;

  constructor(userId?: string) {
    this.userId = userId || null;
    this.loadMemories();
  }

  setUserId(userId: string) {
    this.userId = userId;
    this.loadMemories();
  }

  private loadMemories(): void {
    if (typeof window === 'undefined' || !this.userId) return;

    try {
      const stored = localStorage.getItem(`conversation_memory_${this.userId}`);
      if (stored) {
        const memory: ConversationMemory = JSON.parse(stored);
        memory.messages = memory.messages.map(msg => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        }));
        memory.lastUpdated = new Date(memory.lastUpdated);
        this.localStorage.set(this.userId, memory);
      }
    } catch (error) {
      console.error('Error loading conversation memories:', error);
    }
  }

  private saveToLocalStorage(): void {
    if (typeof window === 'undefined' || !this.userId) return;

    try {
      const memory = this.localStorage.get(this.userId);
      if (memory) {
        localStorage.setItem(`conversation_memory_${this.userId}`, JSON.stringify(memory));
      }
    } catch (error) {
      console.error('Error saving conversation memories:', error);
    }
  }

  private async saveToMongoDB(message: Message): Promise<void> {
    if (!this.userId) return;

    try {
      const utils = trpc.useUtils();
      await utils.conversations.saveMessage.mutate({
        id: message.id,
        content: message.content,
        role: message.role,
        timestamp: message.timestamp,
        responseId: message.responseId,
        feedbackSubmitted: message.feedbackSubmitted
      });
    } catch (error) {
      console.error('Error saving message to MongoDB:', error);
      // Don't throw error, continue with localStorage backup
    }
  }

  async getConversationHistory(userId?: string): Promise<Message[]> {
    const targetUserId = userId || this.userId;
    if (!targetUserId) return [];

    try {
      // First try to get from MongoDB for server-side persistence
      const utils = trpc.useUtils();
      const mongoHistory = await utils.conversations.getHistory.fetch({ limit: 40 });

      if (mongoHistory && mongoHistory.length > 0) {
        return mongoHistory;
      }
    } catch (error) {
      console.error('Error fetching from MongoDB, using localStorage:', error);
    }

    // Fallback to localStorage
    const memory = this.localStorage.get(targetUserId);
    return memory ? memory.messages : [];
  }

  async addMessage(userId: string, message: Message): Promise<void> {
    let memory = this.localStorage.get(userId);

    if (!memory) {
      memory = {
        userId,
        messages: [],
        lastUpdated: new Date()
      };
      this.localStorage.set(userId, memory);
    }

    // Add new message to localStorage
    memory.messages.push(message);

    // Keep only the last MAX_MESSAGES in localStorage
    if (memory.messages.length > this.MAX_MESSAGES) {
      memory.messages = memory.messages.slice(-this.MAX_MESSAGES);
    }

    memory.lastUpdated = new Date();
    this.saveToLocalStorage();

    // Also save to MongoDB for persistence
    await this.saveToMongoDB(message);
  }

  async clearConversationHistory(userId?: string): Promise<void> {
    const targetUserId = userId || this.userId;
    if (!targetUserId) return;

    // Clear localStorage
    this.localStorage.delete(targetUserId);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`conversation_memory_${targetUserId}`);
    }

    // Clear MongoDB
    try {
      const utils = trpc.useUtils();
      await utils.conversations.clearHistory.mutate();
    } catch (error) {
      console.error('Error clearing conversation history from MongoDB:', error);
    }
  }

  async getRecentMessages(userId?: string, count: number = 20): Promise<Message[]> {
    const messages = await this.getConversationHistory(userId);
    return messages.slice(-count);
  }

  async getFormattedHistory(userId?: string, count?: number): Promise<Array<{ role: string; content: string }>> {
    const messages = count ? await this.getRecentMessages(userId, count) : await this.getConversationHistory(userId);
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  getMemoryStats(userId?: string): { totalMessages: number; lastUpdated: Date | null } {
    const targetUserId = userId || this.userId;
    if (!targetUserId) {
      return { totalMessages: 0, lastUpdated: null };
    }

    const memory = this.localStorage.get(targetUserId);
    return {
      totalMessages: memory ? memory.messages.length : 0,
      lastUpdated: memory ? memory.lastUpdated : null
    };
  }

  // Sync localStorage with MongoDB (call this periodically or on load)
  async syncWithMongoDB(): Promise<void> {
    if (!this.userId) return;

    try {
      const utils = trpc.useUtils();
      const mongoHistory = await utils.conversations.getHistory.fetch({ limit: 40 });

      if (mongoHistory && mongoHistory.length > 0) {
        const memory = {
          userId: this.userId,
          messages: mongoHistory,
          lastUpdated: new Date()
        };

        this.localStorage.set(this.userId, memory);
        this.saveToLocalStorage();
      }
    } catch (error) {
      console.error('Error syncing with MongoDB:', error);
    }
  }

  // Get stats from MongoDB
  async getMongoDBStats(): Promise<any> {
    if (!this.userId) return null;

    try {
      const utils = trpc.useUtils();
      return await utils.conversations.getStats.fetch();
    } catch (error) {
      console.error('Error fetching MongoDB stats:', error);
      return null;
    }
  }
}