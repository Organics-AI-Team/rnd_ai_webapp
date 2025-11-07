#!/usr/bin/env tsx

/**
 * Check what's currently indexed in Pinecone
 */

import { config } from 'dotenv';
import { PineconeRAGService } from '../ai/services/rag/pinecone-service-stub';

// Load environment variables
config({ path: '.env.local' });

async function checkPineconeIndex() {
  console.log('🔍 CHECKING PINECONE INDEX STATUS\n');

  try {
    const ragService = new PineconeRAGService();

    // Get index stats
    const stats = await ragService.getIndexStats();
    console.log('📊 Index Statistics:');
    console.log(`  Total Records: ${stats.totalRecordCount}`);
    console.log(`  Dimensions: ${stats.dimension}`);
    console.log(`  Index Fullness: ${(stats.indexFullness * 100).toFixed(2)}%`);

    // Check what's in each namespace
    console.log('\n🔍 Checking namespaces...');

    // Check in_stock namespace
    try {
      const inStockResults = await ragService.searchSimilar("test", {
        topK: 1,
        similarityThreshold: 0.1,
        pinecone_namespace: 'in_stock'
      });
      console.log(`✅ in_stock namespace: ${inStockResults.length} records available`);

      if (inStockResults.length > 0) {
        console.log('Sample in_stock record:');
        console.log(`  RM Code: ${inStockResults[0].metadata?.rm_code || 'N/A'}`);
        console.log(`  Source: ${inStockResults[0].metadata?.source || 'N/A'}`);
        console.log(`  Trade Name: ${inStockResults[0].metadata?.trade_name || 'N/A'}`);
      }
    } catch (error) {
      console.log(`❌ in_stock namespace: Error accessing`);
    }

    // Check all_fda namespace
    try {
      const fdaResults = await ragService.searchSimilar("test", {
        topK: 1,
        similarityThreshold: 0.1,
        pinecone_namespace: 'all_fda'
      });
      console.log(`✅ all_fda namespace: ${fdaResults.length} records available`);

      if (fdaResults.length > 0) {
        console.log('Sample all_fda record:');
        console.log(`  RM Code: ${fdaResults[0].metadata?.rm_code || 'N/A'}`);
        console.log(`  Source: ${fdaResults[0].metadata?.source || 'N/A'}`);
        console.log(`  Trade Name: ${fdaResults[0].metadata?.trade_name || 'N/A'}`);
      }
    } catch (error) {
      console.log(`❌ all_fda namespace: Error accessing`);
    }

  } catch (error: any) {
    console.error('❌ Error checking Pinecone:', error.message);
  }
}

checkPineconeIndex().catch(console.error);