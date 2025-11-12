/**
 * Stock Management Router
 * Handles CRUD operations for stock entries and inventory tracking
 */

import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { StockEntrySchema } from "@/lib/types";
import { ObjectId } from "mongodb";
import { logActivity } from "@/lib/userLog";

export const stockRouter = router({
  /**
   * List all stock entries with filtering and pagination
   */
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(1000).default(50),
        offset: z.number().min(0).default(0),
        materialId: z.string().optional(), // Filter by specific material
        status: z.enum(["active", "expired", "depleted", "all"]).default("all"),
        sortField: z.string().optional().default("createdAt"),
        sortDirection: z.enum(["asc", "desc"]).default("desc"),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      console.log('🔍 [stock.list] Starting stock list query', { input });

      const client = await client_promise;
      const db = client.db();

      const limit = input?.limit || 50;
      const offset = input?.offset || 0;
      const sortField = input?.sortField || "createdAt";
      const sortDirection = input?.sortDirection || "desc";
      const status = input?.status || "all";

      // Build filter
      const filter: any = {
        organizationId: ctx.user.organizationId,
      };

      if (input?.materialId) {
        filter.materialId = input.materialId;
      }

      if (status !== "all") {
        filter.status = status;
      }

      // Get total count
      const totalCount = await db.collection("stock_entries").countDocuments(filter);

      // Build sort
      const sortObj: any = {};
      sortObj[sortField] = sortDirection === "asc" ? 1 : -1;

      // Get stock entries
      const entries = await db
        .collection("stock_entries")
        .find(filter)
        .sort(sortObj)
        .skip(offset)
        .limit(limit)
        .toArray();

      const totalPages = Math.ceil(totalCount / limit);
      const hasMore = offset + limit < totalCount;

      console.log(`✅ [stock.list] Found ${entries.length} entries (total: ${totalCount})`);

      return {
        entries: entries.map((entry: any) => ({
          ...entry,
          _id: entry._id.toString(),
          expirationDate: entry.expirationDate,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })),
        totalCount,
        totalPages,
        hasMore,
      };
    }),

  /**
   * Get stock summary for all materials or specific material
   */
  summary: protectedProcedure
    .input(
      z.object({
        materialId: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      console.log('📊 [stock.summary] Calculating stock summary', { input });

      const client = await client_promise;
      const db = client.db();

      const matchStage: any = {
        organizationId: ctx.user.organizationId,
        status: "active", // Only count active stock
      };

      if (input?.materialId) {
        matchStage.materialId = input.materialId;
      }

      // Aggregate stock data grouped by material
      const summary = await db
        .collection("stock_entries")
        .aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: "$materialId",
              materialCode: { $first: "$materialCode" },
              materialName: { $first: "$materialName" },
              totalQuantityKg: { $sum: "$quantityKg" },
              totalValue: { $sum: "$totalCost" },
              batchCount: { $sum: 1 },
              nearestExpiration: { $min: "$expirationDate" },
              oldestBatch: { $min: "$createdAt" },
              avgPrice: { $avg: "$unitPrice" },
            },
          },
          { $sort: { materialName: 1 } },
        ])
        .toArray();

      console.log(`✅ [stock.summary] Calculated summary for ${summary.length} materials`);

      return summary.map((item: any) => ({
        materialId: item._id,
        materialCode: item.materialCode,
        materialName: item.materialName,
        totalQuantityKg: item.totalQuantityKg || 0,
        totalValue: item.totalValue || 0,
        averagePrice: item.avgPrice || 0,
        batchCount: item.batchCount || 0,
        nearestExpiration: item.nearestExpiration,
        oldestBatch: item.oldestBatch,
      }));
    }),

  /**
   * Create new stock entry
   */
  create: protectedProcedure
    .input(
      z.object({
        materialId: z.string(),
        materialCode: z.string(),
        materialName: z.string(),
        quantityKg: z.number().positive(),
        unitPrice: z.number().positive(),
        expirationDate: z.string(), // ISO date string
        batchNumber: z.string().optional(),
        supplier: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      console.log('➕ [stock.create] Creating new stock entry', { input });

      const client = await client_promise;
      const db = client.db();

      const totalCost = input.quantityKg * input.unitPrice;
      const now = new Date();

      const stockEntry = {
        organizationId: ctx.user.organizationId,
        materialId: input.materialId,
        materialCode: input.materialCode,
        materialName: input.materialName,
        quantityKg: input.quantityKg,
        unitPrice: input.unitPrice,
        totalCost: totalCost,
        expirationDate: new Date(input.expirationDate),
        batchNumber: input.batchNumber || "",
        supplier: input.supplier || "",
        notes: input.notes || "",
        status: "active" as const,
        createdBy: ctx.userId,
        createdAt: now,
        updatedAt: now,
      };

      const result = await db.collection("stock_entries").insertOne(stockEntry);

      // Log activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: `เพิ่มสต็อก: ${input.materialName} (${input.quantityKg} kg)`,
        refId: result.insertedId.toString(),
        organizationId: ctx.user.organizationId,
      });

      console.log(`✅ [stock.create] Stock entry created: ${result.insertedId}`);

      return {
        _id: result.insertedId.toString(),
        success: true,
      };
    }),

  /**
   * Update stock entry
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        quantityKg: z.number().positive().optional(),
        unitPrice: z.number().positive().optional(),
        expirationDate: z.string().optional(),
        batchNumber: z.string().optional(),
        supplier: z.string().optional(),
        notes: z.string().optional(),
        status: z.enum(["active", "expired", "depleted"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      console.log('✏️ [stock.update] Updating stock entry', { input });

      const client = await client_promise;
      const db = client.db();

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (input.quantityKg !== undefined) updateData.quantityKg = input.quantityKg;
      if (input.unitPrice !== undefined) updateData.unitPrice = input.unitPrice;
      if (input.expirationDate) updateData.expirationDate = new Date(input.expirationDate);
      if (input.batchNumber !== undefined) updateData.batchNumber = input.batchNumber;
      if (input.supplier !== undefined) updateData.supplier = input.supplier;
      if (input.notes !== undefined) updateData.notes = input.notes;
      if (input.status) updateData.status = input.status;

      // Recalculate totalCost if quantity or price changed
      if (input.quantityKg !== undefined || input.unitPrice !== undefined) {
        const currentEntry = await db
          .collection("stock_entries")
          .findOne({ _id: new ObjectId(input.id) });

        if (currentEntry) {
          const qty = input.quantityKg !== undefined ? input.quantityKg : currentEntry.quantityKg;
          const price = input.unitPrice !== undefined ? input.unitPrice : currentEntry.unitPrice;
          updateData.totalCost = qty * price;
        }
      }

      const result = await db
        .collection("stock_entries")
        .updateOne(
          {
            _id: new ObjectId(input.id),
            organizationId: ctx.user.organizationId,
          },
          { $set: updateData }
        );

      if (result.matchedCount === 0) {
        throw new Error("Stock entry not found or access denied");
      }

      // Log activity
      const entry = await db
        .collection("stock_entries")
        .findOne({ _id: new ObjectId(input.id) });

      if (entry) {
        await logActivity({
          db,
          userId: ctx.userId,
          userName: ctx.user.name,
          activity: `แก้ไขสต็อก: ${entry.materialName}`,
          refId: input.id,
          organizationId: ctx.user.organizationId,
        });
      }

      console.log(`✅ [stock.update] Stock entry updated: ${input.id}`);

      return { success: true };
    }),

  /**
   * Delete stock entry
   */
  delete: protectedProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      console.log('🗑️ [stock.delete] Deleting stock entry', { input });

      const client = await client_promise;
      const db = client.db();

      // Get entry details before deleting
      const entry = await db
        .collection("stock_entries")
        .findOne({ _id: new ObjectId(input.id) });

      if (!entry) {
        throw new Error("Stock entry not found");
      }

      const result = await db
        .collection("stock_entries")
        .deleteOne({
          _id: new ObjectId(input.id),
          organizationId: ctx.user.organizationId,
        });

      if (result.deletedCount === 0) {
        throw new Error("Stock entry not found or access denied");
      }

      // Log activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: `ลบสต็อก: ${entry.materialName} (${entry.quantityKg} kg)`,
        refId: input.id,
        organizationId: ctx.user.organizationId,
      });

      console.log(`✅ [stock.delete] Stock entry deleted: ${input.id}`);

      return { success: true };
    }),

  /**
   * Get materials for dropdown selection
   */
  getMaterials: protectedProcedure
    .input(
      z.object({
        searchTerm: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      console.log('📦 [stock.getMaterials] Fetching materials for selection', { input });

      const client = await client_promise;
      const db = client.db();

      const searchTerm = input?.searchTerm || "";
      const limit = input?.limit || 20;

      // Build search filter
      const searchFilter: any = {};
      if (searchTerm) {
        searchFilter.$or = [
          { rm_code: { $regex: searchTerm, $options: "i" } },
          { trade_name: { $regex: searchTerm, $options: "i" } },
          { INCI_name: { $regex: searchTerm, $options: "i" } },
          { inci_name: { $regex: searchTerm, $options: "i" } },
        ];
      }

      const materials = await db
        .collection("raw_materials_console")
        .find(searchFilter)
        .limit(limit)
        .sort({ trade_name: 1 })
        .toArray();

      console.log(`✅ [stock.getMaterials] Found ${materials.length} materials`);

      return materials.map((material: any) => ({
        _id: material._id.toString(),
        code: material.rm_code || "",
        name: material.trade_name || material.INCI_name || material.inci_name || "Unnamed",
        inci: material.INCI_name || material.inci_name || "",
        supplier: material.supplier || "",
      }));
    }),
});
