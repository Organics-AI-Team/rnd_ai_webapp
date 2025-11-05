/**
 * Delete and Recreate Pinecone Index with Correct Dimensions
 * Fixes the dimension mismatch issue (768 → 3072)
 */

import { Pinecone } from '@pinecone-database/pinecone';

async function deleteAndRecreateIndex() {
  console.log('🔧 Fixing Pinecone index dimensions...\n');

  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    throw new Error('PINECONE_API_KEY not found in environment');
  }

  const pinecone = new Pinecone({ apiKey });
  const indexName = 'raw-materials-stock';

  try {
    // Step 1: Check if index exists
    console.log(`📋 Checking if index "${indexName}" exists...`);
    const indexes = await pinecone.listIndexes();
    const indexExists = indexes.indexes?.some(idx => idx.name === indexName);

    if (indexExists) {
      // Get current index details
      const indexDescription = await pinecone.describeIndex(indexName);
      console.log(`\n📊 Current Index Details:`);
      console.log(`  Name: ${indexDescription.name}`);
      console.log(`  Dimension: ${indexDescription.dimension} ❌ (incorrect)`);
      console.log(`  Metric: ${indexDescription.metric}`);
      console.log(`  Status: ${indexDescription.status?.state}\n`);

      // Step 2: Delete the index
      console.log(`🗑️  Deleting index "${indexName}"...`);
      await pinecone.deleteIndex(indexName);
      console.log(`✅ Index deleted successfully!\n`);

      // Wait a bit for deletion to complete
      console.log('⏳ Waiting for deletion to propagate...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
      console.log(`✅ Index "${indexName}" does not exist yet.\n`);
    }

    // Step 3: Create new index with correct dimensions
    console.log(`🆕 Creating index "${indexName}" with correct dimensions (3072)...`);
    await pinecone.createIndex({
      name: indexName,
      dimension: 3072, // Correct dimension for gemini-embedding-001
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

    // Step 4: Wait for index to be ready
    let ready = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!ready && attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        const description = await pinecone.describeIndex(indexName);
        if (description.status?.state === 'Ready') {
          ready = true;
          console.log(`\n✅ Index is ready!`);
          console.log(`\n📊 New Index Details:`);
          console.log(`  Name: ${description.name}`);
          console.log(`  Dimension: ${description.dimension} ✅ (correct)`);
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
      console.log(`\n⚠️ Index creation is still in progress.`);
      console.log(`   Check status in Pinecone dashboard.`);
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

deleteAndRecreateIndex()
  .then(() => {
    console.log('\n✅ Index successfully recreated with correct dimensions!');
    console.log('You can now run the migration script.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
