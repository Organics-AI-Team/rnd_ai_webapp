/**
 * Simple test endpoint to verify MongoDB connection and data
 * Bypasses authentication for debugging
 */

import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 [test-db] Testing MongoDB connection...');

    const client = await clientPromise;
    const db = client.db();

    // Test basic connection
    const collections = await db.listCollections().toArray();
    console.log('✅ [test-db] Connected. Collections:', collections.map(c => c.name));

    // Test raw_materials_console collection
    const consoleCount = await db.collection('raw_materials_console').countDocuments();
    console.log(`📊 [test-db] raw_materials_console count: ${consoleCount}`);

    // Get a few sample documents
    const samples = await db.collection('raw_materials_console')
      .find({})
      .limit(3)
      .toArray();

    // Test raw_materials_real_stock collection
    const stockCount = await db.collection('raw_materials_real_stock').countDocuments();
    console.log(`📊 [test-db] raw_materials_real_stock count: ${stockCount}`);

    const response = {
      success: true,
      message: 'MongoDB connection successful',
      database: {
        collections: collections.map(c => ({ name: c.name, type: c.type })),
        raw_materials_console: {
          count: consoleCount,
          sample: samples.map(doc => ({
            rm_code: doc.rm_code,
            trade_name: doc.trade_name,
            supplier: doc.supplier,
            benefits: doc.benefits?.slice(0, 2) // First 2 benefits
          }))
        },
        raw_materials_real_stock: {
          count: stockCount
        }
      },
      timestamp: new Date().toISOString()
    };

    console.log('✅ [test-db] Test completed successfully');
    return NextResponse.json(response);

  } catch (error: any) {
    console.error('❌ [test-db] Database error:', error);

    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}