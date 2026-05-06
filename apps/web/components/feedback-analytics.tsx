'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Star, MessageSquare, Users, Brain } from 'lucide-react';

interface FeedbackAnalyticsProps {
  data: {
    totalFeedback: number;
    averageScore: number;
    feedbackByType: Array<{ type: string; count: number; percentage: number }>;
    scoreTrend: Array<{ date: string; score: number; count: number }>;
    userEngagement: Array<{ userId: string; feedbackCount: number; averageScore: number }>;
    modelPerformance: Array<{ model: string; averageScore: number; totalResponses: number }>;
    responseLengthAnalysis: Array<{ category: string; averageLength: number; averageScore: number }>;
    improvements: Array<{
      area: string;
      suggestion: string;
      priority: 'high' | 'medium' | 'low';
      impact: number;
    }>;
  };
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

export function FeedbackAnalytics({ data }: FeedbackAnalyticsProps) {
  const [selectedTab, setSelectedTab] = useState('overview');

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 4.5) return 'text-green-600';
    if (score >= 3.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Feedback</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totalFeedback.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              All-time responses
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Score</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getScoreColor(data.averageScore)}`}>
              {data.averageScore.toFixed(2)}
            </div>
            <div className="flex items-center space-x-1">
              {data.scoreTrend.length > 1 && (
                <>
                  {data.scoreTrend[data.scoreTrend.length - 1].score > data.scoreTrend[data.scoreTrend.length - 2].score ? (
                    <TrendingUp className="h-3 w-3 text-green-500" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-red-500" />
                  )}
                  <p className="text-xs text-muted-foreground">
                    vs last period
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.userEngagement.length}</div>
            <p className="text-xs text-muted-foreground">
              Providing feedback
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI Models</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.modelPerformance.length}</div>
            <p className="text-xs text-muted-foreground">
              Active models
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="feedback-types">Feedback Types</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="improvements">Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Score Trend */}
            <Card>
              <CardHeader>
                <CardTitle>Score Trend</CardTitle>
                <CardDescription>
                  Average response scores over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={data.scoreTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis domain={[0, 5]} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#8884d8"
                      strokeWidth={2}
                      dot={{ fill: '#8884d8' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Feedback Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Feedback Distribution</CardTitle>
                <CardDescription>
                  Types of feedback received
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={data.feedbackByType}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ type, percentage }) => `${type} ${(percentage as number).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="count"
                    >
                      {data.feedbackByType.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Response Length Analysis */}
          <Card>
            <CardHeader>
              <CardTitle>Response Length vs. Satisfaction</CardTitle>
              <CardDescription>
                How response length affects user satisfaction
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.responseLengthAnalysis}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" />
                  <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                  <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                  <Tooltip />
                  <Bar yAxisId="left" dataKey="averageLength" fill="#8884d8" name="Avg Length" />
                  <Bar yAxisId="right" dataKey="averageScore" fill="#82ca9d" name="Avg Score" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback-types" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Detailed Feedback Breakdown</CardTitle>
              <CardDescription>
                Analysis of all feedback types received
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.feedbackByType.map((feedback, index) => (
                  <div key={feedback.type} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="font-medium capitalize">{feedback.type.replace('_', ' ')}</span>
                    </div>
                    <div className="flex items-center space-x-4">
                      <span className="text-sm text-muted-foreground">{feedback.count} responses</span>
                      <Progress value={feedback.percentage} className="w-20" />
                      <span className="text-sm font-medium">{feedback.percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          {/* Model Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Model Performance</CardTitle>
              <CardDescription>
                How different AI models are performing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.modelPerformance.map((model) => (
                  <div key={model.model} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">{model.model}</h4>
                      <Badge className={getScoreColor(model.averageScore)}>
                        {model.averageScore.toFixed(2)} ⭐
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>{model.totalResponses.toLocaleString()} responses</span>
                      <Progress value={(model.averageScore / 5) * 100} className="w-32" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Users */}
          <Card>
            <CardHeader>
              <CardTitle>Top Feedback Contributors</CardTitle>
              <CardDescription>
                Users providing the most valuable feedback
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.userEngagement.slice(0, 10).map((user) => (
                  <div key={user.userId} className="flex items-center justify-between p-3 border rounded">
                    <div>
                      <p className="font-medium">User {user.userId.slice(-8)}</p>
                      <p className="text-sm text-muted-foreground">{user.feedbackCount} feedback items</p>
                    </div>
                    <Badge className={getScoreColor(user.averageScore)}>
                      {user.averageScore.toFixed(1)} avg
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="improvements" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI Learning Insights</CardTitle>
              <CardDescription>
                Recommendations for improving AI responses based on feedback patterns
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.improvements.map((improvement, index) => (
                  <div key={index} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">{improvement.area}</h4>
                      <Badge className={getPriorityColor(improvement.priority)}>
                        {improvement.priority} priority
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{improvement.suggestion}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Potential impact: {improvement.impact}% improvement
                      </span>
                      <Progress value={improvement.impact} className="w-24" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}