'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AgentChat } from '../components/chat/agent-chat';
import { useAgent } from '../hooks/use-agent';
import { getEnabledAgentConfigs, getAgentConfigsByCategory } from '../agents/configs/agent-configs';
import { getActiveRAGIndices } from '../rag/indices/index-config';

/**
 * Comprehensive demo of the AI Agent Management System
 * Shows different agents, their capabilities, and RAG integration
 */
export function AgentDemo() {
  const [selectedAgent, setSelectedAgent] = useState<string>('raw-materials-specialist');
  const [showMetrics, setShowMetrics] = useState(true);

  const availableAgents = getEnabledAgentConfigs();
  const activeRAGIndices = getActiveRAGIndices();

  const agentsByCategory = {
    general: getAgentConfigsByCategory('general'),
    'raw-materials': getAgentConfigsByCategory('raw-materials'),
    analytics: getAgentConfigsByCategory('analytics'),
    creative: getAgentConfigsByCategory('creative'),
    technical: getAgentConfigsByCategory('technical')
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">
          AI Agent Management System
        </h1>
        <p className="text-slate-600">
          Specialized AI agents with system prompts and RAG capabilities
        </p>
      </div>

      {/* System Overview */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold text-slate-800 mb-4">System Overview</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Agents Overview */}
          <div className="space-y-3">
            <h3 className="font-medium text-slate-700">AI Agents</h3>
            <div className="space-y-2">
              {Object.entries(agentsByCategory).map(([category, agents]) => (
                <div key={category} className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 capitalize">
                    {category.replace('-', ' ')}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {agents.length}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">Total Agents</span>
                <Badge variant="default">{availableAgents.length}</Badge>
              </div>
            </div>
          </div>

          {/* RAG Indices Overview */}
          <div className="space-y-3">
            <h3 className="font-medium text-slate-700">RAG Knowledge Bases</h3>
            <div className="space-y-2">
              {activeRAGIndices.slice(0, 5).map((index) => (
                <div key={index.id} className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 truncate">
                    {index.name}
                  </span>
                  <Badge
                    variant={index.status === 'active' ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {index.documentCount || 0} docs
                  </Badge>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">Active Indices</span>
                <Badge variant="default">{activeRAGIndices.length}</Badge>
              </div>
            </div>
          </div>

          {/* System Status */}
          <div className="space-y-3">
            <h3 className="font-medium text-slate-700">System Status</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Agent System</span>
                <Badge variant="default" className="text-xs">Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">RAG Services</span>
                <Badge variant="default" className="text-xs">Connected</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">AI Services</span>
                <Badge variant="default" className="text-xs">Ready</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Knowledge Bases</span>
                <Badge variant="default" className="text-xs">{activeRAGIndices.filter(i => i.status === 'active').length} Active</Badge>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Agent Details */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold text-slate-800 mb-4">Agent Capabilities</h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {availableAgents.map((agent) => (
            <div
              key={agent.id}
              className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                selectedAgent === agent.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
              onClick={() => setSelectedAgent(agent.id)}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-slate-800">{agent.name}</h3>
                  <Badge variant="outline" className="text-xs">
                    {agent.category}
                  </Badge>
                </div>

                <p className="text-sm text-slate-600">{agent.description}</p>

                <div className="space-y-1">
                  <div className="text-xs font-medium text-slate-700">Capabilities:</div>
                  <div className="flex flex-wrap gap-1">
                    {agent.capabilities.slice(0, 4).map((capability) => (
                      <Badge key={capability} variant="secondary" className="text-xs">
                        {capability.replace('-', ' ')}
                      </Badge>
                    ))}
                    {agent.capabilities.length > 4 && (
                      <Badge variant="secondary" className="text-xs">
                        +{agent.capabilities.length - 4} more
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Provider: {agent.provider}</span>
                  <span>RAG: {agent.ragIndexIds.length} indices</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Interactive Demo */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-800">Interactive Agent Demo</h2>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Show Metrics:</label>
            <input
              type="checkbox"
              checked={showMetrics}
              onChange={(e) => setShowMetrics(e.target.checked)}
              className="rounded"
            />
          </div>
        </div>

        <Tabs defaultValue="chat" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="chat">Agent Chat</TabsTrigger>
            <TabsTrigger value="comparison">Agent Comparison</TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="space-y-4">
            <AgentChat
              userId="demo-user-123"
              initialAgentId={selectedAgent}
              showAgentSelector={true}
              showMetrics={showMetrics}
              onAgentChange={(agent) => console.log('Agent changed to:', agent)}
              onExecutionComplete={(result) => {
                console.log('Agent execution result:', result);
              }}
              className="h-96"
            />
          </TabsContent>

          <TabsContent value="comparison" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Raw Materials Specialist */}
              <div className="space-y-3">
                <h3 className="font-medium text-slate-800">Raw Materials Specialist</h3>
                <div className="p-3 bg-slate-50 rounded-lg text-sm">
                  <p className="font-medium mb-2">Example Query: "What are good natural moisturizers?"</p>
                  <p className="text-slate-600">
                    Will search the raw materials database and provide specific ingredient recommendations
                    with supplier information, safety data, and cost considerations.
                  </p>
                </div>
              </div>

              {/* Formulation Advisor */}
              <div className="space-y-3">
                <h3 className="font-medium text-slate-800">Formulation Advisor</h3>
                <div className="p-3 bg-slate-50 rounded-lg text-sm">
                  <p className="font-medium mb-2">Example Query: "Help me create a face cream"</p>
                  <p className="text-slate-600">
                    Will access formulation database and provide step-by-step recipe development
                    with ingredient percentages, compatibility checks, and stability considerations.
                  </p>
                </div>
              </div>

              {/* Regulatory Expert */}
              <div className="space-y-3">
                <h3 className="font-medium text-slate-800">Regulatory Expert</h3>
                <div className="p-3 bg-slate-50 rounded-lg text-sm">
                  <p className="font-medium mb-2">Example Query: "Is this ingredient EU compliant?"</p>
                  <p className="text-slate-600">
                    Will search regulatory database and provide compliance information,
                    restrictions, labeling requirements, and safety assessment guidelines.
                  </p>
                </div>
              </div>

              {/* Market Analyst */}
              <div className="space-y-3">
                <h3 className="font-medium text-slate-800">Market Analyst</h3>
                <div className="p-3 bg-slate-50 rounded-lg text-sm">
                  <p className="font-medium mb-2">Example Query: "What are current skincare trends?"</p>
                  <p className="text-slate-600">
                    Will analyze market research data and provide trend insights,
                    consumer preferences, and competitive landscape analysis.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-medium text-blue-800 mb-2">Key Differentiators</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Each agent has specialized knowledge bases via RAG</li>
                <li>• System prompts define expertise and behavior</li>
                <li>• Automatic agent switching based on conversation context</li>
                <li>• Performance metrics and learning from user feedback</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      </Card>

      {/* RAG System Info */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold text-slate-800 mb-4">RAG Knowledge Bases</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeRAGIndices.map((index) => (
            <div key={index.id} className="p-4 border border-slate-200 rounded-lg">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-slate-800 text-sm">{index.name}</h3>
                  <Badge
                    variant={index.status === 'active' ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {index.status}
                  </Badge>
                </div>

                <p className="text-xs text-slate-600">{index.description}</p>

                <div className="space-y-1 text-xs text-slate-500">
                  <div className="flex justify-between">
                    <span>Documents:</span>
                    <span>{index.documentCount || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Similarity:</span>
                    <span>{index.similarityThreshold}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Top K:</span>
                    <span>{index.topK}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Category:</span>
                    <span className="capitalize">{index.category.replace('-', ' ')}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default AgentDemo;