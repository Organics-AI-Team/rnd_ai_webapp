/**
 * Create Pinecone Index Script
 * Creates a new Pinecone index with 3072 dimensions for gemini-embedding-001
 */

require('dotenv').config({ path: '.env.local' });
const { Pinecone } = require('@pinecone-database/pinecone');

async function createPineconeIndex() {
  try {
    // Check if environment variables are set
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      throw new Error('PINECONE_API_KEY environment variable is not set');
    }

    const indexName = process.env.PINECONE_INDEX || '002-rnd-ai';

    console.log('Initializing Pinecone client...');
    const pinecone = new Pinecone({
      apiKey: apiKey
    });

    console.log(`Checking if index '${indexName}' already exists...`);

    // List existing indexes
    const indexes = await pinecone.listIndexes();
    const existingIndex = indexes.indexes?.find(index => index.name === indexName);

    if (existingIndex) {
      console.log(`Index '${indexName}' already exists with dimension: ${existingIndex.dimension}`);

      if (existingIndex.dimension === 3072) {
        console.log('✅ Index already has correct dimensions (3072). No action needed.');
        return;
      }

      console.log('⚠️  Index has incorrect dimensions. Deleting existing index...');
      await pinecone.deleteIndex(indexName);
      console.log('✅ Existing index deleted successfully');

      // Wait for deletion to complete
      console.log('⏳ Waiting for index deletion to complete...');
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
    }

    console.log('Creating new index with 3072 dimensions...');

    // Create new index with 3072 dimensions for gemini-embedding-001
    await pinecone.createIndex({
      name: indexName,
      dimension: 3072,
      metric: 'cosine',
      spec: {
        serverless: {
          cloud: 'aws',
          region: 'us-east-1'
        }
      }
    });

    console.log('✅ Index creation initiated successfully');

    // Wait for index to be ready
    console.log('⏳ Waiting for index to be ready...');
    let indexReady = false;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max

    while (!indexReady && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      try {
        const description = await pinecone.describeIndex(indexName);
        if (description.status?.ready === true) {
          indexReady = true;
          console.log('✅ Index is ready for use!');
        } else {
          console.log(`Index status: ${description.status?.state || 'unknown'}... (attempt ${attempts + 1}/${maxAttempts})`);
        }
      } catch (error) {
        console.log(`Checking index status... (attempt ${attempts + 1}/${maxAttempts})`);
      }

      attempts++;
    }

    if (!indexReady) {
      throw new Error('Index creation timed out. Please check the Pinecone console.');
    }

    console.log(`🎉 Successfully created and configured index '${indexName}' with 3072 dimensions`);
    console.log('📝 Index details:');
    console.log(`   - Name: ${indexName}`);
    console.log(`   - Dimensions: 3072`);
    console.log(`   - Metric: cosine`);
    console.log(`   - Cloud: AWS`);
    console.log(`   - Region: us-east-1`);

  } catch (error) {
    console.error('❌ Error creating Pinecone index:', error);
    process.exit(1);
  }
}

// Run the script
createPineconeIndex();