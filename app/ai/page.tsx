'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Bot,
  MessageSquare,
  Package,
  BarChart,
  Users,
  ArrowRight,
  Database,
  Settings,
  Star,
  TrendingUp
} from 'lucide-react';

export default function AIHubPage() {
  const aiFeatures = [
    {
      title: 'Raw Materials AI',
      description: 'Specialized AI for ingredient research with access to comprehensive database',
      icon: <Package className="w-6 h-6" />,
      href: '/ai/raw-materials-ai',
      badge: 'RAG Enhanced',
      color: 'bg-green-500'
    },
    {
      title: 'Sales R&D AI',
      description: 'AI assistant for sales strategies, market intelligence, and business development',
      icon: <TrendingUp className="w-6 h-6" />,
      href: '/ai/sales-rnd-ai',
      badge: 'Market Intel',
      color: 'bg-purple-500'
    },
    {
      title: 'AI Agents Hub',
      description: 'Access specialized AI agents for different domains and expertise areas',
      icon: <Users className="w-6 h-6" />,
      href: '/ai/agents',
      badge: 'New',
      color: 'bg-blue-500'
    },
    {
      title: 'Analytics Dashboard',
      description: 'Monitor AI usage, performance metrics, and user satisfaction',
      icon: <BarChart className="w-6 h-6" />,
      href: '/ai/analytics',
      badge: 'Analytics',
      color: 'bg-orange-500'
    }
  ];

  const stats = [
    { label: 'Active AI Agents', value: '7', icon: <Bot className="w-5 h-5" /> },
    { label: 'Knowledge Bases', value: '8', icon: <Database className="w-5 h-5" /> },
    { label: 'Avg Response Time', value: '1.3s', icon: <TrendingUp className="w-5 h-5" /> },
    { label: 'User Satisfaction', value: '4.2/5', icon: <Star className="w-5 h-5" /> }
  ];

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center space-x-2 mb-4">
          <Bot className="w-8 h-8 text-blue-500" />
          <h1 className="text-3xl font-bold">AI Hub</h1>
        </div>
        <p className="text-lg text-gray-600 mb-6">
          ศูนย์รวมระบบ AI อัจฉริยะที่มีความเชี่ยวชาญเฉพาะด้าน พร้อมฐานข้อมูลความรู้ที่ครอบคลุม
        </p>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {stats.map((stat, index) => (
            <Card key={index}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                    <p className="text-2xl font-bold">{stat.value}</p>
                  </div>
                  <div className="text-blue-500">
                    {stat.icon}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Main Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {aiFeatures.map((feature, index) => (
          <Card key={index} className="group hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg text-white ${feature.color}`}>
                    {feature.icon}
                  </div>
                  <div>
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                  </div>
                </div>
                <Badge variant="secondary">{feature.badge}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">{feature.description}</p>
              <Link href={feature.href}>
                <Button className="w-full group-hover:bg-blue-600 transition-colors">
                  Try Now
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Information Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              AI System Features
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                <span className="text-sm">Multiple specialized AI agents</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                <span className="text-sm">RAG-enhanced knowledge retrieval</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-purple-500 rounded-full" />
                <span className="text-sm">Real-time performance monitoring</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-orange-500 rounded-full" />
                <span className="text-sm">User feedback and learning system</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-red-500 rounded-full" />
                <span className="text-sm">Multi-language support (Thai/English)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Knowledge Bases
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Raw Materials Database</span>
                <Badge variant="outline">Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Formulations Library</span>
                <Badge variant="outline">Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Regulatory Documents</span>
                <Badge variant="outline">Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Market Research Data</span>
                <Badge variant="outline">Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Scientific Papers</span>
                <Badge variant="outline">Active</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Start Guide */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Quick Start Guide</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-blue-600 font-bold">1</span>
              </div>
              <h3 className="font-medium mb-2">Choose Your AI</h3>
              <p className="text-sm text-gray-600">
                Select from general AI chat or specialized agents for specific domains
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-green-600 font-bold">2</span>
              </div>
              <h3 className="font-medium mb-2">Start Conversation</h3>
              <p className="text-sm text-gray-600">
                Begin chatting with AI that has access to relevant knowledge bases
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-purple-600 font-bold">3</span>
              </div>
              <h3 className="font-medium mb-2">Get Results</h3>
              <p className="text-sm text-gray-600">
                Receive accurate, context-aware responses with source information
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}