/**
 * Simple ChromaDB Indexing Script using ChromaService
 *
 * Uses the existing ChromaService to index materials to ChromaDB
 *
 * Environment Variables:
 *   - MONGODB_URI
 *   - GEMINI_API_KEY
 *   - CHROMA_URL
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getChromaService } from '../ai/services/vector/chroma-service';

const BATCH_SIZE = 50;
const COLLECTION_NAME = 'raw_materials_console';
const CHROMA_COLLECTION = 'raw_materials_fda';
const EMBEDDING_MODEL = 'text-embedding-004';

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
    await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
  }

  return embeddings;
}

async function main() {
  console.log('🚀 ChromaDB Indexing Started\n');

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
  console.log(`  Batch: ${BATCH_SIZE}\n`);

  const mongoClient = new MongoClient(mongoUri);
  const genAI = new GoogleGenerativeAI(geminiKey);
  const chromaService = getChromaService();

  try {
    await mongoClient.connect();
    console.log('✅ MongoDB connected\n');

    const db = mongoClient.db('rnd_ai');
    const collection = db.collection(COLLECTION_NAME);
    const total = await collection.countDocuments();

    console.log(`📊 Total: ${total.toLocaleString()}\n`);

    await chromaService.initialize();
    console.log('✅ ChromaDB connected\n');

    await chromaService.getOrCreateCollection(CHROMA_COLLECTION);
    console.log(`✅ Collection ready: ${CHROMA_COLLECTION}\n`);

    console.log('📦 Processing batches...\n');

    let processed = 0;
    const startTime = Date.now();
    const cursor = collection.find({}).batchSize(BATCH_SIZE);
    let batch: MaterialDocument[] = [];

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) continue;

      batch.push(doc as MaterialDocument);

      if (batch.length >= BATCH_SIZE) {
        try {
          const texts = batch.map(formatDocument);
          const embeddings = await generateEmbeddings(texts, genAI);

          const documents = batch.map((doc, i) => ({
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

          processed += batch.length;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = processed / elapsed;
          const eta = (total - processed) / speed / 60;
          const progress = (processed / total * 100).toFixed(1);

          console.log(
            `✅ ${processed.toLocaleString()}/${total.toLocaleString()} ` +
            `(${progress}%) | ` +
            `${speed.toFixed(1)} docs/sec | ` +
            `ETA: ${eta.toFixed(1)} min`
          );

          batch = [];
        } catch (error) {
          console.error(`❌ Batch error:`, error);
          batch = [];
        }
      }
    }

    // Process remaining
    if (batch.length > 0) {
      const texts = batch.map(formatDocument);
      const embeddings = await generateEmbeddings(texts, genAI);

      const documents = batch.map((doc, i) => ({
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
      processed += batch.length;
    }

    const totalTime = (Date.now() - startTime) / 1000 / 60;
    const stats = await chromaService.getCollectionStats(CHROMA_COLLECTION);

    console.log('\n' + '='.repeat(60));
    console.log('🎉 COMPLETED!');
    console.log('='.repeat(60));
    console.log(`📊 Processed: ${processed.toLocaleString()}`);
    console.log(`⏱️  Time: ${totalTime.toFixed(1)} min`);
    console.log(`📈 ChromaDB count: ${stats.count.toLocaleString()}`);
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
