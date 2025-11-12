/**
 * Check ChromaDB collection count
 */

import { getChromaService } from '../ai/services/vector/chroma-service';

async function checkCount() {
  const chromaService = getChromaService();

  await chromaService.initialize();
  console.log('✅ ChromaDB connected\n');

  const stats = await chromaService.getCollectionStats('raw_materials_fda');

  console.log('📊 ChromaDB Statistics:');
  console.log(`   Collection: raw_materials_fda`);
  console.log(`   Document count: ${stats.count.toLocaleString()}`);
  console.log(`   Total documents needed: 31,179`);
  console.log(`   Remaining: ${(31179 - stats.count).toLocaleString()}`);
  console.log(`   Progress: ${(stats.count / 31179 * 100).toFixed(1)}%`);
}

checkCount()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
