/**
 * Test products endpoint that bypasses authentication
 * For debugging purposes only
 */

import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 [test-products] Testing products data...');

    const client = await clientPromise;
    const db = client.db();

    // Get count first
    const totalCount = await db.collection('raw_materials_console').countDocuments();
    console.log(`📊 [test-products] Total documents: ${totalCount}`);

    // Get a few sample products
    const products = await db.collection('raw_materials_console')
      .find({})
      .sort({ rm_code: 1 })
      .limit(10)
      .toArray();

    const formattedProducts = products.map(product => ({
      rm_code: product.rm_code,
      trade_name: product.trade_name,
      supplier: product.supplier,
      rm_cost: product.rm_cost,
      benefits: Array.isArray(product.benefits) ? product.benefits.slice(0, 2) : [],
      usecase: Array.isArray(product.usecase) ? product.usecase.slice(0, 2) : [],
      createdAt: product.createdAt
    }));

    const response = {
      success: true,
      message: 'Products data retrieved successfully',
      totalCount,
      products: formattedProducts,
      sampleFields: products.length > 0 ? {
        availableFields: Object.keys(products[0]),
        sampleProduct: products[0]
      } : null,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ [test-products] Retrieved ${products.length} products`);
    return NextResponse.json(response);

  } catch (error: any) {
    console.error('❌ [test-products] Error:', error);

    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}