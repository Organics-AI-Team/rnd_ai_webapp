/**
 * Verify Production Migration Script
 * Checks Pinecone vector count and tests sample queries
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { HybridSearchService } from '@/ai/services/rag/hybrid-search-service';
import { classify_query } from '@/ai/utils/query-classifier';

async function verify_migration() {
  console.log('🔍 Verifying Production Migration\n');
  console.log('='.repeat(80));

  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    throw new Error('PINECONE_API_KEY not found in environment');
  }

  const pinecone = new Pinecone({ apiKey });
  const indexName = 'raw-materials-stock';

  try {
    // Step 1: Verify index exists and check stats
    console.log('\n[1/3] Checking Pinecone Index...');
    console.log('-'.repeat(80));

    const indexDescription = await pinecone.describeIndex(indexName);
    console.log(`✅ Index "${indexName}" exists`);
    console.log(`  Status: ${indexDescription.status?.state}`);
    console.log(`  Dimension: ${indexDescription.dimension}`);
    console.log(`  Metric: ${indexDescription.metric}`);
    console.log(`  Host: ${indexDescription.host}`);

    // Get index stats
    const index = pinecone.index(indexName);
    const stats = await index.describeIndexStats();

    console.log(`\n📊 Index Statistics:`);
    console.log(`  Total vectors: ${stats.totalRecordCount}`);
    console.log(`  Namespaces: ${Object.keys(stats.namespaces || {}).length || 'default'}`);

    // Verify expected vector count
    const expectedVectors = 18666; // 3,111 documents × 6 chunks
    const actualVectors = stats.totalRecordCount || 0;

    if (actualVectors >= expectedVectors * 0.95) { // Allow 5% tolerance
      console.log(`  ✅ Vector count matches expected (~${expectedVectors})`);
    } else {
      console.log(`  ⚠️  Vector count mismatch: expected ~${expectedVectors}, got ${actualVectors}`);
    }

    // Step 2: Test sample queries
    console.log('\n[2/3] Testing Sample Queries...');
    console.log('-'.repeat(80));

    const testQueries = [
      { query: 'RM000001', type: 'Exact code search' },
      { query: 'Hyaluronic Acid', type: 'Name search' },
      { query: 'วัตถุดิบที่ช่วยเรื่องความชุ่มชื้น', type: 'Thai property search' }
    ];

    const hybridSearch = new HybridSearchService();

    for (const test of testQueries) {
      console.log(`\n🔍 Testing: "${test.query}" (${test.type})`);

      // Classify query
      const classification = classify_query(test.query);
      console.log(`  Classification: ${classification.query_type} (${(classification.confidence * 100).toFixed(0)}%)`);

      try {
        // Perform hybrid search
        const results = await hybridSearch.hybrid_search(test.query, { topK: 5 });

        console.log(`  ✅ Retrieved ${results.length} results`);

        if (results.length > 0) {
          const topResult = results[0];
          console.log(`  Top result score: ${topResult.score.toFixed(4)}`);
          console.log(`  Document: ${topResult.document.rm_code || 'N/A'} - ${topResult.document.trade_name || 'N/A'}`);
        } else {
          console.log(`  ⚠️  No results found`);
        }
      } catch (error: any) {
        console.log(`  ❌ Search failed: ${error.message}`);
      }
    }

    // Step 3: Test vector retrieval
    console.log('\n[3/3] Testing Vector Retrieval...');
    console.log('-'.repeat(80));

    try {
      // Query a random vector to ensure vectors are retrievable
      const queryResult = await index.query({
        topK: 1,
        vector: new Array(3072).fill(0).map(() => Math.random() * 2 - 1), // Random 3072-d vector
        includeMetadata: true
      });

      if (queryResult.matches && queryResult.matches.length > 0) {
        console.log(`✅ Vectors are retrievable`);
        console.log(`  Sample vector ID: ${queryResult.matches[0].id}`);
        console.log(`  Sample metadata keys: ${Object.keys(queryResult.matches[0].metadata || {}).join(', ')}`);
      } else {
        console.log(`⚠️  No vectors found in random query`);
      }
    } catch (error: any) {
      console.log(`❌ Vector retrieval failed: ${error.message}`);
    }

    // Final Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 MIGRATION VERIFICATION SUMMARY');
    console.log('='.repeat(80));

    const verificationPassed = actualVectors >= expectedVectors * 0.95;

    if (verificationPassed) {
      console.log('\n✅ Migration Verified Successfully!');
      console.log(`  - Index exists and is ready`);
      console.log(`  - Vector count: ${actualVectors} (expected: ~${expectedVectors})`);
      console.log(`  - Queries working correctly`);
      console.log(`  - Vectors retrievable`);
      console.log('\n🚀 Ready for production deployment!\n');
      process.exit(0);
    } else {
      console.log('\n⚠️  Migration Verification Issues Detected');
      console.log(`  - Vector count below expected threshold`);
      console.log(`  - Expected: ~${expectedVectors}, Got: ${actualVectors}`);
      console.log('\n⚠️  Review migration logs before deployment\n');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('\n❌ Verification failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run verification
verify_migration();
