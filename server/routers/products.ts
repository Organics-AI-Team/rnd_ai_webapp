import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import clientPromise from "@/lib/mongodb";
import { ProductSchema } from "@/lib/types";
import { ObjectId } from "mongodb";
import { logActivity } from "@/lib/userLog";
import { logProductActivity } from "@/lib/productLog";

export const productsRouter = router({
  // Get all products for organization (from raw_materials collection)
  list: protectedProcedure.query(async ({ ctx }) => {
    const client = await clientPromise;
    const db = client.db();

    const rawMaterials = await db
      .collection("raw_materials")
      .find({})
      .sort({ id: -1 })
      .toArray();

    // Map raw_materials fields to product fields for frontend compatibility
    return rawMaterials.map((material) => ({
      _id: material._id.toString(),
      productCode: material.rm_code,
      productName: material.trade_name,
      inci_name: material.inci_name || "",
      description: "",  // Separate description field (not used yet)
      price: material.rm_cost || 0,
      supplier: material.supplier || "",
      benefits: material.benefits || "",
      details: material.details || "",
      stockQuantity: 0, // Default value as raw_materials doesn't have stock
      lowStockThreshold: 10,
      isActive: true,
      company_name: material.company_name,
      companies_id: material.companies_id,
    }));
  }),

  // Get single product (from raw_materials collection)
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      const material = await db.collection("raw_materials").findOne({
        _id: new ObjectId(input.id),
      });

      if (!material) {
        throw new Error("Material not found");
      }

      return {
        _id: material._id.toString(),
        productCode: material.rm_code,
        productName: material.trade_name,
        inci_name: material.inci_name || "",
        description: "",  // Separate description field
        price: material.rm_cost || 0,
        supplier: material.supplier || "",
        benefits: material.benefits || "",
        details: material.details || "",
        stockQuantity: 0,
        lowStockThreshold: 10,
        isActive: true,
        company_name: material.company_name,
        companies_id: material.companies_id,
      };
    }),

  // Create new material (เพิ่มสาร - Add Material)
  create: protectedProcedure
    .input(
      z.object({
        productCode: z.string().min(1, "Material code is required"),
        productName: z.string().min(1, "Trade name is required"),
        inciName: z.string().optional(),
        description: z.string().optional(),
        price: z.number().optional(),
        supplier: z.string().optional(),
        benefits: z.string().optional(),
        details: z.string().optional(),
        stockQuantity: z.number().int().min(0).optional(),
        lowStockThreshold: z.number().int().min(0).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      // Check if material code already exists
      const existingMaterial = await db.collection("raw_materials").findOne({
        rm_code: input.productCode,
      });

      if (existingMaterial) {
        throw new Error("Material code already exists");
      }

      // Get the max id to generate new id
      const maxIdMaterial = await db.collection("raw_materials")
        .find({})
        .sort({ id: -1 })
        .limit(1)
        .toArray();

      const newId = maxIdMaterial.length > 0 ? (maxIdMaterial[0].id || 0) + 1 : 1;

      const result = await db.collection("raw_materials").insertOne({
        id: newId,
        rm_code: input.productCode,
        trade_name: input.productName,
        inci_name: input.inciName || "",
        supplier: input.supplier || "",
        rm_cost: input.price || 0,
        company_name: ctx.user.organization?.name || "",
        companies_id: 1,
        benefits: input.benefits || "",
        details: input.details || "",
      });

      // Log create material activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "create material",
        refId: result.insertedId.toString(),
        organizationId: ctx.user.organizationId,
      });

      return {
        _id: result.insertedId.toString(),
        success: true,
      };
    }),

  // Update material
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        productCode: z.string().min(1, "Material code is required").optional(),
        productName: z.string().min(1, "Trade name is required").optional(),
        inciName: z.string().optional(),
        description: z.string().optional(),
        price: z.number().optional(),
        supplier: z.string().optional(),
        benefits: z.string().optional(),
        details: z.string().optional(),
        stockQuantity: z.number().int().min(0).optional(),
        lowStockThreshold: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      const { id, ...updateData } = input;

      // Get current material data before update
      const currentMaterial = await db.collection("raw_materials").findOne({
        _id: new ObjectId(id),
      });

      if (!currentMaterial) {
        throw new Error("Material not found");
      }

      // If updating material code, check it doesn't conflict
      if (updateData.productCode) {
        const existingMaterial = await db.collection("raw_materials").findOne({
          rm_code: updateData.productCode,
          _id: { $ne: new ObjectId(id) },
        });

        if (existingMaterial) {
          throw new Error("Material code already exists");
        }
      }

      // Build update object with raw_materials field names
      const rawMaterialUpdate: any = {};
      if (updateData.productCode) rawMaterialUpdate.rm_code = updateData.productCode;
      if (updateData.productName) rawMaterialUpdate.trade_name = updateData.productName;
      if (updateData.inciName !== undefined) rawMaterialUpdate.inci_name = updateData.inciName;
      if (updateData.price !== undefined) rawMaterialUpdate.rm_cost = updateData.price;
      if (updateData.supplier !== undefined) rawMaterialUpdate.supplier = updateData.supplier;
      if (updateData.benefits !== undefined) rawMaterialUpdate.benefits = updateData.benefits;
      if (updateData.details !== undefined) rawMaterialUpdate.details = updateData.details;

      const result = await db.collection("raw_materials").updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: rawMaterialUpdate,
        }
      );

      // Log update material activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "update material",
        refId: id,
        organizationId: ctx.user.organizationId,
      });

      return { success: true };
    }),

  // Add stock (เพิ่มสต๊อก)
  addStock: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        quantity: z.number().int().positive("Quantity must be positive"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      const result = await db.collection("products").updateOne(
        {
          _id: new ObjectId(input.id),
          organizationId: ctx.user.organizationId,
        },
        {
          $inc: { stockQuantity: input.quantity },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.matchedCount === 0) {
        throw new Error("Product not found");
      }

      // Log add stock activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "add stock",
        refId: input.id,
        organizationId: ctx.user.organizationId,
      });

      return { success: true };
    }),

  // Delete material
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      const result = await db.collection("raw_materials").deleteOne({
        _id: new ObjectId(input.id),
      });

      if (result.deletedCount === 0) {
        throw new Error("Material not found");
      }

      // Log delete material activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "delete material",
        refId: input.id,
        organizationId: ctx.user.organizationId,
      });

      return { success: true };
    }),

  // Get low stock products
  lowStock: protectedProcedure.query(async ({ ctx }) => {
    const client = await clientPromise;
    const db = client.db();

    const products = await db
      .collection("products")
      .find({
        organizationId: ctx.user.organizationId,
        isActive: true,
        $expr: { $lte: ["$stockQuantity", "$lowStockThreshold"] },
      })
      .sort({ stockQuantity: 1 })
      .toArray();

    return products.map((product) => ({
      ...product,
      _id: product._id.toString(),
    }));
  }),
});
