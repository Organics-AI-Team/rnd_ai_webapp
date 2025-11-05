/**
 * Unit Tests: Query Classifier
 * Tests pattern detection, entity extraction, and classification accuracy
 */

import { classify_query, fuzzy_match_score } from '@/ai/utils/query-classifier';

interface TestCase {
  name: string;
  query: string;
  expected: {
    is_raw_materials_query: boolean;
    query_type: string;
    min_confidence: number;
    search_strategy?: string;
    extracted_codes?: string[];
    extracted_names?: string[];
    language?: string;
  };
}

const test_cases: TestCase[] = [
  // Code Detection Tests
  {
    name: 'RM code with Thai question',
    query: 'rm000001 คืออะไร',
    expected: {
      is_raw_materials_query: true,
      query_type: 'exact_code',
      min_confidence: 0.95,
      search_strategy: 'exact_match',
      extracted_codes: ['RM000001', 'rm000001'],
      language: 'mixed'
    }
  },
  {
    name: 'RM code uppercase',
    query: 'RM000001',
    expected: {
      is_raw_materials_query: true,
      query_type: 'exact_code',
      min_confidence: 0.95,
      search_strategy: 'exact_match',
      extracted_codes: ['RM000001']
    }
  },
  {
    name: 'RC code format',
    query: 'RC00A008 คืออะไร',
    expected: {
      is_raw_materials_query: true,
      query_type: 'exact_code',
      min_confidence: 0.80,
      extracted_codes: ['RC00A008']
    }
  },
  {
    name: 'RD code format',
    query: 'RDSAM00171',
    expected: {
      is_raw_materials_query: true,
      query_type: 'exact_code',
      min_confidence: 0.80,
      extracted_codes: ['RDSAM00171']
    }
  },

  // Name Detection Tests
  {
    name: 'Name with Thai question',
    query: 'Ginger Extract - DL มีรหัสสารคืออะไร',
    expected: {
      is_raw_materials_query: true,
      query_type: 'name_search',
      min_confidence: 0.85,
      search_strategy: 'fuzzy_match',
      extracted_names: ['Ginger Extract']
    }
  },
  {
    name: 'Ingredient name with Thai',
    query: 'ชื่อการค้า Hyaluronic Acid',
    expected: {
      is_raw_materials_query: true,
      query_type: 'name_search',
      min_confidence: 0.85,
      search_strategy: 'fuzzy_match',
      extracted_names: ['Hyaluronic Acid']
    }
  },

  // Thai Language Tests
  {
    name: 'Thai property search',
    query: 'วัตถุดิบที่ช่วยเรื่องความชุ่มชื้น',
    expected: {
      is_raw_materials_query: true,
      query_type: 'property_search',
      min_confidence: 0.80,
      search_strategy: 'semantic_search',
      language: 'thai'
    }
  },
  {
    name: 'Thai anti-aging query',
    query: 'วัตถุดิบต้านริ้วรอย',
    expected: {
      is_raw_materials_query: true,
      query_type: 'property_search',
      min_confidence: 0.80,
      language: 'thai'
    }
  },
  {
    name: 'Thai code query',
    query: 'รหัสสาร RM000001',
    expected: {
      is_raw_materials_query: true,
      query_type: 'exact_code',
      min_confidence: 0.95,
      extracted_codes: ['RM000001']
    }
  },

  // Generic Query Rejection Tests
  {
    name: 'Generic greeting',
    query: 'hello',
    expected: {
      is_raw_materials_query: false,
      query_type: 'generic',
      min_confidence: 0.0,
      search_strategy: 'hybrid'
    }
  },
  {
    name: 'Generic question',
    query: 'how are you',
    expected: {
      is_raw_materials_query: false,
      query_type: 'generic',
      min_confidence: 0.0
    }
  },
  {
    name: 'Generic cosmetics talk',
    query: 'tell me about cosmetics',
    expected: {
      is_raw_materials_query: false,
      query_type: 'generic',
      min_confidence: 0.0
    }
  },

  // Edge Cases
  {
    name: 'Mixed code in sentence',
    query: 'I need information about RM000001 for my project',
    expected: {
      is_raw_materials_query: true,
      query_type: 'exact_code',
      min_confidence: 0.80,
      extracted_codes: ['RM000001']
    }
  },
  {
    name: 'Multiple codes',
    query: 'Compare RM000001 and RC00A008',
    expected: {
      is_raw_materials_query: true,
      query_type: 'exact_code',
      min_confidence: 0.90,
      extracted_codes: ['RM000001', 'RC00A008']
    }
  },
  {
    name: 'Supplier query English',
    query: 'supplier of vitamin c',
    expected: {
      is_raw_materials_query: true,
      query_type: 'description_search',
      min_confidence: 0.80
    }
  }
];

// Test Runner
function run_unit_tests(): void {
  console.log('🧪 Running Query Classifier Unit Tests\n');
  console.log('='.repeat(80));

  let passed = 0;
  let failed = 0;
  const failures: Array<{ test: string; error: string }> = [];

  test_cases.forEach((test_case, index) => {
    const test_num = index + 1;
    const total = test_cases.length;

    console.log(`\n[${test_num}/${total}] Test: ${test_case.name}`);
    console.log(`Query: "${test_case.query}"`);
    console.log('-'.repeat(80));

    try {
      const result = classify_query(test_case.query);

      // Validate is_raw_materials_query
      if (result.is_raw_materials_query !== test_case.expected.is_raw_materials_query) {
        throw new Error(
          `is_raw_materials_query mismatch: expected ${test_case.expected.is_raw_materials_query}, got ${result.is_raw_materials_query}`
        );
      }

      // Validate query_type
      if (result.query_type !== test_case.expected.query_type) {
        throw new Error(
          `query_type mismatch: expected ${test_case.expected.query_type}, got ${result.query_type}`
        );
      }

      // Validate confidence
      if (result.confidence < test_case.expected.min_confidence) {
        throw new Error(
          `confidence too low: expected >= ${test_case.expected.min_confidence}, got ${result.confidence.toFixed(2)}`
        );
      }

      // Validate search_strategy if specified
      if (test_case.expected.search_strategy && result.search_strategy !== test_case.expected.search_strategy) {
        throw new Error(
          `search_strategy mismatch: expected ${test_case.expected.search_strategy}, got ${result.search_strategy}`
        );
      }

      // Validate extracted codes
      if (test_case.expected.extracted_codes) {
        const extracted = result.extracted_entities.codes || [];
        const expected = test_case.expected.extracted_codes;

        // Check if all expected codes are present
        const all_present = expected.every(code =>
          extracted.some(ext => ext.toUpperCase() === code.toUpperCase())
        );

        if (!all_present) {
          throw new Error(
            `extracted_codes mismatch: expected ${expected.join(', ')}, got ${extracted.join(', ')}`
          );
        }
      }

      // Validate extracted names
      if (test_case.expected.extracted_names) {
        const extracted = result.extracted_entities.names || [];
        const expected = test_case.expected.extracted_names;

        const all_present = expected.every(name =>
          extracted.some(ext => ext.toLowerCase().includes(name.toLowerCase()))
        );

        if (!all_present) {
          throw new Error(
            `extracted_names mismatch: expected ${expected.join(', ')}, got ${extracted.join(', ')}`
          );
        }
      }

      // Validate language if specified
      if (test_case.expected.language && result.language !== test_case.expected.language) {
        throw new Error(
          `language mismatch: expected ${test_case.expected.language}, got ${result.language}`
        );
      }

      console.log('✅ PASS');
      console.log(`  is_raw_materials_query: ${result.is_raw_materials_query}`);
      console.log(`  query_type: ${result.query_type}`);
      console.log(`  confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`  search_strategy: ${result.search_strategy}`);

      if (result.extracted_entities.codes) {
        console.log(`  extracted_codes: ${result.extracted_entities.codes.join(', ')}`);
      }
      if (result.extracted_entities.names) {
        console.log(`  extracted_names: ${result.extracted_entities.names.join(', ')}`);
      }

      passed++;

    } catch (error) {
      console.log(`❌ FAIL: ${error.message}`);
      failed++;
      failures.push({
        test: test_case.name,
        error: error.message
      });
    }
  });

  // Fuzzy Match Score Tests
  console.log('\n' + '='.repeat(80));
  console.log('Testing Fuzzy Match Scoring\n');

  const fuzzy_tests = [
    { str1: 'Ginger Extract', str2: 'Ginger Extract', expected_min: 0.95, name: 'Exact match' },
    { str1: 'ginger extract', str2: 'Ginger Extract', expected_min: 0.95, name: 'Case insensitive' },
    { str1: 'Ginger', str2: 'Ginger Extract', expected_min: 0.70, name: 'Partial match' },
    { str1: 'Giner Extract', str2: 'Ginger Extract', expected_min: 0.85, name: 'Typo (1 char)' },
    { str1: 'Vitamin C', str2: 'Vitamin D', expected_min: 0.70, name: 'Similar words' },
  ];

  fuzzy_tests.forEach((test, index) => {
    const score = fuzzy_match_score(test.str1, test.str2);
    const pass = score >= test.expected_min;

    console.log(`[${index + 1}/${fuzzy_tests.length}] ${test.name}`);
    console.log(`  "${test.str1}" vs "${test.str2}"`);
    console.log(`  Score: ${score.toFixed(3)} (expected >= ${test.expected_min})`);
    console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'}`);

    if (pass) {
      passed++;
    } else {
      failed++;
      failures.push({
        test: `Fuzzy: ${test.name}`,
        error: `Score ${score.toFixed(3)} < ${test.expected_min}`
      });
    }
  });

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 UNIT TEST RESULTS');
  console.log('='.repeat(80));
  console.log(`\nTotal Tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (failures.length > 0) {
    console.log('\n❌ Failed Tests:');
    failures.forEach((failure, index) => {
      console.log(`  ${index + 1}. ${failure.test}`);
      console.log(`     ${failure.error}`);
    });
  } else {
    console.log('\n🎉 All tests passed!');
  }

  console.log('\n' + '='.repeat(80));

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
run_unit_tests();
