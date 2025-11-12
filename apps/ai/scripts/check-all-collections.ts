#!/usr/bin/env tsx

/**
 * Script to check all collections in the database
 */

import { config } from 'dotenv';
import rawMaterialsClientPromise from '../lib/raw-materials-mongodb';

// Load environment variables
config({ path: '.env.local' });

async function checkAllCollections() {
  console.log('🔍 CHECKING ALL COLLECTIONS IN DATABASE\n');

  try {
    const client = await rawMaterialsClientPromise;
    const db = client.db();

    // List all collections
    const collections = await db.listCollections().toArray();
    console.log(`Found ${collections.length} collections:`);
    collections.forEach(col => {
      console.log(`  - ${col.name}`);
    });

    // Check for any collection that might contain FDA or raw materials data
    const relevantCollections = collections.filter(col =>
      col.name.toLowerCase().includes('fda') ||
      col.name.toLowerCase().includes('raw') ||
      col.name.toLowerCase().includes('material') ||
      col.name.toLowerCase().includes('rm')
    );

    console.log('\n=== RELEVANT COLLECTIONS ===');
    for (const col of relevantCollections) {
      const count = await db.collection(col.name).countDocuments();
      console.log(`${col.name}: ${count} documents`);

      // Get a sample
      if (count > 0) {
        const sample = await db.collection(col.name).findOne();
        console.log(`  Sample fields: ${Object.keys(sample).join(', ')}`);

        // Check if it has rm_code field and look for RM000943
        if (sample.rm_code || sample.RM_CODE || sample.material_code) {
          const rm943 = await db.collection(col.name).findOne({
            $or: [
              { rm_code: 'RM000943' },
              { RM_CODE: 'RM000943' },
              { material_code: 'RM000943' }
            ]
          });

          if (rm943) {
            console.log(`  ✅ Found RM000943 in ${col.name}!`);
            console.log(`     Name: ${rm943.trade_name || rm943.name || 'N/A'}`);
            console.log(`     Supplier: ${rm943.supplier || 'N/A'}`);
          }
        }
      }
    }

  } catch (error: any) {
    console.error('❌ Error checking collections:', error.message);
  }
}

checkAllCollections().catch(console.error);