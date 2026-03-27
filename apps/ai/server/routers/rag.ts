/**
 * RAG tRPC Router
 *
 * Exposes vector search, indexing, and statistics procedures backed by
 * QdrantRAGService.  All service instantiation and method calls use the
 * snake_case API defined in qdrant-rag-service.ts.
 *
 * @author AI Management System
 * @date 2026-03-27
 */

import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { raw_materials_client_promise } from "@rnd-ai/shared-database";
import { QdrantRAGService, RawMaterialDocument } from "../../services/rag/qdrant-rag-service";
import { ObjectId } from "mongodb";
import { getRAGConfig, RAGServicesConfig } from "@/ai/config/rag-config";

export const ragRouter = router({
  // Search raw materials using vector similarity
  searchRawMaterials: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1),
        topK: z.number().min(1).max(20).default(5),
        serviceName: z.enum(['rawMaterialsAllAI', 'rawMaterialsAI']).default('rawMaterialsAllAI')
      })
    )
    .query(async ({ ctx, input }) => {
      console.log('[ragRouter] searchRawMaterials — start', { query: input.query, topK: input.topK, serviceName: input.serviceName });

      try {
        const qdrantService = new QdrantRAGService(input.serviceName, {
          topK: input.topK
        });

        // Search using vector similarity
        const matches = await qdrantService.search_similar(
          input.query,
          { topK: input.topK }
        );

        console.log('[ragRouter] searchRawMaterials — done', { resultCount: matches.length });
        return {
          success: true,
          matches,
          query: input.query,
          totalResults: matches.length
        };
      } catch (error) {
        console.error('[ragRouter] searchRawMaterials — error', error);
        return {
          success: false,
          error: 'Failed to search raw materials',
          matches: [],
          query: input.query,
          totalResults: 0
        };
      }
    }),

  // Index raw materials data into Qdrant
  indexRawMaterials: protectedProcedure
    .input(
      z.object({
        batchSize: z.number().min(1).max(100).default(50),
        startIndex: z.number().min(0).default(0)
      })
    )
    .mutation(async ({ ctx, input }) => {
      console.log('[ragRouter] indexRawMaterials — start', { batchSize: input.batchSize, startIndex: input.startIndex });

      try {
        const client = await raw_materials_client_promise;
        const db = client.db();
        const qdrantService = new QdrantRAGService();

        // Get raw materials from MongoDB
        const materials = await db.collection("raw_materials_real_stock")
          .find({})
          .skip(input.startIndex)
          .limit(input.batchSize)
          .toArray();

        if (materials.length === 0) {
          console.log('[ragRouter] indexRawMaterials — no more materials');
          return {
            success: true,
            indexed: 0,
            message: 'No more materials to index',
            startIndex: input.startIndex
          };
        }

        // Prepare documents for Qdrant
        const documents: RawMaterialDocument[] = materials.map(material =>
          QdrantRAGService.prepare_raw_material_document(material as Record<string, unknown>)
        );

        // Index documents in Qdrant
        await qdrantService.upsert_documents(documents);

        console.log('[ragRouter] indexRawMaterials — done', { indexed: documents.length });
        return {
          success: true,
          indexed: documents.length,
          message: `Successfully indexed ${documents.length} raw materials`,
          startIndex: input.startIndex + input.batchSize,
          documentsIndexed: documents.map(doc => ({ id: doc.id, name: doc.metadata.trade_name }))
        };
      } catch (error) {
        console.error('[ragRouter] indexRawMaterials — error', error);
        return {
          success: false,
          indexed: 0,
          error: 'Failed to index raw materials',
          startIndex: input.startIndex
        };
      }
    }),

  // Get indexing statistics
  getIndexStats: protectedProcedure
    .query(async ({ ctx }) => {
      console.log('[ragRouter] getIndexStats — start');

      try {
        const client = await raw_materials_client_promise;
        const db = client.db();
        const qdrantService = new QdrantRAGService();

        // Get MongoDB count
        const mongoCount = await db.collection("raw_materials_real_stock").countDocuments();

        // Get Qdrant stats — returns { pointsCount, status, config }
        const qdrantStats = await qdrantService.get_index_stats();

        console.log('[ragRouter] getIndexStats — done', { mongoCount, qdrantPointsCount: qdrantStats.pointsCount });
        return {
          success: true,
          mongoDBCount: mongoCount,
          qdrantStats,
          indexedCount: qdrantStats.pointsCount || 0
        };
      } catch (error) {
        console.error('[ragRouter] getIndexStats — error', error);
        return {
          success: false,
          error: 'Failed to get index statistics'
        };
      }
    }),

  // Get indexed documents count
  getIndexedCount: protectedProcedure
    .query(async ({ ctx }) => {
      console.log('[ragRouter] getIndexedCount — start');

      try {
        const qdrantService = new QdrantRAGService();
        const stats = await qdrantService.get_index_stats();

        console.log('[ragRouter] getIndexedCount — done', { count: stats.pointsCount });
        return {
          success: true,
          count: stats.pointsCount || 0
        };
      } catch (error) {
        console.error('[ragRouter] getIndexedCount — error', error);
        return {
          success: false,
          count: 0,
          error: 'Failed to get indexed count'
        };
      }
    }),

  // Search with both vector and keyword fallback
  hybridSearch: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1),
        topK: z.number().min(1).max(20).default(5),
        includeKeywordSearch: z.boolean().default(true)
      })
    )
    .query(async ({ ctx, input }) => {
      console.log('[ragRouter] hybridSearch — start', { query: input.query, topK: input.topK });

      try {
        const client = await raw_materials_client_promise;
        const db = client.db();
        const qdrantService = new QdrantRAGService();

        // Vector search
        const vectorMatches = await qdrantService.search_similar(
          input.query,
          { topK: input.topK }
        );

        let keywordMatches: typeof vectorMatches = [];

        // Fallback keyword search if vector search returns no results
        if (input.includeKeywordSearch && (!vectorMatches || vectorMatches.length === 0)) {
          const rawKeywordMatches = await db.collection("raw_materials_real_stock")
            .find({
              $or: [
                { rm_code: { $regex: input.query, $options: 'i' } },
                { trade_name: { $regex: input.query, $options: 'i' } },
                { inci_name: { $regex: input.query, $options: 'i' } }
              ]
            })
            .limit(input.topK)
            .toArray();

          // Convert keyword matches to vector-like format
          keywordMatches = rawKeywordMatches.map(material => ({
            id: material._id?.toString() || '',
            score: 0.5, // Lower score for keyword matches
            metadata: {
              rm_code: material.rm_code,
              trade_name: material.trade_name,
              inci_name: material.inci_name,
              supplier: material.supplier,
              company_name: material.company_name,
              rm_cost: material.rm_cost,
              benefits: material.benefits,
              details: material.details,
              source: 'raw_materials_real_stock',
              searchType: 'keyword'
            }
          }));
        }

        const allMatches = [...vectorMatches, ...keywordMatches].slice(0, input.topK);

        console.log('[ragRouter] hybridSearch — done', {
          vectorResults: vectorMatches.length,
          keywordResults: keywordMatches.length,
          totalResults: allMatches.length
        });
        return {
          success: true,
          matches: allMatches,
          query: input.query,
          vectorResults: vectorMatches.length,
          keywordResults: keywordMatches.length,
          totalResults: allMatches.length
        };
      } catch (error) {
        console.error('[ragRouter] hybridSearch — error', error);
        return {
          success: false,
          error: 'Failed to search raw materials',
          matches: [],
          query: input.query,
          vectorResults: 0,
          keywordResults: 0,
          totalResults: 0
        };
      }
    })
});
