#!/usr/bin/env tsx

/**
 * Check what fields are available in console collection for a specific RM code
 */

import { config } from 'dotenv';
import rawMaterialsClientPromise from '../lib/raw-materials-mongodb';

// Load environment variables
config({ path: '.env.local' });

async function checkConsoleFields() {
  console.log('🔍 CHECKING CONSOLE COLLECTION FIELDS\n');

  try {
    const client = await rawMaterialsClientPromise;
    const db = client.db();

    // Look for RM000943 in console collection
    const rm000943 = await db.collection("raw_meterials_console").findOne({
      rm_code: 'RM000943'
    });

    if (rm000943) {
      console.log('✅ Found RM000943 in console collection:');
      console.log('Available fields:');
      Object.keys(rm000943).forEach(key => {
        const value = rm000943[key];
        if (typeof value === 'string' && value.length > 100) {
          console.log(`  ${key}: "${value.substring(0, 100)}..."`);
        } else {
          console.log(`  ${key}: ${JSON.stringify(value)}`);
        }
      });
    } else {
      console.log('❌ RM000943 not found in console collection');

      // Let's check a few other RM codes to see the pattern
      console.log('\n🔍 Checking other RM codes...');
      const sample = await db.collection("raw_meterials_console")
        .find({ rm_code: { $regex: '^RM' } })
        .limit(3)
        .toArray();

      sample.forEach((doc, index) => {
        console.log(`\nSample ${index + 1}: ${doc.rm_code}`);
        console.log('Fields:', Object.keys(doc).join(', '));
        if (doc.trade_name || doc.name) {
          console.log(`  Name field: ${doc.trade_name || doc.name}`);
        }
        if (doc.supplier) {
          console.log(`  Supplier: ${doc.supplier}`);
        }
      });
    }

  } catch (error: any) {
    console.error('❌ Error checking console fields:', error.message);
  }
}

checkConsoleFields().catch(console.error);