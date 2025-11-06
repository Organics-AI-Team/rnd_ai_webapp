/**
 * Comprehensive Test Suite for Cosmetic AI Optimizations
 * Tests Knowledge Retrieval Enhancement and Answer Quality Scoring
 */

import { CosmeticKnowledgeService } from '../ai/services/knowledge/cosmetic-knowledge-sources';
import { CosmeticQualityScorer } from '../ai/services/quality/cosmetic-quality-scorer';
import { CosmeticRegulatoryService } from '../ai/services/regulatory/cosmetic-regulatory-sources';
import { CosmeticCredibilityWeightingService } from '../ai/services/credibility/cosmetic-credibility-weighting';
import { CosmeticQualityThresholdsService } from '../ai/services/thresholds/cosmetic-quality-thresholds';

// Test configuration
interface TestConfiguration {
  apiKey: string;
  pineconeApiKey: string;
  testQueries: TestQuery[];
  testContexts: TestContext[];
}

interface TestQuery {
  id: string;
  query: string;
  type: 'safety' | 'regulatory' | 'formulation' | 'efficacy' | 'market';
  expectedTopics: string[];
  difficulty: 'easy' | 'medium' | 'hard';
}

interface TestContext {
  userRole: string;
  productType: string;
  targetRegions: string[];
  requirements: any;
}

interface TestResult {
  queryId: string;
  query: string;
  knowledgeResult?: any;
  qualityScore?: any;
  performance: PerformanceMetrics;
  success: boolean;
  errors: string[];
  warnings: string[];
  insights: string[];
}

interface PerformanceMetrics {
  knowledgeRetrievalTime: number;
  qualityScoringTime: number;
  totalTime: number;
  memoryUsage: number;
  cacheHitRate: number;
  sourceCount: number;
}

/**
 * Cosmetic Optimization Test Suite
 */
export class CosmeticOptimizationTestSuite {
  private knowledgeService: CosmeticKnowledgeService;
  private qualityScorer: CosmeticQualityScorer;
  private regulatoryService: CosmeticRegulatoryService;
  private credibilityService: CosmeticCredibilityWeightingService;
  private thresholdsService: CosmeticQualityThresholdsService;

  constructor(config: TestConfiguration) {
    this.knowledgeService = new CosmeticKnowledgeService(config.pineconeApiKey);
    this.qualityScorer = new CosmeticQualityScorer();
    this.regulatoryService = new CosmeticRegulatoryService();
    this.credibilityService = new CosmeticCredibilityWeightingService();
    this.thresholdsService = new CosmeticQualityThresholdsService();
  }

  /**
   * Run comprehensive test suite
   */
  async runComprehensiveTests(config: TestConfiguration): Promise<TestSuiteResults> {
    console.log('🚀 [CosmeticOptimizationTestSuite] Starting comprehensive tests...');

    const testResults: TestResult[] = [];
    const suiteResults: TestSuiteResults = {
      startTime: new Date(),
      endTime: new Date(),
      totalTests: config.testQueries.length,
      passedTests: 0,
      failedTests: 0,
      results: testResults,
      summary: {} as TestSummary,
      performance: {} as PerformanceSummary
    };

    // Run individual tests
    for (const testQuery of config.testQueries) {
      const testContext = config.testContexts[0]; // Use first context for simplicity

      try {
        const result = await this.runSingleTest(testQuery, testContext);
        testResults.push(result);

        if (result.success) {
          suiteResults.passedTests++;
        } else {
          suiteResults.failedTests++;
        }

        console.log(`✅ [Test] ${testQuery.id}: ${result.success ? 'PASSED' : 'FAILED'}`);

      } catch (error) {
        console.error(`❌ [Test] ${testQuery.id}: ERROR - ${error}`);
        testResults.push({
          queryId: testQuery.id,
          query: testQuery.query,
          performance: {
            knowledgeRetrievalTime: 0,
            qualityScoringTime: 0,
            totalTime: 0,
            memoryUsage: 0,
            cacheHitRate: 0,
            sourceCount: 0
          },
          success: false,
          errors: [error as string],
          warnings: [],
          insights: []
        });
        suiteResults.failedTests++;
      }
    }

    // Generate summary
    suiteResults.endTime = new Date();
    suiteResults.summary = this.generateTestSummary(testResults);
    suiteResults.performance = this.generatePerformanceSummary(testResults);

    console.log('📊 [CosmeticOptimizationTestSuite] Tests complete');
    console.log(`📈 Results: ${suiteResults.passedTests}/${suiteResults.totalTests} passed`);

    return suiteResults;
  }

  /**
   * Run a single test
   */
  private async runSingleTest(
    testQuery: TestQuery,
    testContext: TestContext
  ): Promise<TestResult> {
    const startTime = Date.now();
    const result: TestResult = {
      queryId: testQuery.id,
      query: testQuery.query,
      performance: {
        knowledgeRetrievalTime: 0,
        qualityScoringTime: 0,
        totalTime: 0,
        memoryUsage: 0,
        cacheHitRate: 0,
        sourceCount: 0
      },
      success: true,
      errors: [],
      warnings: [],
      insights: []
    };

    try {
      // Test Knowledge Retrieval Enhancement
      console.log(`🔍 [Test] Testing knowledge retrieval for: ${testQuery.query}`);
      const knowledgeStartTime = Date.now();

      const knowledgeResult = await this.knowledgeService.retrieveCosmeticKnowledge(
        testQuery.query,
        {
          region: 'global',
          requireLatestInfo: true,
          productType: testContext.productType,
          targetMarket: testContext.targetRegions,
          originalQuery: testQuery.query
        }
      );

      result.knowledgeResult = knowledgeResult;
      result.performance.knowledgeRetrievalTime = Date.now() - knowledgeStartTime;
      result.performance.sourceCount = knowledgeResult.sources.length;

      // Validate knowledge retrieval
      this.validateKnowledgeRetrieval(knowledgeResult, testQuery, result);

      // Test Answer Quality Scoring
      console.log(`📊 [Test] Testing quality scoring for: ${testQuery.query}`);
      const qualityStartTime = Date.now();

      const mockResponse = this.generateMockResponse(knowledgeResult);
      const qualityScore = await this.qualityScorer.scoreCosmeticResponse(
        mockResponse,
        testQuery.query,
        {
          userId: 'test-user',
          userRole: testContext.userRole as any,
          targetRegions: testContext.targetRegions,
          productType: testContext.productType as any,
          queryType: testQuery.type as any,
          requirements: testContext.requirements
        },
        knowledgeResult
      );

      result.qualityScore = qualityScore;
      result.performance.qualityScoringTime = Date.now() - qualityStartTime;

      // Validate quality scoring
      this.validateQualityScoring(qualityScore, testQuery, result);

      // Test Regulatory Compliance
      console.log(`⚖️ [Test] Testing regulatory compliance for: ${testQuery.query}`);
      await this.testRegulatoryCompliance(testQuery, result);

      // Test Source Credibility
      console.log(`🎯 [Test] Testing source credibility for: ${testQuery.query}`);
      await this.testSourceCredibility(knowledgeResult, result);

      // Test Thresholds
      console.log(`📏 [Test] Testing quality thresholds for: ${testQuery.query}`);
      await this.testQualityThresholds(qualityScore, testContext, result);

      result.performance.totalTime = Date.now() - startTime;
      result.performance.memoryUsage = this.estimateMemoryUsage(result);

      // Generate insights
      result.insights = this.generateTestInsights(result, testQuery);

    } catch (error) {
      result.success = false;
      result.errors.push(error as string);
      result.performance.totalTime = Date.now() - startTime;
    }

    return result;
  }

  private validateKnowledgeRetrieval(
    knowledgeResult: any,
    testQuery: TestQuery,
    result: TestResult
  ): void {
    // Check if knowledge retrieval succeeded
    if (!knowledgeResult) {
      result.success = false;
      result.errors.push('Knowledge retrieval failed - no result returned');
      return;
    }

    // Check if we have sources
    if (!knowledgeResult.sources || knowledgeResult.sources.length === 0) {
      result.warnings.push('No sources found for query');
      return;
    }

    // Check confidence level
    if (knowledgeResult.confidence < 0.5) {
      result.warnings.push(`Low confidence score: ${knowledgeResult.confidence}`);
    }

    // Check if expected topics are covered
    const coveredTopics = this.extractTopicsFromResult(knowledgeResult);
    const missingTopics = testQuery.expectedTopics.filter(topic =>
      !coveredTopics.some(covered => covered.toLowerCase().includes(topic.toLowerCase()))
    );

    if (missingTopics.length > 0) {
      result.warnings.push(`Missing expected topics: ${missingTopics.join(', ')}`);
    }

    // Check synthesis quality
    if (!knowledgeResult.synthesis) {
      result.warnings.push('No knowledge synthesis provided');
    } else if (knowledgeResult.synthesis.confidenceLevel < 0.6) {
      result.warnings.push('Low synthesis confidence');
    }
  }

  private validateQualityScoring(
    qualityScore: any,
    testQuery: TestQuery,
    result: TestResult
  ): void {
    // Check if quality scoring succeeded
    if (!qualityScore) {
      result.success = false;
      result.errors.push('Quality scoring failed - no result returned');
      return;
    }

    // Check overall score
    if (qualityScore.overallScore < 0.3) {
      result.errors.push(`Critically low quality score: ${qualityScore.overallScore}`);
    } else if (qualityScore.overallScore < 0.6) {
      result.warnings.push(`Low quality score: ${qualityScore.overallScore}`);
    }

    // Check critical dimensions for safety queries
    if (testQuery.type === 'safety') {
      if (qualityScore.dimensions.safetyCompliance < 0.7) {
        result.errors.push(`Safety compliance score too low for safety query: ${qualityScore.dimensions.safetyCompliance}`);
      }
    }

    // Check compliance status
    if (!qualityScore.complianceStatus.overallCompliant) {
      result.warnings.push('Compliance issues detected');
    }

    // Check risk assessment
    if (qualityScore.riskAssessment.overallRiskLevel === 'critical') {
      result.errors.push('Critical risk level detected - requires immediate attention');
    }

    // Check for improvement suggestions
    if (!qualityScore.improvementSuggestions || qualityScore.improvementSuggestions.length === 0) {
      result.warnings.push('No improvement suggestions provided');
    }
  }

  private async testRegulatoryCompliance(
    testQuery: TestQuery,
    result: TestResult
  ): Promise<void> {
    try {
      // Extract ingredients from query
      const ingredients = this.extractIngredientsFromQuery(testQuery.query);

      if (ingredients.length > 0) {
        // Test regulatory data retrieval for first ingredient
        const regulatoryData = await this.regulatoryService.getRegulatoryData(
          ingredients[0],
          {
            region: 'global',
            targetRegions: ['US', 'EU', 'ASEAN'],
            requireLatestInfo: true,
            originalQuery: testQuery.query
          }
        );

        if (!regulatoryData) {
          result.warnings.push('No regulatory data found for ingredient');
        } else {
          result.insights.push(`Regulatory data found for ${ingredients[0]}`);
        }
      }
    } catch (error) {
      result.warnings.push(`Regulatory compliance test failed: ${error}`);
    }
  }

  private async testSourceCredibility(
    knowledgeResult: any,
    result: TestResult
  ): Promise<void> {
    try {
      if (knowledgeResult.sources && knowledgeResult.sources.length > 0) {
        // Test credibility scoring for sources
        const sourceIds = knowledgeResult.sources.map((s: any) => s.source.id);
        const credibilitySummary = this.credibilityService.getSourceCredibilitySummary(sourceIds);

        result.insights.push(`Average source credibility: ${(credibilitySummary.averageCredibility * 100).toFixed(1)}%`);
        result.insights.push(`High quality sources: ${credibilitySummary.highQualitySources}/${sourceIds.length}`);

        if (credibilitySummary.riskSources > 0) {
          result.warnings.push(`${credibilitySummary.riskSources} sources have high/critical risk levels`);
        }

        if (credibilitySummary.recommendations.length > 0) {
          result.insights.push(`Source recommendations: ${credibilitySummary.recommendations.length}`);
        }
      }
    } catch (error) {
      result.warnings.push(`Source credibility test failed: ${error}`);
    }
  }

  private async testQualityThresholds(
    qualityScore: any,
    testContext: TestContext,
    result: TestResult
  ): Promise<void> {
    try {
      const evaluation = this.thresholdsService.evaluateQualityScore(
        qualityScore,
        {
          userRole: testContext.userRole,
          productType: testContext.productType,
          targetRegions: testContext.targetRegions,
          queryType: 'test',
          requirements: testContext.requirements
        }
      );

      if (!evaluation.meetsMinimumRequirements) {
        result.errors.push('Response does not meet minimum quality requirements');
      }

      if (evaluation.criticalIssues.length > 0) {
        result.errors.push(`${evaluation.criticalIssues.length} critical issues detected`);
      }

      if (evaluation.recommendations.length > 0) {
        result.insights.push(`${evaluation.recommendations.length} quality improvement recommendations`);
      }

      result.insights.push(`Overall quality rating: ${evaluation.overallEvaluation.rating}`);
    } catch (error) {
      result.warnings.push(`Quality thresholds test failed: ${error}`);
    }
  }

  private generateMockResponse(knowledgeResult: any): string {
    if (!knowledgeResult || !knowledgeResult.synthesis) {
      return 'This is a test response for knowledge retrieval and quality scoring.';
    }

    return `
Based on the information retrieved from multiple sources, here is a comprehensive analysis:

${knowledgeResult.synthesis.summary || 'No summary available.'}

Key Findings:
${knowledgeResult.synthesis.keyInsights?.map((insight: any, index: number) =>
  `${index + 1}. ${insight.insight} (Source: ${insight.source})`
).join('\n') || 'No key findings available.'}

Safety Assessment:
${knowledgeResult.synthesis.consensus?.consensusPoints?.map((point: any) =>
  `- ${point.statement} (Confidence: ${(point.confidenceLevel * 100).toFixed(1)}%)`
).join('\n') || 'No consensus information available.'}

Recommendations:
${knowledgeResult.synthesis.recommendations?.map((rec: any) =>
  `- ${rec.recommendation} (Priority: ${rec.priority})`
).join('\n') || 'No recommendations available.'}

Sources: ${knowledgeResult.sources?.map((s: any) => s.source.name).join(', ') || 'No sources listed.'}

Confidence Level: ${((knowledgeResult.confidence || 0.5) * 100).toFixed(1)}%
    `.trim();
  }

  private extractTopicsFromResult(knowledgeResult: any): string[] {
    const topics: string[] = [];

    if (knowledgeResult.synthesis?.keyInsights) {
      knowledgeResult.synthesis.keyInsights.forEach((insight: any) => {
        topics.push(insight.category);
      });
    }

    return [...new Set(topics)];
  }

  private extractIngredientsFromQuery(query: string): string[] {
    // Simple ingredient extraction - in production, this would be more sophisticated
    const ingredientPatterns = [
      /\b[A-Z][a-z]+(?:-[A-Z][a-z]+)*\b/g, // Potential INCI names
      /\b(niacinamide|hyaluronic acid|retinol|vitamin C|salicylic acid|benzoyl peroxide|zinc oxide|titanium dioxide|octocrylene|avobenzone)\b/gi
    ];

    const ingredients: string[] = [];
    ingredientPatterns.forEach(pattern => {
      const matches = query.match(pattern);
      if (matches) {
        ingredients.push(...matches);
      }
    });

    return [...new Set(ingredients)];
  }

  private estimateMemoryUsage(result: TestResult): number {
    // Simple estimation based on result size
    const size = JSON.stringify(result).length;
    return Math.round(size / 1024); // Return in KB
  }

  private generateTestInsights(result: TestResult, testQuery: TestQuery): string[] {
    const insights: string[] = [];

    // Performance insights
    if (result.performance.totalTime > 5000) {
      insights.push('Response time is slower than expected (>5s)');
    } else if (result.performance.totalTime < 1000) {
      insights.push('Excellent response performance (<1s)');
    }

    // Source insights
    if (result.performance.sourceCount > 10) {
      insights.push('Good source diversity found');
    } else if (result.performance.sourceCount < 3) {
      insights.push('Limited source diversity - consider expanding search');
    }

    // Quality insights
    if (result.qualityScore && result.qualityScore.overallScore > 0.8) {
      insights.push('High quality response achieved');
    } else if (result.qualityScore && result.qualityScore.overallScore < 0.5) {
      insights.push('Quality improvements needed');
    }

    // Query-specific insights
    if (testQuery.type === 'safety' && result.qualityScore) {
      const safetyScore = result.qualityScore.dimensions.safetyCompliance;
      if (safetyScore > 0.8) {
        insights.push('Excellent safety information provided');
      } else if (safetyScore < 0.6) {
        insights.push('Safety information needs improvement');
      }
    }

    return insights;
  }

  private generateTestSummary(results: TestResult[]): TestSummary {
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const warnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
    const errors = results.reduce((sum, r) => sum + r.errors.length, 0);

    const avgQualityScore = results
      .filter(r => r.qualityScore)
      .reduce((sum, r) => sum + r.qualityScore.overallScore, 0) /
      Math.max(results.filter(r => r.qualityScore).length, 1);

    const avgResponseTime = results
      .reduce((sum, r) => sum + r.performance.totalTime, 0) /
      Math.max(results.length, 1);

    return {
      totalTests: results.length,
      passed,
      failed,
      passRate: (passed / results.length) * 100,
      averageQualityScore: avgQualityScore,
      averageResponseTime: avgResponseTime,
      totalWarnings: warnings,
      totalErrors: errors,
      successRate: passed > 0 ? (passed - errors) / passed * 100 : 0
    };
  }

  private generatePerformanceSummary(results: TestResult[]): PerformanceSummary {
    const times = results.map(r => r.performance.totalTime);
    const memoryUsages = results.map(r => r.performance.memoryUsage);
    const sourceCounts = results.map(r => r.performance.sourceCount);

    return {
      minResponseTime: Math.min(...times),
      maxResponseTime: Math.max(...times),
      averageResponseTime: times.reduce((sum, t) => sum + t, 0) / times.length,
      minMemoryUsage: Math.min(...memoryUsages),
      maxMemoryUsage: Math.max(...memoryUsages),
      averageMemoryUsage: memoryUsages.reduce((sum, m) => sum + m, 0) / memoryUsages.length,
      minSources: Math.min(...sourceCounts),
      maxSources: Math.max(...sourceCounts),
      averageSources: sourceCounts.reduce((sum, s) => sum + s, 0) / sourceCounts.length
    };
  }

  /**
   * Run quick validation tests
   */
  async runQuickValidation(): Promise<ValidationResults> {
    console.log('⚡ [CosmeticOptimizationTestSuite] Running quick validation...');

    const results: ValidationResults = {
      knowledgeService: false,
      qualityScorer: false,
      regulatoryService: false,
      credibilityService: false,
      thresholdsService: false,
      overall: false,
      errors: [],
      warnings: []
    };

    try {
      // Test Knowledge Service
      console.log('🔍 Validating Knowledge Service...');
      await this.knowledgeService.retrieveCosmeticKnowledge(
        'niacinamide safety',
        {
          region: 'global',
          requireLatestInfo: true,
          productType: 'skincare',
          targetMarket: ['US'],
          originalQuery: 'niacinamide safety'
        }
      );
      results.knowledgeService = true;
      console.log('✅ Knowledge Service validation passed');

    } catch (error) {
      results.errors.push(`Knowledge Service validation failed: ${error}`);
    }

    try {
      // Test Quality Scorer
      console.log('📊 Validating Quality Scorer...');
      await this.qualityScorer.scoreCosmeticResponse(
        'Test response for validation',
        'test query',
        {
          userId: 'test',
          userRole: 'safety_assessor',
          targetRegions: ['US'],
          productType: 'skincare',
          queryType: 'ingredient_safety',
          requirements: {
            requireSafetyData: true,
            requireRegulatoryCompliance: true,
            requireFormulationGuidance: false,
            requireEfficacyData: false,
            requireConcentrationLimits: true,
            requireDocumentation: true
          }
        }
      );
      results.qualityScorer = true;
      console.log('✅ Quality Scorer validation passed');

    } catch (error) {
      results.errors.push(`Quality Scorer validation failed: ${error}`);
    }

    try {
      // Test Regulatory Service
      console.log('⚖️ Validating Regulatory Service...');
      await this.regulatoryService.getRegulatoryData(
        'niacinamide',
        {
          region: 'global',
          targetRegions: ['US'],
          requireLatestInfo: true,
          originalQuery: 'test'
        }
      );
      results.regulatoryService = true;
      console.log('✅ Regulatory Service validation passed');

    } catch (error) {
      results.errors.push(`Regulatory Service validation failed: ${error}`);
    }

    try {
      // Test Credibility Service
      console.log('🎯 Validating Credibility Service...');
      this.credibilityService.calculateSourceCredibility('fda_cosmetics');
      results.credibilityService = true;
      console.log('✅ Credibility Service validation passed');

    } catch (error) {
      results.errors.push(`Credibility Service validation failed: ${error}`);
    }

    try {
      // Test Thresholds Service
      console.log('📏 Validating Thresholds Service...');
      this.thresholdsService.evaluateQualityScore(
        {
          overallScore: 0.8,
          dimensions: {
            factualAccuracy: 0.8,
            safetyCompliance: 0.8,
            regulatoryCompliance: 0.8,
            formulationAccuracy: 0.8,
            completeness: 0.8,
            clarity: 0.8,
            relevance: 0.8,
            sourceQuality: 0.8
          },
          cosmeticSpecificFactors: {
            ingredientAccuracy: 0.8,
            concentrationGuidelines: 0.8,
            safetyAssessment: 0.8,
            regulatoryStatus: 0.8,
            practicalApplication: 0.8
          },
          improvementSuggestions: [],
          confidenceLevel: 0.8,
          complianceStatus: {
            overallCompliant: true,
            fdaCompliant: true,
            euCompliant: true,
            aseanCompliant: true,
            missingCompliance: [],
            requiredDocumentation: [],
            regulatoryConcerns: []
          },
          riskAssessment: {
            overallRiskLevel: 'low',
            safetyRisks: [],
            regulatoryRisks: [],
            formulationRisks: [],
            recommendedActions: []
          }
        },
        {
          userRole: 'safety_assessor',
          productType: 'skincare',
          targetRegions: ['US'],
          queryType: 'test',
          requirements: {
            requireSafetyData: true,
            requireRegulatoryCompliance: true,
            requireFormulationGuidance: false,
            requireEfficacyData: false,
            requireConcentrationLimits: true,
            requireDocumentation: true
          }
        }
      );
      results.thresholdsService = true;
      console.log('✅ Thresholds Service validation passed');

    } catch (error) {
      results.errors.push(`Thresholds Service validation failed: ${error}`);
    }

    results.overall = results.knowledgeService &&
                     results.qualityScorer &&
                     results.regulatoryService &&
                     results.credibilityService &&
                     results.thresholdsService;

    if (results.overall) {
      console.log('🎉 All validations passed! System ready for production.');
    } else {
      console.log('⚠️ Some validations failed. Please review errors.');
    }

    return results;
  }
}

// Result interfaces
export interface TestSuiteResults {
  startTime: Date;
  endTime: Date;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
  summary: TestSummary;
  performance: PerformanceSummary;
}

export interface TestSummary {
  totalTests: number;
  passed: number;
  failed: number;
  passRate: number;
  averageQualityScore: number;
  averageResponseTime: number;
  totalWarnings: number;
  totalErrors: number;
  successRate: number;
}

export interface PerformanceSummary {
  minResponseTime: number;
  maxResponseTime: number;
  averageResponseTime: number;
  minMemoryUsage: number;
  maxMemoryUsage: number;
  averageMemoryUsage: number;
  minSources: number;
  maxSources: number;
  averageSources: number;
}

export interface ValidationResults {
  knowledgeService: boolean;
  qualityScorer: boolean;
  regulatoryService: boolean;
  credibilityService: boolean;
  thresholdsService: boolean;
  overall: boolean;
  errors: string[];
  warnings: string[];
}

// Example test configuration
export const EXAMPLE_TEST_CONFIG: TestConfiguration = {
  apiKey: process.env.OPENAI_API_KEY || 'test-key',
  pineconeApiKey: process.env.PINECONE_API_KEY || 'test-key',
  testQueries: [
    {
      id: 'test_001',
      query: 'What are the safety considerations for niacinamide in skincare products?',
      type: 'safety',
      expectedTopics: ['safety', 'niacinamide', 'skincare', 'concentration', 'irritation'],
      difficulty: 'medium'
    },
    {
      id: 'test_002',
      query: 'Is hyaluronic acid approved for use in cosmetics in the EU?',
      type: 'regulatory',
      expectedTopics: ['hyaluronic acid', 'EU regulation', 'CosIng', 'approval', 'compliance'],
      difficulty: 'easy'
    },
    {
      id: 'test_003',
      query: 'How to formulate a stable vitamin C serum?',
      type: 'formulation',
      expectedTopics: ['vitamin C', 'formulation', 'stability', 'pH', 'antioxidant'],
      difficulty: 'hard'
    },
    {
      id: 'test_004',
      query: 'What is the efficacy of retinol for anti-aging?',
      type: 'efficacy',
      expectedTopics: ['retinol', 'efficacy', 'anti-aging', 'clinical studies', 'benefits'],
      difficulty: 'medium'
    },
    {
      id: 'test_005',
      query: 'Current market trends for natural cosmetics in Asia',
      type: 'market',
      expectedTopics: ['market trends', 'natural cosmetics', 'Asia', 'consumer preferences', 'growth'],
      difficulty: 'medium'
    }
  ],
  testContexts: [
    {
      userRole: 'safety_assessor',
      productType: 'skincare',
      targetRegions: ['US', 'EU', 'ASEAN'],
      requirements: {
        requireSafetyData: true,
        requireRegulatoryCompliance: true,
        requireFormulationGuidance: false,
        requireEfficacyData: false,
        requireConcentrationLimits: true,
        requireDocumentation: true
      }
    }
  ]
};

// Example usage
/*
import { CosmeticOptimizationTestSuite, EXAMPLE_TEST_CONFIG } from './cosmetic-optimization-test';

async function runTests() {
  const testSuite = new CosmeticOptimizationTestSuite(EXAMPLE_TEST_CONFIG);

  // Run quick validation first
  const validation = await testSuite.runQuickValidation();
  console.log('Validation Results:', validation);

  if (validation.overall) {
    // Run comprehensive tests
    const results = await testSuite.runComprehensiveTests(EXAMPLE_TEST_CONFIG);
    console.log('Test Results:', results);
  }
}

runTests().catch(console.error);
*/