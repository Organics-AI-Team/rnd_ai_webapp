/**
 * API Route to Index Raw Materials into Pinecone
 * This will process the raw_materials_console collection and create embeddings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEmbeddingService } from '@/lib/services/embedding';
import { MongoClient, Db } from 'mongodb';

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'rnd_ai';

export const maxDuration = 300; // 5 minutes for indexing

// Helper function to connect to MongoDB
async function connectToDatabase(): Promise<Db> {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  return db;
}

// Helper function to fetch raw materials from MongoDB
async function fetchRawMaterials(db: Db) {
  try {
    // Try to get from raw_meterials_console collection first (the new data with 31K+ records)
    const rawMaterials = await db
      .collection('raw_meterials_console')
      .find({})
      .toArray();

    if (rawMaterials.length > 0) {
      console.log(`Found ${rawMaterials.length} raw materials in raw_meterials_console`);
      return rawMaterials;
    }

    // Fallback to other possible collection names
    const alternativeNames = ['raw_materials', 'raw_materials_console', 'materials', 'ingredients'];

    for (const collectionName of alternativeNames) {
      try {
        const materials = await db
          .collection(collectionName)
          .find({})
          .toArray();

        if (materials.length > 0) {
          console.log(`Found ${materials.length} raw materials in ${collectionName}`);
          return materials;
        }
      } catch (error) {
        console.log(`Collection ${collectionName} not found, trying next...`);
      }
    }

    console.log('No raw materials found in any collection');
    return [];
  } catch (error) {
    console.error('Error fetching raw materials:', error);
    return [];
  }
}

// Helper function to fetch formulas from MongoDB
async function fetchFormulas(db: Db) {
  try {
    const formulas = await db
      .collection('formulas')
      .find({})
      .toArray();

    console.log(`Found ${formulas.length} formulas`);
    return formulas;
  } catch (error) {
    console.error('Error fetching formulas:', error);
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const { indexType = 'all', forceReindex = false } = await req.json();

    console.log(`Starting to index ${indexType} data...`);

    // Connect to MongoDB
    const db = await connectToDatabase();

    // Get embedding service
    const embeddingService = getEmbeddingService();

    // Check current index stats to avoid re-indexing
    const currentStats = await embeddingService.getIndexStats();
    const currentVectorCount = currentStats.totalVectorCount || 0;

    console.log(`Current vector count: ${currentVectorCount}`);

    let indexedCount = 0;
    let needsIndexing = forceReindex;

    if (indexType === 'raw_materials' || indexType === 'all') {
      // Fetch raw materials
      const rawMaterials = await fetchRawMaterials(db);

      if (rawMaterials.length > 0) {
        // Check if we need to index (avoid re-indexing if already done)
        if (!needsIndexing) {
          // Simple check: if we have close to the expected number of vectors, assume it's already indexed
          const expectedVectors = rawMaterials.length;
          if (currentVectorCount >= expectedVectors * 0.9) { // 90% threshold
            console.log(`Raw materials already indexed (${currentVectorCount} vectors found, ${expectedVectors} expected). Skipping...`);
            indexedCount = rawMaterials.length;
          } else {
            needsIndexing = true;
          }
        }

        if (needsIndexing) {
          console.log(`Indexing ${rawMaterials.length} raw materials...`);
          await embeddingService.indexRawMaterials(rawMaterials as any[]);
          indexedCount += rawMaterials.length;
        } else {
          indexedCount += rawMaterials.length; // Count as "indexed" for UI purposes
        }
      }
    }

    if (indexType === 'formulas' || indexType === 'all') {
      // Fetch formulas
      const formulas = await fetchFormulas(db);

      if (formulas.length > 0) {
        // Check if we need to index formulas
        if (!needsIndexing) {
          // For formulas, we'd need a more complex check, but for now assume if we have raw materials indexed, we're good
          console.log(`Formulas likely already indexed. Skipping...`);
          indexedCount += formulas.length;
        } else {
          console.log(`Indexing ${formulas.length} formulas...`);
          await embeddingService.indexFormulas(formulas as any[]);
          indexedCount += formulas.length;
        }
      }
    }

    // Get final index stats
    const finalStats = await embeddingService.getIndexStats();

    const message = needsIndexing
      ? `Successfully indexed ${indexedCount} items`
      : `Data already indexed (${indexedCount} items found)`;

    return NextResponse.json({
      success: true,
      message,
      indexedCount,
      indexStats: finalStats,
      indexType,
      alreadyIndexed: !needsIndexing
    });

  } catch (error) {
    console.error('Indexing error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const embeddingService = getEmbeddingService();
    const stats = await embeddingService.getIndexStats();

    return NextResponse.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Stats error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}