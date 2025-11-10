/**
 * Resume ChromaDB Indexing from a specific offset
 *
 * This script continues indexing from where it left off
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getChromaService } from '../ai/services/vector/chroma-service';

const BATCH_SIZE = 50;
const COLLECTION_NAME = 'raw_materials_console';
const CHROMA_COLLECTION = 'raw_materials_fda';
const EMBEDDING_MODEL = 'text-embedding-004';
const SKIP_FIRST = 6700; // Documents already indexed

interface MaterialDocument {
  _id: any;
  rm_code: string;
  INCI_name?: string;
  trade_name?: string;
  supplier?: string;
  rm_cost?: number;
  Function?: string;
  Chem_IUPAC_Name_Description?: string;
  benefits?: string[] | string;
  usecase?: string[] | string;
}

function formatDocument(doc: MaterialDocument): string {
  const parts = [
    `Code: ${doc.rm_code}`,
    doc.INCI_name ? `INCI: ${doc.INCI_name}` : '',
    doc.trade_name ? `Trade Name: ${doc.trade_name}` : '',
    doc.Function ? `Function: ${doc.Function}` : '',
    doc.benefits ? `Benefits: ${Array.isArray(doc.benefits) ? doc.benefits.join(', ') : doc.benefits}` : '',
    doc.usecase ? `Use Cases: ${Array.isArray(doc.usecase) ? doc.usecase.join(', ') : doc.usecase}` : '',
    doc.Chem_IUPAC_Name_Description ? `Description: ${doc.Chem_IUPAC_Name_Description}` : '',
    doc.supplier ? `Supplier: ${doc.supplier}` : ''
  ].filter(Boolean);
  return parts.join('\n');
}

async function generateEmbeddings(texts: string[], genAI: GoogleGenerativeAI): Promise<number[][]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const embeddings: number[][] = [];

  for (const text of texts) {
    const result = await model.embedContent(text);
    embeddings.push(result.embedding.values);
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return embeddings;
}

async function main() {
  console.log('🚀 ChromaDB Indexing (Resume Mode)\n');

  const mongoUri = process.env.MONGODB_URI;
  const geminiKey = process.env.GEMINI_API_KEY;
  const chromaUrl = process.env.CHROMA_URL;

  if (!mongoUri || !geminiKey || !chromaUrl) {
    console.error('❌ Missing environment variables');
    process.exit(1);
  }

  console.log('📋 Config:');
  console.log(`  MongoDB: ${mongoUri.split('@')[1]?.split('/')[0]}`);
  console.log(`  ChromaDB: ${chromaUrl}`);
  console.log(`  Batch: ${BATCH_SIZE}`);
  console.log(`  ⏭️  Skipping first: ${SKIP_FIRST.toLocaleString()} documents\n`);

  const mongoClient = new MongoClient(mongoUri);
  const genAI = new GoogleGenerativeAI(geminiKey);
  const chromaService = getChromaService();

  try {
    await mongoClient.connect();
    console.log('✅ MongoDB connected\n');

    const db = mongoClient.db('rnd_ai');
    const collection = db.collection(COLLECTION_NAME);
    const total = await collection.countDocuments();
    const remaining = total - SKIP_FIRST;

    console.log(`📊 Total in MongoDB: ${total.toLocaleString()}`);
    console.log(`   Already indexed: ${SKIP_FIRST.toLocaleString()}`);
    console.log(`   Remaining: ${remaining.toLocaleString()}\n`);

    await chromaService.initialize();
    console.log('✅ ChromaDB connected\n');

    await chromaService.getOrCreateCollection(CHROMA_COLLECTION);
    console.log(`✅ Collection ready: ${CHROMA_COLLECTION}\n`);

    console.log('📦 Processing batches...\n');

    let processed = 0;
    const startTime = Date.now();

    // Use skip() and limit() to get batches without keeping cursor open
    for (let offset = SKIP_FIRST; offset < total; offset += BATCH_SIZE) {
      try {
        // Fetch batch with fresh query each time (no long-lived cursor)
        const docs = await collection
          .find({})
          .skip(offset)
          .limit(BATCH_SIZE)
          .toArray();

        if (docs.length === 0) break;

        const texts = docs.map(doc => formatDocument(doc as MaterialDocument));
        const embeddings = await generateEmbeddings(texts, genAI);

        const documents = docs.map((doc: any, i: number) => ({
          id: doc.rm_code,
          text: texts[i],
          values: embeddings[i],
          metadata: {
            rm_code: doc.rm_code,
            INCI_name: doc.INCI_name || '',
            trade_name: doc.trade_name || '',
            Function: doc.Function || '',
            supplier: doc.supplier || '',
            rm_cost: doc.rm_cost || 0,
            benefits: Array.isArray(doc.benefits) ? doc.benefits.join(', ') : (doc.benefits || ''),
            usecase: Array.isArray(doc.usecase) ? doc.usecase.join(', ') : (doc.usecase || ''),
            source: 'raw_materials_console'
          }
        }));

        await chromaService.upsert(CHROMA_COLLECTION, documents);

        processed += docs.length;
        const totalProcessed = SKIP_FIRST + processed;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = processed / elapsed;
        const eta = (remaining - processed) / speed / 60;
        const progress = (totalProcessed / total * 100).toFixed(1);

        console.log(
          `✅ ${totalProcessed.toLocaleString()}/${total.toLocaleString()} ` +
          `(${progress}%) | ` +
          `${speed.toFixed(1)} docs/sec | ` +
          `ETA: ${eta.toFixed(1)} min`
        );

      } catch (error) {
        console.error(`❌ Batch error at offset ${offset}:`, error);
        console.log('⚠️  Continuing with next batch...\n');
        continue;
      }
    }

    const totalTime = (Date.now() - startTime) / 1000 / 60;
    const stats = await chromaService.getCollectionStats(CHROMA_COLLECTION);

    console.log('\n' + '='.repeat(60));
    console.log('🎉 COMPLETED!');
    console.log('='.repeat(60));
    console.log(`📊 Newly processed: ${processed.toLocaleString()}`);
    console.log(`⏱️  Time: ${totalTime.toFixed(1)} min`);
    console.log(`📈 ChromaDB total: ${stats.count.toLocaleString()}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Failed:', error);
    throw error;
  } finally {
    await mongoClient.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
