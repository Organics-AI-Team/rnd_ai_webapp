import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import rawMaterialsClientPromise from "@/lib/raw-materials-mongodb";
import { PineconeRAGService, RawMaterialDocument } from "@/ai/services/rag/pinecone-service-stub";
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
      try {
        const pineconeService = new PineconeRAGService(input.serviceName, {
          topK: input.topK
        });

        // Search using vector similarity
        const matches = await pineconeService.searchSimilar(
          input.query,
          { topK: input.topK }
        );

        return {
          success: true,
          matches,
          query: input.query,
          totalResults: matches.length
        };
      } catch (error) {
        console.error('Error in vector search:', error);
        return {
          success: false,
          error: 'Failed to search raw materials',
          matches: [],
          query: input.query,
          totalResults: 0
        };
      }
    }),

  // Index raw materials data into Pinecone
  indexRawMaterials: protectedProcedure
    .input(
      z.object({
        batchSize: z.number().min(1).max(100).default(50),
        startIndex: z.number().min(0).default(0)
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const client = await rawMaterialsClientPromise;
        const db = client.db();
        const pineconeService = new PineconeRAGService();

        // Get raw materials from MongoDB
        const materials = await db.collection("raw_materials_real_stock")
          .find({})
          .skip(input.startIndex)
          .limit(input.batchSize)
          .toArray();

        if (materials.length === 0) {
          return {
            success: true,
            indexed: 0,
            message: 'No more materials to index',
            startIndex: input.startIndex
          };
        }

        // Prepare documents for Pinecone
        const documents: RawMaterialDocument[] = materials.map(material =>
          PineconeRAGService.prepareRawMaterialDocument(material)
        );

        // Index documents in Pinecone
        await pineconeService.upsertDocuments(documents);

        return {
          success: true,
          indexed: documents.length,
          message: `Successfully indexed ${documents.length} raw materials`,
          startIndex: input.startIndex + input.batchSize,
          documentsIndexed: documents.map(doc => ({ id: doc.id, name: doc.metadata.trade_name }))
        };
      } catch (error) {
        console.error('Error indexing raw materials:', error);
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
      try {
        const client = await rawMaterialsClientPromise;
        const db = client.db();
        const pineconeService = new PineconeRAGService();

        // Get MongoDB count
        const mongoCount = await db.collection("raw_materials_real_stock").countDocuments();

        // Get Pinecone stats
        const pineconeStats = await pineconeService.getIndexStats();

        return {
          success: true,
          mongoDBCount: mongoCount,
          pineconeStats,
          indexedCount: pineconeStats.totalVectorCount || 0
        };
      } catch (error) {
        console.error('Error getting index stats:', error);
        return {
          success: false,
          error: 'Failed to get index statistics'
        };
      }
    }),

  // Get indexed documents count
  getIndexedCount: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const pineconeService = new PineconeRAGService();
        const stats = await pineconeService.getIndexStats();

        return {
          success: true,
          count: stats.totalVectorCount || 0
        };
      } catch (error) {
        console.error('Error getting indexed count:', error);
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
      try {
        const client = await rawMaterialsClientPromise;
        const db = client.db();
        const pineconeService = new PineconeRAGService();

        // Vector search
        const vectorMatches = await pineconeService.searchSimilar(
          input.query,
          { topK: input.topK }
        );

        let keywordMatches = [];

        // Fallback keyword search if vector search returns no results
        if (input.includeKeywordSearch && (!vectorMatches || vectorMatches.length === 0)) {
          keywordMatches = await db.collection("raw_materials_real_stock")
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
          keywordMatches = keywordMatches.map(material => ({
            id: material._id?.toString(),
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

        return {
          success: true,
          matches: allMatches,
          query: input.query,
          vectorResults: vectorMatches.length,
          keywordResults: keywordMatches.length,
          totalResults: allMatches.length
        };
      } catch (error) {
        console.error('Error in hybrid search:', error);
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