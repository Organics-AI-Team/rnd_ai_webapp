/**
 * Test script to check embedding dimensions
 */

import { createEmbeddingService } from '@/ai/services/embeddings/universal-embedding-service';

async function testEmbeddingDimensions() {
  console.log('🧪 Testing embedding dimensions...\n');

  try {
    const embeddingService = createEmbeddingService();

    console.log('📋 Service configuration:');
    console.log(`  Provider: ${embeddingService.getProvider()}`);
    console.log(`  Expected dimensions: ${embeddingService.getDimensions()}\n`);

    const testText = "RM000001 is a raw material";
    console.log(`🔍 Generating embedding for: "${testText}"`);

    const embedding = await embeddingService.createEmbedding(testText);

    console.log(`\n✅ Embedding generated successfully!`);
    console.log(`📏 Actual dimensions: ${embedding.length}`);
    console.log(`🎯 First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(6)).join(', ')}...]\n`);

    // Check if dimensions match expected
    const expectedDims = embeddingService.getDimensions();
    if (embedding.length === expectedDims) {
      console.log(`✅ Dimensions match! (${embedding.length} === ${expectedDims})`);
    } else {
      console.error(`❌ Dimension mismatch! Got ${embedding.length}, expected ${expectedDims}`);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testEmbeddingDimensions();
