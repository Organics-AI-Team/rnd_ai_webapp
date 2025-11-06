/**
 * Enhanced Agents End-to-End (E2E) Tests
 * Real-world scenario testing for Raw Materials and Sales R&D AI agents
 */

import {
  EnhancedRawMaterialsAgent,
  EnhancedRawMaterialsAgentFunctions
} from '../ai/agents/raw-materials-ai/enhanced-raw-materials-agent';

import {
  EnhancedSalesRndAgent,
  EnhancedSalesRndAgentFunctions
} from '../ai/agents/sales-rnd-ai/enhanced-sales-rnd-agent';

// E2E Test Configuration
const E2E_CONFIG = {
  timeout: 60000, // 60 seconds for E2E tests
  retryAttempts: 3,
  realScenarios: [
    {
      name: 'Safety Assessment Query',
      agent: 'raw-materials',
      query: 'What are the safety considerations for using 5% niacinamide in a face cream for sensitive skin? Include maximum concentration limits and any restrictions for US, EU, and ASEAN markets.',
      context: {
        userId: 'safety-assessor-001',
        userRole: 'safety_assessor',
        queryType: 'safety',
        productType: 'skincare',
        targetRegions: ['US', 'EU', 'ASEAN'],
        materialName: 'niacinamide'
      },
      expectations: {
        success: true,
        qualityScore: { min: 0.7, max: 1.0 },
        regulatoryCompliant: true,
        includesSafetyData: true,
        processingTime: { max: 30000 }
      }
    },
    {
      name: 'Material Comparison Query',
      agent: 'raw-materials',
      query: 'Compare niacinamide, tranexamic acid, and alpha arbutin for brightening effects. Include efficacy, safety profiles, concentration ranges, and regulatory status in major markets.',
      context: {
        userId: 'formulation-chemist-001',
        userRole: 'formulation_chemist',
        queryType: 'comparison',
        productType: 'skincare',
        targetRegions: ['US', 'EU', 'ASEAN'],
        materialName: 'niacinamide, tranexamic acid, alpha arbutin'
      },
      expectations: {
        success: true,
        qualityScore: { min: 0.7, max: 1.0 },
        includesComparison: true,
        materialsAnalyzed: { min: 3, max: 5 },
        processingTime: { max: 30000 }
      }
    },
    {
      name: 'Product Concept Development',
      agent: 'sales-rnd',
      query: 'Develop a comprehensive product concept for a anti-aging serum targeting women 45-65 in premium EU market. Include formulation approach, pricing strategy, market positioning, and regulatory considerations.',
      context: {
        userId: 'product-manager-001',
        userRole: 'product_manager',
        queryType: 'concept_development',
        targetRegions: ['EU'],
        clientBrief: {
          targetCustomer: 'women 45-65',
          painPoints: ['wrinkles', 'loss of firmness', 'uneven tone'],
          productCategory: 'serum',
          region: 'EU',
          constraints: ['premium positioning', 'sustainable packaging'],
          heroClaims: ['anti-aging', 'firming', 'brightening'],
          priceTier: 'premium',
          texture: 'luxurious serum'
        }
      },
      expectations: {
        success: true,
        qualityScore: { min: 0.7, max: 1.0 },
        includesMarketIntelligence: true,
        includesCostAnalysis: true,
        commercialViability: { min: 0.6, max: 1.0 },
        processingTime: { max: 30000 }
      }
    },
    {
      name: 'Market Analysis Query',
      agent: 'sales-rnd',
      query: 'Analyze the natural and clean beauty trend for facial cleansers in US market targeting Gen Z consumers. Include market size, growth trends, key competitors, and pricing strategies.',
      context: {
        userId: 'market-analyst-001',
        userRole: 'market_analyst',
        queryType: 'market_analysis',
        targetRegions: ['US'],
        clientBrief: {
          targetCustomer: 'Gen Z (16-24)',
          painPoints: ['acne', 'environmental concerns'],
          productCategory: 'cleanser',
          region: 'US',
          constraints: ['natural', 'sustainable', 'vegan'],
          heroClaims: ['clean beauty', 'gentle cleansing'],
          priceTier: 'masstige'
        }
      },
      expectations: {
        success: true,
        qualityScore: { min: 0.7, max: 1.0 },
        includesMarketData: true,
        includesCompetitiveAnalysis: true,
        salesQualityScore: { min: 0.6, max: 1.0 },
        processingTime: { max: 30000 }
      }
    },
    {
      name: 'Regulatory Compliance Query',
      agent: 'raw-materials',
      query: 'What are the regulatory requirements for launching a new sunscreen product with SPF 50+ in EU market? Include ingredient restrictions, testing requirements, and labeling obligations.',
      context: {
        userId: 'regulatory-specialist-001',
        userRole: 'regulatory_specialist',
        queryType: 'regulatory',
        productType: 'sun_care',
        targetRegions: ['EU']
      },
      expectations: {
        success: true,
        qualityScore: { min: 0.8, max: 1.0 },
        regulatoryCompliant: true,
        includesRegulatoryData: true,
        processingTime: { max: 30000 }
      }
    },
    {
      name: 'Complex Formulation Query',
      agent: 'sales-rnd',
      query: 'Create a formulation concept for a vitamin C serum with 15% L-ascorbic acid for US market. Consider stability challenges, packaging requirements, cost optimization, and competitive positioning.',
      context: {
        userId: 'rd-director-001',
        userRole: 'rd_scientist',
        queryType: 'concept_development',
        targetRegions: ['US'],
        clientBrief: {
          targetCustomer: 'women 25-45',
          painPoints: ['dullness', 'oxidative stress'],
          productCategory: 'serum',
          region: 'US',
          constraints: ['stable formulation', 'effective delivery'],
          heroClaims: ['antioxidant protection', 'brightening'],
          priceTier: 'premium',
          activeIngredient: 'L-ascorbic acid'
        }
      },
      expectations: {
        success: true,
        qualityScore: { min: 0.7, max: 1.0 },
        includesFormulationGuidance: true,
        includesCostAnalysis: true,
        commercialViability: { min: 0.6, max: 1.0 },
        processingTime: { max: 30000 }
      }
    }
  ]
};

/**
 * E2E Test Result Interface
 */
interface E2ETestResult {
  scenario: string;
  agent: string;
  success: boolean;
  processingTime: number;
  qualityScore: number;
  expectations: any;
  actualResults: any;
  passedExpectations: string[];
  failedExpectations: string[];
  warnings: string[];
  error?: string;
}

/**
 * Enhanced Agents E2E Test Suite
 */
export class EnhancedAgentsE2ETestSuite {
  private config: any;
  private results: E2ETestResult[] = [];

  constructor(config = E2E_CONFIG) {
    this.config = config;
  }

  /**
   * Run all E2E tests
   */
  async runAllTests(): Promise<E2ETestSuiteResult> {
    console.log('🚀 [EnhancedAgentsE2ETestSuite] Starting end-to-end testing...');
    console.log(`📋 [Test Plan] ${this.config.realScenarios.length} real-world scenarios to execute\n`);

    const startTime = Date.now();
    this.results = [];

    try {
      // Run each scenario
      for (const scenario of this.config.realScenarios) {
        console.log(`🎭 [E2E Test] Executing: ${scenario.name}`);
        const result = await this.executeScenario(scenario);
        this.results.push(result);
        this.logScenarioResult(result);

        // Small delay between tests to avoid overwhelming services
        await this.delay(1000);
      }

      const totalTime = Date.now() - startTime;
      const summary = this.generateE2ETestSummary(totalTime);

      console.log('\n✅ [EnhancedAgentsE2ETestSuite] E2E testing completed!');
      console.log(`📊 [Summary] ${summary.passedTests}/${summary.totalTests} scenarios passed (${summary.successRate.toFixed(1)}%)`);
      console.log(`⏱️ [Timing] Total time: ${(totalTime / 1000).toFixed(2)}s`);

      return summary;

    } catch (error) {
      console.error('❌ [EnhancedAgentsE2ETestSuite] E2E test suite failed:', error);
      throw error;
    }
  }

  /**
   * Execute a single E2E test scenario
   */
  private async executeScenario(scenario: any): Promise<E2ETestResult> {
    const startTime = Date.now();
    let result: E2ETestResult = {
      scenario: scenario.name,
      agent: scenario.agent,
      success: false,
      processingTime: 0,
      qualityScore: 0,
      expectations: scenario.expectations,
      actualResults: {},
      passedExpectations: [],
      failedExpectations: [],
      warnings: []
    };

    try {
      // Select appropriate agent
      const agent = scenario.agent === 'raw-materials'
        ? new EnhancedRawMaterialsAgent()
        : new EnhancedSalesRndAgent();

      console.log(`  🔍 [${scenario.agent.toUpperCase()}] Query: ${scenario.query.substring(0, 100)}...`);

      // Execute the query with retry logic
      let response;
      for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
        try {
          response = await agent.generateEnhancedResponse(scenario.query, scenario.context);
          break;
        } catch (error) {
          if (attempt === this.config.retryAttempts) throw error;
          console.log(`    ⚠️ [Retry] Attempt ${attempt} failed, retrying...`);
          await this.delay(2000 * attempt); // Exponential backoff
        }
      }

      result.processingTime = Date.now() - startTime;
      result.success = response.success;
      result.actualResults = response;

      if (response.success) {
        // Extract metrics from response
        result.qualityScore = response.quality?.overallScore || 0;

        // Validate expectations
        this.validateScenarioExpectations(result, response, scenario.expectations);

        // Add additional metrics based on agent type
        if (scenario.agent === 'sales-rnd') {
          result.actualResults.salesQualityScore = response.salesQuality?.overallSalesQuality || 0;
          result.actualResults.commercialViability = response.optimizations?.responseReranking?.commercialViability || 0;
        }

      } else {
        result.error = response.error;
        result.failedExpectations.push(`Response failed: ${response.error}`);
      }

      return result;

    } catch (error) {
      result.processingTime = Date.now() - startTime;
      result.error = error instanceof Error ? error.message : 'Unknown error';
      result.failedExpectations.push(`Test execution failed: ${result.error}`);
      return result;
    }
  }

  /**
   * Validate scenario expectations against actual results
   */
  private validateScenarioExpectations(result: E2ETestResult, response: any, expectations: any): void {
    // Check success expectation
    if (expectations.success !== undefined && response.success !== expectations.success) {
      result.failedExpectations.push(`Expected success: ${expectations.success}, got: ${response.success}`);
    } else {
      result.passedExpectations.push('Response success status matches expectation');
    }

    // Check quality score range
    if (expectations.qualityScore) {
      const score = response.quality?.overallScore || 0;
      if (score >= expectations.qualityScore.min && score <= expectations.qualityScore.max) {
        result.passedExpectations.push(`Quality score ${(score * 100).toFixed(1)}% within expected range`);
      } else {
        result.failedExpectations.push(`Quality score ${(score * 100).toFixed(1)}% outside expected range [${(expectations.qualityScore.min * 100).toFixed(1)}%, ${(expectations.qualityScore.max * 100).toFixed(1)}%]`);
      }
    }

    // Check regulatory compliance
    if (expectations.regulatoryCompliant !== undefined) {
      const compliant = response.compliance?.meetsMinimum || false;
      if (compliant === expectations.regulatoryCompliant) {
        result.passedExpectations.push('Regulatory compliance status matches expectation');
      } else {
        result.failedExpectations.push(`Expected regulatory compliant: ${expectations.regulatoryCompliant}, got: ${compliant}`);
      }
    }

    // Check processing time
    if (expectations.processingTime) {
      if (result.processingTime <= expectations.processingTime.max) {
        result.passedExpectations.push(`Processing time ${result.processingTime}ms within limit`);
      } else {
        result.failedExpectations.push(`Processing time ${result.processingTime}ms exceeds limit of ${expectations.processingTime.max}ms`);
        result.warnings.push('Slow response time detected');
      }
    }

    // Check content-specific expectations
    if (expectations.includesSafetyData) {
      const hasSafetyData = response.response.toLowerCase().includes('safety') ||
                           response.response.toLowerCase().includes('toxicity') ||
                           response.response.toLowerCase().includes('irritation');
      if (hasSafetyData) {
        result.passedExpectations.push('Response includes safety data');
      } else {
        result.failedExpectations.push('Response missing expected safety data');
      }
    }

    if (expectations.includesComparison) {
      const hasComparison = response.response.toLowerCase().includes('compare') ||
                           response.response.toLowerCase().includes('versus') ||
                           response.response.toLowerCase().includes('better');
      if (hasComparison) {
        result.passedExpectations.push('Response includes comparison data');
      } else {
        result.failedExpectations.push('Response missing expected comparison data');
      }
    }

    if (expectations.includesMarketIntelligence) {
      const hasMarketData = response.marketData && response.marketData.length > 0;
      if (hasMarketData) {
        result.passedExpectations.push('Response includes market intelligence data');
      } else {
        result.failedExpectations.push('Response missing expected market intelligence');
      }
    }

    if (expectations.includesCostAnalysis) {
      const hasCostData = response.costData && response.costData.formulationCost;
      if (hasCostData) {
        result.passedExpectations.push('Response includes cost analysis');
      } else {
        result.failedExpectations.push('Response missing expected cost analysis');
      }
    }

    if (expectations.includesRegulatoryData) {
      const hasRegulatoryData = response.regulatoryData && response.regulatoryData.length > 0;
      if (hasRegulatoryData) {
        result.passedExpectations.push('Response includes regulatory data');
      } else {
        result.failedExpectations.push('Response missing expected regulatory data');
      }
    }

    // Check agent-specific expectations
    if (expectations.commercialViability) {
      const viability = response.optimizations?.responseReranking?.commercialViability || 0;
      if (viability >= expectations.commercialViability.min && viability <= expectations.commercialViability.max) {
        result.passedExpectations.push(`Commercial viability ${(viability * 100).toFixed(1)}% within expected range`);
      } else {
        result.failedExpectations.push(`Commercial viability ${(viability * 100).toFixed(1)}% outside expected range`);
      }
    }

    if (expectations.salesQualityScore) {
      const salesQuality = response.salesQuality?.overallSalesQuality || 0;
      if (salesQuality >= expectations.salesQualityScore.min && salesQuality <= expectations.salesQualityScore.max) {
        result.passedExpectations.push(`Sales quality score ${(salesQuality * 100).toFixed(1)}% within expected range`);
      } else {
        result.failedExpectations.push(`Sales quality score ${(salesQuality * 100).toFixed(1)}% outside expected range`);
      }
    }

    // Check for optimization enablement
    if (response.optimizations) {
      const enabledOptimizations = Object.keys(response.optimizations).filter(key =>
        response.optimizations[key].enabled
      ).length;
      const totalOptimizations = Object.keys(response.optimizations).length;

      if (enabledOptimizations >= totalOptimizations * 0.75) { // At least 75% enabled
        result.passedExpectations.push(`${enabledOptimizations}/${totalOptimizations} optimizations enabled`);
      } else {
        result.warnings.push(`Only ${enabledOptimizations}/${totalOptimizations} optimizations enabled`);
      }
    }

    // Add response quality checks
    const responseLength = response.response.length;
    if (responseLength > 500) {
      result.passedExpectations.push('Response length adequate (> 500 characters)');
    } else {
      result.warnings.push('Response might be too brief');
    }

    // Check for structured content
    if (response.response.includes('\n') || response.response.includes(':')) {
      result.passedExpectations.push('Response has structured content');
    }
  }

  /**
   * Log scenario result
   */
  private logScenarioResult(result: E2ETestResult): void {
    const status = result.success ? '✅' : '❌';
    const time = (result.processingTime / 1000).toFixed(2);
    const quality = (result.qualityScore * 100).toFixed(1);

    console.log(`    ${status} ${result.scenario}: ${result.success ? 'PASSED' : 'FAILED'} (${time}s, Quality: ${quality}%)`);

    if (result.passedExpectations.length > 0) {
      console.log(`      ✓ ${result.passedExpectations.length} expectations passed`);
    }

    if (result.failedExpectations.length > 0) {
      console.log(`      ✗ ${result.failedExpectations.length} expectations failed`);
      result.failedExpectations.slice(0, 2).forEach(failed => {
        console.log(`        - ${failed}`);
      });
    }

    if (result.warnings.length > 0) {
      console.log(`      ⚠️ ${result.warnings.length} warnings`);
    }
  }

  /**
   * Generate E2E test summary
   */
  private generateE2ETestSummary(totalTime: number): E2ETestSuiteResult {
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

    // Count total expectations
    const totalExpectations = this.results.reduce((sum, r) =>
      sum + r.passedExpectations.length + r.failedExpectations.length, 0);
    const passedExpectations = this.results.reduce((sum, r) =>
      sum + r.passedExpectations.length, 0);
    const expectationSuccessRate = totalExpectations > 0 ? (passedExpectations / totalExpectations) * 100 : 0;

    // Agent-specific stats
    const rawMaterialsResults = this.results.filter(r => r.agent === 'raw-materials');
    const salesRndResults = this.results.filter(r => r.agent === 'sales-rnd');

    return {
      totalTests,
      passedTests,
      failedTests,
      successRate,
      totalTime,
      avgProcessingTime,
      avgQualityScore,
      totalExpectations,
      passedExpectations,
      expectationSuccessRate,
      agentStats: {
        rawMaterials: {
          total: rawMaterialsResults.length,
          passed: rawMaterialsResults.filter(r => r.success).length,
          avgQuality: rawMaterialsResults.filter(r => r.success).reduce((sum, r) => sum + r.qualityScore, 0) / (rawMaterialsResults.filter(r => r.success).length || 1)
        },
        salesRnd: {
          total: salesRndResults.length,
          passed: salesRndResults.filter(r => r.success).length,
          avgQuality: salesRndResults.filter(r => r.success).reduce((sum, r) => sum + r.qualityScore, 0) / (salesRndResults.filter(r => r.success).length || 1)
        }
      },
      results: this.results
    };
  }

  /**
   * Quick E2E validation (subset of scenarios)
   */
  async runQuickValidation(): Promise<QuickE2EResult> {
    console.log('⚡ [EnhancedAgentsE2ETestSuite] Running quick E2E validation...');

    // Run only 2 key scenarios for quick validation
    const quickScenarios = [
      this.config.realScenarios.find(s => s.name === 'Safety Assessment Query'),
      this.config.realScenarios.find(s => s.name === 'Product Concept Development')
    ].filter(Boolean);

    const results: E2ETestResult[] = [];

    try {
      for (const scenario of quickScenarios) {
        console.log(`🎭 [Quick Test] ${scenario.name}`);
        const result = await this.executeScenario(scenario);
        results.push(result);
        this.logScenarioResult(result);
      }

      const allPassed = results.every(r => r.success);
      const avgQuality = results.reduce((sum, r) => sum + r.qualityScore, 0) / results.length;

      console.log(`\n${allPassed ? '✅' : '❌'} Quick E2E validation ${allPassed ? 'passed' : 'failed'}`);
      console.log(`📊 Average quality: ${(avgQuality * 100).toFixed(1)}%`);

      return {
        passed: allPassed,
        avgQualityScore: avgQuality,
        results,
        summary: {
          totalTests: results.length,
          passedTests: results.filter(r => r.success).length,
          failedTests: results.filter(r => !r.success).length
        }
      };

    } catch (error) {
      console.error('❌ Quick E2E validation failed:', error);
      return {
        passed: false,
        avgQualityScore: 0,
        results: [],
        summary: { totalTests: 0, passedTests: 0, failedTests: 0 },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Helper function for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Interface definitions
interface E2ETestSuiteResult {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  successRate: number;
  totalTime: number;
  avgProcessingTime: number;
  avgQualityScore: number;
  totalExpectations: number;
  passedExpectations: number;
  expectationSuccessRate: number;
  agentStats: {
    rawMaterials: { total: number; passed: number; avgQuality: number };
    salesRnd: { total: number; passed: number; avgQuality: number };
  };
  results: E2ETestResult[];
}

interface QuickE2EResult {
  passed: boolean;
  avgQualityScore: number;
  results: E2ETestResult[];
  summary: { totalTests: number; passedTests: number; failedTests: number };
  error?: string;
}

/**
 * Run E2E tests if this file is executed directly
 */
if (require.main === module) {
  const testSuite = new EnhancedAgentsE2ETestSuite();

  console.log('🧪 [EnhancedAgentsE2ETests] End-to-End Testing for Enhanced AI Agents');
  console.log('======================================================================\n');

  console.log('Choose test mode:');
  console.log('1. Quick validation (2 scenarios)');
  console.log('2. Full E2E test suite (6 scenarios)');

  const mode = process.argv[2] || '1';

  if (mode === '1') {
    testSuite.runQuickValidation()
      .then(result => {
        console.log('\n📋 Quick E2E Validation Results:');
        console.log(`Status: ${result.passed ? 'PASSED' : 'FAILED'}`);
        console.log(`Scenarios: ${result.summary.passedTests}/${result.summary.totalTests} passed`);
        console.log(`Average Quality: ${(result.avgQualityScore * 100).toFixed(1)}%`);
        console.log('\n🎉 Enhanced agents E2E validation completed!');
        process.exit(result.passed ? 0 : 1);
      })
      .catch(error => {
        console.error('❌ E2E validation failed:', error);
        process.exit(1);
      });
  } else {
    testSuite.runAllTests()
      .then(result => {
        console.log('\n📋 Full E2E Test Suite Results:');
        console.log('=====================================\n');
        console.log(`Overall Status: ${result.successRate >= 80 ? '✅ PASSED' : '⚠️ NEEDS ATTENTION'}`);
        console.log(`Success Rate: ${result.successRate.toFixed(1)}% (${result.passedTests}/${result.totalTests} scenarios)`);
        console.log(`Expectation Success Rate: ${result.expectationSuccessRate.toFixed(1)}%`);
        console.log(`Average Quality Score: ${(result.avgQualityScore * 100).toFixed(1)}%`);
        console.log(`Average Processing Time: ${(result.avgProcessingTime / 1000).toFixed(2)}s`);
        console.log(`Total Test Time: ${(result.totalTime / 1000).toFixed(2)}s\n`);

        console.log('Agent Performance:');
        console.log(`  Raw Materials Agent: ${result.agentStats.rawMaterials.passed}/${result.agentStats.rawMaterials.total} passed (Avg Quality: ${(result.agentStats.rawMaterials.avgQuality * 100).toFixed(1)}%)`);
        console.log(`  Sales R&D Agent: ${result.agentStats.salesRnd.passed}/${result.agentStats.salesRnd.total} passed (Avg Quality: ${(result.agentStats.salesRnd.avgQuality * 100).toFixed(1)}%)\n`);

        if (result.failedTests > 0) {
          console.log('Failed Scenarios:');
          result.results.filter(r => !r.success).forEach(r => {
            console.log(`  - ${r.scenario}: ${r.error || 'Multiple expectation failures'}`);
          });
        }

        console.log('\n🎯 E2E Testing Recommendations:');
        if (result.successRate >= 80) {
          console.log('✅ Enhanced agents are ready for production deployment');
          console.log('📈 Performance meets quality standards');
        } else {
          console.log('⚠️ Some scenarios need attention before production deployment');
          console.log('🔧 Review failed scenarios and optimize accordingly');
        }

        process.exit(result.successRate >= 80 ? 0 : 1);
      })
      .catch(error => {
        console.error('❌ E2E test suite failed:', error);
        process.exit(1);
      });
  }
}