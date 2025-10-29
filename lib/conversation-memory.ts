interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

interface ConversationMemory {
  userId: string;
  messages: Message[];
  lastUpdated: Date;
}

export class ConversationMemoryManager {
  private memories: Map<string, ConversationMemory> = new Map();
  private readonly MAX_MESSAGES = 40;

  constructor() {
    // Load memories from localStorage if available
    this.loadMemories();
  }

  private loadMemories(): void {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem('conversation_memories');
      if (stored) {
        const memoriesData = JSON.parse(stored);
        memoriesData.forEach((memory: ConversationMemory) => {
          // Convert timestamp strings back to Date objects
          memory.messages = memory.messages.map(msg => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
          }));
          memory.lastUpdated = new Date(memory.lastUpdated);
          this.memories.set(memory.userId, memory);
        });
      }
    } catch (error) {
      console.error('Error loading conversation memories:', error);
    }
  }

  private saveMemories(): void {
    if (typeof window === 'undefined') return;

    try {
      const memoriesArray = Array.from(this.memories.values());
      localStorage.setItem('conversation_memories', JSON.stringify(memoriesArray));
    } catch (error) {
      console.error('Error saving conversation memories:', error);
    }
  }

  getConversationHistory(userId: string): Message[] {
    const memory = this.memories.get(userId);
    return memory ? memory.messages : [];
  }

  addMessage(userId: string, message: Message): void {
    let memory = this.memories.get(userId);

    if (!memory) {
      memory = {
        userId,
        messages: [],
        lastUpdated: new Date()
      };
      this.memories.set(userId, memory);
    }

    // Add new message
    memory.messages.push(message);

    // Keep only the last MAX_MESSAGES
    if (memory.messages.length > this.MAX_MESSAGES) {
      memory.messages = memory.messages.slice(-this.MAX_MESSAGES);
    }

    memory.lastUpdated = new Date();
    this.saveMemories();
  }

  clearConversationHistory(userId: string): void {
    this.memories.delete(userId);
    this.saveMemories();
  }

  getRecentMessages(userId: string, count: number = 20): Message[] {
    const messages = this.getConversationHistory(userId);
    return messages.slice(-count);
  }

  getFormattedHistory(userId: string, count?: number): Array<{ role: string; content: string }> {
    const messages = count ? this.getRecentMessages(userId, count) : this.getConversationHistory(userId);
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  getMemoryStats(userId: string): { totalMessages: number; lastUpdated: Date | null } {
    const memory = this.memories.get(userId);
    return {
      totalMessages: memory ? memory.messages.length : 0,
      lastUpdated: memory ? memory.lastUpdated : null
    };
  }

  // Cleanup old memories (optional utility)
  cleanupOldMemories(maxAge: number = 30 * 24 * 60 * 60 * 1000): void { // 30 days default
    const now = new Date();
    const cutoff = new Date(now.getTime() - maxAge);

    for (const [userId, memory] of this.memories.entries()) {
      if (memory.lastUpdated < cutoff) {
        this.memories.delete(userId);
      }
    }

    this.saveMemories();
  }
}