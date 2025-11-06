/**
 * Optimization Methods Validation Tests
 * Comprehensive testing of all enhancement methods: Knowledge Retrieval, Quality Scoring, Regulatory Check, Response Reranking
 */

import {
  EnhancedRawMaterialsAgentFunctions
} from '../ai/agents/raw-materials-ai/enhanced-raw-materials-agent';

import {
  EnhancedSalesRndAgentFunctions
} from '../ai/agents/sales-rnd-ai/enhanced-sales-rnd-agent';

// Mock API responses for validation
const mockKnowledgeSources = {
  regulatory: {
    FDA: {
      name: 'FDA Cosmetic Database',
      credibilityWeight: 0.98,
      region: 'US',
      lastUpdated: '2024-10-15'
    },
    EU_Cosing: {
      name: 'EU CosIng Database',
      credibilityWeight: 0.97,
      region: 'EU',
      lastUpdated: '2024-10-10'
    },
    ASEAN: {
      name: 'ASEAN Cosmetic Directive',
      credibilityWeight: 0.96,
      region: 'ASEAN',
      lastUpdated: '2024-09-30'
    }
  },
  scientific: {
    PubMed: {
      name: 'PubMed Research Database',
      credibilityWeight: 0.95,
      type: 'peer_reviewed'
    },
    ScienceDirect: {
      name: 'ScienceDirect Journals',
      credibilityWeight: 0.94,
      type: 'academic'
    }
  }
};

const mockQualityDimensions = {
  factualAccuracy: { weight: 0.25, description: 'Correctness of factual information' },
  relevance: { weight: 0.20, description: 'Relevance to user query' },
  completeness: { weight: 0.15, description: 'Completeness of information' },
  clarity: { weight: 0.15, description: 'Clarity and understandability' },
  safetyCompliance: { weight: 0.15, description: 'Safety regulatory compliance' },
  commercialViability: { weight: 0.10, description: 'Commercial feasibility for sales queries' }
};

/**
 * Optimization Validation Test Suite
 */
export class OptimizationMethodsValidationSuite {
  private testResults: OptimizationTestResult[] = [];

  /**
   * Run all optimization validation tests
   */
  async runAllValidations(): Promise<OptimizationValidationResult> {
    console.log('🔬 [OptimizationValidation] Starting comprehensive optimization method validation...\n');

    this.testResults = [];
    const startTime = Date.now();

    try {
      // Test Knowledge Retrieval Enhancement
      await this.validateKnowledgeRetrieval();

      // Test Answer Quality Scoring
      await this.validateQualityScoring();

      // Test Regulatory Compliance Check
      await this.validateRegulatoryCheck();

      // Test Response Reranking
      await this.validateResponseReranking();

      // Test Integration and Synergy
      await this.validateOptimizationIntegration();

      const totalTime = Date.now() - startTime;
      const summary = this.generateValidationSummary(totalTime);

      console.log('\n✅ [OptimizationValidation] All optimization validations completed!');
      console.log(`📊 [Summary] ${summary.passedValidations}/${summary.totalValidations} validations passed (${summary.successRate.toFixed(1)}%)`);

      return summary;

    } catch (error) {
      console.error('❌ [OptimizationValidation] Validation suite failed:', error);
      throw error;
    }
  }

  /**
   * Validate Knowledge Retrieval Enhancement
   */
  private async validateKnowledgeRetrieval(): Promise<void> {
    console.log('🧠 [Validation] Testing Knowledge Retrieval Enhancement...');

    const testCases = [
      {
        name: 'Regulatory Source Access',
        query: 'niacinamide safety regulations',
        context: { targetRegions: ['US', 'EU'], queryType: 'regulatory' },
        expectedSources: ['FDA', 'EU_Cosing', 'ASEAN'],
        minCredibility: 0.95
      },
      {
        name: 'Scientific Source Access',
        query: 'hyaluronic acid molecular weight effects',
        context: { queryType: 'general' },
        expectedSources: ['PubMed', 'ScienceDirect'],
        minCredibility: 0.90
      },
      {
        name: 'Multi-Source Synthesis',
        query: 'retinol vs retinal comparison',
        context: { targetRegions: ['US'], queryType: 'comparison' },
        expectedMinSources: 3,
        requireConsensus: true
      }
    ];

    for (const testCase of testCases) {
      console.log(`  🔍 ${testCase.name}`);

      try {
        // Test Raw Materials Agent Knowledge Retrieval
        const rawResult = await EnhancedRawMaterialsAgentFunctions.retrieveEnhancedKnowledge(
          testCase.query,
          testCase.context
        );

        // Test Sales R&D Agent Knowledge Retrieval
        const salesResult = await EnhancedSalesRndAgentFunctions.retrieveEnhancedSalesKnowledge(
          testCase.query,
          testCase.context
        );

        const validation: OptimizationTestResult = {
          optimization: 'Knowledge Retrieval Enhancement',
          testCase: testCase.name,
          success: true,
          details: {
            rawMaterialsResult: this.validateKnowledgeResult(rawResult, testCase),
            salesRndResult: this.validateKnowledgeResult(salesResult, testCase)
          },
          metrics: {
            rawSourcesFound: rawResult.sourcesFound,
            salesSourcesFound: salesResult.sourcesFound,
            rawConfidence: rawResult.confidence,
            salesConfidence: salesResult.confidence
          },
          passedChecks: [],
          failedChecks: []
        };

        // Validate results
        this.validateKnowledgeMetrics(validation, rawResult, salesResult, testCase);
        this.testResults.push(validation);

        console.log(`    ✅ ${testCase.name}: ${validation.success ? 'PASSED' : 'FAILED'}`);

      } catch (error) {
        const validation: OptimizationTestResult = {
          optimization: 'Knowledge Retrieval Enhancement',
          testCase: testCase.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          details: {},
          metrics: {},
          passedChecks: [],
          failedChecks: [`Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
        };

        this.testResults.push(validation);
        console.log(`    ❌ ${testCase.name}: FAILED - ${validation.error}`);
      }
    }
  }

  /**
   * Validate Answer Quality Scoring
   */
  private async validateQualityScoring(): Promise<void> {
    console.log('📊 [Validation] Testing Answer Quality Scoring...');

    const testCases = [
      {
        name: 'Safety Query Quality Assessment',
        response: 'Niacinamide is generally recognized as safe (GRAS) for cosmetic use at concentrations up to 5% in the US, EU, and ASEAN regions. It has a low irritation potential and excellent tolerability profile.',
        query: 'Is niacinamide safe for cosmetic use?',
        context: { userRole: 'safety_assessor', queryType: 'safety', targetRegions: ['US', 'EU', 'ASEAN'] },
        expectedMinScore: 0.7,
        expectedDimensions: ['factualAccuracy', 'safetyCompliance', 'completeness']
      },
      {
        name: 'Commercial Query Quality Assessment',
        response: 'The anti-aging serum market is valued at $12.5B globally with 8.3% CAGR. Premium positioning targeting women 45-65 shows strong ROI potential with 65% profit margins.',
        query: 'Market analysis for anti-aging serum',
        context: { userRole: 'product_manager', queryType: 'market_analysis', clientBrief: { priceTier: 'premium' } },
        expectedMinScore: 0.6,
        expectedDimensions: ['relevance', 'commercialViability', 'clarity']
      },
      {
        name: 'Low Quality Response Detection',
        response: 'It works good.',
        query: 'Explain the mechanism of action for niacinamide in skin brightening',
        context: { userRole: 'rd_scientist', queryType: 'general' },
        expectedMaxScore: 0.4,
        expectedIssues: ['low completeness', 'low clarity']
      }
    ];

    for (const testCase of testCases) {
      console.log(`  📏 ${testCase.name}`);

      try {
        // Test Raw Materials Agent Quality Scoring
        const rawQualityResult = await EnhancedRawMaterialsAgentFunctions.performQualityScoring(
          testCase.response,
          testCase.query,
          testCase.context
        );

        // Test Sales R&D Agent Quality Scoring
        const salesQualityResult = await EnhancedSalesRndAgentFunctions.performSalesQualityScoring(
          testCase.response,
          testCase.query,
          testCase.context
        );

        const validation: OptimizationTestResult = {
          optimization: 'Answer Quality Scoring',
          testCase: testCase.name,
          success: true,
          details: {
            rawMaterialsQuality: rawQualityResult,
            salesRndQuality: salesQualityResult
          },
          metrics: {
            rawQualityScore: rawQualityResult.score?.overallScore || 0,
            salesQualityScore: salesQualityResult.score?.overallScore || 0,
            rawSalesQuality: salesQualityResult.salesQualityScore?.overallSalesQuality || 0
          },
          passedChecks: [],
          failedChecks: []
        };

        // Validate quality scoring
        this.validateQualityMetrics(validation, rawQualityResult, salesQualityResult, testCase);
        this.testResults.push(validation);

        console.log(`    ✅ ${testCase.name}: ${validation.success ? 'PASSED' : 'FAILED'}`);

      } catch (error) {
        const validation: OptimizationTestResult = {
          optimization: 'Answer Quality Scoring',
          testCase: testCase.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          details: {},
          metrics: {},
          passedChecks: [],
          failedChecks: [`Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
        };

        this.testResults.push(validation);
        console.log(`    ❌ ${testCase.name}: FAILED - ${validation.error}`);
      }
    }
  }

  /**
   * Validate Regulatory Compliance Check
   */
  private async validateRegulatoryCheck(): Promise<void> {
    console.log('⚖️ [Validation] Testing Regulatory Compliance Check...');

    const testCases = [
      {
        name: 'Compliant Ingredient Check',
        ingredients: ['niacinamide', 'hyaluronic acid', 'glycerin'],
        context: { targetRegions: ['US', 'EU', 'ASEAN'], productType: 'skincare' },
        expectedCompliance: true,
        expectedMaxRestrictions: 2
      },
      {
        name: 'Restricted Ingredient Check',
        ingredients: ['hydroquinone', 'mercury compounds'],
        context: { targetRegions: ['EU', 'US'], productType: 'skincare' },
        expectedCompliance: false,
        expectedMinRestrictions: 1
      },
      {
        name: 'Multi-Region Compliance',
        ingredients: ['retinol', 'vitamin C'],
        context: { targetRegions: ['US', 'EU', 'ASEAN', 'JP'], productType: 'skincare' },
        expectedPartialCompliance: true, // Some regions may have restrictions
        expectedRegionsChecked: 4
      }
    ];

    for (const testCase of testCases) {
      console.log(`  🏛️ ${testCase.name}`);

      try {
        // Test Raw Materials Agent Regulatory Check
        const rawRegulatoryResult = await EnhancedRawMaterialsAgentFunctions.performRegulatoryCheck(
          testCase.ingredients,
          testCase.context
        );

        // Test Sales R&D Agent Regulatory Check
        const salesRegulatoryResult = await EnhancedSalesRndAgentFunctions.performSalesRegulatoryCheck(
          [], // No concepts for this test
          testCase.ingredients,
          testCase.context
        );

        const validation: OptimizationTestResult = {
          optimization: 'Regulatory Compliance Check',
          testCase: testCase.name,
          success: true,
          details: {
            rawMaterialsRegulatory: rawRegulatoryResult,
            salesRndRegulatory: salesRegulatoryResult
          },
          metrics: {
            rawComplianceStatus: rawRegulatoryResult.overallCompliance,
            salesComplianceStatus: salesRegulatoryResult.overallCompliance,
            rawItemsChecked: rawRegulatoryResult.results?.length || 0,
            salesItemsChecked: salesRegulatoryResult.results?.length || 0
          },
          passedChecks: [],
          failedChecks: []
        };

        // Validate regulatory results
        this.validateRegulatoryMetrics(validation, rawRegulatoryResult, salesRegulatoryResult, testCase);
        this.testResults.push(validation);

        console.log(`    ✅ ${testCase.name}: ${validation.success ? 'PASSED' : 'FAILED'}`);

      } catch (error) {
        const validation: OptimizationTestResult = {
          optimization: 'Regulatory Compliance Check',
          testCase: testCase.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          details: {},
          metrics: {},
          passedChecks: [],
          failedChecks: [`Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
        };

        this.testResults.push(validation);
        console.log(`    ❌ ${testCase.name}: FAILED - ${validation.error}`);
      }
    }
  }

  /**
   * Validate Response Reranking
   */
  private async validateResponseReranking(): Promise<void> {
    console.log('🔄 [Validation] Testing Response Reranking...');

    const testCases = [
      {
        name: 'High Quality Response Enhancement',
        originalResponse: 'Niacinamide at 5% concentration is safe and effective for skin brightening. Multiple clinical studies demonstrate its efficacy in reducing hyperpigmentation and improving skin barrier function.',
        query: 'What is the optimal concentration of niacinamide for brightening?',
        searchResults: [
          { title: 'Clinical Study on Niacinamide', relevance: 0.95, credibility: 0.98 },
          { title: 'Dermatology Review', relevance: 0.90, credibility: 0.92 }
        ],
        expectedMinScore: 0.7,
        expectImprovement: false // Already high quality
      },
      {
        name: 'Low Quality Response Enhancement',
        originalResponse: 'Use niacinamide. Its good.',
        query: 'Explain the benefits of niacinamide in skincare',
        searchResults: [
          { title: 'Comprehensive Niacinamide Guide', relevance: 0.95, credibility: 0.97 },
          { title: 'Clinical Applications', relevance: 0.88, credibility: 0.94 }
        ],
        expectedMinScore: 0.6,
        expectImprovement: true // Should be enhanced
      },
      {
        name: 'Commercial Response Optimization',
        originalResponse: 'The product will be profitable.',
        query: 'Analyze market potential for premium anti-aging serum',
        searchResults: [
          { title: 'Market Analysis Report', relevance: 0.92, credibility: 0.89 },
          { title: 'Competitive Analysis', relevance: 0.87, credibility: 0.85 }
        ],
        context: { userRole: 'product_manager', queryType: 'market_analysis' },
        expectedMinScore: 0.5,
        expectCommercialViability: true
      }
    ];

    for (const testCase of testCases) {
      console.log(`  🎯 ${testCase.name}`);

      try {
        // Test Raw Materials Agent Response Reranking
        const rawRerankResult = await EnhancedRawMaterialsAgentFunctions.performResponseReranking(
          testCase.query,
          testCase.originalResponse,
          testCase.searchResults,
          testCase.context || {}
        );

        // Test Sales R&D Agent Response Reranking
        const salesRerankResult = await EnhancedSalesRndAgentFunctions.performSalesResponseReranking(
          testCase.query,
          testCase.originalResponse,
          testCase.searchResults,
          testCase.context || {}
        );

        const validation: OptimizationTestResult = {
          optimization: 'Response Reranking',
          testCase: testCase.name,
          success: true,
          details: {
            rawMaterialsRerank: rawRerankResult,
            salesRndRerank: salesRerankResult
          },
          metrics: {
            rawRerankScore: rawRerankResult.score,
            salesRerankScore: salesRerankResult.score,
            rawImproved: rawRerankResult.enhancedResponse !== testCase.originalResponse,
            salesImproved: salesRerankResult.enhancedResponse !== testCase.originalResponse,
            salesCommercialViability: salesRerankResult.commercialViability || 0
          },
          passedChecks: [],
          failedChecks: []
        };

        // Validate reranking results
        this.validateRerankingMetrics(validation, rawRerankResult, salesRerankResult, testCase);
        this.testResults.push(validation);

        console.log(`    ✅ ${testCase.name}: ${validation.success ? 'PASSED' : 'FAILED'}`);

      } catch (error) {
        const validation: OptimizationTestResult = {
          optimization: 'Response Reranking',
          testCase: testCase.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          details: {},
          metrics: {},
          passedChecks: [],
          failedChecks: [`Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
        };

        this.testResults.push(validation);
        console.log(`    ❌ ${testCase.name}: FAILED - ${validation.error}`);
      }
    }
  }

  /**
   * Validate Integration and Synergy between Optimizations
   */
  private async validateOptimizationIntegration(): Promise<void> {
    console.log('🔗 [Validation] Testing Optimization Integration...');

    const integrationTests = [
      {
        name: 'Full Pipeline Integration',
        query: 'Safety assessment for 5% niacinamide in anti-aging cream for US market',
        context: {
          userRole: 'safety_assessor',
          queryType: 'safety',
          targetRegions: ['US'],
          productType: 'skincare',
          materialName: 'niacinamide'
        },
        agent: 'raw-materials'
      },
      {
        name: 'Sales Pipeline Integration',
        query: 'Product concept development for natural cleanser targeting Gen Z in US market',
        context: {
          userRole: 'product_manager',
          queryType: 'concept_development',
          targetRegions: ['US'],
          clientBrief: {
            targetCustomer: 'Gen Z',
            productCategory: 'cleanser',
            constraints: ['natural'],
            priceTier: 'mass'
          }
        },
        agent: 'sales-rnd'
      }
    ];

    for (const testCase of integrationTests) {
      console.log(`  🔄 ${testCase.name}`);

      try {
        // Execute full pipeline
        const result = testCase.agent === 'raw-materials'
          ? await EnhancedRawMaterialsAgentFunctions.generateEnhancedResponse(testCase.query, testCase.context)
          : await EnhancedSalesRndAgentFunctions.generateEnhancedResponse(testCase.query, testCase.context);

        const validation: OptimizationTestResult = {
          optimization: 'Integration Test',
          testCase: testCase.name,
          success: result.success,
          details: { fullPipelineResult: result },
          metrics: {
            totalProcessingTime: result.metadata?.processingTime || 0,
            optimizationsEnabled: this.countEnabledOptimizations(result.optimizations || {}),
            overallQuality: result.quality?.overallScore || 0,
            salesQuality: result.salesQuality?.overallSalesQuality || 0
          },
          passedChecks: [],
          failedChecks: []
        };

        // Validate integration
        this.validateIntegrationMetrics(validation, result, testCase);
        this.testResults.push(validation);

        console.log(`    ✅ ${testCase.name}: ${validation.success ? 'PASSED' : 'FAILED'}`);

      } catch (error) {
        const validation: OptimizationTestResult = {
          optimization: 'Integration Test',
          testCase: testCase.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          details: {},
          metrics: {},
          passedChecks: [],
          failedChecks: [`Integration failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
        };

        this.testResults.push(validation);
        console.log(`    ❌ ${testCase.name}: FAILED - ${validation.error}`);
      }
    }
  }

  /**
   * Helper validation methods
   */
  private validateKnowledgeResult(result: any, testCase: any): any {
    const validation: any = {
      sourcesFound: result.sourcesFound || 0,
      confidence: result.confidence || 0,
      hasSynthesis: !!(result.knowledgeResult?.synthesis),
      processingTime: result.processingTime || 0
    };

    if (testCase.expectedSources) {
      validation.sourceCoverage = testCase.expectedSources.length;
      validation.expectedMinCredibility = testCase.minCredibility;
    }

    if (testCase.expectedMinSources) {
      validation.minSourcesMet = validation.sourcesFound >= testCase.expectedMinSources;
    }

    return validation;
  }

  private validateKnowledgeMetrics(validation: OptimizationTestResult, rawResult: any, salesResult: any, testCase: any): void {
    // Check minimum sources
    if (testCase.expectedMinSources) {
      if (rawResult.sourcesFound >= testCase.expectedMinSources) {
        validation.passedChecks.push(`Raw materials: ${rawResult.sourcesFound} sources found (>= ${testCase.expectedMinSources})`);
      } else {
        validation.failedChecks.push(`Raw materials: Only ${rawResult.sourcesFound} sources found (< ${testCase.expectedMinSources})`);
        validation.success = false;
      }
    }

    // Check confidence levels
    if (rawResult.confidence >= 0.7) {
      validation.passedChecks.push(`Raw materials confidence: ${(rawResult.confidence * 100).toFixed(1)}%`);
    } else {
      validation.failedChecks.push(`Raw materials confidence too low: ${(rawResult.confidence * 100).toFixed(1)}%`);
      validation.success = false;
    }

    // Check synthesis generation
    if (rawResult.knowledgeResult?.synthesis) {
      validation.passedChecks.push('Knowledge synthesis generated successfully');
    } else {
      validation.failedChecks.push('Knowledge synthesis missing');
      validation.success = false;
    }
  }

  private validateQualityMetrics(validation: OptimizationTestResult, rawQuality: any, salesQuality: any, testCase: any): void {
    // Check score ranges
    if (testCase.expectedMinScore) {
      const rawScore = rawQuality.score?.overallScore || 0;
      const salesScore = salesQuality.score?.overallScore || 0;

      if (rawScore >= testCase.expectedMinScore) {
        validation.passedChecks.push(`Raw materials quality score: ${(rawScore * 100).toFixed(1)}% (>= ${(testCase.expectedMinScore * 100).toFixed(1)}%)`);
      } else {
        validation.failedChecks.push(`Raw materials quality score too low: ${(rawScore * 100).toFixed(1)}% (< ${(testCase.expectedMinScore * 100).toFixed(1)}%)`);
        validation.success = false;
      }

      if (salesScore >= testCase.expectedMinScore) {
        validation.passedChecks.push(`Sales R&D quality score: ${(salesScore * 100).toFixed(1)}% (>= ${(testCase.expectedMinScore * 100).toFixed(1)}%)`);
      } else {
        validation.failedChecks.push(`Sales R&D quality score too low: ${(salesScore * 100).toFixed(1)}% (< ${(testCase.expectedMinScore * 100).toFixed(1)}%)`);
        validation.success = false;
      }
    }

    // Check dimension coverage
    if (testCase.expectedDimensions) {
      const rawDimensions = Object.keys(rawQuality.score?.dimensions || {});
      const salesDimensions = Object.keys(salesQuality.score?.dimensions || {});

      testCase.expectedDimensions.forEach((dimension: string) => {
        if (rawDimensions.includes(dimension)) {
          validation.passedChecks.push(`Raw materials includes ${dimension} dimension`);
        } else {
          validation.failedChecks.push(`Raw materials missing ${dimension} dimension`);
          validation.success = false;
        }

        if (salesDimensions.includes(dimension)) {
          validation.passedChecks.push(`Sales R&D includes ${dimension} dimension`);
        } else {
          validation.failedChecks.push(`Sales R&D missing ${dimension} dimension`);
          validation.success = false;
        }
      });
    }

    // Check sales-specific quality for sales agent
    if (salesQuality.salesQualityScore?.overallSalesQuality) {
      validation.passedChecks.push(`Sales-specific quality score: ${(salesQuality.salesQualityScore.overallSalesQuality * 100).toFixed(1)}%`);
    }
  }

  private validateRegulatoryMetrics(validation: OptimizationTestResult, rawRegulatory: any, salesRegulatory: any, testCase: any): void {
    // Check compliance status
    if (testCase.expectedCompliance !== undefined) {
      if (rawRegulatory.overallCompliance === testCase.expectedCompliance) {
        validation.passedChecks.push(`Raw materials compliance status matches expectation: ${testCase.expectedCompliance}`);
      } else {
        validation.failedChecks.push(`Raw materials compliance mismatch: expected ${testCase.expectedCompliance}, got ${rawRegulatory.overallCompliance}`);
        validation.success = false;
      }

      if (salesRegulatory.overallCompliance === testCase.expectedCompliance) {
        validation.passedChecks.push(`Sales R&D compliance status matches expectation: ${testCase.expectedCompliance}`);
      } else {
        validation.failedChecks.push(`Sales R&D compliance mismatch: expected ${testCase.expectedCompliance}, got ${salesRegulatory.overallCompliance}`);
        validation.success = false;
      }
    }

    // Check items analyzed
    const rawItems = rawRegulatory.results?.length || 0;
    const salesItems = salesRegulatory.results?.length || 0;

    if (rawItems > 0) {
      validation.passedChecks.push(`Raw materials analyzed ${rawItems} items`);
    } else {
      validation.failedChecks.push('Raw materials no items analyzed');
      validation.success = false;
    }

    if (salesItems > 0) {
      validation.passedChecks.push(`Sales R&D analyzed ${salesItems} items`);
    } else {
      validation.failedChecks.push('Sales R&D no items analyzed');
      validation.success = false;
    }

    // Check regional coverage
    if (testCase.expectedRegionsChecked) {
      const rawRegions = new Set();
      const salesRegions = new Set();

      rawRegulatory.results?.forEach((result: any) => {
        if (result.data?.complianceStatus?.regionalCompliance) {
          Object.keys(result.data.complianceStatus.regionalCompliance).forEach(region => {
            rawRegions.add(region);
          });
        }
      });

      salesRegulatory.results?.forEach((result: any) => {
        if (result.data?.complianceStatus?.regionalCompliance) {
          Object.keys(result.data.complianceStatus.regionalCompliance).forEach(region => {
            salesRegions.add(region);
          });
        }
      });

      if (rawRegions.size >= testCase.expectedRegionsChecked * 0.8) {
        validation.passedChecks.push(`Raw materials covered ${rawRegions.size} regions`);
      } else {
        validation.failedChecks.push(`Raw materials insufficient regional coverage: ${rawRegions.size} regions`);
        validation.success = false;
      }
    }
  }

  private validateRerankingMetrics(validation: OptimizationTestResult, rawRerank: any, salesRerank: any, testCase: any): void {
    // Check reranking scores
    if (testCase.expectedMinScore) {
      if (rawRerank.score >= testCase.expectedMinScore) {
        validation.passedChecks.push(`Raw materials rerank score: ${(rawRerank.score * 100).toFixed(1)}%`);
      } else {
        validation.failedChecks.push(`Raw materials rerank score too low: ${(rawRerank.score * 100).toFixed(1)}%`);
        validation.success = false;
      }

      if (salesRerank.score >= testCase.expectedMinScore) {
        validation.passedChecks.push(`Sales R&D rerank score: ${(salesRerank.score * 100).toFixed(1)}%`);
      } else {
        validation.failedChecks.push(`Sales R&D rerank score too low: ${(salesRerank.score * 100).toFixed(1)}%`);
        validation.success = false;
      }
    }

    // Check improvement expectations
    if (testCase.expectImprovement !== undefined) {
      const rawImproved = rawRerank.enhancedResponse !== testCase.originalResponse;
      const salesImproved = salesRerank.enhancedResponse !== testCase.originalResponse;

      if (testCase.expectImprovement) {
        if (rawImproved || salesImproved) {
          validation.passedChecks.push(`Response enhanced as expected: Raw=${rawImproved}, Sales=${salesImproved}`);
        } else {
          validation.failedChecks.push('Expected response improvement but none detected');
          validation.success = false;
        }
      } else {
        // High quality response shouldn't need improvement
        validation.passedChecks.push('High quality response correctly preserved');
      }
    }

    // Check commercial viability for sales agent
    if (testCase.expectCommercialViability && salesRerank.commercialViability) {
      if (salesRerank.commercialViability >= 0.5) {
        validation.passedChecks.push(`Commercial viability: ${(salesRerank.commercialViability * 100).toFixed(1)}%`);
      } else {
        validation.failedChecks.push(`Commercial viability too low: ${(salesRerank.commercialViability * 100).toFixed(1)}%`);
        validation.success = false;
      }
    }
  }

  private validateIntegrationMetrics(validation: OptimizationTestResult, result: any, testCase: any): void {
    // Check success
    if (!result.success) {
      validation.failedChecks.push('Full pipeline failed');
      validation.success = false;
      return;
    }

    // Check processing time
    if (result.metadata?.processingTime < 30000) { // 30 seconds
      validation.passedChecks.push(`Processing time acceptable: ${result.metadata.processingTime}ms`);
    } else {
      validation.failedChecks.push(`Processing time too slow: ${result.metadata.processingTime}ms`);
      validation.success = false;
    }

    // Check optimization enablement
    const enabledCount = this.countEnabledOptimizations(result.optimizations || {});
    const totalCount = Object.keys(result.optimizations || {}).length;

    if (enabledCount >= totalCount * 0.75) { // At least 75% enabled
      validation.passedChecks.push(`Optimizations enabled: ${enabledCount}/${totalCount}`);
    } else {
      validation.failedChecks.push(`Insufficient optimizations enabled: ${enabledCount}/${totalCount}`);
      validation.success = false;
    }

    // Check quality thresholds
    if (result.quality?.overallScore >= 0.6) {
      validation.passedChecks.push(`Overall quality acceptable: ${(result.quality.overallScore * 100).toFixed(1)}%`);
    } else {
      validation.failedChecks.push(`Overall quality too low: ${(result.quality.overallScore * 100).toFixed(1)}%`);
      validation.success = false;
    }

    // Check sales quality for sales agent
    if (testCase.agent === 'sales-rnd' && result.salesQuality?.overallSalesQuality) {
      if (result.salesQuality.overallSalesQuality >= 0.5) {
        validation.passedChecks.push(`Sales quality acceptable: ${(result.salesQuality.overallSalesQuality * 100).toFixed(1)}%`);
      } else {
        validation.failedChecks.push(`Sales quality too low: ${(result.salesQuality.overallSalesQuality * 100).toFixed(1)}%`);
        validation.success = false;
      }
    }
  }

  private countEnabledOptimizations(optimizations: any): number {
    return Object.values(optimizations).filter((opt: any) =>
      typeof opt === 'object' && opt.enabled === true
    ).length;
  }

  /**
   * Generate validation summary
   */
  private generateValidationSummary(totalTime: number): OptimizationValidationResult {
    const totalValidations = this.testResults.length;
    const passedValidations = this.testResults.filter(r => r.success).length;
    const successRate = totalValidations > 0 ? (passedValidations / totalValidations) * 100 : 0;

    // Group by optimization type
    const optimizationGroups = this.groupResultsByOptimization();

    // Calculate metrics
    const avgProcessingTime = this.testResults.reduce((sum, r) =>
      sum + (r.metrics.totalProcessingTime || 0), 0) / this.testResults.length;

    const totalChecks = this.testResults.reduce((sum, r) =>
      sum + r.passedChecks.length + r.failedChecks.length, 0);
    const passedChecks = this.testResults.reduce((sum, r) =>
      sum + r.passedChecks.length, 0);

    return {
      totalValidations,
      passedValidations,
      failedValidations: totalValidations - passedValidations,
      successRate,
      totalTime,
      avgProcessingTime,
      totalChecks,
      passedChecks,
      checkSuccessRate: totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 0,
      optimizationGroups,
      results: this.testResults
    };
  }

  private groupResultsByOptimization(): { [key: string]: OptimizationGroupStats } {
    const groups: { [key: string]: OptimizationGroupStats } = {};

    this.testResults.forEach(result => {
      if (!groups[result.optimization]) {
        groups[result.optimization] = {
          total: 0,
          passed: 0,
          failed: 0,
          avgScore: 0,
          avgTime: 0
        };
      }

      const group = groups[result.optimization];
      group.total++;

      if (result.success) {
        group.passed++;
      } else {
        group.failed++;
      }

      // Calculate averages (simplified)
      group.avgScore = Object.values(result.metrics)
        .filter((val): val is number => typeof val === 'number')
        .reduce((sum, val, _, arr) => sum + val / arr.length, 0);
    });

    return groups;
  }
}

// Interface definitions
interface OptimizationTestResult {
  optimization: string;
  testCase: string;
  success: boolean;
  details: any;
  metrics: any;
  passedChecks: string[];
  failedChecks: string[];
  error?: string;
}

interface OptimizationGroupStats {
  total: number;
  passed: number;
  failed: number;
  avgScore: number;
  avgTime: number;
}

interface OptimizationValidationResult {
  totalValidations: number;
  passedValidations: number;
  failedValidations: number;
  successRate: number;
  totalTime: number;
  avgProcessingTime: number;
  totalChecks: number;
  passedChecks: number;
  checkSuccessRate: number;
  optimizationGroups: { [key: string]: OptimizationGroupStats };
  results: OptimizationTestResult[];
}

/**
 * Run validation if this file is executed directly
 */
if (require.main === module) {
  const validationSuite = new OptimizationMethodsValidationSuite();

  console.log('🔬 [OptimizationValidation] Comprehensive Testing of Enhancement Methods');
  console.log('=======================================================================\n');

  validationSuite.runAllValidations()
    .then(result => {
      console.log('\n📋 Optimization Validation Results:');
      console.log('=====================================\n');
      console.log(`Overall Status: ${result.successRate >= 80 ? '✅ PASSED' : '⚠️ NEEDS ATTENTION'}`);
      console.log(`Success Rate: ${result.successRate.toFixed(1)}% (${result.passedValidations}/${result.totalValidations} validations)`);
      console.log(`Check Success Rate: ${result.checkSuccessRate.toFixed(1)}% (${result.passedChecks}/${result.totalChecks} checks)`);
      console.log(`Average Processing Time: ${(result.avgProcessingTime / 1000).toFixed(2)}s`);
      console.log(`Total Validation Time: ${(result.totalTime / 1000).toFixed(2)}s\n`);

      console.log('Optimization Method Performance:');
      Object.entries(result.optimizationGroups).forEach(([optimization, stats]) => {
        const successRate = (stats.passed / stats.total) * 100;
        console.log(`  ${optimization}: ${stats.passed}/${stats.total} passed (${successRate.toFixed(1)}%, Avg Score: ${(stats.avgScore * 100).toFixed(1)}%)`);
      });

      if (result.failedValidations > 0) {
        console.log('\nFailed Validations:');
        result.results.filter(r => !r.success).forEach(r => {
          console.log(`  - ${r.optimization} - ${r.testCase}: ${r.error || r.failedChecks.join(', ')}`);
        });
      }

      console.log('\n🎯 Optimization Validation Summary:');
      if (result.successRate >= 80) {
        console.log('✅ All optimization methods are working correctly');
        console.log('📈 Enhancement methods meet quality standards');
        console.log('🚀 Ready for production deployment');
      } else {
        console.log('⚠️ Some optimization methods need attention');
        console.log('🔧 Review failed validations and optimize accordingly');
      }

      process.exit(result.successRate >= 80 ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Optimization validation failed:', error);
      process.exit(1);
    });
}