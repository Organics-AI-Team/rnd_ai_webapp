/**
 * Enhanced Agents Test Suite
 * Comprehensive testing for Raw Materials and Sales R&D AI agents with new optimization methods
 */

import { EnhancedRawMaterialsAgent } from '../ai/agents/raw-materials-ai/enhanced-raw-materials-agent';
import { EnhancedSalesRndAgent } from '../ai/agents/sales-rnd-ai/enhanced-sales-rnd-agent';

// Test configuration
const TEST_CONFIG = {
  // Enable all optimizations
  enableKnowledgeRetrieval: true,
  enableQualityScoring: true,
  enableRegulatoryCheck: true,
  enableSourceCredibility: true,
  enableResponseReranking: true,

  // Test parameters
  timeout: 30000, // 30 seconds
  verboseLogging: true,

  // Test scenarios
  rawMaterialsScenarios: [
    {
      name: 'Ingredient Safety Query',
      query: 'What are the safety considerations for using 5% niacinamide in a face cream?',
      context: {
        queryType: 'safety',
        productType: 'skincare',
        targetRegions: ['US', 'EU', 'ASEAN'],
        userRole: 'safety_assessor'
      }
    },
    {
      name: 'Material Stock Query',
      query: 'Check availability and pricing for hyaluronic acid and vitamin C in our inventory',
      context: {
        queryType: 'stock',
        productType: 'skincare',
        userRole: 'procurement_manager'
      }
    },
    {
      name: 'Formulation Compatibility Query',
      query: 'Can retinol be combined with vitamin C in the same formulation? What are the stability issues?',
      context: {
        queryType: 'application',
        productType: 'skincare',
        targetRegions: ['US', 'EU'],
        userRole: 'formulation_chemist'
      }
    }
  ],

  salesRndScenarios: [
    {
      name: 'Product Concept Development',
      query: 'Develop a brightening serum concept for ASEAN market targeting millennials, vegan, fragrance-free, masstige pricing',
      context: {
        queryType: 'concept_development',
        clientBrief: {
          targetCustomer: 'millennials (25-40)',
          painPoints: ['hyperpigmentation', 'uneven tone'],
          productCategory: 'serum',
          region: 'ASEAN',
          constraints: ['vegan', 'fragrance-free'],
          heroClaims: ['brightening', 'tone evening'],
          priceTier: 'masstige'
        },
        targetRegions: ['ASEAN'],
        userRole: 'product_manager'
      }
    },
    {
      name: 'Market Analysis Query',
      query: 'Analyze market potential for anti-acne products in US market for teen demographic',
      context: {
        queryType: 'market_analysis',
        clientBrief: {
          targetCustomer: 'teenagers (16-19)',
          painPoints: ['acne', 'oil control'],
          productCategory: 'cleanser',
          region: 'US',
          priceTier: 'mass'
        },
        targetRegions: ['US'],
        userRole: 'market_analyst'
      }
    },
    {
      name: 'Regulatory Compliance Query',
      query: 'What regulatory requirements exist for launching a sunscreen product with SPF 50 in EU market?',
      context: {
        queryType: 'regulatory_compliance',
        clientBrief: {
          productCategory: 'sunscreen',
          region: 'EU',
          constraints: ['broad spectrum', 'water resistant']
        },
        targetRegions: ['EU'],
        userRole: 'regulatory_specialist'
      }
    }
  ]
};

/**
 * Enhanced Agents Test Suite
 */
export class EnhancedAgentsTestSuite {
  private config: any;
  private results: TestResult[] = [];

  constructor(config = TEST_CONFIG) {
    this.config = config;
  }

  /**
   * Run all tests for enhanced agents
   */
  async runAllTests(): Promise<TestSuiteResult> {
    console.log('🚀 [EnhancedAgentsTestSuite] Starting comprehensive test suite...');

    const startTime = Date.now();
    this.results = [];

    try {
      // Test Raw Materials Enhanced Agent
      console.log('\n📦 [Test Suite] Testing Enhanced Raw Materials Agent...');
      await this.testRawMaterialsAgent();

      // Test Sales R&D Enhanced Agent
      console.log('\n💼 [Test Suite] Testing Enhanced Sales R&D Agent...');
      await this.testSalesRndAgent();

      // Generate test summary
      const totalTime = Date.now() - startTime;
      const summary = this.generateTestSummary(totalTime);

      console.log('\n✅ [EnhancedAgentsTestSuite] Test suite completed successfully!');
      console.log(`📊 [Summary] ${summary.passedTests}/${summary.totalTests} tests passed (${summary.successRate.toFixed(1)}%)`);
      console.log(`⏱️ [Timing] Total time: ${totalTime}ms`);

      return summary;

    } catch (error) {
      console.error('❌ [EnhancedAgentsTestSuite] Test suite failed:', error);
      throw error;
    }
  }

  /**
   * Test Enhanced Raw Materials Agent
   */
  private async testRawMaterialsAgent(): Promise<void> {
    const agent = new EnhancedRawMaterialsAgent();

    for (const scenario of this.config.rawMaterialsScenarios) {
      console.log(`\n  🔍 [Raw Materials] Testing: ${scenario.name}`);

      try {
        const result = await agent.generateEnhancedResponse(scenario.query, scenario.context);

        const testResult: TestResult = {
          agent: 'raw-materials',
          scenario: scenario.name,
          query: scenario.query,
          success: result.success,
          processingTime: result.metadata?.processingTime || 0,
          qualityScore: result.quality?.overallScore || 0,
          optimizations: result.optimizations || {},
          error: result.error
        };

        // Validate results
        this.validateRawMaterialsResult(testResult, result);
        this.results.push(testResult);

        console.log(`    ✅ ${scenario.name}: ${result.success ? 'PASSED' : 'FAILED'} (${testResult.processingTime}ms)`);
        if (result.success) {
          console.log(`    📊 Quality Score: ${(testResult.qualityScore * 100).toFixed(1)}%`);
          console.log(`    🔧 Optimizations: ${this.countEnabledOptimizations(testResult.optimizations)}/4 enabled`);
        } else {
          console.log(`    ❌ Error: ${result.error}`);
        }

      } catch (error) {
        const testResult: TestResult = {
          agent: 'raw-materials',
          scenario: scenario.name,
          query: scenario.query,
          success: false,
          processingTime: 0,
          qualityScore: 0,
          optimizations: {},
          error: error instanceof Error ? error.message : 'Unknown error'
        };

        this.results.push(testResult);
        console.log(`    ❌ ${scenario.name}: FAILED - ${testResult.error}`);
      }
    }
  }

  /**
   * Test Enhanced Sales R&D Agent
   */
  private async testSalesRndAgent(): Promise<void> {
    const agent = new EnhancedSalesRndAgent();

    for (const scenario of this.config.salesRndScenarios) {
      console.log(`\n  💼 [Sales R&D] Testing: ${scenario.name}`);

      try {
        const result = await agent.generateEnhancedResponse(scenario.query, scenario.context);

        const testResult: TestResult = {
          agent: 'sales-rnd',
          scenario: scenario.name,
          query: scenario.query,
          success: result.success,
          processingTime: result.metadata?.processingTime || 0,
          qualityScore: result.quality?.overallScore || 0,
          optimizations: result.optimizations || {},
          error: result.error
        };

        // Validate results
        this.validateSalesRndResult(testResult, result);
        this.results.push(testResult);

        console.log(`    ✅ ${scenario.name}: ${result.success ? 'PASSED' : 'FAILED'} (${testResult.processingTime}ms)`);
        if (result.success) {
          console.log(`    📊 Quality Score: ${(testResult.qualityScore * 100).toFixed(1)}%`);
          console.log(`    💼 Sales Quality: ${(result.salesQuality?.overallSalesQuality * 100).toFixed(1)}%`);
          console.log(`    🔧 Optimizations: ${this.countEnabledOptimizations(testResult.optimizations)}/4 enabled`);
        } else {
          console.log(`    ❌ Error: ${result.error}`);
        }

      } catch (error) {
        const testResult: TestResult = {
          agent: 'sales-rnd',
          scenario: scenario.name,
          query: scenario.query,
          success: false,
          processingTime: 0,
          qualityScore: 0,
          optimizations: {},
          error: error instanceof Error ? error.message : 'Unknown error'
        };

        this.results.push(testResult);
        console.log(`    ❌ ${scenario.name}: FAILED - ${testResult.error}`);
      }
    }
  }

  /**
   * Validate Raw Materials Agent result
   */
  private validateRawMaterialsResult(testResult: TestResult, result: any): void {
    if (!testResult.success) return;

    // Check required metadata
    if (!result.metadata) {
      testResult.warnings = testResult.warnings || [];
      testResult.warnings.push('Missing metadata');
    }

    // Check optimizations structure
    const requiredOptimizations = ['knowledgeRetrieval', 'qualityScoring', 'regulatoryCheck', 'responseReranking'];
    for (const opt of requiredOptimizations) {
      if (!result.optimizations?.[opt]) {
        testResult.warnings = testResult.warnings || [];
        testResult.warnings.push(`Missing optimization: ${opt}`);
      }
    }

    // Check quality threshold
    if (testResult.qualityScore < 0.5) {
      testResult.warnings = testResult.warnings || [];
      testResult.warnings.push(`Low quality score: ${(testResult.qualityScore * 100).toFixed(1)}%`);
    }

    // Check processing time
    if (testResult.processingTime > this.config.timeout) {
      testResult.warnings = testResult.warnings || [];
      testResult.warnings.push(`Slow response: ${testResult.processingTime}ms`);
    }
  }

  /**
   * Validate Sales R&D Agent result
   */
  private validateSalesRndResult(testResult: TestResult, result: any): void {
    if (!testResult.success) return;

    // Check required metadata
    if (!result.metadata) {
      testResult.warnings = testResult.warnings || [];
      testResult.warnings.push('Missing metadata');
    }

    // Check sales-specific data
    if (!result.marketData || result.marketData.length === 0) {
      testResult.warnings = testResult.warnings || [];
      testResult.warnings.push('Missing market intelligence data');
    }

    if (!result.costData) {
      testResult.warnings = testResult.warnings || [];
      testResult.warnings.push('Missing cost analysis data');
    }

    // Check optimizations structure
    const requiredOptimizations = ['knowledgeRetrieval', 'qualityScoring', 'regulatoryCheck', 'responseReranking'];
    for (const opt of requiredOptimizations) {
      if (!result.optimizations?.[opt]) {
        testResult.warnings = testResult.warnings || [];
        testResult.warnings.push(`Missing optimization: ${opt}`);
      }
    }

    // Check sales quality threshold
    const salesQuality = result.salesQuality?.overallSalesQuality || 0;
    if (salesQuality < 0.5) {
      testResult.warnings = testResult.warnings || [];
      testResult.warnings.push(`Low sales quality score: ${(salesQuality * 100).toFixed(1)}%`);
    }
  }

  /**
   * Count enabled optimizations
   */
  private countEnabledOptimizations(optimizations: any): number {
    if (!optimizations) return 0;

    return Object.values(optimizations).filter((opt: any) =>
      typeof opt === 'object' && opt.enabled === true
    ).length;
  }

  /**
   * Generate test summary
   */
  private generateTestSummary(totalTime: number): TestSuiteResult {
    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;
    const successRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;

    // Calculate averages
    const successfulResults = this.results.filter(r => r.success);
    const avgProcessingTime = successfulResults.length > 0
      ? successfulResults.reduce((sum, r) => sum + r.processingTime, 0) / successfulResults.length
      : 0;
    const avgQualityScore = successfulResults.length > 0
      ? successfulResults.reduce((sum, r) => sum + r.qualityScore, 0) / successfulResults.length
      : 0;

    // Count warnings
    const totalWarnings = this.results.reduce((sum, r) => sum + (r.warnings?.length || 0), 0);

    return {
      totalTests,
      passedTests,
      failedTests,
      successRate,
      totalTime,
      avgProcessingTime,
      avgQualityScore,
      totalWarnings,
      results: this.results
    };
  }

  /**
   * Run quick validation test
   */
  async runQuickValidation(): Promise<QuickValidationResult> {
    console.log('⚡ [EnhancedAgentsTestSuite] Running quick validation...');

    const quickScenarios = [
      this.config.rawMaterialsScenarios[0], // First raw materials scenario
      this.config.salesRndScenarios[0]     // First sales R&D scenario
    ];

    const results: any[] = [];

    try {
      // Test Raw Materials
      const rawAgent = new EnhancedRawMaterialsAgent();
      const rawResult = await rawAgent.generateEnhancedResponse(
        quickScenarios[0].query,
        quickScenarios[0].context
      );
      results.push({ agent: 'raw-materials', ...rawResult });

      // Test Sales R&D
      const salesAgent = new EnhancedSalesRndAgent();
      const salesResult = await salesAgent.generateEnhancedResponse(
        quickScenarios[1].query,
        quickScenarios[1].context
      );
      results.push({ agent: 'sales-rnd', ...salesResult });

      const allPassed = results.every(r => r.success);
      const avgQuality = results.reduce((sum, r) => sum + (r.quality?.overallScore || 0), 0) / results.length;

      console.log(`${allPassed ? '✅' : '❌'} Quick validation ${allPassed ? 'passed' : 'failed'}`);
      console.log(`📊 Average quality: ${(avgQuality * 100).toFixed(1)}%`);

      return {
        passed: allPassed,
        avgQualityScore: avgQuality,
        results
      };

    } catch (error) {
      console.error('❌ Quick validation failed:', error);
      return {
        passed: false,
        avgQualityScore: 0,
        results: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Interface definitions
interface TestResult {
  agent: string;
  scenario: string;
  query: string;
  success: boolean;
  processingTime: number;
  qualityScore: number;
  optimizations: any;
  warnings?: string[];
  error?: string;
}

interface TestSuiteResult {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  successRate: number;
  totalTime: number;
  avgProcessingTime: number;
  avgQualityScore: number;
  totalWarnings: number;
  results: TestResult[];
}

interface QuickValidationResult {
  passed: boolean;
  avgQualityScore: number;
  results: any[];
  error?: string;
}

// Export test suite and configurations
export { TEST_CONFIG };

/**
 * Run tests if this file is executed directly
 */
if (require.main === module) {
  const testSuite = new EnhancedAgentsTestSuite();

  console.log('Choose test mode:');
  console.log('1. Quick validation (2 tests)');
  console.log('2. Full test suite (6 tests)');

  const mode = process.argv[2] || '1';

  if (mode === '1') {
    testSuite.runQuickValidation()
      .then(result => {
        console.log('\n📋 Quick Validation Results:');
        console.log(`Status: ${result.passed ? 'PASSED' : 'FAILED'}`);
        console.log(`Average Quality: ${(result.avgQualityScore * 100).toFixed(1)}%`);
        process.exit(result.passed ? 0 : 1);
      })
      .catch(error => {
        console.error('Test execution failed:', error);
        process.exit(1);
      });
  } else {
    testSuite.runAllTests()
      .then(result => {
        console.log('\n📋 Full Test Suite Results:');
        console.log(`Total Tests: ${result.totalTests}`);
        console.log(`Passed: ${result.passedTests}`);
        console.log(`Failed: ${result.failedTests}`);
        console.log(`Success Rate: ${result.successRate.toFixed(1)}%`);
        console.log(`Average Quality: ${(result.avgQualityScore * 100).toFixed(1)}%`);
        console.log(`Average Processing Time: ${result.avgProcessingTime.toFixed(0)}ms`);
        console.log(`Total Warnings: ${result.totalWarnings}`);
        process.exit(result.failedTests > 0 ? 1 : 0);
      })
      .catch(error => {
        console.error('Test execution failed:', error);
        process.exit(1);
      });
  }
}