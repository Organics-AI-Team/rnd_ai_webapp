'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AIChat,
  RawMaterialsChat,
  useAIService,
  getAIServiceFactory,
  OpenAIService,
  GeminiService
} from '../index';

/**
 * Example component demonstrating the refactored AI module
 * Shows different use cases and configurations
 */
export function AIDemo() {
  const [activeProvider, setActiveProvider] = useState<'openai' | 'gemini'>('openai');

  const aiService = useAIService({
    defaultProvider: activeProvider,
    apiKey: activeProvider === 'openai'
      ? process.env.NEXT_PUBLIC_OPENAI_API_KEY
      : process.env.NEXT_PUBLIC_GEMINI_API_KEY,
    onServiceChange: (service) => {
      console.log('Service changed to:', service?.constructor.name);
    },
    onError: (error) => {
      console.error('AI Service error:', error);
    }
  });

  const userId = 'demo-user-123';

  const switchProvider = (provider: 'openai' | 'gemini') => {
    setActiveProvider(provider);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">
          AI Module Demo
        </h1>
        <p className="text-slate-600">
          Demonstrating the refactored AI components and services
        </p>
      </div>

      {/* Provider Selection */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="font-semibold text-slate-800">AI Provider</h3>
            <p className="text-sm text-slate-600">
              Current: {activeProvider === 'openai' ? 'OpenAI GPT-4' : 'Google Gemini 2.5 Flash'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={aiService.isHealthy ? 'default' : 'destructive'}>
              {aiService.isHealthy ? 'Healthy' : 'Error'}
            </Badge>

            <div className="flex gap-2">
              <Button
                variant={activeProvider === 'openai' ? 'default' : 'outline'}
                size="sm"
                onClick={() => switchProvider('openai')}
              >
                OpenAI
              </Button>
              <Button
                variant={activeProvider === 'gemini' ? 'default' : 'outline'}
                size="sm"
                onClick={() => switchProvider('gemini')}
              >
                Gemini
              </Button>
            </div>
          </div>
        </div>

        {aiService.error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-800">
              Error: {aiService.error.message}
            </p>
          </div>
        )}
      </Card>

      {/* Chat Examples */}
      <Tabs defaultValue="general-chat" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="general-chat">General Chat</TabsTrigger>
          <TabsTrigger value="raw-materials">Raw Materials</TabsTrigger>
          <TabsTrigger value="service-api">Service API</TabsTrigger>
        </TabsList>

        {/* General Chat Tab */}
        <TabsContent value="general-chat" className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold text-slate-800 mb-4">General AI Chat</h3>
            <AIChat
              userId={userId}
              apiKey={activeProvider === 'openai'
                ? process.env.NEXT_PUBLIC_OPENAI_API_KEY
                : process.env.NEXT_PUBLIC_GEMINI_API_KEY}
              provider={activeProvider}
              enableFeedback={true}
              showServiceStatus={true}
              className="h-96"
              onError={(error) => console.error('Chat error:', error)}
              onFeedbackSubmit={(feedback) => {
                console.log('Feedback submitted:', feedback);
              }}
            />
          </Card>
        </TabsContent>

        {/* Raw Materials Tab */}
        <TabsContent value="raw-materials" className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold text-slate-800 mb-4">
              Raw Materials Assistant (with RAG)
            </h3>
            <RawMaterialsChat
              userId={userId}
              apiKey={process.env.NEXT_PUBLIC_GEMINI_API_KEY}
              provider="gemini"
              enableRAG={true}
              ragConfig={{
                topK: 5,
                similarityThreshold: 0.7
              }}
              className="h-96"
              onError={(error) => console.error('Raw materials chat error:', error)}
            />
          </Card>
        </TabsContent>

        {/* Service API Tab */}
        <TabsContent value="service-api" className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold text-slate-800 mb-4">Service API Examples</h3>

            <div className="space-y-4">
              {/* Factory Example */}
              <div className="p-4 bg-slate-50 rounded-lg">
                <h4 className="font-medium text-slate-700 mb-2">Service Factory</h4>
                <p className="text-sm text-slate-600 mb-3">
                  Creating and managing AI services through the factory pattern
                </p>
                <div className="text-xs bg-slate-800 text-slate-200 p-3 rounded-md font-mono">
                  {`const factory = getAIServiceFactory();
const service = factory.createService('${activeProvider}', apiKey);
const response = await service.generateResponse({
  prompt: 'Hello, world!',
  userId: '${userId}'
});`}
                </div>
              </div>

              {/* Service Status */}
              <div className="p-4 bg-blue-50 rounded-lg">
                <h4 className="font-medium text-blue-700 mb-2">Service Status</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Provider:</span>
                    <Badge variant="outline">{activeProvider}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <Badge variant={aiService.isHealthy ? 'default' : 'destructive'}>
                      {aiService.isHealthy ? 'Connected' : 'Error'}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Loading:</span>
                    <Badge variant={aiService.isLoading ? 'default' : 'secondary'}>
                      {aiService.isLoading ? 'Loading...' : 'Ready'}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Available Services:</span>
                    <span>{aiService.availableServices.length}</span>
                  </div>
                </div>
              </div>

              {/* Test Service Button */}
              <div className="flex gap-2">
                <Button
                  onClick={() => aiService.checkHealth()}
                  disabled={aiService.isLoading}
                  variant="outline"
                >
                  Check Service Health
                </Button>

                <Button
                  onClick={async () => {
                    if (aiService.service) {
                      try {
                        const response = await aiService.service.generateResponse({
                          prompt: 'What is 2 + 2?',
                          userId: userId
                        });
                        alert(`Response: ${response.response}`);
                      } catch (error) {
                        alert(`Error: ${(error as Error).message}`);
                      }
                    }
                  }}
                  disabled={!aiService.service || aiService.isLoading}
                >
                  Test Service
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Feature Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <h4 className="font-semibold text-slate-800 mb-2">🔧 Modular Architecture</h4>
          <p className="text-sm text-slate-600">
            Organized into services, components, hooks, and utilities for better maintainability
          </p>
        </Card>

        <Card className="p-4">
          <h4 className="font-semibold text-slate-800 mb-2">🔄 Shared Services</h4>
          <p className="text-sm text-slate-600">
            Common feedback analysis, response processing, and state management across all AI providers
          </p>
        </Card>

        <Card className="p-4">
          <h4 className="font-semibold text-slate-800 mb-2">🎯 Easy Integration</h4>
          <p className="text-sm text-slate-600">
            Simple hooks and components that make it easy to add AI functionality to any part of your app
          </p>
        </Card>
      </div>
    </div>
  );
}

export default AIDemo;