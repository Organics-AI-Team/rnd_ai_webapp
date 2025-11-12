/**
 * Create Pinecone Index Script
 * Creates the raw-materials-stock index if it doesn't exist
 */

import { Pinecone } from '@pinecone-database/pinecone';

async function createPineconeIndex() {
  console.log('🔍 Checking Pinecone index...\n');

  const apiKey = process.env.PINECONE_API_KEY;

  if (!apiKey) {
    throw new Error('PINECONE_API_KEY not found in environment');
  }

  const pinecone = new Pinecone({ apiKey });
  const indexName = 'raw-materials-stock';

  try {
    // Check if index exists
    console.log(`📋 Checking if index "${indexName}" exists...`);
    const indexes = await pinecone.listIndexes();
    const indexExists = indexes.indexes?.some(idx => idx.name === indexName);

    if (indexExists) {
      console.log(`✅ Index "${indexName}" already exists!`);

      // Describe the index
      const indexDescription = await pinecone.describeIndex(indexName);
      console.log(`\n📊 Index Details:`);
      console.log(`  Name: ${indexDescription.name}`);
      console.log(`  Dimension: ${indexDescription.dimension}`);
      console.log(`  Metric: ${indexDescription.metric}`);
      console.log(`  Status: ${indexDescription.status?.state}`);

      return;
    }

    console.log(`❌ Index "${indexName}" does not exist. Creating...`);

    // Create the index
    // Dimension 3072 is for Google Gemini gemini-embedding-001
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

    console.log(`✅ Index "${indexName}" created successfully!`);
    console.log(`\n⏳ Waiting for index to be ready...`);

    // Wait for index to be ready
    let ready = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!ready && attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

      try {
        const description = await pinecone.describeIndex(indexName);
        if (description.status?.state === 'Ready') {
          ready = true;
          console.log(`\n✅ Index is ready!`);
          console.log(`\n📊 Index Details:`);
          console.log(`  Name: ${description.name}`);
          console.log(`  Dimension: ${description.dimension}`);
          console.log(`  Metric: ${description.metric}`);
          console.log(`  Status: ${description.status?.state}`);
        } else {
          process.stdout.write('.');
        }
      } catch (error) {
        process.stdout.write('.');
      }
    }

    if (!ready) {
      console.log(`\n⚠️ Index creation is still in progress. It may take a few more minutes.`);
      console.log(`   You can check the status in the Pinecone dashboard.`);
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

// Run the script
createPineconeIndex()
  .then(() => {
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
