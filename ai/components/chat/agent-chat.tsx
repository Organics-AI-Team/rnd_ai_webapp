'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bot, Settings, Database, Clock, TrendingUp } from 'lucide-react';
import { BaseChat, BaseChatProps } from './base-chat';
import { useAgent } from '../../hooks/use-agent';
import { ConversationMessage } from '../../types/conversation-types';

export interface AgentChatProps extends Omit<BaseChatProps, 'messages' | 'onSendMessage' | 'onClearHistory'> {
  userId: string;
  initialAgentId?: string;
  showAgentSelector?: boolean;
  showMetrics?: boolean;
  onAgentChange?: (agent: any) => void;
  onExecutionComplete?: (result: any) => void;
}

/**
 * Advanced AI Chat component that supports multiple specialized agents
 * Each agent has its own system prompt and RAG capabilities
 */
export function AgentChat({
  userId,
  initialAgentId,
  showAgentSelector = true,
  showMetrics = false,
  onAgentChange,
  onExecutionComplete,
  ...baseChatProps
}: AgentChatProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);

  const agent = useAgent({
    agentId: initialAgentId,
    userId,
    onAgentChange: (newAgent) => {
      onAgentChange?.(newAgent);
    }
  });

  const handleSendMessage = async (message: string) => {
    if (!agent.currentAgent || !agent.agentManager) {
      console.error('No agent selected');
      return;
    }

    setIsExecuting(true);

    // Add user message
    const userMessage: ConversationMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: message,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const result = await agent.executeAgent(message, {
        context: {
          previousMessages: messages.slice(-5).map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        }
      });

      // Add AI response
      const aiMessage: ConversationMessage = {
        id: `msg_${Date.now()}_ai`,
        role: 'assistant',
        content: result.response.response,
        timestamp: new Date(),
        metadata: {
          model: result.response.model,
          responseId: result.response.id,
          agentId: result.agentConfig.id,
          agentName: result.agentConfig.name,
          ragUsed: result.ragResults !== null,
          ragSources: result.ragResults?.sources || [],
          executionTime: result.executionTime
        }
      };

      setMessages(prev => [...prev, aiMessage]);
      onExecutionComplete?.(result);

    } catch (error) {
      console.error('Agent execution failed:', error);

      // Add error message
      const errorMessage: ConversationMessage = {
        id: `msg_${Date.now()}_error`,
        role: 'assistant',
        content: `Sorry, I encountered an error while processing your request: ${(error as Error).message}`,
        timestamp: new Date(),
        metadata: {
          error: true,
          agentId: agent.currentAgent?.id
        }
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleClearHistory = async () => {
    setMessages([]);
  };

  const renderMessageActions = (message: ConversationMessage) => {
    if (message.role !== 'assistant' || !message.metadata) {
      return null;
    }

    const { ragUsed, ragSources, executionTime, agentName } = message.metadata;

    return (
      <div className="mt-2 space-y-2">
        {/* Agent Info */}
        {agentName && (
          <Badge variant="outline" className="text-xs">
            <Bot className="w-3 h-3 mr-1" />
            {agentName}
          </Badge>
        )}

        {/* RAG Info */}
        {ragUsed && (
          <div className="space-y-1">
            <Badge variant="secondary" className="text-xs">
              <Database className="w-3 h-3 mr-1" />
              Enhanced with Knowledge Base
            </Badge>
            {ragSources && ragSources.length > 0 && (
              <p className="text-xs text-slate-500">
                Sources: {ragSources.join(', ')}
              </p>
            )}
          </div>
        )}

        {/* Execution Time */}
        {executionTime && (
          <Badge variant="outline" className="text-xs">
            <Clock className="w-3 h-3 mr-1" />
            {executionTime}ms
          </Badge>
        )}
      </div>
    );
  };

  const renderHeader = () => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Bot className="w-5 h-5 text-blue-600" />
        <span className="font-semibold text-slate-800">AI Agent Chat</span>
        {agent.currentAgent && (
          <Badge variant="secondary">
            {agent.currentAgent.name}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        {showMetrics && agent.lastResult && (
          <div className="flex items-center gap-1 text-xs text-slate-600">
            <TrendingUp className="w-3 h-3" />
            {agent.lastResult.executionTime}ms
          </div>
        )}

        {showAgentSelector && (
          <Select
            value={agent.currentAgent?.id || ''}
            onValueChange={(value) => agent.switchAgent(value)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select agent..." />
            </SelectTrigger>
            <SelectContent>
              {agent.availableAgents.map((agentConfig) => (
                <SelectItem key={agentConfig.id} value={agentConfig.id}>
                  <div className="flex items-center gap-2">
                    <span>{agentConfig.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {agentConfig.category}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleClearHistory}
          className="flex items-center gap-1"
        >
          Clear
        </Button>
      </div>
    </div>
  );

  const renderFooter = () => {
    if (!agent.error && !agent.isLoading && !isExecuting) return null;

    return (
      <Card className="m-4 p-3">
        {agent.error && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-red-800">
              <Settings className="w-4 h-4" />
              <span className="text-sm">
                Error: {agent.error.message}
              </span>
            </div>
          </div>
        )}

        {(agent.isLoading || isExecuting) && (
          <div className="flex items-center gap-2 text-blue-800">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">
              {isExecuting ? 'Agent is thinking...' : 'Initializing agent...'}
            </span>
          </div>
        )}
      </Card>
    );
  };

  const getPlaceholder = () => {
    if (!agent.currentAgent) {
      return 'Select an agent to start chatting...';
    }

    const placeholders: Record<string, string> = {
      'raw-materials-specialist': 'Ask about cosmetic ingredients, suppliers, or material properties...',
      'formulation-advisor': 'Request formulation advice or recipe optimization...',
      'regulatory-expert': 'Inquire about regulations, compliance, or safety requirements...',
      'market-analyst': 'Ask about market trends, consumer insights, or competitive analysis...',
      'creative-developer': 'Brainstorm product concepts or creative ideas...',
      'technical-support': 'Get help with technical issues or troubleshooting...',
      'general-assistant': 'How can I help you today?'
    };

    return placeholders[agent.currentAgent.id] || 'How can I help you today?';
  };

  return (
    <BaseChat
      userId={userId}
      messages={messages}
      onSendMessage={handleSendMessage}
      onClearHistory={handleClearHistory}
      isLoading={isExecuting}
      header={renderHeader()}
      footer={renderFooter()}
      messageActions={renderMessageActions}
      placeholder={getPlaceholder()}
      showTimestamp={true}
      className="border border-slate-200 rounded-lg shadow-sm"
      {...baseChatProps}
    />
  );
}

export default AgentChat;