#!/usr/bin/env tsx

/**
 * Test script to check if RM000011 exists in the database
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import rawMaterialsClientPromise from './lib/raw-materials-mongodb';

async function checkDatabaseForRM000011() {
  console.log('🔍 Checking database for RM000011...');

  try {
    const client = await rawMaterialsClientPromise;
    const db = client.db();

    // Search for RM000011 in MongoDB
    const material = await db.collection("raw_materials_real_stock")
      .findOne({ rm_code: "RM000011" });

    if (material) {
      console.log('✅ Found RM000011 in database:');
      console.log('   RM Code:', material.rm_code);
      console.log('   Trade Name:', material.trade_name);
      console.log('   INCI Name:', material.inci_name);
      console.log('   Supplier:', material.supplier);
      console.log('   Benefits:', material.benefits?.substring(0, 100) + '...');
      return material;
    } else {
      console.log('❌ RM000011 not found in database');

      // Let's see what materials exist
      const sample = await db.collection("raw_materials_real_stock")
        .find({})
        .limit(5)
        .toArray();

      console.log('📋 Sample materials in database:');
      sample.forEach((mat, index) => {
        console.log(`${index + 1}. ${mat.rm_code} - ${mat.trade_name}`);
      });

      return null;
    }
  } catch (error) {
    console.error('❌ Database error:', error);
    return null;
  }
}

async function main() {
  console.log('🚀 Testing Database Search for RM000011\n');

  const result = await checkDatabaseForRM000011();

  console.log('\n' + '='.repeat(50));
  console.log('📊 DATABASE SEARCH RESULTS');
  console.log('='.repeat(50));

  if (result) {
    console.log('✅ RM000011 EXISTS in database');
    console.log('❌ RAG should have found it but didn\'t');
    console.log('🔧 This confirms the RAG embedding issue');
  } else {
    console.log('❌ RM000011 NOT in database');
    console.log('🔧 Need to check what chemicals are actually indexed');
  }

  console.log('\n🏁 Test completed!');
}

main().catch(console.error);