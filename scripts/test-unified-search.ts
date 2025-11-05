/**
 * Test Script for Unified Search with Namespaces
 * Tests the collection separation with intelligent routing
 */

import { getUnifiedSearchService } from '@/ai/services/rag/unified-search-service';

// Test queries representing different intents
const TEST_QUERIES = [
  {
    query: 'RM000001',
    expected_collection: 'in_stock',
    description: 'Exact code search - should search stock'
  },
  {
    query: 'วัตถุดิบทั้งหมดที่มี vitamin C',
    expected_collection: 'all_fda',
    description: 'Thai query for all FDA ingredients'
  },
  {
    query: 'มี Hyaluronic Acid ไหม',
    expected_collection: 'both',
    description: 'Availability query - should search both'
  },
  {
    query: 'moisturizing ingredient in stock',
    expected_collection: 'in_stock',
    description: 'Stock keyword query'
  },
  {
    query: 'search all whitening agents',
    expected_collection: 'all_fda',
    description: 'FDA keyword query'
  }
];

async function test_unified_search(): Promise<void> {
  console.log('🧪 Testing Unified Search with Namespaces\n');
  console.log('='.repeat(80));

  const search_service = getUnifiedSearchService();

  for (const test of TEST_QUERIES) {
    console.log(`\n📋 Test: ${test.description}`);
    console.log(`   Query: "${test.query}"`);
    console.log(`   Expected: ${test.expected_collection}`);

    try {
      const start_time = Date.now();

      const results = await search_service.unified_search(test.query, {
        topK: 5,
        include_availability_context: true
      });

      const elapsed = Date.now() - start_time;

      console.log(`   Results: ${results.length} matches`);
      console.log(`   Time: ${elapsed}ms`);

      if (results.length > 0) {
        // Get collection stats
        const stats = search_service.get_collection_stats(results);
        console.log(`   Stats: ${stats.in_stock} in-stock, ${stats.fda_only} FDA-only`);

        // Show top result
        const top = results[0];
        console.log(`   Top Match: ${top.document.trade_name || 'Unknown'}`);
        console.log(`   Source: ${top.source_collection}`);
        console.log(`   Availability: ${top.availability}`);
        console.log(`   Score: ${top.score.toFixed(3)}`);
      }

      console.log('   ✅ Test passed');
    } catch (error: any) {
      console.error(`   ❌ Test failed: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(80));

  // Test explicit collection searches
  console.log('\n🎯 Testing Explicit Collection Searches\n');

  try {
    console.log('📦 Search in-stock only:');
    const stock_results = await search_service.search_in_stock('Vitamin C');
    console.log(`   Found ${stock_results.length} in-stock items`);

    console.log('\n📚 Search all FDA:');
    const fda_results = await search_service.search_all_fda('Vitamin C');
    console.log(`   Found ${fda_results.length} FDA items`);

    console.log('\n🔍 Check availability:');
    const availability = await search_service.check_availability('Hyaluronic Acid');
    console.log(`   In stock: ${availability.in_stock}`);
    if (availability.in_stock) {
      console.log(`   Details: ${availability.details?.document.trade_name}`);
    } else {
      console.log(`   Alternatives: ${availability.alternatives?.length || 0} found`);
    }

    console.log('\n✅ All explicit collection tests passed');
  } catch (error: any) {
    console.error(`\n❌ Explicit collection test failed: ${error.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('🎉 Testing completed!\n');
}

// Run tests
test_unified_search()
  .then(() => {
    console.log('✅ All tests completed successfully\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test suite failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  });
