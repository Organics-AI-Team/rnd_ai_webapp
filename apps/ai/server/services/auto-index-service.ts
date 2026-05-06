/**
 * Auto-Index Service
 * Automatically indexes new MongoDB documents to Qdrant
 *
 * Called whenever:
 * - New material is added via products.create
 * - Material is updated via products.update
 *
 * Ensures AI search always has latest data
 */

import { get_qdrant_service } from '../../services/vector/qdrant-service';
import { QdrantRAGService } from '../../services/rag/qdrant-rag-service';

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
 * Auto-index a single material to Qdrant via QdrantRAGService.
 *
 * @param material - Material document from MongoDB
 * @returns Promise<boolean> - Success status
 */
export async function auto_index_material(material: MaterialDocument): Promise<boolean> {
  console.log(`[auto-index] auto_index_material: rm_code=${material.rm_code}, start`);
  try {
    const ragService = new QdrantRAGService('rawMaterialsAI');
    const doc = QdrantRAGService.prepare_raw_material_document(material as any);
    await ragService.upsert_documents([doc]);
    console.log(`[auto-index] auto_index_material: rm_code=${material.rm_code}, success`);
    return true;
  } catch (err) {
    console.error(`[auto-index] auto_index_material: rm_code=${material.rm_code}, error`, err);
    return false;
  }
}

/**
 * Auto-delete a material from Qdrant.
 *
 * @param rm_code - Material code to delete
 * @returns Promise<boolean> - Success status
 */
export async function auto_delete_material(rm_code: string): Promise<boolean> {
  console.log(`[auto-index] auto_delete_material: rm_code=${rm_code}, start`);
  try {
    const qdrant = get_qdrant_service();
    await qdrant.ensure_initialised();
    await qdrant.delete('raw_materials_console', [rm_code]);
    console.log(`[auto-index] auto_delete_material: rm_code=${rm_code}, success`);
    return true;
  } catch (err) {
    console.error(`[auto-index] auto_delete_material: rm_code=${rm_code}, error`, err);
    return false;
  }
}
