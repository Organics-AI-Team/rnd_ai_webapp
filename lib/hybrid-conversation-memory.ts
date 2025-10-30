import { AppRouter } from '@/server';

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

  
  getConversationHistory(userId?: string): Message[] {
    const targetUserId = userId || this.userId;
    if (!targetUserId) return [];

    // Only use localStorage now - MongoDB operations handled by component
    const memory = this.localStorage.get(targetUserId);
    return memory ? memory.messages : [];
  }

  addMessage(userId: string, message: Message): void {
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
  }

  clearConversationHistory(userId?: string): void {
    const targetUserId = userId || this.userId;
    if (!targetUserId) return;

    // Clear localStorage
    this.localStorage.delete(targetUserId);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`conversation_memory_${targetUserId}`);
    }
  }

  getRecentMessages(userId?: string, count: number = 20): Message[] {
    const messages = this.getConversationHistory(userId);
    return messages.slice(-count);
  }

  getFormattedHistory(userId?: string, count?: number): Array<{ role: string; content: string }> {
    const messages = count ? this.getRecentMessages(userId, count) : this.getConversationHistory(userId);
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

  // Set messages from external source (e.g., MongoDB)
  setMessages(messages: Message[]): void {
    if (!this.userId) return;

    const memory = {
      userId: this.userId,
      messages,
      lastUpdated: new Date()
    };

    this.localStorage.set(this.userId, memory);
    this.saveToLocalStorage();
  }
}