'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line
} from 'recharts';
import {
  TrendingUp,
  Users,
  MessageSquare,
  ThumbsUp,
  Bot,
  Database,
  Clock,
  Activity,
  Filter
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

// Mock data - in real app, this would come from your API
const mockUsageData = [
  { date: '2024-01-01', conversations: 45, users: 12, satisfaction: 4.2 },
  { date: '2024-01-02', conversations: 52, users: 15, satisfaction: 4.1 },
  { date: '2024-01-03', conversations: 38, users: 10, satisfaction: 4.3 },
  { date: '2024-01-04', conversations: 61, users: 18, satisfaction: 4.4 },
  { date: '2024-01-05', conversations: 55, users: 16, satisfaction: 4.2 },
  { date: '2024-01-06', conversations: 48, users: 14, satisfaction: 4.0 },
  { date: '2024-01-07', conversations: 72, users: 20, satisfaction: 4.5 },
];

const mockAgentUsage = [
  { name: 'Raw Materials Specialist', conversations: 245, satisfaction: 4.3, color: '#3b82f6' },
  { name: 'Formulation Advisor', conversations: 189, satisfaction: 4.1, color: '#10b981' },
  { name: 'Regulatory Expert', conversations: 156, satisfaction: 4.4, color: '#f59e0b' },
  { name: 'Market Analyst', conversations: 134, satisfaction: 4.2, color: '#8b5cf6' },
  { name: 'General Assistant', conversations: 298, satisfaction: 3.9, color: '#6b7280' },
];

const mockRAGUsage = [
  { index: 'Raw Materials DB', queries: 1247, avgResponseTime: 1.2, hitRate: 0.87 },
  { index: 'Formulations DB', queries: 892, avgResponseTime: 1.5, hitRate: 0.82 },
  { index: 'Regulations DB', queries: 456, avgResponseTime: 1.1, hitRate: 0.91 },
  { index: 'Market Research DB', queries: 678, avgResponseTime: 1.3, hitRate: 0.78 },
  { index: 'Research DB', queries: 234, avgResponseTime: 1.4, hitRate: 0.85 },
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#6b7280'];

export default function AIAnalyticsPage() {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [isLoading, setIsLoading] = useState(false);

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <Activity className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h2 className="text-xl font-semibold mb-2">กรุณาเข้าสู่ระบบเพื่อดูข้อมูลวิเคราะห์ AI</h2>
          <p className="text-gray-600">คุณต้องได้รับการยืนยันตัวตนเพื่อเข้าถึงข้อมูลการใช้งานระบบ AI</p>
        </div>
      </div>
    );
  }

  const refreshData = async () => {
    setIsLoading(true);
    // In real app, fetch fresh data from your API
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsLoading(false);
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 mb-2">
            <Activity className="w-6 h-6 text-blue-500" />
            <h1 className="text-2xl font-bold">AI Analytics Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {(['7d', '30d', '90d'] as const).map((range) => (
                <Button
                  key={range}
                  variant={timeRange === range ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTimeRange(range)}
                >
                  {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : '90 Days'}
                </Button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={refreshData} disabled={isLoading}>
              <Filter className="w-4 h-4 mr-1" />
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>
        <p className="text-gray-600">
          ข้อมูลการใช้งานระบบ AI และประสิทธิภาพของ AI agents
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <MessageSquare className="h-8 w-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Conversations</p>
                <p className="text-2xl font-bold">1,022</p>
                <p className="text-xs text-green-600">+12% from last period</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-green-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Active Users</p>
                <p className="text-2xl font-bold">89</p>
                <p className="text-xs text-green-600">+8% from last period</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <ThumbsUp className="h-8 w-8 text-yellow-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Avg Satisfaction</p>
                <p className="text-2xl font-bold">4.2/5</p>
                <p className="text-xs text-green-600">+0.1 from last period</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Clock className="h-8 w-8 text-purple-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Avg Response Time</p>
                <p className="text-2xl font-bold">1.3s</p>
                <p className="text-xs text-green-600">-0.2s from last period</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="rag">Knowledge Base</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Usage Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Usage Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={mockUsageData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="conversations" stroke="#3b82f6" strokeWidth={2} />
                    <Line type="monotone" dataKey="users" stroke="#10b981" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Satisfaction Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ThumbsUp className="w-5 h-5" />
                  User Satisfaction
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={mockUsageData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis domain={[3, 5]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="satisfaction" stroke="#f59e0b" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="agents" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                Agent Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {mockAgentUsage.map((agent) => (
                  <div key={agent.name} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: agent.color }} />
                      <div>
                        <h3 className="font-medium">{agent.name}</h3>
                        <p className="text-sm text-gray-600">{agent.conversations} conversations</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">{agent.satisfaction}/5.0</Badge>
                      <p className="text-xs text-gray-600 mt-1">Avg rating</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Agent Usage Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Agent Usage Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={mockAgentUsage}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="conversations"
                  >
                    {mockAgentUsage.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rag" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                RAG Knowledge Base Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {mockRAGUsage.map((index) => (
                  <div key={index.index} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h3 className="font-medium">{index.index}</h3>
                      <p className="text-sm text-gray-600">{index.queries} queries</p>
                    </div>
                    <div className="text-right space-y-1">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-gray-500" />
                        <span className="text-sm">{index.avgResponseTime}s</span>
                      </div>
                      <Badge variant={index.hitRate > 0.8 ? 'default' : 'secondary'}>
                        {Math.round(index.hitRate * 100)}% hit rate
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* RAG Usage Chart */}
          <Card>
            <CardHeader>
              <CardTitle>RAG Query Volume</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={mockRAGUsage}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="index" angle={-45} textAnchor="end" height={80} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="queries" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Feedback Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p className="text-gray-600">Feedback analytics coming soon</p>
                <p className="text-sm text-gray-500">Detailed feedback analysis and sentiment tracking</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}