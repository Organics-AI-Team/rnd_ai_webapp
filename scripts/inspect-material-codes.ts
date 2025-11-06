#!/usr/bin/env tsx

/**
 * Script to inspect material codes in MongoDB to identify formatting issues
 */

import { config } from 'dotenv';
import rawMaterialsClientPromise from '../lib/raw-materials-mongodb';

// Load environment variables
config({ path: '.env.local' });

async function inspectMaterialCodes() {
  console.log('🔍 INSPECTING MATERIAL CODES IN MONGODB\n');

  try {
    const client = await rawMaterialsClientPromise;
    const db = client.db();

    // Get sample of materials from both collections
    console.log('=== Checking raw_materials_real_stock collection ===');
    const realStock = await db.collection("raw_materials_real_stock")
      .find({})
      .limit(10)
      .toArray();

    console.log(`Found ${realStock.length} materials in real_stock collection:\n`);

    realStock.forEach((material, index) => {
      console.log(`${index + 1}. RM Code: "${material.rm_code}" | Trade Name: "${material.trade_name}" | Supplier: "${material.supplier}"`);
    });

    console.log('\n=== Checking raw_materials_all_fda collection ===');
    const allFda = await db.collection("raw_materials_all_fda")
      .find({})
      .limit(10)
      .toArray();

    console.log(`Found ${allFda.length} materials in all_fda collection:\n`);

    allFda.forEach((material, index) => {
      console.log(`${index + 1}. RM Code: "${material.rm_code}" | Trade Name: "${material.trade_name}" | Supplier: "${material.supplier}"`);
    });

    // Look for materials with problematic codes
    console.log('\n=== LOOKING FOR PROBLEMATIC CODES ===');

    const problematicPatterns = [
      /^[A-Z]+[ก-๙]/, // Starts with English letters but contains Thai
      /^[ก-๙]/, // Starts with Thai characters
      /\s/, // Contains spaces
      /^[^-]+-[^-]+-[^-]+/ // Contains multiple dashes (likely descriptive)
    ];

    const findProblematicCodes = async (collectionName: string) => {
      console.log(`\n--- Problematic codes in ${collectionName} ---`);

      for (const pattern of problematicPatterns) {
        const matches = await db.collection(collectionName)
          .find({ rm_code: { $regex: pattern } })
          .limit(5)
          .toArray();

        if (matches.length > 0) {
          console.log(`Pattern ${pattern}:`);
          matches.forEach(m => {
            console.log(`  - "${m.rm_code}" -> "${m.trade_name}" (${m.supplier})`);
          });
        }
      }
    };

    await findProblematicCodes("raw_materials_real_stock");
    await findProblematicCodes("raw_materials_all_fda");

    // Count total and show statistics
    const realStockCount = await db.collection("raw_materials_real_stock").countDocuments();
    const allFdaCount = await db.collection("raw_materials_all_fda").countDocuments();

    console.log('\n=== COLLECTION STATISTICS ===');
    console.log(`Total in raw_materials_real_stock: ${realStockCount}`);
    console.log(`Total in raw_materials_all_fda: ${allFdaCount}`);

  } catch (error: any) {
    console.error('❌ Error inspecting material codes:', error.message);
  }
}

inspectMaterialCodes().catch(console.error);