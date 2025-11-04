/**
 * Test Pinecone Connection Script
 * Tests basic connectivity to Pinecone API
 */

require('dotenv').config({ path: '.env.local' });
const { Pinecone } = require('@pinecone-database/pinecone');

async function testPineconeConnection() {
  try {
    console.log('🔍 Testing Pinecone connection...');

    // Check environment variables
    const apiKey = process.env.PINECONE_API_KEY;
    const indexName = process.env.PINECONE_INDEX || '002-rnd-ai';

    if (!apiKey) {
      throw new Error('PINECONE_API_KEY environment variable is not set');
    }

    console.log('✅ Environment variables found');

    // Initialize Pinecone
    console.log('🌲 Initializing Pinecone client...');
    const pinecone = new Pinecone({
      apiKey: apiKey
    });

    // Test 1: List indexes
    console.log('📋 Testing list indexes API...');
    const indexList = await pinecone.listIndexes();
    console.log('✅ List indexes API working');

    const indexExists = indexList.indexes?.some(index => index.name === indexName);
    if (indexExists) {
      console.log(`✅ Index '${indexName}' exists`);
    } else {
      console.log(`❌ Index '${indexName}' not found`);
      return;
    }

    // Test 2: Describe index
    console.log('🔍 Testing describe index API...');
    const indexDescription = await pinecone.describeIndex(indexName);
    console.log('✅ Describe index API working');
    console.log(`📊 Index status: ${indexDescription.status?.ready ? 'Ready' : 'Not ready'}`);
    console.log(`📏 Index dimension: ${indexDescription.dimension}`);

    // Test 3: Connect to index
    console.log('🔗 Testing index connection...');
    const index = pinecone.index(indexName);

    // Test 4: Get index stats
    console.log('📊 Testing index stats API...');
    const stats = await index.describeIndexStats();
    console.log('✅ Index stats API working');
    console.log(`📈 Total vectors: ${stats.totalRecordCount || 0}`);
    console.log(`💾 Index fullness: ${stats.indexFullness ? (stats.indexFullness * 100).toFixed(2) + '%' : 'N/A'}`);

    // Test 5: Simple query test
    console.log('🔍 Testing query API...');
    const testVector = Array(3072).fill(0.1); // Simple test vector
    const queryResult = await index.query({
      vector: testVector,
      topK: 1,
      includeMetadata: true
    });
    console.log('✅ Query API working');
    console.log(`🔎 Query results: ${queryResult.matches?.length || 0} matches`);

    console.log('\n🎉 All Pinecone connectivity tests passed!');
    console.log('✅ Your connection to Pinecone is working correctly');

  } catch (error) {
    console.error('❌ Pinecone connection test failed:', error.message);

    if (error.message.includes('fetch failed') || error.message.includes('timeout')) {
      console.log('\n🔧 Troubleshooting suggestions:');
      console.log('1. Check your internet connection');
      console.log('2. Try using a different network');
      console.log('3. Check if you need a VPN or proxy settings');
      console.log('4. Visit https://status.pinecone.io/ to check service status');
      console.log('5. Try again in a few minutes');
    } else if (error.message.includes('401') || error.message.includes('403')) {
      console.log('\n🔑 Authentication issue:');
      console.log('1. Check your PINECONE_API_KEY is correct');
      console.log('2. Verify the API key has proper permissions');
      console.log('3. Check if the API key has expired');
    } else if (error.message.includes('404')) {
      console.log('\n🔍 Index not found:');
      console.log('1. Check if the index name is correct');
      console.log('2. Run the index creation script if needed');
    }

    process.exit(1);
  }
}

// Run the test
testPineconeConnection();