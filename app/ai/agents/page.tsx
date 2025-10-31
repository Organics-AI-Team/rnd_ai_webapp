'use client';

import React, { useState } from 'react';
import { AgentChat } from '@/ai/components/chat/agent-chat';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Bot,
  Package,
  Scale,
  BookOpen,
  TrendingUp,
  Lightbulb,
  Wrench,
  MessageSquare,
  Database,
  Clock,
  Star,
  Users,
  ArrowRight
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getEnabledAgentConfigs, getAgentConfigsByCategory } from '@/ai/agents/configs/agent-configs';
import { getActiveRAGIndices } from '@/ai/rag/indices/index-config';

export default function AIAgentsHubPage() {
  const { user } = useAuth();
  const [selectedAgent, setSelectedAgent] = useState('raw-materials-specialist');
  const [showComparison, setShowComparison] = useState(false);

  const availableAgents = getEnabledAgentConfigs();
  const activeRAGIndices = getActiveRAGIndices();

  const agentsByCategory = {
    'raw-materials': getAgentConfigsByCategory('raw-materials'),
    analytics: getAgentConfigsByCategory('analytics'),
    creative: getAgentConfigsByCategory('creative'),
    technical: getAgentConfigsByCategory('technical'),
    general: getAgentConfigsByCategory('general')
  };

  const agentIcons: Record<string, React.ReactNode> = {
    'raw-materials-specialist': <Package className="w-5 h-5" />,
    'formulation-advisor': <Scale className="w-5 h-5" />,
    'regulatory-expert': <BookOpen className="w-5 h-5" />,
    'market-analyst': <TrendingUp className="w-5 h-5" />,
    'creative-developer': <Lightbulb className="w-5 h-5" />,
    'technical-support': <Wrench className="w-5 h-5" />,
    'general-assistant': <MessageSquare className="w-5 h-5" />
  };

  const getCategoryIcon = (category: string) => {
    const icons: Record<string, React.ReactNode> = {
      'raw-materials': <Package className="w-4 h-4" />,
      'analytics': <TrendingUp className="w-4 h-4" />,
      'creative': <Lightbulb className="w-4 h-4" />,
      'technical': <Wrench className="w-4 h-4" />,
      'general': <MessageSquare className="w-4 h-4" />
    };
    return icons[category] || <Bot className="w-4 h-4" />;
  };

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <Bot className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h2 className="text-xl font-semibold mb-2">กรุณาเข้าสู่ระบบเพื่อใช้ AI Agents Hub</h2>
          <p className="text-gray-600">คุณต้องได้รับการยืนยันตัวตนเพื่อเข้าถึงศูนย์รวม AI Agents ที่มีความเชี่ยวชาญเฉพาะด้าน</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto">
      <Card className="flex flex-col min-h-[600px]">
        <CardHeader className="pb-4 border-b">
          <div className="flex items-center space-x-2 mb-2">
            <Bot className="w-6 h-6 text-blue-500" />
            <h1 className="text-2xl font-bold">AI Agents Hub</h1>
          </div>
          <p className="text-gray-600">
            ศูนย์รวม AI Agents ที่มีความเชี่ยวชาญเฉพาะด้านสำหรับงานต่างๆ พร้อมระบบค้นหาจากฐานข้อมูล (RAG)
          </p>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <Tabs defaultValue="chat" className="h-full flex flex-col">
            <div className="px-6 pt-2">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="chat">Agent Chat</TabsTrigger>
                <TabsTrigger value="explore">Explore Agents</TabsTrigger>
                <TabsTrigger value="compare">Compare</TabsTrigger>
              </TabsList>
            </div>

        <TabsContent value="chat" className="flex-1 mt-0">
          <div className="h-full p-6">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-full">
              {/* System Overview */}
              <div className="lg:col-span-1 space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-600">Active Agents</p>
                          <p className="text-2xl font-bold">{availableAgents.length}</p>
                        </div>
                        <Bot className="w-8 h-8 text-blue-500" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-600">Knowledge Bases</p>
                          <p className="text-2xl font-bold">{activeRAGIndices.length}</p>
                        </div>
                        <Database className="w-8 h-8 text-green-500" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-600">Categories</p>
                          <p className="text-2xl font-bold">{Object.keys(agentsByCategory).length}</p>
                        </div>
                        <Users className="w-8 h-8 text-purple-500" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-600">Avg Rating</p>
                          <p className="text-2xl font-bold">4.2/5</p>
                        </div>
                        <Star className="w-8 h-8 text-yellow-500" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Agent Selection */}
                <Card className="flex-1">
                  <CardHeader>
                    <CardTitle className="text-lg">Select Agent</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 max-h-80 overflow-y-auto">
                    {availableAgents.map((agent) => (
                      <div
                        key={agent.id}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                          selectedAgent === agent.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => setSelectedAgent(agent.id)}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          {agentIcons[agent.id] || <Bot className="w-4 h-4" />}
                          <span className="font-medium text-sm">{agent.name}</span>
                        </div>
                        <p className="text-xs text-gray-600 mb-2">{agent.description}</p>
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-xs">
                            {agent.category}
                          </Badge>
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Database className="w-3 h-3" />
                            {agent.ragIndexIds.length}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {/* Chat Area */}
              <Card className="lg:col-span-3 flex flex-col">
                <CardHeader className="pb-4 border-b">
                  <CardTitle className="flex items-center gap-2">
                    {agentIcons[selectedAgent] || <Bot className="w-5 h-5" />}
                    {availableAgents.find(a => a.id === selectedAgent)?.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                  <AgentChat
                    userId={user.id}
                    initialAgentId={selectedAgent}
                    showAgentSelector={false}
                    showMetrics={true}
                    onAgentChange={(agent) => setSelectedAgent(agent.id)}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="explore" className="flex-1 mt-0">
          <div className="h-full p-6 overflow-y-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {Object.entries(agentsByCategory).map(([category, agents]) => (
                <Card key={category}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {getCategoryIcon(category)}
                      <span className="capitalize">{category.replace('-', ' ')}</span>
                      <Badge variant="outline">{agents.length} agents</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {agents.map((agent) => (
                        <div key={agent.id} className="p-4 border rounded-lg">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {agentIcons[agent.id] || <Bot className="w-4 h-4" />}
                              <h3 className="font-medium">{agent.name}</h3>
                            </div>
                            <Badge variant="secondary" className="text-xs">
                              {agent.provider}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-600 mb-3">{agent.description}</p>

                          <div className="space-y-2">
                            <div className="text-xs font-medium text-gray-700">Capabilities:</div>
                            <div className="flex flex-wrap gap-1">
                              {agent.capabilities.slice(0, 4).map((capability) => (
                                <Badge key={capability} variant="outline" className="text-xs">
                                  {capability.replace('-', ' ')}
                                </Badge>
                              ))}
                              {agent.capabilities.length > 4 && (
                                <Badge variant="outline" className="text-xs">
                                  +{agent.capabilities.length - 4}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs text-gray-500">
                            <div className="flex items-center gap-2">
                              <Database className="w-3 h-3" />
                              {agent.ragIndexIds.length} knowledge bases
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedAgent(agent.id);
                                // Switch to chat tab
                              }}
                            >
                              Try Agent
                              <ArrowRight className="w-3 h-3 ml-1" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="compare" className="flex-1 mt-0">
          <div className="h-full p-6">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Agent Comparison</CardTitle>
              </CardHeader>
              <CardContent className="h-full overflow-y-auto">
                <div className="text-center py-8">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="p-6 border rounded-lg">
                      <Package className="w-12 h-12 mx-auto mb-4 text-blue-500" />
                      <h3 className="font-medium mb-2">Raw Materials Expert</h3>
                      <p className="text-sm text-gray-600 mb-4">
                        Best for: Ingredient research, supplier information, safety data
                      </p>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span>Knowledge Bases:</span>
                          <span className="font-medium">3</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Response Time:</span>
                          <span className="font-medium">1.2s</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Accuracy:</span>
                          <span className="font-medium">95%</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-6 border rounded-lg">
                      <Scale className="w-12 h-12 mx-auto mb-4 text-green-500" />
                      <h3 className="font-medium mb-2">Formulation Advisor</h3>
                      <p className="text-sm text-gray-600 mb-4">
                        Best for: Recipe development, optimization, compatibility checks
                      </p>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span>Knowledge Bases:</span>
                          <span className="font-medium">4</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Response Time:</span>
                          <span className="font-medium">1.5s</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Accuracy:</span>
                          <span className="font-medium">92%</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-6 border rounded-lg">
                      <BookOpen className="w-12 h-12 mx-auto mb-4 text-purple-500" />
                      <h3 className="font-medium mb-2">Regulatory Expert</h3>
                      <p className="text-sm text-gray-600 mb-4">
                        Best for: Compliance, regulations, safety assessments
                      </p>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span>Knowledge Bases:</span>
                          <span className="font-medium">3</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Response Time:</span>
                          <span className="font-medium">1.1s</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Accuracy:</span>
                          <span className="font-medium">98%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <p className="text-gray-600">
                    Compare different AI agents to find the best one for your specific needs
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}