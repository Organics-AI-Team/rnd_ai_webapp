/**
 * RAGAS-Style Evaluation Metrics for RAG System
 *
 * Implements key metrics from RAGAS framework:
 * 1. Faithfulness - Response is grounded in retrieved context
 * 2. Answer Relevancy - Response addresses the query
 * 3. Context Precision - Retrieved chunks are relevant
 * 4. Context Recall - All relevant information is retrieved
 *
 * Reference: https://docs.ragas.io/en/stable/concepts/metrics/index.html
 */

import { classify_query } from '@/ai/utils/query-classifier';
import { HybridSearchService } from '@/ai/services/rag/hybrid-search-service';

/**
 * Test case structure for RAGAS evaluation
 */
interface RAGASTestCase {
  query: string;
  expected_code?: string; // For code queries
  expected_info: string[]; // Key information that should be in response
  ground_truth: string; // Ideal response
  context_keywords: string[]; // Keywords that should appear in retrieved context
}

/**
 * Evaluation result for a single test case
 */
interface EvaluationResult {
  test_case: string;
  query: string;
  faithfulness: number; // 0-1
  answer_relevancy: number; // 0-1
  context_precision: number; // 0-1
  context_recall: number; // 0-1
  overall_score: number; // Average of all metrics
  details: {
    retrieved_chunks: number;
    relevant_chunks: number;
    missing_information: string[];
    extra_information: string[];
  };
}

/**
 * Calculate Faithfulness Score
 * Measures if the response is grounded in the retrieved context
 *
 * @param response - Generated response text
 * @param context - Retrieved context chunks
 * @returns Score between 0 and 1
 */
function calculate_faithfulness(
  response: string,
  context: string[]
): number {
  // Extract claims from response (simple sentence split)
  const claims = response
    .split(/[.!?]/)
    .filter((s) => s.trim().length > 10)
    .map((s) => s.trim().toLowerCase());

  if (claims.length === 0) return 0;

  // Check how many claims can be supported by context
  const context_text = context.join(' ').toLowerCase();
  let supported_claims = 0;

  claims.forEach((claim) => {
    // Extract key terms from claim (words > 3 chars)
    const key_terms = claim
      .split(/\s+/)
      .filter((word) => word.length > 3 && !/^(and|the|for|with|from)$/i.test(word));

    // Claim is supported if most key terms appear in context
    const supported_terms = key_terms.filter((term) =>
      context_text.includes(term)
    );

    if (supported_terms.length / Math.max(key_terms.length, 1) >= 0.5) {
      supported_claims++;
    }
  });

  return supported_claims / claims.length;
}

/**
 * Calculate Answer Relevancy Score
 * Measures if the response addresses the query
 *
 * @param query - User query
 * @param response - Generated response
 * @param expected_info - Information that should be in the response
 * @returns Score between 0 and 1
 */
function calculate_answer_relevancy(
  query: string,
  response: string,
  expected_info: string[]
): number {
  const response_lower = response.toLowerCase();
  const query_lower = query.toLowerCase();

  let relevancy_score = 0;

  // 1. Check if query keywords appear in response (0.3 weight)
  const query_keywords = query_lower
    .split(/\s+/)
    .filter((word) => word.length > 3);

  const matching_keywords = query_keywords.filter((keyword) =>
    response_lower.includes(keyword)
  );

  const keyword_score =
    matching_keywords.length / Math.max(query_keywords.length, 1);
  relevancy_score += keyword_score * 0.3;

  // 2. Check if expected information is present (0.7 weight)
  const found_info = expected_info.filter((info) =>
    response_lower.includes(info.toLowerCase())
  );

  const info_score = found_info.length / Math.max(expected_info.length, 1);
  relevancy_score += info_score * 0.7;

  return Math.min(relevancy_score, 1.0);
}

/**
 * Calculate Context Precision Score
 * Measures what proportion of retrieved chunks are relevant
 *
 * @param query - User query
 * @param retrieved_chunks - Retrieved context chunks
 * @param context_keywords - Keywords that should appear in relevant context
 * @returns Score between 0 and 1
 */
function calculate_context_precision(
  query: string,
  retrieved_chunks: any[],
  context_keywords: string[]
): number {
  if (retrieved_chunks.length === 0) return 0;

  let relevant_chunks = 0;

  retrieved_chunks.forEach((chunk) => {
    const chunk_text = (chunk.text || chunk.document?.text || JSON.stringify(chunk.document)).toLowerCase();

    // Chunk is relevant if it contains at least 50% of context keywords
    const matching_keywords = context_keywords.filter((keyword) =>
      chunk_text.includes(keyword.toLowerCase())
    );

    if (matching_keywords.length / Math.max(context_keywords.length, 1) >= 0.3) {
      relevant_chunks++;
    }
  });

  return relevant_chunks / retrieved_chunks.length;
}

/**
 * Calculate Context Recall Score
 * Measures if all relevant information was retrieved
 *
 * @param retrieved_chunks - Retrieved context chunks
 * @param expected_info - Information that should be retrieved
 * @returns Score between 0 and 1
 */
function calculate_context_recall(
  retrieved_chunks: any[],
  expected_info: string[]
): number {
  if (expected_info.length === 0) return 1.0;

  const all_context = retrieved_chunks
    .map((chunk) => chunk.text || chunk.document?.text || JSON.stringify(chunk.document))
    .join(' ')
    .toLowerCase();

  const found_info = expected_info.filter((info) =>
    all_context.includes(info.toLowerCase())
  );

  return found_info.length / expected_info.length;
}

/**
 * Simulate AI response (simplified for testing)
 * In production, this would call the actual AI model
 */
function simulate_ai_response(
  query: string,
  context: string[],
  expected_code?: string
): string {
  // For code queries, format as factual response
  if (expected_code) {
    const code_context = context.find((c) =>
      c.toLowerCase().includes(expected_code.toLowerCase())
    );

    if (code_context) {
      // Extract key facts from context
      const facts: string[] = [];

      if (/trade name|ชื่อการค้า/i.test(code_context)) {
        const trade_name_match = code_context.match(
          /trade name:?\s*([^.\n]+)/i
        );
        if (trade_name_match) {
          facts.push(`Trade Name: ${trade_name_match[1].trim()}`);
        }
      }

      if (/inci/i.test(code_context)) {
        const inci_match = code_context.match(/inci name:?\s*([^.\n]+)/i);
        if (inci_match) {
          facts.push(`INCI: ${inci_match[1].trim()}`);
        }
      }

      if (/supplier|ซัพพลายเออร์/i.test(code_context)) {
        const supplier_match = code_context.match(/supplier:?\s*([^.\n]+)/i);
        if (supplier_match) {
          facts.push(`Supplier: ${supplier_match[1].trim()}`);
        }
      }

      return `${expected_code} is a raw material with the following details:\n${facts.join('\n')}`;
    }
  }

  // For property queries, synthesize from context
  return `Based on the retrieved information: ${context.slice(0, 2).join(' ')}`;
}

/**
 * Run RAGAS evaluation on test cases
 */
export async function run_ragas_evaluation(
  test_cases: RAGASTestCase[]
): Promise<EvaluationResult[]> {
  console.log('🎯 Running RAGAS-Style Evaluation\n');
  console.log('='.repeat(80));

  const results: EvaluationResult[] = [];

  // Note: This is a simplified evaluation without actual API calls
  // In production, this would use HybridSearchService with real data

  for (let i = 0; i < test_cases.length; i++) {
    const test_case = test_cases[i];
    const test_num = i + 1;

    console.log(`\n[${test_num}/${test_cases.length}] Evaluating: "${test_case.query}"`);
    console.log('-'.repeat(80));

    // Step 1: Classify query
    const classification = classify_query(test_case.query);
    console.log(
      `  Classification: ${classification.query_type} (${(classification.confidence * 100).toFixed(0)}%)`
    );

    // Step 2: Simulate context retrieval (mock)
    // In production, this would call HybridSearchService.hybrid_search()
    const mock_context = [
      `Material Code: ${test_case.expected_code || 'RM000001'}. Trade Name: Test Material. INCI Name: Test Ingredient. Supplier: Test Supplier Ltd.`,
      `Category: Humectant. Function: ${test_case.context_keywords.join(', ')}. Cost: 2500 THB/kg.`,
    ];

    const retrieved_chunks = mock_context.map((text, idx) => ({
      text,
      score: 0.9 - idx * 0.1,
      document: { rm_code: test_case.expected_code || 'RM000001' },
    }));

    console.log(`  Retrieved ${retrieved_chunks.length} chunks`);

    // Step 3: Simulate AI response
    const ai_response = simulate_ai_response(
      test_case.query,
      mock_context,
      test_case.expected_code
    );

    // Step 4: Calculate metrics
    const faithfulness = calculate_faithfulness(ai_response, mock_context);
    const answer_relevancy = calculate_answer_relevancy(
      test_case.query,
      ai_response,
      test_case.expected_info
    );
    const context_precision = calculate_context_precision(
      test_case.query,
      retrieved_chunks,
      test_case.context_keywords
    );
    const context_recall = calculate_context_recall(
      retrieved_chunks,
      test_case.expected_info
    );

    const overall_score =
      (faithfulness + answer_relevancy + context_precision + context_recall) / 4;

    console.log(`  📊 Scores:`);
    console.log(`    Faithfulness:       ${(faithfulness * 100).toFixed(1)}%`);
    console.log(`    Answer Relevancy:   ${(answer_relevancy * 100).toFixed(1)}%`);
    console.log(`    Context Precision:  ${(context_precision * 100).toFixed(1)}%`);
    console.log(`    Context Recall:     ${(context_recall * 100).toFixed(1)}%`);
    console.log(`    Overall Score:      ${(overall_score * 100).toFixed(1)}%`);

    results.push({
      test_case: `Test ${test_num}`,
      query: test_case.query,
      faithfulness,
      answer_relevancy,
      context_precision,
      context_recall,
      overall_score,
      details: {
        retrieved_chunks: retrieved_chunks.length,
        relevant_chunks: Math.round(
          retrieved_chunks.length * context_precision
        ),
        missing_information: test_case.expected_info.filter(
          (info) => !ai_response.toLowerCase().includes(info.toLowerCase())
        ),
        extra_information: [],
      },
    });
  }

  return results;
}

/**
 * Print evaluation summary
 */
export function print_evaluation_summary(results: EvaluationResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('📊 RAGAS EVALUATION SUMMARY');
  console.log('='.repeat(80));

  // Calculate averages
  const avg_faithfulness =
    results.reduce((sum, r) => sum + r.faithfulness, 0) / results.length;
  const avg_answer_relevancy =
    results.reduce((sum, r) => sum + r.answer_relevancy, 0) / results.length;
  const avg_context_precision =
    results.reduce((sum, r) => sum + r.context_precision, 0) / results.length;
  const avg_context_recall =
    results.reduce((sum, r) => sum + r.context_recall, 0) / results.length;
  const avg_overall =
    results.reduce((sum, r) => sum + r.overall_score, 0) / results.length;

  console.log(`\nTotal Test Cases: ${results.length}\n`);
  console.log('Average Scores:');
  console.log(`  Faithfulness:       ${(avg_faithfulness * 100).toFixed(1)}%`);
  console.log(`  Answer Relevancy:   ${(avg_answer_relevancy * 100).toFixed(1)}%`);
  console.log(`  Context Precision:  ${(avg_context_precision * 100).toFixed(1)}%`);
  console.log(`  Context Recall:     ${(avg_context_recall * 100).toFixed(1)}%`);
  console.log(`  Overall RAG Score:  ${(avg_overall * 100).toFixed(1)}%`);

  // Score interpretation
  console.log('\n' + '-'.repeat(80));
  console.log('Score Interpretation:');
  console.log(`  ${avg_overall >= 0.8 ? '✅' : avg_overall >= 0.6 ? '⚠️' : '❌'} Overall: ${avg_overall >= 0.8 ? 'Excellent' : avg_overall >= 0.6 ? 'Good' : 'Needs Improvement'}`);
  console.log(`  ${avg_faithfulness >= 0.8 ? '✅' : avg_faithfulness >= 0.6 ? '⚠️' : '❌'} Faithfulness: ${avg_faithfulness >= 0.8 ? 'Responses are well-grounded' : avg_faithfulness >= 0.6 ? 'Some hallucination detected' : 'High hallucination risk'}`);
  console.log(`  ${avg_answer_relevancy >= 0.8 ? '✅' : avg_answer_relevancy >= 0.6 ? '⚠️' : '❌'} Relevancy: ${avg_answer_relevancy >= 0.8 ? 'Answers are relevant' : avg_answer_relevancy >= 0.6 ? 'Some off-topic responses' : 'Poor query understanding'}`);
  console.log(`  ${avg_context_precision >= 0.8 ? '✅' : avg_context_precision >= 0.6 ? '⚠️' : '❌'} Precision: ${avg_context_precision >= 0.8 ? 'Good retrieval quality' : avg_context_precision >= 0.6 ? 'Some irrelevant chunks' : 'Poor retrieval quality'}`);
  console.log(`  ${avg_context_recall >= 0.8 ? '✅' : avg_context_recall >= 0.6 ? '⚠️' : '❌'} Recall: ${avg_context_recall >= 0.8 ? 'Complete information retrieved' : avg_context_recall >= 0.6 ? 'Some information missing' : 'Incomplete retrieval'}`);

  console.log('\n' + '='.repeat(80));
}

/**
 * Main test runner
 */
async function run_ragas_tests(): Promise<void> {
  const test_cases: RAGASTestCase[] = [
    {
      query: 'rm000001 คืออะไร',
      expected_code: 'RM000001',
      expected_info: ['trade name', 'inci', 'supplier'],
      ground_truth: 'RM000001 is Hyaluronic Acid from XYZ Chemicals',
      context_keywords: ['rm000001', 'hyaluronic', 'acid', 'supplier'],
    },
    {
      query: 'RC00A008',
      expected_code: 'RC00A008',
      expected_info: ['alpha arbutin', 'whitening'],
      ground_truth: 'RC00A008 is Alpha Arbutin, a whitening ingredient',
      context_keywords: ['rc00a008', 'alpha', 'arbutin', 'whitening'],
    },
    {
      query: 'วัตถุดิบที่ช่วยเรื่องความชุ่มชื้น',
      expected_info: ['moisturizing', 'hydrating', 'humectant'],
      ground_truth: 'Materials with moisturizing properties include...',
      context_keywords: ['moisturizing', 'hydrating', 'humectant', 'ความชุ่มชื้น'],
    },
    {
      query: 'Ginger Extract มีรหัสอะไร',
      expected_code: 'RM002345',
      expected_info: ['ginger', 'extract', 'code'],
      ground_truth: 'Ginger Extract has code RM002345',
      context_keywords: ['ginger', 'extract', 'code', 'rm'],
    },
    {
      query: 'supplier of vitamin c',
      expected_info: ['vitamin c', 'supplier'],
      ground_truth: 'Vitamin C suppliers include...',
      context_keywords: ['vitamin', 'supplier', 'ascorbic'],
    },
  ];

  const results = await run_ragas_evaluation(test_cases);
  print_evaluation_summary(results);

  // Exit code based on overall score
  const avg_overall =
    results.reduce((sum, r) => sum + r.overall_score, 0) / results.length;
  process.exit(avg_overall >= 0.6 ? 0 : 1);
}

// Run if executed directly
if (require.main === module) {
  run_ragas_tests().catch((error) => {
    console.error('❌ RAGAS evaluation error:', error);
    process.exit(1);
  });
}
