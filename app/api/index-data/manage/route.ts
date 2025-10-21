/**
 * Index Management API Route
 * Provides functionality to recreate, validate, and manage Pinecone indexes
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'rnd_ai';

export const maxDuration = 600; // 10 minutes for index operations

async function connectToMongoDB() {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  return client.db(DB_NAME);
}

export async function POST(req: NextRequest) {
  try {
    const { action, confirmIndexName, forceRecreate } = await req.json();

    const pineconeApiKey = process.env.PINECONE_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const indexName = process.env.PINECONE_INDEX || '002-rnd-ai';

    if (!pineconeApiKey || !geminiApiKey) {
      return NextResponse.json(
        { success: false, error: 'Missing required API keys' },
        { status: 400 }
      );
    }

    if (action === 'validate-and-recreate') {
      if (!confirmIndexName || confirmIndexName !== indexName) {
        return NextResponse.json(
          {
            success: false,
            error: 'Index name confirmation required',
            requiresConfirmation: true,
            expectedIndexName: indexName
          },
          { status: 400 }
        );
      }

      console.log('🔄 Starting index validation and recreation process...');

      // Initialize Pinecone
      const pinecone = new Pinecone({ apiKey: pineconeApiKey });

      // Step 1: Delete existing index if it exists
      console.log('🔍 Checking if index exists...');
      try {
        const indexList = await pinecone.listIndexes();
        const existingIndex = indexList.indexes?.find(index => index.name === indexName);

        if (existingIndex) {
          if (!forceRecreate && existingIndex.dimension === 3072) {
            console.log('✅ Index already has correct dimensions (3072)');
            return NextResponse.json({
              success: true,
              message: 'Index already has correct dimensions (3072)',
              action: 'none',
              indexStats: {
                name: indexName,
                dimension: existingIndex.dimension,
                status: existingIndex.status?.ready ? 'Ready' : 'Not Ready'
              }
            });
          }

          console.log(`🗑️ Deleting existing index: ${indexName}`);
          await pinecone.deleteIndex(indexName);
          console.log('✅ Existing index deleted');

          // Wait for deletion to complete
          console.log('⏳ Waiting for index deletion to complete...');
          await new Promise(resolve => setTimeout(resolve, 30000));
        }
      } catch (error) {
        console.error('Error checking/deleting index:', error);
        return NextResponse.json(
          { success: false, error: `Failed to manage existing index: ${error.message}` },
          { status: 500 }
        );
      }

      // Step 2: Create new index with correct dimensions
      console.log('🏗️ Creating new index with 3072 dimensions...');
      try {
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
        console.log('✅ Index creation initiated');

        // Wait for index to be ready
        console.log('⏳ Waiting for index to be ready...');
        let indexReady = false;
        let attempts = 0;
        const maxAttempts = 60;

        while (!indexReady && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000));

          try {
            const description = await pinecone.describeIndex(indexName);
            if (description.status?.ready === true) {
              indexReady = true;
              console.log('✅ Index is ready!');
            } else {
              console.log(`Index status: ${description.status?.state || 'unknown'} (attempt ${attempts + 1}/${maxAttempts})`);
            }
          } catch (error) {
            console.log(`Checking index status... (attempt ${attempts + 1}/${maxAttempts})`);
          }

          attempts++;
        }

        if (!indexReady) {
          throw new Error('Index creation timed out');
        }

      } catch (error) {
        console.error('Error creating index:', error);
        return NextResponse.json(
          { success: false, error: `Failed to create index: ${error.message}` },
          { status: 500 }
        );
      }

      // Step 3: Test embedding generation
      console.log('🧪 Testing embedding generation...');
      try {
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
        const testResult = await model.embedContent('Test text for embedding validation');

        if (testResult.embedding.values.length !== 3072) {
          throw new Error(`Expected 3072 dimensions, got ${testResult.embedding.values.length}`);
        }

        console.log('✅ Embedding generation working correctly');
      } catch (error) {
        console.error('Embedding test failed:', error);
        return NextResponse.json(
          { success: false, error: `Embedding validation failed: ${error.message}` },
          { status: 500 }
        );
      }

      // Step 4: Test vector operations
      console.log('🧪 Testing vector operations...');
      try {
        const index = pinecone.index(indexName);
        const testVector = Array(3072).fill(0.1);

        // Test insert
        const testId = `test-validation-${Date.now()}`;
        await index.upsert([{
          id: testId,
          values: testVector,
          metadata: { type: 'test', timestamp: new Date().toISOString() }
        }]);

        // Test query
        const queryResult = await index.query({
          vector: testVector,
          topK: 1,
          includeMetadata: true
        });

        // Test delete
        await index.deleteOne([testId]);

        console.log('✅ Vector operations working correctly');
      } catch (error) {
        console.error('Vector operations test failed:', error);
        return NextResponse.json(
          { success: false, error: `Vector operations validation failed: ${error.message}` },
          { status: 500 }
        );
      }

      // Step 5: Get final index stats
      console.log('📊 Getting final index statistics...');
      try {
        const index = pinecone.index(indexName);
        const finalStats = await index.describeIndexStats();

        return NextResponse.json({
          success: true,
          message: 'Index successfully validated and created with correct dimensions (3072)',
          action: 'recreated',
          indexStats: {
            name: indexName,
            dimension: 3072,
            totalRecordCount: finalStats.totalRecordCount || 0,
            indexFullness: finalStats.indexFullness || 0,
            status: 'Ready'
          },
          validations: {
            embeddingGeneration: '✅ Passed',
            vectorOperations: '✅ Passed',
            correctDimensions: '✅ 3072 dimensions'
          }
        });
      } catch (error) {
        return NextResponse.json({
          success: true,
          message: 'Index created successfully (could not retrieve final stats)',
          action: 'recreated',
          indexStats: {
            name: indexName,
            dimension: 3072,
            status: 'Ready'
          },
          warning: `Could not retrieve final stats: ${error.message}`
        });
      }

    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid action' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('Index management error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const pineconeApiKey = process.env.PINECONE_API_KEY;
    const indexName = process.env.PINECONE_INDEX || '002-rnd-ai';

    if (!pineconeApiKey) {
      return NextResponse.json(
        { success: false, error: 'Missing PINECONE_API_KEY' },
        { status: 500 }
      );
    }

    const pinecone = new Pinecone({ apiKey: pineconeApiKey });

    // Get detailed index information
    const indexList = await pinecone.listIndexes();
    const indexInfo = indexList.indexes?.find(index => index.name === indexName);

    let indexStats = null;

    if (indexInfo) {
      try {
        const index = pinecone.index(indexName);
        indexStats = await index.describeIndexStats();
      } catch (error) {
        console.warn('Could not get index stats:', error.message);
      }
    }

    return NextResponse.json({
      success: true,
      indexInfo: indexInfo ? {
        name: indexInfo.name,
        dimension: indexInfo.dimension,
        metric: indexInfo.metric,
        status: indexInfo.status?.ready ? 'Ready' : 'Not Ready',
        state: indexInfo.status?.state
      } : null,
      stats: indexStats
    });
  } catch (error) {
    console.error('Get index info error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}