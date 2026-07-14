/**
 * Stock Management Router
 * Handles CRUD operations for stock entries and inventory tracking.
 *
 * G2.5 conversion note: every stock_entries access now goes through the
 * tenant-scoped StockRepository (ctx.repositories.stock); the repository
 * stamps tenantId/actorProfileId from the execution context.
 */

import { z } from "zod";
import type { Document, WithId } from "mongodb";
import { router, tenantProcedure, throw_from_repository_error } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { logActivity } from "@/lib/userLog";

export const stockRouter = router({
  /**
   * List all stock entries with filtering and pagination
   */
  list: tenantProcedure("tenant:knowledge:read")
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

      const limit = input?.limit || 50;
      const offset = input?.offset || 0;
      const status = input?.status || "all";

      const { documents, total_count } =
        await ctx.repositories.stock.search_stock_entries(ctx.tenant_context, {
          material_id: input?.materialId,
          status: status === "all" ? undefined : status,
          sort_field: input?.sortField || "createdAt",
          sort_direction: input?.sortDirection || "desc",
          skip: offset,
          limit,
        });

      const totalPages = Math.ceil(total_count / limit);
      const hasMore = offset + limit < total_count;

      console.log(`✅ [stock.list] Found ${documents.length} entries (total: ${total_count})`);

      return {
        entries: documents.map((entry: any) => ({
          ...entry,
          _id: entry._id.toString(),
          expirationDate: entry.expirationDate,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })),
        totalCount: total_count,
        totalPages,
        hasMore,
      };
    }),

  /**
   * Get stock summary for all materials or specific material
   */
  summary: tenantProcedure("tenant:knowledge:read")
    .input(
      z.object({
        materialId: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      console.log('📊 [stock.summary] Calculating stock summary', { input });

      const summary = await ctx.repositories.stock.summarize_stock(
        ctx.tenant_context,
        input?.materialId,
      );

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
  create: tenantProcedure("tenant:knowledge:manage")
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

      // tenantId/actorProfileId/createdAt/updatedAt are stamped by the
      // repository from the execution context — never from the input.
      const created = await ctx.repositories.stock.create_stock_entry(
        ctx.tenant_context,
        {
          materialId: input.materialId,
          materialCode: input.materialCode,
          materialName: input.materialName,
          quantityKg: input.quantityKg,
          unitPrice: input.unitPrice,
          totalCost,
          expirationDate: new Date(input.expirationDate),
          batchNumber: input.batchNumber || "",
          supplier: input.supplier || "",
          notes: input.notes || "",
          status: "active" as const,
        },
      );

      // Display-only activity log; identity fields are for audit text only.
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: `เพิ่มสต็อก: ${input.materialName} (${input.quantityKg} kg)`,
        refId: created._id.toString(),
        organizationId: ctx.tenant_context.tenant_id,
      });

      console.log(`✅ [stock.create] Stock entry created: ${created._id}`);

      return {
        _id: created._id.toString(),
        success: true,
      };
    }),

  /**
   * Update stock entry
   */
  update: tenantProcedure("tenant:knowledge:manage")
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

      const patch: Record<string, unknown> = {};
      if (input.quantityKg !== undefined) patch.quantityKg = input.quantityKg;
      if (input.unitPrice !== undefined) patch.unitPrice = input.unitPrice;
      if (input.expirationDate) patch.expirationDate = new Date(input.expirationDate);
      if (input.batchNumber !== undefined) patch.batchNumber = input.batchNumber;
      if (input.supplier !== undefined) patch.supplier = input.supplier;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.status) patch.status = input.status;

      let updated: WithId<Document>;
      try {
        // Recalculate totalCost if quantity or price changed.
        if (input.quantityKg !== undefined || input.unitPrice !== undefined) {
          const current = await ctx.repositories.stock.get_stock_entry(
            ctx.tenant_context,
            input.id,
          );
          const qty =
            input.quantityKg !== undefined ? input.quantityKg : (current as any).quantityKg;
          const price =
            input.unitPrice !== undefined ? input.unitPrice : (current as any).unitPrice;
          patch.totalCost = qty * price;
        }

        updated = await ctx.repositories.stock.update_stock_entry(
          ctx.tenant_context,
          input.id,
          patch,
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: `แก้ไขสต็อก: ${(updated as any).materialName}`,
        refId: input.id,
        organizationId: ctx.tenant_context.tenant_id,
      });

      console.log(`✅ [stock.update] Stock entry updated: ${input.id}`);

      return { success: true };
    }),

  /**
   * Delete stock entry
   */
  delete: tenantProcedure("tenant:knowledge:manage")
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      console.log('🗑️ [stock.delete] Deleting stock entry', { input });

      const client = await client_promise;
      const db = client.db();

      // Read before delete: the activity log needs the entry details.
      let entry: WithId<Document>;
      try {
        entry = await ctx.repositories.stock.get_stock_entry(
          ctx.tenant_context,
          input.id,
        );
        await ctx.repositories.stock.delete_stock_entry(ctx.tenant_context, input.id);
      } catch (error) {
        throw_from_repository_error(error);
      }

      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: `ลบสต็อก: ${(entry as any).materialName} (${(entry as any).quantityKg} kg)`,
        refId: input.id,
        organizationId: ctx.tenant_context.tenant_id,
      });

      console.log(`✅ [stock.delete] Stock entry deleted: ${input.id}`);

      return { success: true };
    }),

  /**
   * Get materials for dropdown selection
   */
  getMaterials: tenantProcedure("tenant:knowledge:read")
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

      // raw_materials_console is platform-global raw-material reference data
      // (not tenant-owned), so this read carries no tenant filter.
      // TODO(G2.6): move into a reference-data repository.
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
