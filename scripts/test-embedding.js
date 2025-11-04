/**
 * Test Embedding Script
 * Tests the embedding service with the new 3072-dimension index
 */

require('dotenv').config({ path: '.env.local' });
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pinecone } = require('@pinecone-database/pinecone');

async function testEmbedding() {
  try {
    console.log('🧪 Testing embedding service...');

    // Check environment variables
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const pineconeApiKey = process.env.PINECONE_API_KEY;
    const indexName = process.env.PINECONE_INDEX || '002-rnd-ai';

    if (!geminiApiKey || !pineconeApiKey) {
      throw new Error('Missing required API keys (GEMINI_API_KEY, PINECONE_API_KEY)');
    }

    console.log('✅ Environment variables found');

    // Initialize Gemini
    console.log('🤖 Initializing Gemini AI...');
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

    // Test embedding generation
    console.log('📊 Testing embedding generation...');
    const testText = 'น้ำมันมะพร้าว เป็นสารที่ให้ความชุ่มชื้นแก่ผิวหนัง';

    const result = await model.embedContent(testText);
    const embedding = result.embedding;

    console.log(`✅ Embedding generated successfully`);
    console.log(`📏 Embedding dimensions: ${embedding.values.length}`);

    if (embedding.values.length !== 3072) {
      throw new Error(`Expected 3072 dimensions, got ${embedding.values.length}`);
    }

    // Initialize Pinecone
    console.log('🌲 Initializing Pinecone...');
    const pinecone = new Pinecone({ apiKey: pineconeApiKey });
    const index = pinecone.index(indexName);

    // Test index description
    console.log('📋 Checking index configuration...');
    const description = await index.describeIndexStats();
    console.log(`📊 Index stats:`, description);

    // Test vector insertion
    console.log('🔄 Testing vector insertion...');
    const testVector = {
      id: 'test-vector-' + Date.now(),
      values: embedding.values,
      metadata: {
        type: 'test',
        text: testText,
        timestamp: new Date().toISOString()
      }
    };

    await index.upsert([testVector]);
    console.log('✅ Vector inserted successfully');

    // Test vector search
    console.log('🔍 Testing vector search...');
    const queryResult = await index.query({
      vector: embedding.values,
      topK: 1,
      includeMetadata: true
    });

    console.log('✅ Search completed successfully');
    console.log(`📝 Found ${queryResult.matches?.length || 0} matches`);

    if (queryResult.matches && queryResult.matches.length > 0) {
      const match = queryResult.matches[0];
      console.log(`🎯 Top match score: ${match.score}`);
      console.log(`📋 Match metadata:`, match.metadata);
    }

    // Clean up test vector
    console.log('🧹 Cleaning up test vector...');
    await index.deleteOne([testVector.id]);
    console.log('✅ Test vector deleted');

    console.log('🎉 All tests passed! Embedding service is working correctly.');
    console.log('');
    console.log('📋 Summary:');
    console.log(`   - Gemini embedding dimensions: 3072`);
    console.log(`   - Pinecone index: ${indexName}`);
    console.log(`   - Vector insertion: ✅`);
    console.log(`   - Vector search: ✅`);
    console.log('');
    console.log('🚀 Your RAG system is ready to use!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testEmbedding();