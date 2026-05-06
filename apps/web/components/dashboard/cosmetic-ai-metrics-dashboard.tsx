/**
 * Cosmetic AI Metrics Dashboard
 * Real-time monitoring of AI optimization performance and quality metrics
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Clock,
  Database,
  Shield,
  Target,
  Activity,
  BarChart3,
  PieChart,
  RefreshCw
} from 'lucide-react';

// Metric interfaces
interface DashboardMetrics {
  overall: OverallMetrics;
  performance: PerformanceMetrics;
  quality: QualityMetrics;
  sources: SourceMetrics;
  compliance: ComplianceMetrics;
  trends: TrendMetrics;
}

interface OverallMetrics {
  totalQueries: number;
  averageQualityScore: number;
  averageResponseTime: number;
  successRate: number;
  userSatisfaction: number;
  activeOptimizations: number;
}

interface PerformanceMetrics {
  knowledgeRetrievalTime: number;
  qualityScoringTime: number;
  regulatoryCheckTime: number;
  totalProcessingTime: number;
  cacheHitRate: number;
  systemUptime: number;
  errorRate: number;
}

interface QualityMetrics {
  factualAccuracy: number;
  safetyCompliance: number;
  regulatoryCompliance: number;
  formulationAccuracy: number;
  completeness: number;
  clarity: number;
  sourceQuality: number;
  riskAssessment: number;
}

interface SourceMetrics {
  totalSources: number;
  highQualitySources: number;
  riskSources: number;
  averageCredibility: number;
  topSources: SourcePerformance[];
  sourceDistribution: SourceDistribution[];
}

interface SourcePerformance {
  id: string;
  name: string;
  usageCount: number;
  averageCredibility: number;
  lastUsed: Date;
}

interface SourceDistribution {
  type: string;
  count: number;
  percentage: number;
  averageQuality: number;
}

interface ComplianceMetrics {
  overallComplianceRate: number;
  fdaCompliance: number;
  euCompliance: number;
  aseanCompliance: number;
  criticalViolations: number;
  pendingReviews: number;
}

interface TrendMetrics {
  qualityTrend: number[];
  responseTimeTrend: number[];
  usageTrend: number[];
  complianceTrend: number[];
  timeframe: string;
}

interface AlertItem {
  id: string;
  type: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Cosmetic AI Metrics Dashboard Component
 */
export function CosmeticAIMetricsDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState('24h');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Fetch metrics on component mount and interval refresh
  useEffect(() => {
    fetchMetrics();

    const interval = setInterval(fetchMetrics, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [selectedTimeframe]);

  const fetchMetrics = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch(`/api/ai/cosmetic-enhanced?action=metrics&timeframe=${selectedTimeframe}`);

      if (!response.ok) {
        throw new Error('Failed to fetch metrics');
      }

      const data = await response.json();
      setMetrics(data);
      setLastRefresh(new Date());

      // Process alerts from metrics
      const processedAlerts = processAlerts(data);
      setAlerts(processedAlerts);

    } catch (error) {
      console.error('Failed to fetch metrics:', error);
      // Set error alert
      setAlerts([{
        id: 'fetch-error',
        type: 'error',
        title: 'Metrics Fetch Failed',
        description: 'Unable to fetch latest metrics. Please check system status.',
        timestamp: new Date(),
        severity: 'high'
      }]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const processAlerts = (data: DashboardMetrics): AlertItem[] => {
    const alerts: AlertItem[] = [];

    // Quality alerts
    if (data.quality.factualAccuracy < 0.7) {
      alerts.push({
        id: 'quality-accuracy',
        type: 'warning',
        title: 'Low Factual Accuracy',
        description: `Factual accuracy has dropped to ${(data.quality.factualAccuracy * 100).toFixed(1)}%`,
        timestamp: new Date(),
        severity: 'medium'
      });
    }

    if (data.quality.safetyCompliance < 0.8) {
      alerts.push({
        id: 'safety-compliance',
        type: 'error',
        title: 'Safety Compliance Issue',
        description: `Safety compliance is at ${(data.quality.safetyCompliance * 100).toFixed(1)}%`,
        timestamp: new Date(),
        severity: 'high'
      });
    }

    // Performance alerts
    if (data.performance.averageResponseTime > 5000) {
      alerts.push({
        id: 'response-time',
        type: 'warning',
        title: 'Slow Response Time',
        description: `Average response time is ${(data.performance.averageResponseTime / 1000).toFixed(1)}s`,
        timestamp: new Date(),
        severity: 'medium'
      });
    }

    if (data.performance.errorRate > 0.05) {
      alerts.push({
        id: 'error-rate',
        type: 'error',
        title: 'High Error Rate',
        description: `Error rate is ${(data.performance.errorRate * 100).toFixed(1)}%`,
        timestamp: new Date(),
        severity: 'high'
      });
    }

    // Compliance alerts
    if (data.compliance.criticalViolations > 0) {
      alerts.push({
        id: 'compliance-violations',
        type: 'error',
        title: 'Compliance Violations',
        description: `${data.compliance.criticalViolations} critical compliance violations detected`,
        timestamp: new Date(),
        severity: 'critical'
      });
    }

    // Source alerts
    if (data.sources.riskSources > data.sources.totalSources * 0.3) {
      alerts.push({
        id: 'source-risk',
        type: 'warning',
        title: 'High Risk Sources',
        description: `${data.sources.riskSources} sources have high or critical risk levels`,
        timestamp: new Date(),
        severity: 'medium'
      });
    }

    return alerts.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  };

  const getQualityColor = (score: number): string => {
    if (score >= 0.8) return 'text-green-600';
    if (score >= 0.6) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getTrendIcon = (trend: number[]) => {
    if (trend.length < 2) return <Activity className="h-4 w-4" />;

    const recent = trend.slice(-3);
    const older = trend.slice(-6, -3);
    const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const olderAvg = older.reduce((sum, val) => sum + val, 0) / older.length;

    if (recentAvg > olderAvg * 1.05) {
      return <TrendingUp className="h-4 w-4 text-green-600" />;
    } else if (recentAvg < olderAvg * 0.95) {
      return <TrendingDown className="h-4 w-4 text-red-600" />;
    }

    return <Activity className="h-4 w-4 text-yellow-600" />;
  };

  const formatTime = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading metrics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Cosmetic AI Metrics</h2>
          <p className="text-muted-foreground">
            Real-time monitoring of AI optimization performance
          </p>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-sm text-muted-foreground">
            Last updated: {lastRefresh.toLocaleTimeString()}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchMetrics}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.slice(0, 3).map((alert) => (
            <Alert key={alert.id} variant={alert.type === 'error' ? 'destructive' : 'default'}>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{alert.title}</AlertTitle>
              <AlertDescription>{alert.description}</AlertDescription>
            </Alert>
          ))}

          {alerts.length > 3 && (
            <Button variant="outline" size="sm">
              View all {alerts.length} alerts
            </Button>
          )}
        </div>
      )}

      {/* Overall Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Quality Score</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {((metrics.overall.averageQualityScore || 0) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Average across all responses
            </p>
            <Progress
              value={(metrics.overall.averageQualityScore || 0) * 100}
              className="mt-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Response Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatTime(metrics.overall.averageResponseTime)}
            </div>
            <p className="text-xs text-muted-foreground">
              Average processing time
            </p>
            <Badge
              variant={metrics.overall.averageResponseTime < 3000 ? 'secondary' : 'destructive'}
              className="mt-2"
            >
              {metrics.overall.averageResponseTime < 3000 ? 'Good' : 'Slow'}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {((metrics.overall.successRate || 0) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Of {metrics.overall.totalQueries} queries
            </p>
            <Progress
              value={(metrics.overall.successRate || 0) * 100}
              className="mt-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">User Satisfaction</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {((metrics.overall.userSatisfaction || 0) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Based on user feedback
            </p>
            <div className="flex items-center space-x-2 mt-2">
              {getTrendIcon(metrics.trends.userSatisfactionTrend)}
              <span className="text-xs text-muted-foreground">Trend</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Metrics Tabs */}
      <Tabs defaultValue="quality" className="space-y-4">
        <TabsList>
          <TabsTrigger value="quality">Quality Metrics</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="quality" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(metrics.quality).map(([key, value]) => (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${getQualityColor(value)}`}>
                    {(value * 100).toFixed(1)}%
                  </div>
                  <Progress
                    value={value * 100}
                    className="mt-2"
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Processing Times</CardTitle>
                <CardDescription>
                  Breakdown of response processing components
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span>Knowledge Retrieval</span>
                  <span>{formatTime(metrics.performance.knowledgeRetrievalTime)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Quality Scoring</span>
                  <span>{formatTime(metrics.performance.qualityScoringTime)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Regulatory Check</span>
                  <span>{formatTime(metrics.performance.regulatoryCheckTime)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Total Processing</span>
                  <span>{formatTime(metrics.performance.totalProcessingTime)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System Health</CardTitle>
                <CardDescription>
                  System performance indicators
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span>Cache Hit Rate</span>
                  <span>{(metrics.performance.cacheHitRate * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>System Uptime</span>
                  <span>{(metrics.performance.systemUptime * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Error Rate</span>
                  <span className={metrics.performance.errorRate > 0.05 ? 'text-red-600' : 'text-green-600'}>
                    {(metrics.performance.errorRate * 100).toFixed(2)}%
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sources" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Source Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span>Total Sources</span>
                  <span>{metrics.sources.totalSources}</span>
                </div>
                <div className="flex justify-between">
                  <span>High Quality</span>
                  <span className="text-green-600">{metrics.sources.highQualitySources}</span>
                </div>
                <div className="flex justify-between">
                  <span>At Risk</span>
                  <span className="text-red-600">{metrics.sources.riskSources}</span>
                </div>
                <div className="flex justify-between">
                  <span>Avg Credibility</span>
                  <span>{(metrics.sources.averageCredibility * 100).toFixed(1)}%</span>
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Top Sources</CardTitle>
                <CardDescription>
                  Most frequently used and reliable sources
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {metrics.sources.topSources.slice(0, 5).map((source) => (
                    <div key={source.id} className="flex items-center justify-between p-2 border rounded">
                      <div>
                        <div className="font-medium">{source.name}</div>
                        <div className="text-sm text-muted-foreground">
                          Used {source.usageCount} times
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-medium ${getQualityColor(source.averageCredibility)}`}>
                          {(source.averageCredibility * 100).toFixed(1)}%
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Credibility
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="compliance" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Compliance Overview</CardTitle>
                <CardDescription>
                  Regulatory compliance status across regions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span>Overall Compliance</span>
                  <Badge variant={metrics.compliance.overallComplianceRate > 0.9 ? 'secondary' : 'destructive'}>
                    {(metrics.compliance.overallComplianceRate * 100).toFixed(1)}%
                  </Badge>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>FDA Compliance</span>
                    <span className={metrics.compliance.fdaCompliance > 0.8 ? 'text-green-600' : 'text-red-600'}>
                      {(metrics.compliance.fdaCompliance * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>EU Compliance</span>
                    <span className={metrics.compliance.euCompliance > 0.8 ? 'text-green-600' : 'text-red-600'}>
                      {(metrics.compliance.euCompliance * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>ASEAN Compliance</span>
                    <span className={metrics.compliance.aseanCompliance > 0.8 ? 'text-green-600' : 'text-red-600'}>
                      {(metrics.compliance.aseanCompliance * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Compliance Issues</CardTitle>
                <CardDescription>
                  Active compliance violations and reviews
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {metrics.compliance.criticalViolations > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Critical Violations</AlertTitle>
                    <AlertDescription>
                      {metrics.compliance.criticalViolations} critical compliance violations require immediate attention
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Pending Reviews</span>
                    <span>{metrics.compliance.pendingReviews}</span>
                  </div>
                  {metrics.compliance.pendingReviews > 0 && (
                    <Button variant="outline" size="sm" className="w-full">
                      Review Pending Items
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Quality Trends</CardTitle>
                <CardDescription>
                  Quality score trends over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-2 mb-4">
                  {getTrendIcon(metrics.trends.qualityTrend)}
                  <span>Quality Score Trend</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Last {metrics.trends.timeframe}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Response Time Trends</CardTitle>
                <CardDescription>
                  Response time trends over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-2 mb-4">
                  {getTrendIcon(metrics.trends.responseTimeTrend)}
                  <span>Response Time Trend</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Last {metrics.trends.timeframe}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Usage Trends</CardTitle>
                <CardDescription>
                  Query volume trends over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-2 mb-4">
                  {getTrendIcon(metrics.trends.usageTrend)}
                  <span>Usage Trend</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Last {metrics.trends.timeframe}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Compliance Trends</CardTitle>
                <CardDescription>
                  Compliance rate trends over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-2 mb-4">
                  {getTrendIcon(metrics.trends.complianceTrend)}
                  <span>Compliance Trend</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Last {metrics.trends.timeframe}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}