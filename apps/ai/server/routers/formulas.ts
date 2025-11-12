import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { FormulaSchema } from "@/lib/types";
import { ObjectId } from "mongodb";
import { logActivity } from "@/lib/userLog";

export const formulasRouter = router({
  // Get next auto-generated formula code
  getNextCode: protectedProcedure
    .query(async ({ ctx }) => {
      const client = await client_promise;
      const db = client.db();

      // Get total count of formulas
      const totalCount = await db.collection("formulas").countDocuments();

      // Try to get the latest formula_code to check if there's a higher number
      const latestFormula = await db.collection("formulas")
        .find({})
        .sort({ _id: -1 })
        .limit(1)
        .toArray();

      let maxNumber = totalCount;

      if (latestFormula.length > 0 && latestFormula[0].formulaCode) {
        const match = latestFormula[0].formulaCode.toString().match(/(\d+)/);
        if (match) {
          const codeNumber = parseInt(match[1], 10);
          maxNumber = Math.max(maxNumber, codeNumber);
        }
      }

      const nextCode = `F${String(maxNumber + 1).padStart(6, '0')}`;

      return { nextCode, maxNumber };
    }),

  // Get all formulas
  list: protectedProcedure.query(async ({ ctx }) => {
    const client = await clientPromise;
    const db = client.db();

    const formulas = await db
      .collection("formulas")
      .find({ organizationId: ctx.user.organizationId })
      .sort({ createdAt: -1 })
      .toArray();

    return formulas.map((formula) => ({
      ...formula,
      _id: formula._id.toString(),
    }));
  }),

  // Get single formula by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      const formula = await db.collection("formulas").findOne({
        _id: new ObjectId(input.id),
        organizationId: ctx.user.organizationId,
      });

      if (!formula) {
        throw new Error("Formula not found");
      }

      return {
        ...formula,
        _id: formula._id.toString(),
      };
    }),

  // Create new formula
  create: protectedProcedure
    .input(
      z.object({
        formulaName: z.string().min(1, "Formula name is required"),
        version: z.number().int().positive().default(1),
        client: z.string().optional(),
        targetBenefits: z.array(z.string()).optional(),
        ingredients: z.array(z.object({
          materialId: z.string(),
          rm_code: z.string(),
          productName: z.string(),
          inci_name: z.string().optional(),
          amount: z.number().positive(),
          percentage: z.number().min(0).max(100).optional(),
          notes: z.string().optional(),
        })).min(1, "At least one ingredient is required"),
        totalAmount: z.number().positive().optional(),
        remarks: z.string().optional(),
        status: z.enum(["draft", "testing", "approved", "rejected"]).default("draft"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      // Auto-generate formula code: Get total count and use as next number
      const totalCount = await db.collection("formulas").countDocuments();

      // Try to get the latest formulaCode to check if there's a higher number
      const latestFormula = await db.collection("formulas")
        .find({})
        .sort({ _id: -1 })
        .limit(1)
        .toArray();

      let maxNumber = totalCount;

      if (latestFormula.length > 0 && latestFormula[0].formulaCode) {
        const match = latestFormula[0].formulaCode.toString().match(/(\d+)/);
        if (match) {
          const codeNumber = parseInt(match[1], 10);
          maxNumber = Math.max(maxNumber, codeNumber);
        }
      }

      const formulaCode = `F${String(maxNumber + 1).padStart(6, '0')}`;

      const result = await db.collection("formulas").insertOne({
        organizationId: ctx.user.organizationId,
        formulaCode,
        formulaName: input.formulaName,
        version: input.version,
        client: input.client || "",
        targetBenefits: input.targetBenefits || [],
        ingredients: input.ingredients,
        totalAmount: input.totalAmount || 0,
        remarks: input.remarks || "",
        status: input.status,
        createdBy: ctx.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Log create formula activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "create formula",
        refId: result.insertedId.toString(),
        organizationId: ctx.user.organizationId,
      });

      return {
        _id: result.insertedId.toString(),
        formulaCode,
        success: true,
      };
    }),

  // Update formula
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        formulaName: z.string().min(1).optional(),
        version: z.number().int().positive().optional(),
        client: z.string().optional(),
        targetBenefits: z.array(z.string()).optional(),
        ingredients: z.array(z.object({
          materialId: z.string(),
          rm_code: z.string(),
          productName: z.string(),
          inci_name: z.string().optional(),
          amount: z.number().positive(),
          percentage: z.number().min(0).max(100).optional(),
          notes: z.string().optional(),
        })).optional(),
        totalAmount: z.number().positive().optional(),
        remarks: z.string().optional(),
        status: z.enum(["draft", "testing", "approved", "rejected"]).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      const { id, ...updateData } = input;

      const result = await db.collection("formulas").updateOne(
        {
          _id: new ObjectId(id),
          organizationId: ctx.user.organizationId,
        },
        {
          $set: {
            ...updateData,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        throw new Error("Formula not found");
      }

      // Log update formula activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "update formula",
        refId: id,
        organizationId: ctx.user.organizationId,
      });

      return { success: true };
    }),

  // Delete formula
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      const result = await db.collection("formulas").deleteOne({
        _id: new ObjectId(input.id),
        organizationId: ctx.user.organizationId,
      });

      if (result.deletedCount === 0) {
        throw new Error("Formula not found");
      }

      // Log delete formula activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "delete formula",
        refId: input.id,
        organizationId: ctx.user.organizationId,
      });

      return { success: true };
    }),
});
