/**
 * Unit Tests: Dynamic Chunking Service
 * Tests chunking strategies, field weighting, and multilingual support
 */

import { DynamicChunkingService } from '@/ai/services/rag/dynamic-chunking-service';

/**
 * Mock raw material for testing
 */
const MOCK_MATERIAL = {
  _id: 'test-id-001',
  rm_code: 'RM000001',
  trade_name: 'Hyaluronic Acid (Low Molecular Weight)',
  inci_name: 'Sodium Hyaluronate',
  category: 'Humectant',
  function: 'Moisturizing, Anti-aging, Skin hydration',
  supplier: 'XYZ Chemicals Co., Ltd.',
  cost_per_unit: 2500,
  unit: 'กก',
  company_name: 'Test Company A',
  description: 'Premium quality hyaluronic acid with excellent water retention properties',
};

const MOCK_MATERIAL_THAI = {
  _id: 'test-id-002',
  rm_code: 'RC00A008',
  trade_name: 'ALPHA ARBUTIN',
  inci_name: 'Alpha Arbutin',
  category: 'Skin Lightening',
  function: 'Whitening, Brightening',
  supplier: 'ABC Ingredients Ltd.',
  cost_per_unit: 3500,
  unit: 'กก',
  company_name: 'บริษัท ทดสอบ จำกัด',
};

interface TestCase {
  name: string;
  material: any;
  expected: {
    min_chunks: number;
    max_chunks: number;
    should_have_primary: boolean;
    should_have_code_only: boolean;
    should_have_thai: boolean;
    expected_priorities: number[];
    expected_chunk_types: string[];
  };
}

const test_cases: TestCase[] = [
  {
    name: 'Full material with all fields',
    material: MOCK_MATERIAL,
    expected: {
      min_chunks: 6,
      max_chunks: 7,
      should_have_primary: true,
      should_have_code_only: true,
      should_have_thai: true,
      expected_priorities: [1.0, 1.0, 0.9, 0.85, 0.9],
      expected_chunk_types: [
        'primary_identifier',
        'code_exact_match',
        'technical_specs',
        'commercial_info',
        'combined_context',
        'thai_optimized',
      ],
    },
  },
  {
    name: 'Material with Thai company name',
    material: MOCK_MATERIAL_THAI,
    expected: {
      min_chunks: 6,
      max_chunks: 7,
      should_have_primary: true,
      should_have_code_only: true,
      should_have_thai: true,
      expected_priorities: [1.0, 1.0, 0.9, 0.85, 0.9],
      expected_chunk_types: [
        'primary_identifier',
        'code_exact_match',
        'technical_specs',
        'commercial_info',
        'combined_context',
        'thai_optimized',
      ],
    },
  },
  {
    name: 'Material with minimal fields',
    material: {
      rm_code: 'RM000099',
      trade_name: 'Test Material',
    },
    expected: {
      min_chunks: 4, // Fewer chunks for minimal data
      max_chunks: 6,
      should_have_primary: true,
      should_have_code_only: true,
      should_have_thai: false, // No Thai content
      expected_priorities: [1.0, 1.0],
      expected_chunk_types: ['primary_identifier', 'code_exact_match'],
    },
  },
];

/**
 * Test Runner
 */
async function run_chunking_tests(): Promise<void> {
  console.log('🧪 Running Dynamic Chunking Service Unit Tests\n');
  console.log('='.repeat(80));

  let passed = 0;
  let failed = 0;
  const failures: Array<{ test: string; error: string }> = [];

  const chunking_service = new DynamicChunkingService({
    max_chunk_size: 500,
    chunk_overlap: 50,
    enable_thai_optimization: true,
    enable_field_weighting: true,
  });

  for (let i = 0; i < test_cases.length; i++) {
    const test_case = test_cases[i];
    const test_num = i + 1;
    const total = test_cases.length;

    console.log(`\n[${test_num}/${total}] Test: ${test_case.name}`);
    console.log(`Material: ${test_case.material.rm_code}`);
    console.log('-'.repeat(80));

    try {
      // Generate chunks
      const chunks = chunking_service.chunk_raw_material_document(test_case.material);

      console.log(`  Generated ${chunks.length} chunks`);

      // Validate chunk count
      if (chunks.length < test_case.expected.min_chunks) {
        throw new Error(
          `Too few chunks: expected >= ${test_case.expected.min_chunks}, got ${chunks.length}`
        );
      }

      if (chunks.length > test_case.expected.max_chunks) {
        throw new Error(
          `Too many chunks: expected <= ${test_case.expected.max_chunks}, got ${chunks.length}`
        );
      }

      // Validate chunk structure
      chunks.forEach((chunk, index) => {
        if (!chunk.id) {
          throw new Error(`Chunk ${index} missing id`);
        }

        if (!chunk.text || chunk.text.length === 0) {
          throw new Error(`Chunk ${index} has empty text`);
        }

        if (chunk.priority === undefined || chunk.priority < 0 || chunk.priority > 1) {
          throw new Error(
            `Chunk ${index} has invalid priority: ${chunk.priority}`
          );
        }

        if (!chunk.chunk_type) {
          throw new Error(`Chunk ${index} missing chunk_type`);
        }

        if (!chunk.metadata) {
          throw new Error(`Chunk ${index} missing metadata`);
        }

        if (!chunk.metadata.rm_code) {
          throw new Error(`Chunk ${index} metadata missing rm_code`);
        }
      });

      // Validate expected chunk types
      const chunk_types = chunks.map((c) => c.chunk_type);

      if (test_case.expected.should_have_primary) {
        if (!chunk_types.includes('primary_identifier')) {
          throw new Error(
            `Expected primary_identifier chunk, found types: ${chunk_types.join(', ')}`
          );
        }
      }

      if (test_case.expected.should_have_code_only) {
        if (!chunk_types.includes('code_exact_match')) {
          throw new Error(
            `Expected code_exact_match chunk, found types: ${chunk_types.join(', ')}`
          );
        }
      }

      if (test_case.expected.should_have_thai) {
        if (!chunk_types.includes('thai_optimized')) {
          throw new Error(
            `Expected thai_optimized chunk, found types: ${chunk_types.join(', ')}`
          );
        }
      }

      // Validate priorities
      const priorities = chunks.map((c) => c.priority);
      const has_high_priority = priorities.some((p) => p >= 0.9);

      if (!has_high_priority) {
        throw new Error(
          `No high-priority chunks found (>= 0.9). Priorities: ${priorities.join(', ')}`
        );
      }

      // Validate primary identifier chunk content
      const primary_chunk = chunks.find((c) => c.chunk_type === 'primary_identifier');
      if (primary_chunk) {
        if (!primary_chunk.text.includes(test_case.material.rm_code)) {
          throw new Error(
            `Primary chunk doesn't contain rm_code: ${test_case.material.rm_code}`
          );
        }

        if (test_case.material.trade_name) {
          if (!primary_chunk.text.includes(test_case.material.trade_name)) {
            throw new Error(
              `Primary chunk doesn't contain trade_name: ${test_case.material.trade_name}`
            );
          }
        }
      }

      // Validate code-only chunk
      const code_chunk = chunks.find((c) => c.chunk_type === 'code_exact_match');
      if (code_chunk) {
        if (!code_chunk.text.includes(test_case.material.rm_code)) {
          throw new Error(
            `Code chunk doesn't contain rm_code: ${test_case.material.rm_code}`
          );
        }

        // Code chunk should be concise (< 200 chars)
        if (code_chunk.text.length > 200) {
          throw new Error(
            `Code chunk too long: ${code_chunk.text.length} chars (expected < 200)`
          );
        }
      }

      // Validate Thai chunk
      if (test_case.expected.should_have_thai) {
        const thai_chunk = chunks.find((c) => c.chunk_type === 'thai_optimized');
        if (thai_chunk) {
          if (!thai_chunk.text.includes('รหัสสาร') && !thai_chunk.text.includes('ชื่อการค้า')) {
            throw new Error(
              `Thai chunk doesn't contain Thai keywords`
            );
          }
        }
      }

      // Validate chunk size limits
      chunks.forEach((chunk, index) => {
        if (chunk.text.length > chunking_service['config'].max_chunk_size + 100) {
          throw new Error(
            `Chunk ${index} exceeds max size: ${chunk.text.length} chars`
          );
        }
      });

      // Validate metadata propagation
      chunks.forEach((chunk, index) => {
        if (chunk.metadata.rm_code !== test_case.material.rm_code) {
          throw new Error(
            `Chunk ${index} metadata rm_code mismatch: expected ${test_case.material.rm_code}, got ${chunk.metadata.rm_code}`
          );
        }

        if (chunk.metadata.chunk_type !== chunk.chunk_type) {
          throw new Error(
            `Chunk ${index} metadata chunk_type mismatch`
          );
        }
      });

      console.log('✅ PASS');
      console.log(`  Chunk Types: ${chunk_types.join(', ')}`);
      console.log(`  Priorities: ${priorities.map((p) => p.toFixed(2)).join(', ')}`);
      console.log(
        `  Total Characters: ${chunks.reduce((sum, c) => sum + c.text.length, 0)}`
      );

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

  // Additional functional tests
  console.log('\n' + '='.repeat(80));
  console.log('Additional Functional Tests\n');

  // Test 1: Chunks to Documents conversion
  console.log('[1/3] Test: chunks_to_documents conversion');
  console.log('-'.repeat(80));

  try {
    const chunks = chunking_service.chunk_raw_material_document(MOCK_MATERIAL);
    const documents = chunking_service.chunks_to_documents(chunks);

    if (documents.length !== chunks.length) {
      throw new Error(
        `Document count mismatch: expected ${chunks.length}, got ${documents.length}`
      );
    }

    documents.forEach((doc, index) => {
      if (!doc.id) {
        throw new Error(`Document ${index} missing id`);
      }

      if (!doc.text || doc.text.length === 0) {
        throw new Error(`Document ${index} has empty text`);
      }

      if (!doc.metadata) {
        throw new Error(`Document ${index} missing metadata`);
      }
    });

    console.log('✅ PASS');
    console.log(`  Converted ${documents.length} chunks to documents`);
    passed++;
  } catch (error: any) {
    console.log(`❌ FAIL: ${error.message}`);
    failed++;
    failures.push({
      test: 'chunks_to_documents conversion',
      error: error.message,
    });
  }

  // Test 2: Empty material handling
  console.log('\n[2/3] Test: Empty material handling');
  console.log('-'.repeat(80));

  try {
    const empty_material = { rm_code: 'RM000000' };
    const chunks = chunking_service.chunk_raw_material_document(empty_material);

    if (chunks.length === 0) {
      throw new Error('Should generate at least 1 chunk for material with only rm_code');
    }

    console.log('✅ PASS');
    console.log(`  Generated ${chunks.length} chunks for minimal material`);
    passed++;
  } catch (error: any) {
    console.log(`❌ FAIL: ${error.message}`);
    failed++;
    failures.push({
      test: 'Empty material handling',
      error: error.message,
    });
  }

  // Test 3: Field weighting validation
  console.log('\n[3/3] Test: Field weighting validation');
  console.log('-'.repeat(80));

  try {
    const chunks = chunking_service.chunk_raw_material_document(MOCK_MATERIAL);

    // Primary identifier should have highest priority
    const primary = chunks.find((c) => c.chunk_type === 'primary_identifier');
    const commercial = chunks.find((c) => c.chunk_type === 'commercial_info');

    if (primary && commercial) {
      if (primary.priority <= commercial.priority) {
        throw new Error(
          `Primary chunk priority (${primary.priority}) should be higher than commercial (${commercial.priority})`
        );
      }
    }

    // Code exact match should have priority 1.0
    const code_chunk = chunks.find((c) => c.chunk_type === 'code_exact_match');
    if (code_chunk && code_chunk.priority !== 1.0) {
      throw new Error(
        `Code chunk should have priority 1.0, got ${code_chunk.priority}`
      );
    }

    console.log('✅ PASS');
    console.log(`  Field weighting validated successfully`);
    passed++;
  } catch (error: any) {
    console.log(`❌ FAIL: ${error.message}`);
    failed++;
    failures.push({
      test: 'Field weighting validation',
      error: error.message,
    });
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 DYNAMIC CHUNKING TEST RESULTS');
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
    console.log('\n🎉 All dynamic chunking tests passed!');
  }

  console.log('\n' + '='.repeat(80));

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
run_chunking_tests().catch((error) => {
  console.error('❌ Test runner error:', error);
  process.exit(1);
});
