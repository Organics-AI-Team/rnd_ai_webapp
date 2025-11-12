/**
 * Auto-Index Service
 * Automatically indexes new MongoDB documents to ChromaDB
 *
 * Called whenever:
 * - New material is added via products.create
 * - Material is updated via products.update
 *
 * Ensures AI search always has latest data
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getChromaService } from '@/ai/services/vector/chroma-service';

const CHROMA_COLLECTION = 'raw_materials_fda';
const EMBEDDING_MODEL = 'text-embedding-004';

interface MaterialDocument {
  _id?: any;
  rm_code: string;
  trade_name?: string;
  inci_name?: string;
  INCI_name?: string;
  supplier?: string;
  rm_cost?: number;
  Function?: string;
  Chem_IUPAC_Name_Description?: string;
  benefits?: string[] | string;
  usecase?: string[] | string;
  benefits_cached?: string;
  usecase_cached?: string;
}

/**
 * Format material document for embedding
 */
function format_document(doc: MaterialDocument): string {
  const parts = [
    `Code: ${doc.rm_code}`,
    doc.trade_name ? `Trade Name: ${doc.trade_name}` : '',
    doc.INCI_name || doc.inci_name ? `INCI: ${doc.INCI_name || doc.inci_name}` : '',
    doc.Function ? `Function: ${doc.Function}` : '',
    doc.benefits || doc.benefits_cached ? `Benefits: ${Array.isArray(doc.benefits) ? doc.benefits.join(', ') : (doc.benefits || doc.benefits_cached)}` : '',
    doc.usecase || doc.usecase_cached ? `Use Cases: ${Array.isArray(doc.usecase) ? doc.usecase.join(', ') : (doc.usecase || doc.usecase_cached)}` : '',
    doc.Chem_IUPAC_Name_Description ? `Description: ${doc.Chem_IUPAC_Name_Description}` : '',
    doc.supplier ? `Supplier: ${doc.supplier}` : ''
  ].filter(Boolean);

  return parts.join('\n');
}

/**
 * Generate embedding using Gemini
 */
async function generate_embedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not found in environment');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  const result = await model.embedContent(text);
  return result.embedding.values;
}

/**
 * Auto-index a single material to ChromaDB
 *
 * @param material - Material document from MongoDB
 * @returns Promise<boolean> - Success status
 */
export async function auto_index_material(material: MaterialDocument): Promise<boolean> {
  try {
    console.log(`🔄 [AutoIndex] Starting auto-index for material: ${material.rm_code}`);

    // Step 1: Format document text
    const documentText = format_document(material);

    // Step 2: Generate embedding
    console.log(`🧠 [AutoIndex] Generating embedding for: ${material.rm_code}`);
    const embedding = await generate_embedding(documentText);

    // Step 3: Upsert to ChromaDB
    console.log(`💾 [AutoIndex] Upserting to ChromaDB collection: ${CHROMA_COLLECTION}`);
    const chromaService = getChromaService();
    await chromaService.initialize();

    await chromaService.upsert(CHROMA_COLLECTION, [{
      id: material.rm_code,
      text: documentText,
      values: embedding,
      metadata: {
        rm_code: material.rm_code,
        trade_name: material.trade_name || '',
        inci_name: material.inci_name || material.INCI_name || '',
        supplier: material.supplier || '',
        rm_cost: material.rm_cost || 0,
        Function: material.Function || '',
        benefits: typeof material.benefits === 'string' ? material.benefits : (material.benefits_cached || ''),
        usecase: typeof material.usecase === 'string' ? material.usecase : (material.usecase_cached || '')
      }
    }]);

    console.log(`✅ [AutoIndex] Successfully indexed material: ${material.rm_code}`);
    return true;

  } catch (error) {
    console.error(`❌ [AutoIndex] Failed to index material: ${material.rm_code}`, error);
    // Don't throw - we don't want to break the main flow if indexing fails
    return false;
  }
}

/**
 * Auto-delete a material from ChromaDB
 *
 * @param rm_code - Material code to delete
 * @returns Promise<boolean> - Success status
 */
export async function auto_delete_material(rm_code: string): Promise<boolean> {
  try {
    console.log(`🗑️  [AutoIndex] Deleting from ChromaDB: ${rm_code}`);

    const chromaService = getChromaService();
    await chromaService.initialize();

    await chromaService.deleteDocuments(CHROMA_COLLECTION, [rm_code]);

    console.log(`✅ [AutoIndex] Successfully deleted from ChromaDB: ${rm_code}`);
    return true;

  } catch (error) {
    console.error(`❌ [AutoIndex] Failed to delete from ChromaDB: ${rm_code}`, error);
    return false;
  }
}
