/**
 * Admin-only Qdrant indexing operations for the unified R&D agent.
 *
 * This is intentionally separate from the chat agent: it manages the
 * canonical `raw_materials_console` collection but never serves user search.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import {
  QdrantRAGService,
  type RawMaterialDocument,
} from "../../services/rag/qdrant-rag-service";

const INDEX_COLLECTION = "raw_materials_console";

function assert_admin(role: string | undefined): void {
  if (role !== "admin") {
    throw new Error("Administrator access is required for vector indexing.");
  }
}

export const vectorIndexRouter = router({
  /** Index one bounded page of the canonical material catalog. */
  indexRawMaterials: protectedProcedure
    .input(z.object({
      batchSize: z.number().min(1).max(100).default(50),
      startIndex: z.number().min(0).default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      assert_admin(ctx.user.role);

      const client = await client_promise;
      const db = client.db();
      const materials = await db.collection("raw_materials_console")
        .find({})
        .skip(input.startIndex)
        .limit(input.batchSize)
        .toArray();

      if (materials.length === 0) {
        return {
          success: true,
          indexed: 0,
          message: "No more materials to index",
          startIndex: input.startIndex,
          documentsIndexed: [],
        };
      }

      const indexing_service = new QdrantRAGService(INDEX_COLLECTION);
      const documents: RawMaterialDocument[] = materials.map((material) => (
        QdrantRAGService.prepare_raw_material_document(material as Record<string, unknown>)
      ));
      await indexing_service.upsert_documents(documents);

      return {
        success: true,
        indexed: documents.length,
        message: `Indexed ${documents.length} materials in ${INDEX_COLLECTION}`,
        startIndex: input.startIndex + documents.length,
        documentsIndexed: documents.map((document) => ({
          id: document.id,
          name: document.metadata.trade_name || document.metadata.rm_code || document.id,
        })),
      };
    }),

  /** Compare the canonical catalog count with its Qdrant vector count. */
  getIndexStats: protectedProcedure
    .query(async ({ ctx }) => {
      assert_admin(ctx.user.role);

      const client = await client_promise;
      const db = client.db();
      const [mongoDBCount, qdrantStats] = await Promise.all([
        db.collection("raw_materials_console").countDocuments(),
        new QdrantRAGService(INDEX_COLLECTION).get_index_stats(),
      ]);

      return {
        success: true,
        mongoDBCount,
        indexedCount: qdrantStats.pointsCount || 0,
        qdrantStats,
      };
    }),
});
