#!/usr/bin/env tsx

/**
 * Report the health and registered collection statistics for Qdrant.
 *
 * Usage: npm run check:qdrant --workspace=apps/ai
 */

import { QDRANT_COLLECTIONS } from '../config/qdrant-config';
import { get_qdrant_service } from '../services/vector/qdrant-service';

async function check_qdrant(): Promise<void> {
  console.log('[check-qdrant] Starting Qdrant health check');

  const qdrant_service = get_qdrant_service();
  if (!(await qdrant_service.health_check())) {
    console.error('[check-qdrant] Qdrant is unavailable. Check QDRANT_URL and QDRANT_API_KEY.');
    process.exitCode = 1;
    return;
  }

  let unavailable_collections = 0;
  for (const collection of Object.values(QDRANT_COLLECTIONS)) {
    try {
      const info = await qdrant_service.get_collection_info(collection.name);
      console.log(
        `[check-qdrant] ${collection.name}: ${info.pointsCount} points, ${info.status}, ${collection.vector_size} dimensions`,
      );
    } catch (error) {
      unavailable_collections++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[check-qdrant] ${collection.name}: unavailable (${message})`);
    }
  }

  if (unavailable_collections > 0) {
    console.error(`[check-qdrant] ${unavailable_collections} configured collection(s) are unavailable.`);
    process.exitCode = 1;
    return;
  }

  console.log('[check-qdrant] Qdrant and all configured collections are available.');
}

check_qdrant().catch((error) => {
  console.error('[check-qdrant] Unexpected error:', error);
  process.exitCode = 1;
});
