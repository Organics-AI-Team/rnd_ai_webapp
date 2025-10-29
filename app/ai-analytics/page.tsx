'use client';

import React, { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { FeedbackAnalytics } from '@/components/feedback-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { BarChart3, TrendingUp, RefreshCw, Download } from 'lucide-react';

export default function AIAnalyticsPage() {
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d' | '90d' | 'all'>('30d');
  const [model, setModel] = useState<string>('');

  const { data: analytics, isLoading, refetch } = trpc.feedback.getAnalytics.useQuery(
    { timeRange, model: model || undefined },
    {
      refetchInterval: 30000, // Refresh every 30 seconds
    }
  );

  const handleRefresh = () => {
    refetch();
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center space-x-2">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
            <span>Loading analytics...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="p-8 text-center">
            <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-medium mb-2">No Analytics Data Available</h3>
            <p className="text-gray-500">Start collecting feedback by using the AI chat feature.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center space-x-2 mb-2">
            <BarChart3 className="w-6 h-6 text-blue-500" />
            <h1 className="text-2xl font-bold">AI Performance Analytics</h1>
          </div>
          <p className="text-gray-600">
            Monitor AI performance, user satisfaction, and feedback patterns.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Time Range</label>
              <Select value={timeRange} onValueChange={(value: any) => setTimeRange(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24 Hours</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="90d">Last 90 Days</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">AI Model</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue placeholder="All models" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Models</SelectItem>
                  {analytics.modelPerformance.map((model) => (
                    <SelectItem key={model.model} value={model.model}>
                      {model.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Satisfaction</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {analytics.averageScore.toFixed(2)}/5.0
            </div>
            <p className="text-xs text-muted-foreground">
              {analytics.totalFeedback.toLocaleString()} total feedback
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Response Quality</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.averageScore >= 4 ? 'Excellent' :
               analytics.averageScore >= 3 ? 'Good' :
               analytics.averageScore >= 2 ? 'Fair' : 'Poor'}
            </div>
            <p className="text-xs text-muted-foreground">
              Based on user ratings
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.userEngagement.length}
            </div>
            <p className="text-xs text-muted-foreground">
              Providing feedback
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI Models</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.modelPerformance.length}
            </div>
            <p className="text-xs text-muted-foreground">
              Active models
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Analytics Component */}
      <FeedbackAnalytics data={{
        ...analytics,
        averageScore: analytics.averageScore || 0
      }} />

      {/* Additional Insights */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Top Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analytics.improvements.slice(0, 3).map((improvement, index) => (
                <div key={index} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-medium text-sm">{improvement.area}</h4>
                    <span className={`text-xs px-2 py-1 rounded ${
                      improvement.priority === 'high' ? 'bg-red-100 text-red-700' :
                      improvement.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {improvement.priority}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{improvement.suggestion}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Feedback Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analytics.scoreTrend.slice(-5).reverse().map((trend, index) => (
                <div key={index} className="flex items-center justify-between">
                  <span className="text-sm">{trend.date}</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">{trend.score.toFixed(2)}</span>
                    <span className="text-xs text-gray-500">({trend.count} feedback)</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}