/**
 * Unit Tests: Hybrid Search Service
 * Tests all 4 search strategies, result merging, and re-ranking
 */

import { HybridSearchService } from '@/ai/services/rag/hybrid-search-service';
import { classify_query } from '@/ai/utils/query-classifier';

/**
 * Mock data for testing
 * Simulates raw materials database
 */
const MOCK_RAW_MATERIALS = [
  {
    rm_code: 'RM000001',
    trade_name: 'Hyaluronic Acid (Low Molecular Weight)',
    inci_name: 'Sodium Hyaluronate',
    category: 'Humectant',
    function: 'Moisturizing, Anti-aging',
    supplier: 'XYZ Chemicals Co., Ltd.',
    cost_per_unit: 2500,
    unit: 'กก',
    company_name: 'Company A',
  },
  {
    rm_code: 'RC00A008',
    trade_name: 'ALPHA ARBUTIN',
    inci_name: 'Alpha Arbutin',
    category: 'Skin Lightening',
    function: 'Whitening, Brightening',
    supplier: 'ABC Ingredients Ltd.',
    cost_per_unit: 3500,
    unit: 'กก',
    company_name: 'Company B',
  },
  {
    rm_code: 'RDSAM00171',
    trade_name: 'Enterococcus faecium',
    inci_name: 'Enterococcus faecium',
    category: 'Probiotic',
    function: 'Skin barrier support',
    supplier: 'Biotech Supplies Inc.',
    cost_per_unit: 4500,
    unit: 'กก',
    company_name: 'Company C',
  },
  {
    rm_code: 'RM000045',
    trade_name: 'Glycerin USP',
    inci_name: 'Glycerin',
    category: 'Humectant',
    function: 'Moisturizing, Hydrating',
    supplier: 'Global Chemicals Ltd.',
    cost_per_unit: 150,
    unit: 'กก',
    company_name: 'Company D',
  },
];

interface TestCase {
  name: string;
  query: string;
  expected: {
    should_find_results: boolean;
    min_results: number;
    expected_codes?: string[];
    expected_strategy?: string;
    should_prioritize_exact?: boolean;
    min_top_score?: number;
  };
}

const test_cases: TestCase[] = [
  // Exact Code Search Tests
  {
    name: 'Exact code search - RM code',
    query: 'rm000001',
    expected: {
      should_find_results: true,
      min_results: 1,
      expected_codes: ['RM000001'],
      expected_strategy: 'exact_match',
      should_prioritize_exact: true,
      min_top_score: 0.95,
    },
  },
  {
    name: 'Exact code search - RC code',
    query: 'RC00A008 คืออะไร',
    expected: {
      should_find_results: true,
      min_results: 1,
      expected_codes: ['RC00A008'],
      expected_strategy: 'exact_match',
      should_prioritize_exact: true,
      min_top_score: 0.95,
    },
  },
  {
    name: 'Exact code search - RD code',
    query: 'RDSAM00171',
    expected: {
      should_find_results: true,
      min_results: 1,
      expected_codes: ['RDSAM00171'],
      expected_strategy: 'exact_match',
      should_prioritize_exact: true,
      min_top_score: 0.95,
    },
  },
  {
    name: 'Multiple codes in query',
    query: 'Compare RM000001 and RC00A008',
    expected: {
      should_find_results: true,
      min_results: 2,
      expected_codes: ['RM000001', 'RC00A008'],
      expected_strategy: 'exact_match',
      min_top_score: 0.90,
    },
  },

  // Name Search Tests
  {
    name: 'Name search - exact match',
    query: 'ALPHA ARBUTIN',
    expected: {
      should_find_results: true,
      min_results: 1,
      expected_codes: ['RC00A008'],
      min_top_score: 0.85,
    },
  },
  {
    name: 'Name search - partial match',
    query: 'Hyaluronic Acid',
    expected: {
      should_find_results: true,
      min_results: 1,
      expected_codes: ['RM000001'],
      min_top_score: 0.80,
    },
  },
  {
    name: 'Name search with Thai',
    query: 'Glycerin มีรหัสอะไร',
    expected: {
      should_find_results: true,
      min_results: 1,
      expected_codes: ['RM000045'],
      min_top_score: 0.75,
    },
  },

  // Property Search Tests
  {
    name: 'Property search - Thai moisturizing',
    query: 'วัตถุดิบที่ช่วยเรื่องความชุ่มชื้น',
    expected: {
      should_find_results: true,
      min_results: 2, // Should find both Hyaluronic Acid and Glycerin
      min_top_score: 0.60,
    },
  },
  {
    name: 'Property search - English anti-aging',
    query: 'materials for anti-aging',
    expected: {
      should_find_results: true,
      min_results: 1,
      min_top_score: 0.55,
    },
  },
  {
    name: 'Property search - whitening',
    query: 'ส่วนผสมที่ช่วยกระจ่างใส',
    expected: {
      should_find_results: true,
      min_results: 1,
      expected_codes: ['RC00A008'],
      min_top_score: 0.55,
    },
  },

  // Supplier/Commercial Search Tests
  {
    name: 'Supplier search',
    query: 'supplier of glycerin',
    expected: {
      should_find_results: true,
      min_results: 1,
      expected_codes: ['RM000045'],
      min_top_score: 0.60,
    },
  },
  {
    name: 'Category search',
    query: 'humectant materials',
    expected: {
      should_find_results: true,
      min_results: 2, // Hyaluronic Acid and Glycerin
      min_top_score: 0.55,
    },
  },

  // Edge Cases
  {
    name: 'Case insensitive code',
    query: 'rc00a008',
    expected: {
      should_find_results: true,
      min_results: 1,
      expected_codes: ['RC00A008'],
      min_top_score: 0.90,
    },
  },
  {
    name: 'Code with separators',
    query: 'RM-000001',
    expected: {
      should_find_results: true,
      min_results: 1,
      expected_codes: ['RM000001'],
      min_top_score: 0.85,
    },
  },
  {
    name: 'Typo in name',
    query: 'Hyaluronic Acod', // Typo: Acod instead of Acid
    expected: {
      should_find_results: true,
      min_results: 1,
      expected_codes: ['RM000001'],
      min_top_score: 0.70, // Lower score due to typo
    },
  },

  // Negative Cases
  {
    name: 'Non-existent code',
    query: 'RM999999',
    expected: {
      should_find_results: false,
      min_results: 0,
      min_top_score: 0.0,
    },
  },
  {
    name: 'Generic query - should use hybrid fallback',
    query: 'tell me about ingredients',
    expected: {
      should_find_results: false, // Generic queries should not return raw material results
      min_results: 0,
      min_top_score: 0.0,
    },
  },
];

/**
 * Mock Hybrid Search Service for testing
 * Simulates database and vector search without actual connections
 */
class MockHybridSearchService extends HybridSearchService {
  private mock_data = MOCK_RAW_MATERIALS;

  /**
   * Override exact_match_search to use mock data
   */
  protected async exact_match_search(
    query: string,
    classification: any
  ): Promise<any[]> {
    console.log('  🔍 [exact_match_search] Query:', query);

    const codes = classification.extracted_entities?.codes || [];
    const results: any[] = [];

    codes.forEach((code: string) => {
      const material = this.mock_data.find(
        (m) => m.rm_code.toUpperCase() === code.toUpperCase()
      );

      if (material) {
        results.push({
          document: material,
          score: 1.0,
          match_type: 'exact',
          confidence: 1.0,
          matched_fields: ['rm_code'],
          source: 'mongodb',
        });
        console.log(`    ✅ Found exact match: ${material.rm_code}`);
      }
    });

    return results;
  }

  /**
   * Override metadata_filter_search to use mock data
   */
  protected async metadata_filter_search(
    query: string,
    classification: any,
    options: any
  ): Promise<any[]> {
    console.log('  🔍 [metadata_filter_search] Query:', query);

    const names = classification.extracted_entities?.names || [];
    const results: any[] = [];

    names.forEach((name: string) => {
      const matches = this.mock_data.filter((m) =>
        m.trade_name.toLowerCase().includes(name.toLowerCase())
      );

      matches.forEach((material) => {
        results.push({
          document: material,
          score: 0.9,
          match_type: 'metadata',
          confidence: 0.9,
          matched_fields: ['trade_name'],
          source: 'pinecone',
        });
        console.log(`    ✅ Found metadata match: ${material.rm_code}`);
      });
    });

    return results;
  }

  /**
   * Override fuzzy_match_search to use mock data with Levenshtein distance
   */
  protected async fuzzy_match_search(
    query: string,
    classification: any
  ): Promise<any[]> {
    console.log('  🔍 [fuzzy_match_search] Query:', query);

    const query_lower = query.toLowerCase();
    const results: any[] = [];

    this.mock_data.forEach((material) => {
      const trade_name_lower = material.trade_name.toLowerCase();

      // Simple fuzzy matching
      if (
        trade_name_lower.includes(query_lower) ||
        query_lower.includes(trade_name_lower.split(' ')[0])
      ) {
        const similarity = this.calculate_similarity(
          query_lower,
          trade_name_lower
        );

        if (similarity >= 0.6) {
          results.push({
            document: material,
            score: similarity * 0.85, // Weighted score for fuzzy match
            match_type: 'fuzzy',
            confidence: similarity * 0.8,
            matched_fields: ['trade_name'],
            source: 'mongodb',
          });
          console.log(
            `    ✅ Found fuzzy match: ${material.rm_code} (score: ${(similarity * 0.85).toFixed(2)})`
          );
        }
      }
    });

    return results;
  }

  /**
   * Override semantic_vector_search to use mock data with keyword matching
   */
  protected async semantic_vector_search(
    query: string,
    classification: any,
    options: any
  ): Promise<any[]> {
    console.log('  🔍 [semantic_vector_search] Query:', query);

    const query_lower = query.toLowerCase();
    const properties = classification.extracted_entities?.properties || [];
    const results: any[] = [];

    this.mock_data.forEach((material) => {
      let relevance_score = 0;

      // Check function field for property matches
      const function_lower = material.function.toLowerCase();

      properties.forEach((prop: string) => {
        if (function_lower.includes(prop.toLowerCase())) {
          relevance_score += 0.8;
        }
      });

      // Check for keyword matches in all fields
      const all_text = `${material.trade_name} ${material.inci_name} ${material.category} ${material.function}`.toLowerCase();

      const keywords = [
        'moisturiz',
        'hydrat',
        'anti-aging',
        'whiten',
        'brighten',
        'humectant',
        'ความชุ่มชื้น',
        'ต้านริ้วรอย',
        'กระจ่างใส',
      ];

      keywords.forEach((keyword) => {
        if (query_lower.includes(keyword) && all_text.includes(keyword)) {
          relevance_score += 0.3;
        }
      });

      if (relevance_score > 0) {
        results.push({
          document: material,
          score: Math.min(relevance_score * 0.75, 0.9), // Cap at 0.9
          match_type: 'semantic',
          confidence: Math.min(relevance_score * 0.7, 0.8),
          matched_fields: ['function', 'category'],
          source: 'pinecone',
        });
        console.log(
          `    ✅ Found semantic match: ${material.rm_code} (score: ${Math.min(relevance_score * 0.75, 0.9).toFixed(2)})`
        );
      }
    });

    return results;
  }

  /**
   * Simple similarity calculation (Jaccard similarity)
   */
  private calculate_similarity(str1: string, str2: string): number {
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }
}

/**
 * Test Runner
 */
async function run_hybrid_search_tests(): Promise<void> {
  console.log('🧪 Running Hybrid Search Service Unit Tests\n');
  console.log('='.repeat(80));

  let passed = 0;
  let failed = 0;
  const failures: Array<{ test: string; error: string }> = [];

  const service = new MockHybridSearchService('rawMaterialsAI', {
    topK: 10,
    similarityThreshold: 0.5,
  });

  for (let i = 0; i < test_cases.length; i++) {
    const test_case = test_cases[i];
    const test_num = i + 1;
    const total = test_cases.length;

    console.log(`\n[${test_num}/${total}] Test: ${test_case.name}`);
    console.log(`Query: "${test_case.query}"`);
    console.log('-'.repeat(80));

    try {
      // Classify query
      const classification = classify_query(test_case.query);
      console.log(
        `  Classification: ${classification.query_type} (${(classification.confidence * 100).toFixed(0)}%)`
      );

      // Perform hybrid search
      const results = await service.hybrid_search(test_case.query, {
        topK: 10,
        similarityThreshold: 0.5,
        enable_exact_match: true,
        enable_metadata_filter: true,
        enable_fuzzy_match: true,
        enable_semantic_search: true,
      });

      console.log(`  Results found: ${results.length}`);

      // Validate should_find_results
      if (
        test_case.expected.should_find_results &&
        results.length < test_case.expected.min_results
      ) {
        throw new Error(
          `Expected at least ${test_case.expected.min_results} results, got ${results.length}`
        );
      }

      if (
        !test_case.expected.should_find_results &&
        results.length > 0
      ) {
        throw new Error(
          `Expected no results for generic query, got ${results.length}`
        );
      }

      // Validate expected codes
      if (test_case.expected.expected_codes && results.length > 0) {
        const found_codes = results.map(
          (r) => r.document.rm_code
        );

        test_case.expected.expected_codes.forEach((code) => {
          if (!found_codes.includes(code)) {
            throw new Error(
              `Expected to find code ${code}, but it was not in results: ${found_codes.join(', ')}`
            );
          }
        });
      }

      // Validate top score
      if (results.length > 0 && test_case.expected.min_top_score) {
        const top_score = results[0].score;
        if (top_score < test_case.expected.min_top_score) {
          throw new Error(
            `Top score ${top_score.toFixed(2)} is below minimum ${test_case.expected.min_top_score}`
          );
        }
      }

      // Validate exact match prioritization
      if (test_case.expected.should_prioritize_exact && results.length > 0) {
        const top_source = results[0].source;
        const top_match_type = results[0].match_type;
        if (top_match_type !== 'exact' && top_match_type !== 'metadata') {
          throw new Error(
            `Expected exact match to be prioritized, but top result has match_type ${top_match_type} from ${top_source}`
          );
        }
      }

      console.log('✅ PASS');
      if (results.length > 0) {
        console.log(`  Top Result: ${results[0].document.rm_code}`);
        console.log(`  Top Score: ${results[0].score.toFixed(2)}`);
        console.log(`  Source: ${results[0].source}`);
      }

      passed++;
    } catch (error: any) {
      console.log(`❌ FAIL: ${error.message}`);
      failed++;
      failures.push({
        test: test_case.name,
        error: error.message,
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 HYBRID SEARCH TEST RESULTS');
  console.log('='.repeat(80));
  console.log(`\nTotal Tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(
    `Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`
  );

  if (failures.length > 0) {
    console.log('\n❌ Failed Tests:');
    failures.forEach((failure, index) => {
      console.log(`  ${index + 1}. ${failure.test}`);
      console.log(`     ${failure.error}`);
    });
  } else {
    console.log('\n🎉 All hybrid search tests passed!');
  }

  console.log('\n' + '='.repeat(80));

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
run_hybrid_search_tests().catch((error) => {
  console.error('❌ Test runner error:', error);
  process.exit(1);
});
