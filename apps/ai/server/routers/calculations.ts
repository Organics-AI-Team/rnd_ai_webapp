import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { ObjectId } from "mongodb";
import { logActivity } from "@/lib/userLog";
import { Logger } from "@rnd-ai/shared-utils";

// Create scoped logger for this module
const logger = Logger.scope('CalculationsRouter');

/**
 * Price Calculation Router
 *
 * Handles all price calculation operations for formulas and products.
 * Calculates production costs based on raw material prices and ingredient amounts.
 *
 * @module calculationsRouter
 */

// Manual Calculation Item Schema - for picking materials from stock
const ManualCalculationItemSchema = z.object({
  materialId: z.string(),
  materialCode: z.string(),
  materialName: z.string(),
  amountKg: z.number().positive("Amount must be positive"),
  unitPrice: z.number().positive("Unit price must be positive"),
  stockEntryId: z.string().optional(), // Reference to specific stock entry used
});

export type ManualCalculationItem = z.infer<typeof ManualCalculationItemSchema>;

// Manual Calculation Parameters Schema
const ManualCalculationParamsSchema = z.object({
  name: z.string().min(1, "Calculation name is required"),
  items: z.array(ManualCalculationItemSchema).min(1, "At least one material is required"),
  batchSize: z.number().positive("Batch size must be positive").default(100), // in grams/ml
  overheadPercentage: z.number().min(0).max(100).default(20), // Manufacturing overhead %
  markupPercentage: z.number().min(0).max(1000).default(50), // Profit markup %
  packagingCost: z.number().min(0).default(0), // Cost per unit
  laborCostPerBatch: z.number().min(0).default(0), // Fixed labor cost
  notes: z.string().optional(),
});

export type ManualCalculationParams = z.infer<typeof ManualCalculationParamsSchema>;

// Formula Calculation Parameters Schema
const FormulaCalculationParamsSchema = z.object({
  formulaId: z.string(),
  batchSize: z.number().positive("Batch size must be positive").default(100), // in grams/ml
  overheadPercentage: z.number().min(0).max(100).default(20), // Manufacturing overhead %
  markupPercentage: z.number().min(0).max(1000).default(50), // Profit markup %
  packagingCost: z.number().min(0).default(0), // Cost per unit
  laborCostPerBatch: z.number().min(0).default(0), // Fixed labor cost
});

export type FormulaCalculationParams = z.infer<typeof FormulaCalculationParamsSchema>;

// Calculation Result Schema
const CalculationResultSchema = z.object({
  name: z.string(),
  formulaId: z.string().optional(),
  formulaCode: z.string().optional(),
  calculationType: z.enum(["formula", "manual"]),
  batchSize: z.number(),
  items: z.array(z.object({
    materialCode: z.string(),
    materialName: z.string(),
    amountKg: z.number(), // Amount in kg
    unitPrice: z.number(), // Price per kg
    totalCost: z.number(), // Cost for this material
    percentage: z.number().optional(),
    stockEntryId: z.string().optional(),
  })),
  rawMaterialCost: z.number(), // Total raw material cost
  overheadCost: z.number(), // Manufacturing overhead
  laborCost: z.number(), // Labor cost
  packagingCost: z.number(), // Packaging cost
  totalProductionCost: z.number(), // Sum of all costs
  markupAmount: z.number(), // Profit markup
  suggestedSellingPrice: z.number(), // Final selling price
  costPerKg: z.number(), // Cost per kg
  profitMargin: z.number(), // Profit margin percentage
  notes: z.string().optional(),
  calculatedAt: z.date(),
});

export type CalculationResult = z.infer<typeof CalculationResultSchema>;

export const calculationsRouter = router({
  /**
   * Calculate price manually by picking materials from stock
   *
   * @param {string} name - Name for this calculation
   * @param {array} items - Materials picked from stock with amounts
   * @param {number} batchSize - Size of production batch
   * @param {number} overheadPercentage - Manufacturing overhead percentage
   * @param {number} markupPercentage - Profit markup percentage
   * @param {number} packagingCost - Cost per unit of packaging
   * @param {number} laborCostPerBatch - Fixed labor cost per batch
   * @returns {CalculationResult} Complete calculation breakdown
   */
  calculateManual: protectedProcedure
    .input(ManualCalculationParamsSchema)
    .mutation(async ({ ctx, input }) => {
      const startTime = Date.now();
      logger.info("Starting manual price calculation", {
        userId: ctx.user._id,
        itemsCount: input.items.length,
        timestamp: new Date().toISOString()
      });

      try {
        // Get database connection for logging
        const client = await client_promise;
        const db = client.db();

        // Calculate material costs
        const itemCalculations = [];
        let totalRawMaterialCost = 0;

        for (const item of input.items) {
          const itemTotalCost = item.amountKg * item.unitPrice;
          totalRawMaterialCost += itemTotalCost;

          itemCalculations.push({
            materialCode: item.materialCode,
            materialName: item.materialName,
            amountKg: Number(item.amountKg.toFixed(4)),
            unitPrice: Number(item.unitPrice.toFixed(2)),
            totalCost: Number(itemTotalCost.toFixed(2)),
            percentage: (item.amountKg / input.batchSize) * 100,
            stockEntryId: item.stockEntryId,
          });

          logger.debug("Material cost calculated", {
            materialCode: item.materialCode,
            amountKg: item.amountKg,
            unitPrice: item.unitPrice,
            totalCost: itemTotalCost,
          });
        }

        // Calculate overhead
        const overheadCost = (totalRawMaterialCost * input.overheadPercentage) / 100;

        // Calculate total production cost
        const totalProductionCost =
          totalRawMaterialCost +
          overheadCost +
          input.laborCostPerBatch +
          input.packagingCost;

        // Calculate markup and selling price
        const markupAmount = (totalProductionCost * input.markupPercentage) / 100;
        const suggestedSellingPrice = totalProductionCost + markupAmount;

        // Calculate per-kg metrics
        const costPerKg = totalProductionCost / input.batchSize;
        const profitMargin = (markupAmount / suggestedSellingPrice) * 100;

        const result: CalculationResult = {
          name: input.name,
          calculationType: "manual",
          batchSize: input.batchSize,
          items: itemCalculations,
          rawMaterialCost: Number(totalRawMaterialCost.toFixed(2)),
          overheadCost: Number(overheadCost.toFixed(2)),
          laborCost: input.laborCostPerBatch,
          packagingCost: input.packagingCost,
          totalProductionCost: Number(totalProductionCost.toFixed(2)),
          markupAmount: Number(markupAmount.toFixed(2)),
          suggestedSellingPrice: Number(suggestedSellingPrice.toFixed(2)),
          costPerKg: Number(costPerKg.toFixed(4)),
          profitMargin: Number(profitMargin.toFixed(2)),
          notes: input.notes,
          calculatedAt: new Date(),
        };

        // Log activity
        await logActivity({
          db,
          userId: ctx.user._id,
          userName: ctx.user.name,
          activity: "calculate_price_manual",
          organizationId: ctx.user.organizationId,
        });

        const elapsedTime = Date.now() - startTime;
        logger.info("Manual price calculation completed successfully", {
          name: input.name,
          totalProductionCost: result.totalProductionCost,
          suggestedSellingPrice: result.suggestedSellingPrice,
          elapsedTimeMs: elapsedTime,
        });

        return result;
      } catch (error: any) {
        const elapsedTime = Date.now() - startTime;
        logger.error("Manual price calculation failed", {
          error: error.message,
          stack: error.stack,
          userId: ctx.user._id,
          elapsedTimeMs: elapsedTime,
        });
        throw error;
      }
    }),

  /**
   * Save a calculation result for future reference
   *
   * @param {CalculationResult} calculation - The calculation to save
   * @returns {object} Saved calculation with ID
   */
  saveCalculation: protectedProcedure
    .input(CalculationResultSchema.omit({ calculatedAt: true }))
    .mutation(async ({ ctx, input }) => {
      logger.info("Saving calculation", {
        userId: ctx.user._id,
        formulaId: input.formulaId,
        timestamp: new Date().toISOString(),
      });

      try {
        const client = await client_promise;
        const db = client.db();

        const calculation = {
          ...input,
          organizationId: ctx.user.organizationId,
          createdBy: ctx.user._id,
          createdAt: new Date(),
          calculatedAt: new Date(),
        };

        const result = await db.collection("price_calculations").insertOne(calculation);

        logger.info("Calculation saved successfully", {
          calculationId: result.insertedId.toString(),
          formulaId: input.formulaId,
        });

        return {
          _id: result.insertedId.toString(),
          ...calculation,
        };
      } catch (error: any) {
        logger.error("Failed to save calculation", {
          error: error.message,
          formulaId: input.formulaId,
        });
        throw error;
      }
    }),

  /**
   * Get all saved calculations for the organization
   *
   * @returns {array} List of saved calculations
   */
  listCalculations: protectedProcedure
    .query(async ({ ctx }) => {
      logger.info("Listing calculations", {
        userId: ctx.user._id,
        organizationId: ctx.user.organizationId,
      });

      try {
        const client = await client_promise;

        if (!client) {
          logger.error("MongoDB client is undefined");
          throw new Error("Database connection failed - client is undefined");
        }

        const db = client.db();

        if (!db) {
          logger.error("MongoDB db() returned undefined");
          throw new Error("Database connection failed - db is undefined");
        }

        const calculations = await db
          .collection("price_calculations")
          .find({ organizationId: ctx.user.organizationId })
          .sort({ createdAt: -1 })
          .toArray();

        logger.info("Calculations retrieved", {
          count: calculations.length,
        });

        return calculations;
      } catch (error: any) {
        logger.error("Failed to list calculations", {
          error: error.message,
          stack: error.stack,
          userId: ctx.user._id,
        });
        throw error;
      }
    }),

  /**
   * Get a specific calculation by ID
   *
   * @param {string} id - Calculation ID
   * @returns {object} The calculation details
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      logger.info("Getting calculation by ID", {
        calculationId: input.id,
        userId: ctx.user._id,
      });

      try {
        const client = await client_promise;
        const db = client.db();

        const calculation = await db.collection("price_calculations").findOne({
          _id: new ObjectId(input.id),
          organizationId: ctx.user.organizationId,
        });

        if (!calculation) {
          logger.error("Calculation not found", { calculationId: input.id });
          throw new Error("Calculation not found");
        }

        logger.info("Calculation retrieved successfully", {
          calculationId: input.id,
        });

        return calculation;
      } catch (error: any) {
        logger.error("Failed to get calculation", {
          error: error.message,
          calculationId: input.id,
        });
        throw error;
      }
    }),

  /**
   * Delete a saved calculation
   *
   * @param {string} id - Calculation ID to delete
   * @returns {object} Success confirmation
   */
  deleteCalculation: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      logger.info("Deleting calculation", {
        calculationId: input.id,
        userId: ctx.user._id,
      });

      try {
        const client = await client_promise;
        const db = client.db();

        const result = await db.collection("price_calculations").deleteOne({
          _id: new ObjectId(input.id),
          organizationId: ctx.user.organizationId,
        });

        if (result.deletedCount === 0) {
          logger.error("Calculation not found for deletion", {
            calculationId: input.id,
          });
          throw new Error("Calculation not found");
        }

        logger.info("Calculation deleted successfully", {
          calculationId: input.id,
        });

        return { success: true };
      } catch (error: any) {
        logger.error("Failed to delete calculation", {
          error: error.message,
          calculationId: input.id,
        });
        throw error;
      }
    }),
});
