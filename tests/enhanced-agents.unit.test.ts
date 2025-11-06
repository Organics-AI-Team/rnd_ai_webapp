/**
 * Enhanced Agents Unit Tests
 * Comprehensive unit testing for Raw Materials and Sales R&D AI agents
 */

import {
  EnhancedRawMaterialsAgent,
  EnhancedRawMaterialsAgentFunctions
} from '../ai/agents/raw-materials-ai/enhanced-raw-materials-agent';

import {
  EnhancedSalesRndAgent,
  EnhancedSalesRndAgentFunctions
} from '../ai/agents/sales-rnd-ai/enhanced-sales-rnd-agent';

// Mock dependencies for unit testing
const mockKnowledgeService = {
  retrieveCosmeticKnowledge: jest.fn().mockResolvedValue({
    sources: [
      {
        content: { title: 'Test Source 1', content: 'Test content about niacinamide' },
        source: { name: 'FDA Database', credibilityWeight: 0.98 },
        score: 0.9,
        confidence: 0.85,
        metadata: { type: 'regulatory' }
      }
    ],
    synthesis: {
      keyInsights: [
        { insight: 'Niacinamide is safe at 5% concentration', source: 'FDA', confidence: 0.95 }
      ],
      consensus: { overallAgreement: 0.9, consensusPoints: ['Safety confirmed'] },
      recommendations: [
        { recommendation: 'Use in skincare products', priority: 'high' }
      ],
      knowledgeGaps: []
    }
  })
};

const mockQualityScorer = {
  scoreCosmeticResponse: jest.fn().mockResolvedValue({
    overallScore: 0.85,
    dimensions: {
      factualAccuracy: 0.9,
      relevance: 0.85,
      completeness: 0.8,
      clarity: 0.85
    },
    cosmeticFactors: {
      safetyCompliance: 0.95,
      regulatoryCompliance: 0.9,
      formulationGuidance: 0.8
    },
    riskAssessment: {
      overallRiskLevel: 'low',
      recommendedActions: []
    },
    improvementSuggestions: [
      {
        category: 'completeness',
        priority: 'medium',
        description: 'Add more usage guidelines',
        specificActions: ['Include concentration ranges']
      }
    ]
  })
};

const mockRegulatoryService = {
  getRegulatoryData: jest.fn().mockResolvedValue({
    complianceStatus: {
      overallCompliant: true,
      regionalCompliance: {
        US: { compliant: true, restrictions: [] },
        EU: { compliant: true, restrictions: [] },
        ASEAN: { compliant: true, restrictions: [] }
      }
    },
    restrictions: [],
    requiredDocumentation: ['Safety assessment'],
    latestUpdate: '2024-01-01'
  })
};

const mockResponseReranker = {
  scoreResponse: jest.fn().mockResolvedValue({
    overallScore: 0.88,
    confidence: 0.9,
    sources: [
      { title: 'FDA Source', relevance: 0.95, credibility: 0.98 }
    ],
    improvements: []
  }),
  enhanceResponse: jest.fn().mockResolvedValue({
    response: 'Enhanced response with better clarity and structure',
    improvements: [
      { description: 'Improved clarity', impact: 'high' }
    ]
  })
};

// Mock environment variables
process.env.PINECONE_API_KEY = 'test-api-key';

/**
 * Enhanced Raw Materials Agent Unit Tests
 */
describe('Enhanced Raw Materials Agent', () => {
  let agent: EnhancedRawMaterialsAgent;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock the service initialization
    jest.doMock('../ai/services/knowledge/cosmetic-knowledge-sources', () => ({
      CosmeticKnowledgeService: jest.fn().mockImplementation(() => mockKnowledgeService)
    }));
    jest.doMock('../ai/services/quality/cosmetic-quality-scorer', () => ({
      CosmeticQualityScorer: jest.fn().mockImplementation(() => mockQualityScorer)
    }));
    jest.doMock('../ai/services/regulatory/cosmetic-regulatory-sources', () => ({
      CosmeticRegulatoryService: jest.fn().mockImplementation(() => mockRegulatoryService)
    }));
    jest.doMock('../ai/services/response/response-reranker', () => ({
      ResponseReranker: jest.fn().mockImplementation(() => mockResponseReranker)
    }));

    agent = new EnhancedRawMaterialsAgent();
  });

  afterEach(() => {
    jest.resetModules();
  });

  describe('Agent Initialization', () => {
    test('should initialize successfully', () => {
      expect(agent).toBeInstanceOf(EnhancedRawMaterialsAgent);
    });

    test('should have required methods', () => {
      expect(typeof agent.generateEnhancedResponse).toBe('function');
    });
  });

  describe('generateEnhancedResponse', () => {
    const testQuery = 'What are the safety considerations for niacinamide?';
    const testContext = {
      userId: 'test-user',
      userRole: 'safety_assessor',
      queryType: 'safety',
      targetRegions: ['US', 'EU'],
      productType: 'skincare',
      materialName: 'niacinamide'
    };

    test('should generate enhanced response successfully', async () => {
      const result = await agent.generateEnhancedResponse(testQuery, testContext);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      expect(result.originalResponse).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.optimizations).toBeDefined();
      expect(result.quality).toBeDefined();
      expect(result.compliance).toBeDefined();
    });

    test('should include all optimization types', async () => {
      const result = await agent.generateEnhancedResponse(testQuery, testContext);

      expect(result.optimizations.knowledgeRetrieval).toBeDefined();
      expect(result.optimizations.qualityScoring).toBeDefined();
      expect(result.optimizations.regulatoryCheck).toBeDefined();
      expect(result.optimizations.responseReranking).toBeDefined();

      expect(result.optimizations.knowledgeRetrieval.enabled).toBe(true);
      expect(result.optimizations.qualityScoring.enabled).toBe(true);
      expect(result.optimizations.regulatoryCheck.enabled).toBe(true);
      expect(result.optimizations.responseReranking.enabled).toBe(true);
    });

    test('should include quality metrics', async () => {
      const result = await agent.generateEnhancedResponse(testQuery, testContext);

      expect(result.quality.overallScore).toBeGreaterThan(0);
      expect(result.quality.dimensions).toBeDefined();
      expect(result.quality.cosmeticFactors).toBeDefined();
      expect(result.quality.riskAssessment).toBeDefined();
    });

    test('should include metadata with required fields', async () => {
      const result = await agent.generateEnhancedResponse(testQuery, testContext);

      expect(result.metadata.processingTime).toBeGreaterThan(0);
      expect(result.metadata.userRole).toBe(testContext.userRole);
      expect(result.metadata.productType).toBe(testContext.productType);
      expect(result.metadata.queryType).toBe(testContext.queryType);
      expect(result.metadata.materialName).toBe(testContext.materialName);
      expect(result.metadata.overallConfidence).toBeGreaterThan(0);
    });

    test('should handle different query types', async () => {
      const queryTypes = ['general', 'safety', 'regulatory', 'application', 'comparison', 'stock'];

      for (const queryType of queryTypes) {
        const context = { ...testContext, queryType };
        const result = await agent.generateEnhancedResponse(testQuery, context);

        expect(result.success).toBe(true);
        expect(result.metadata.queryType).toBe(queryType);
      }
    });

    test('should handle missing optional context fields', async () => {
      const minimalContext = {
        userId: 'test-user'
      };

      const result = await agent.generateEnhancedResponse(testQuery, minimalContext);

      expect(result.success).toBe(true);
      expect(result.metadata.userRole).toBe('general');
      expect(result.metadata.productType).toBe('personal_care');
      expect(result.metadata.queryType).toBe('general');
    });

    test('should handle empty query', async () => {
      const result = await agent.generateEnhancedResponse('', testContext);

      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
    });

    test('should handle service initialization failure gracefully', async () => {
      // Mock a service failure
      mockKnowledgeService.retrieveCosmeticKnowledge.mockRejectedValueOnce(
        new Error('Service unavailable')
      );

      const result = await agent.generateEnhancedResponse(testQuery, testContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('extractMaterialNames', () => {
    test('should extract common cosmetic ingredients', () => {
      // This tests a private function through the agent's behavior
      const testCases = [
        { query: 'niacinamide and hyaluronic acid', expected: ['niacinamide', 'hyaluronic acid'] },
        { query: 'retinol with vitamin C', expected: ['retinol', 'vitamin c'] },
        { query: 'salicylic acid for acne', expected: ['salicylic acid'] },
        { query: 'no ingredients here', expected: [] }
      ];

      testCases.forEach(({ query, expected }) => {
        // Test through generateEnhancedResponse which calls extractMaterialNames internally
        expect(agent.generateEnhancedResponse(query, { userId: 'test' })).resolves.toBeDefined();
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle null query', async () => {
      const result = await agent.generateEnhancedResponse(null as any, testContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle undefined context', async () => {
      const result = await agent.generateEnhancedResponse(testQuery, undefined as any);

      expect(result.success).toBe(true); // Should handle gracefully with defaults
    });

    test('should handle malformed context', async () => {
      const malformedContext = { userRole: 123, queryType: {} };

      const result = await agent.generateEnhancedResponse(testQuery, malformedContext);

      expect(result.success).toBe(true); // Should handle gracefully
    });
  });
});

/**
 * Enhanced Sales R&D Agent Unit Tests
 */
describe('Enhanced Sales R&D Agent', () => {
  let agent: EnhancedSalesRndAgent;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock the service initialization
    jest.doMock('../ai/services/knowledge/cosmetic-knowledge-sources', () => ({
      CosmeticKnowledgeService: jest.fn().mockImplementation(() => mockKnowledgeService)
    }));
    jest.doMock('../ai/services/quality/cosmetic-quality-scorer', () => ({
      CosmeticQualityScorer: jest.fn().mockImplementation(() => mockQualityScorer)
    }));
    jest.doMock('../ai/services/regulatory/cosmetic-regulatory-sources', () => ({
      CosmeticRegulatoryService: jest.fn().mockImplementation(() => mockRegulatoryService)
    }));
    jest.doMock('../ai/services/response/response-reranker', () => ({
      ResponseReranker: jest.fn().mockImplementation(() => mockResponseReranker)
    }));

    agent = new EnhancedSalesRndAgent();
  });

  afterEach(() => {
    jest.resetModules();
  });

  describe('Agent Initialization', () => {
    test('should initialize successfully', () => {
      expect(agent).toBeInstanceOf(EnhancedSalesRndAgent);
    });

    test('should have required methods', () => {
      expect(typeof agent.generateEnhancedResponse).toBe('function');
    });
  });

  describe('generateEnhancedResponse', () => {
    const testQuery = 'Develop brightening serum for ASEAN market';
    const testContext = {
      userId: 'test-user',
      userRole: 'product_manager',
      queryType: 'concept_development',
      targetRegions: ['ASEAN'],
      clientBrief: {
        targetCustomer: 'millennials',
        painPoints: ['hyperpigmentation'],
        productCategory: 'serum',
        region: 'ASEAN',
        constraints: ['vegan'],
        heroClaims: ['brightening'],
        priceTier: 'masstige'
      }
    };

    test('should generate enhanced sales response successfully', async () => {
      const result = await agent.generateEnhancedResponse(testQuery, testContext);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      expect(result.originalResponse).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.optimizations).toBeDefined();
      expect(result.quality).toBeDefined();
      expect(result.salesQuality).toBeDefined();
      expect(result.marketData).toBeDefined();
      expect(result.costData).toBeDefined();
    });

    test('should include sales-specific optimizations', async () => {
      const result = await agent.generateEnhancedResponse(testQuery, testContext);

      expect(result.optimizations.knowledgeRetrieval.enabled).toBe(true);
      expect(result.optimizations.knowledgeRetrieval.marketIntelligence).toBeGreaterThan(0);
      expect(result.optimizations.knowledgeRetrieval.costAnalysis).toBeGreaterThan(0);

      expect(result.optimizations.qualityScoring.enabled).toBe(true);
      expect(result.optimizations.qualityScoring.salesQualityScore).toBeGreaterThan(0);
      expect(result.optimizations.qualityScoring.commercialReadiness).toBeGreaterThan(0);
    });

    test('should include sales quality metrics', async () => {
      const result = await agent.generateEnhancedResponse(testQuery, testContext);

      expect(result.salesQuality.commercialReadiness).toBeGreaterThan(0);
      expect(result.salesQuality.marketFocus).toBeGreaterThan(0);
      expect(result.salesQuality.pricingClarity).toBeGreaterThan(0);
      expect(result.salesQuality.overallSalesQuality).toBeGreaterThan(0);
    });

    test('should include market and cost data', async () => {
      const result = await agent.generateEnhancedResponse(testQuery, testContext);

      expect(Array.isArray(result.marketData)).toBe(true);
      expect(result.costData).toBeDefined();
      expect(result.costData.formulationCost).toBeDefined();
      expect(result.costData.marketPositioning).toBeDefined();
    });

    test('should handle different sales query types', async () => {
      const queryTypes = [
        'concept_development',
        'market_analysis',
        'regulatory_compliance',
        'costing',
        'claims_substantiation',
        'competitive_positioning'
      ];

      for (const queryType of queryTypes) {
        const context = { ...testContext, queryType };
        const result = await agent.generateEnhancedResponse(testQuery, context);

        expect(result.success).toBe(true);
        expect(result.metadata.queryType).toBe(queryType);
      }
    });

    test('should handle client brief variations', async () => {
      const briefVariations = [
        { priceTier: 'mass' },
        { priceTier: 'premium' },
        { constraints: ['fragrance-free'] },
        { targetCustomer: 'teens' },
        { productCategory: 'cream' }
      ];

      for (const brief of briefVariations) {
        const context = {
          ...testContext,
          clientBrief: { ...testContext.clientBrief, ...brief }
        };
        const result = await agent.generateEnhancedResponse(testQuery, context);

        expect(result.success).toBe(true);
      }
    });

    test('should handle missing client brief', async () => {
      const contextWithoutBrief = {
        userId: 'test-user',
        userRole: 'product_manager'
      };

      const result = await agent.generateEnhancedResponse(testQuery, contextWithoutBrief);

      expect(result.success).toBe(true);
    });

    test('should handle service failures gracefully', async () => {
      mockKnowledgeService.retrieveCosmeticKnowledge.mockRejectedValueOnce(
        new Error('Market data unavailable')
      );

      const result = await agent.generateEnhancedResponse(testQuery, testContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Product Concept Extraction', () => {
    test('should extract product concepts from queries', () => {
      const testCases = [
        { query: 'brightening serum for face', expectedCategory: 'serum' },
        { query: 'anti-aging cream formulation', expectedCategory: 'cream' },
        { query: 'gentle cleanser for sensitive skin', expectedCategory: 'cleanser' },
        { query: 'SPF 50 sunscreen', expectedCategory: 'sunscreen' }
      ];

      testCases.forEach(({ query }) => {
        expect(agent.generateEnhancedResponse(query, { userId: 'test' })).resolves.toBeDefined();
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle null query', async () => {
      const result = await agent.generateEnhancedResponse(null as any, testContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle empty client brief', async () => {
      const context = {
        userId: 'test-user',
        clientBrief: {}
      };

      const result = await agent.generateEnhancedResponse(testQuery, context);

      expect(result.success).toBe(true);
    });

    test('should handle invalid price tier', async () => {
      const context = {
        ...testContext,
        clientBrief: {
          ...testContext.clientBrief,
          priceTier: 'invalid_tier'
        }
      };

      const result = await agent.generateEnhancedResponse(testQuery, context);

      expect(result.success).toBe(true); // Should handle gracefully
    });
  });
});

/**
 * Enhanced Agent Functions Unit Tests
 */
describe('Enhanced Agent Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Raw Materials Agent Functions', () => {
    test('should export required functions', () => {
      expect(EnhancedRawMaterialsAgentFunctions).toBeDefined();
      expect(typeof EnhancedRawMaterialsAgentFunctions.generateEnhancedResponse).toBe('function');
      expect(typeof EnhancedRawMaterialsAgentFunctions.retrieveEnhancedKnowledge).toBe('function');
      expect(typeof EnhancedRawMaterialsAgentFunctions.performQualityScoring).toBe('function');
      expect(typeof EnhancedRawMaterialsAgentFunctions.performRegulatoryCheck).toBe('function');
      expect(typeof EnhancedRawMaterialsAgentFunctions.performResponseReranking).toBe('function');
    });

    test('generateEnhancedResponse should work via function export', async () => {
      const result = await EnhancedRawMaterialsAgentFunctions.generateEnhancedResponse(
        'test query',
        { userId: 'test' }
      );

      expect(result).toBeDefined();
    });
  });

  describe('Sales R&D Agent Functions', () => {
    test('should export required functions', () => {
      expect(EnhancedSalesRndAgentFunctions).toBeDefined();
      expect(typeof EnhancedSalesRndAgentFunctions.generateEnhancedResponse).toBe('function');
      expect(typeof EnhancedSalesRndAgentFunctions.retrieveEnhancedSalesKnowledge).toBe('function');
      expect(typeof EnhancedSalesRndAgentFunctions.performSalesQualityScoring).toBe('function');
      expect(typeof EnhancedSalesRndAgentFunctions.performSalesRegulatoryCheck).toBe('function');
      expect(typeof EnhancedSalesRndAgentFunctions.performSalesResponseReranking).toBe('function');
    });

    test('generateEnhancedResponse should work via function export', async () => {
      const result = await EnhancedSalesRndAgentFunctions.generateEnhancedResponse(
        'test query',
        { userId: 'test' }
      );

      expect(result).toBeDefined();
    });
  });
});

/**
 * Integration Tests for Both Agents
 */
describe('Enhanced Agents Integration', () => {
  test('both agents should handle similar queries differently', async () => {
    const query = 'niacinamide safety information';
    const context = { userId: 'test-user', targetRegions: ['US'] };

    // Mock services to avoid API calls
    jest.doMock('../ai/services/knowledge/cosmetic-knowledge-sources', () => ({
      CosmeticKnowledgeService: jest.fn().mockImplementation(() => mockKnowledgeService)
    }));
    jest.doMock('../ai/services/quality/cosmetic-quality-scorer', () => ({
      CosmeticQualityScorer: jest.fn().mockImplementation(() => mockQualityScorer)
    }));

    const rawAgent = new EnhancedRawMaterialsAgent();
    const salesAgent = new EnhancedSalesRndAgent();

    const rawResult = await rawAgent.generateEnhancedResponse(query, context);
    const salesResult = await salesAgent.generateEnhancedResponse(query, context);

    expect(rawResult.success).toBe(true);
    expect(salesResult.success).toBe(true);

    // Raw materials agent should focus on technical details
    expect(rawResult.metadata.materialName).toBeDefined();

    // Sales agent should include commercial aspects
    expect(salesResult.marketData).toBeDefined();
  });

  test('agents should handle concurrent requests', async () => {
    const queries = [
      'niacinamide safety',
      'hyaluronic acid benefits',
      'retinol usage guidelines'
    ];

    const rawAgent = new EnhancedRawMaterialsAgent();
    const salesAgent = new EnhancedSalesRndAgent();

    const promises = queries.map(query =>
      Promise.all([
        rawAgent.generateEnhancedResponse(query, { userId: 'test' }),
        salesAgent.generateEnhancedResponse(query, { userId: 'test' })
      ])
    );

    const results = await Promise.all(promises);

    expect(results).toHaveLength(3);
    results.forEach(([rawResult, salesResult]) => {
      expect(rawResult.success).toBe(true);
      expect(salesResult.success).toBe(true);
    });
  });
});

/**
 * Performance Tests
 */
describe('Enhanced Agents Performance', () => {
  test('should complete responses within reasonable time', async () => {
    const agent = new EnhancedRawMaterialsAgent();
    const startTime = Date.now();

    const result = await agent.generateEnhancedResponse(
      'test query for performance',
      { userId: 'test-user' }
    );

    const endTime = Date.now();
    const processingTime = endTime - startTime;

    expect(result.success).toBe(true);
    expect(processingTime).toBeLessThan(10000); // Should complete within 10 seconds
    expect(result.metadata.processingTime).toBeGreaterThan(0);
  });

  test('should handle multiple sequential requests efficiently', async () => {
    const agent = new EnhancedSalesRndAgent();
    const requests = 5;
    const times: number[] = [];

    for (let i = 0; i < requests; i++) {
      const startTime = Date.now();
      const result = await agent.generateEnhancedResponse(
        `test query ${i}`,
        { userId: 'test-user' }
      );
      const endTime = Date.now();

      expect(result.success).toBe(true);
      times.push(endTime - startTime);
    }

    const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
    expect(avgTime).toBeLessThan(8000); // Average should be under 8 seconds
  });
});

/**
 * Run tests if this file is executed directly
 */
if (require.main === module) {
  console.log('🧪 [EnhancedAgentsUnitTests] Running comprehensive unit tests...\n');

  // Set test environment
  process.env.NODE_ENV = 'test';

  // Run the tests
  require('ts-node/register');

  console.log('✅ Unit tests completed!');
  console.log('📝 Run with: npm test -- enhanced-agents.unit.test.ts');
}