'use client';

import { useState, useCallback } from 'react';
import type { AgentType } from '@/lib/ai/types';

export type { AgentType } from '@/lib/ai/types';

export const CHEMICAL_AGENTS_V3 = [
  {
    type: 'chemical_compound' as AgentType,
    name: 'AI Chemical Expert',
    description: 'ผู้เชี่ยวชาญด้านสารเคมีและเคมีความงาม',
    capabilities: ['ให้คำปรึกษาเคมี', 'แนะนำสารเคมี', 'วิเคราะห์คุณสมบัติ']
  }
];

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  agent_type?: AgentType;
}

interface UseSimpleChemicalAIChatOptions {
  agent_type?: AgentType;
  on_error?: (error: Error) => void;
}

export function useSimpleChemicalAIChat(options: UseSimpleChemicalAIChatOptions = {}) {
  const { agent_type: initial_agent_type = 'general_chemistry', on_error } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendMessage = useCallback(async (message: string, agentType?: AgentType) => {
    if (!message.trim()) return;

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          agent_type: agentType || initial_agent_type
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      let assistantMessage: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        agent_type: agentType || initial_agent_type,
      };

      setMessages(prev => [...prev, assistantMessage]);

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('0:')) {
            const content = line.slice(2);
            try {
              // Parse Gemini format: 0:"text"
              const textMatch = content.match(/^"(.*)"$/);
              if (textMatch) {
                const text = textMatch[1].replace(/\\"/g, '"');
                assistantMessage.content += text;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...assistantMessage };
                  return updated;
                });
              }
            } catch (e) {
              // Skip invalid format
            }
          }
        }
      }

    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to send message');
      setError(error);
      on_error?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [messages, initial_agent_type, on_error]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  }, [input, sendMessage]);

  return {
    messages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    sendMessage,
    clearChat,
    hasMessages: messages.length > 0,
  };
}