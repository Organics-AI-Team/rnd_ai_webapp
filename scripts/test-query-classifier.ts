/**
 * Test Query Classifier
 * Tests the intelligent query classification with various query types
 */

import { classify_query } from '@/ai/utils/query-classifier';

// Test queries from user examples
const test_queries = [
  // Code queries
  'rm000001 คืออะไร',
  'RM000001',
  'RC00A008 คืออะไร',

  // Name queries
  'Ginger Extract - DL มีรหัสสารคืออะไร',
  'Ginger Extract - DL',
  'ALPHA ARBUTIN',

  // Thai queries
  'วัตถุดิบที่ช่วยเรื่องความชุ่มชื้น',
  'รหัสสาร RM000001',
  'ชื่อการค้า Hyaluronic Acid',

  // Property queries
  'ingredients for moisturizing',
  'anti-aging materials',
  'วัตถุดิบต้านริ้วรอย',

  // Supplier queries
  'supplier of vitamin c',
  'ซัพพลายเออร์ของวิตามินซี',

  // Generic queries (should have low confidence)
  'hello',
  'how are you',
  'tell me about cosmetics'
];

console.log('🧪 Testing Query Classifier\n');
console.log('='.repeat(80));

test_queries.forEach((query, index) => {
  console.log(`\n[Test ${index + 1}/${test_queries.length}] Query: "${query}"`);
  console.log('-'.repeat(80));

  const result = classify_query(query);

  console.log('📊 Classification Result:');
  console.log(`  ✓ Is Raw Materials Query: ${result.is_raw_materials_query ? '✅ YES' : '❌ NO'}`);
  console.log(`  ✓ Query Type: ${result.query_type}`);
  console.log(`  ✓ Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`  ✓ Search Strategy: ${result.search_strategy}`);
  console.log(`  ✓ Language: ${result.language}`);

  if (result.detected_patterns.length > 0) {
    console.log(`  ✓ Detected Patterns: ${result.detected_patterns.join(', ')}`);
  }

  if (result.extracted_entities.codes && result.extracted_entities.codes.length > 0) {
    console.log(`  ✓ Extracted Codes: ${result.extracted_entities.codes.join(', ')}`);
  }

  if (result.extracted_entities.names && result.extracted_entities.names.length > 0) {
    console.log(`  ✓ Extracted Names: ${result.extracted_entities.names.join(', ')}`);
  }

  if (result.extracted_entities.properties && result.extracted_entities.properties.length > 0) {
    console.log(`  ✓ Extracted Properties: ${result.extracted_entities.properties.join(', ')}`);
  }

  if (result.expanded_queries && result.expanded_queries.length > 1) {
    console.log(`  ✓ Expanded Queries (${result.expanded_queries.length}):`);
    result.expanded_queries.slice(0, 5).forEach((eq, i) => {
      console.log(`     ${i + 1}. "${eq}"`);
    });
  }

  // Validation
  if (index <= 2) {
    // Code queries - should be exact_code
    if (result.query_type !== 'exact_code') {
      console.log('  ⚠️  WARNING: Expected exact_code type for code query');
    }
  } else if (index <= 5) {
    // Name queries - should be name_search
    if (result.query_type !== 'name_search' && result.query_type !== 'exact_code') {
      console.log('  ⚠️  WARNING: Expected name_search type for name query');
    }
  }
});

console.log('\n' + '='.repeat(80));
console.log('✅ Query Classifier Test Complete\n');
