import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import clientPromise from "@/lib/mongodb";
import { ProductSchema } from "@/lib/types";
import { ObjectId } from "mongodb";
import { logActivity } from "@/lib/userLog";
import { logProductActivity } from "@/lib/productLog";

export const productsRouter = router({
  // Get all products for organization
  list: protectedProcedure.query(async ({ ctx }) => {
    const client = await clientPromise;
    const db = client.db();

    const products = await db
      .collection("products")
      .find({ organizationId: ctx.user.organizationId })
      .sort({ createdAt: -1 })
      .toArray();

    return products.map((product) => ({
      ...product,
      _id: product._id.toString(),
    }));
  }),

  // Get single product
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      const product = await db.collection("products").findOne({
        _id: new ObjectId(input.id),
        organizationId: ctx.user.organizationId,
      });

      if (!product) {
        throw new Error("Product not found");
      }

      return {
        ...product,
        _id: product._id.toString(),
      };
    }),

  // Create new product (เพิ่มสินค้า - Add Stock)
  create: protectedProcedure
    .input(
      z.object({
        productCode: z.string().min(1, "Product code is required"),
        productName: z.string().min(1, "Product name is required"),
        description: z.string().optional(),
        price: z.number().positive("Price must be positive"),
        stockQuantity: z.number().int().min(0, "Stock quantity cannot be negative"),
        lowStockThreshold: z.number().int().min(0).default(10),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      // Check if product code already exists in this organization
      const existingProduct = await db.collection("products").findOne({
        productCode: input.productCode,
        organizationId: ctx.user.organizationId,
      });

      if (existingProduct) {
        throw new Error("Product code already exists");
      }

      const result = await db.collection("products").insertOne({
        organizationId: ctx.user.organizationId,
        productCode: input.productCode,
        productName: input.productName,
        description: input.description || "",
        price: input.price,
        stockQuantity: input.stockQuantity,
        lowStockThreshold: input.lowStockThreshold,
        isActive: true,
        createdBy: ctx.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Log create product activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "create product",
        refId: result.insertedId.toString(),
        organizationId: ctx.user.organizationId,
      });

      // Log product activity
      await logProductActivity({
        db,
        productId: result.insertedId.toString(),
        productCode: input.productCode,
        productName: input.productName,
        action: "create",
        previousStock: 0,
        newStock: input.stockQuantity,
        quantityChange: input.stockQuantity,
        userId: ctx.userId,
        userName: ctx.user.name,
        organizationId: ctx.user.organizationId,
        notes: `Created with initial stock: ${input.stockQuantity}`,
      });

      return {
        _id: result.insertedId.toString(),
        success: true,
      };
    }),

  // Update product
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        productCode: z.string().min(1, "Product code is required").optional(),
        productName: z.string().min(1, "Product name is required").optional(),
        description: z.string().optional(),
        price: z.number().positive("Price must be positive").optional(),
        stockQuantity: z.number().int().min(0, "Stock quantity cannot be negative").optional(),
        lowStockThreshold: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      const { id, ...updateData } = input;

      // Get current product data before update
      const currentProduct = await db.collection("products").findOne({
        _id: new ObjectId(id),
        organizationId: ctx.user.organizationId,
      });

      if (!currentProduct) {
        throw new Error("Product not found");
      }

      // If updating product code, check it doesn't conflict
      if (updateData.productCode) {
        const existingProduct = await db.collection("products").findOne({
          productCode: updateData.productCode,
          organizationId: ctx.user.organizationId,
          _id: { $ne: new ObjectId(id) },
        });

        if (existingProduct) {
          throw new Error("Product code already exists");
        }
      }

      const result = await db.collection("products").updateOne(
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

      // Log update product activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "update product",
        refId: id,
        organizationId: ctx.user.organizationId,
      });

      // Log product activity with stock changes if stock was updated
      const stockChanged = updateData.stockQuantity !== undefined && updateData.stockQuantity !== currentProduct.stockQuantity;
      await logProductActivity({
        db,
        productId: id,
        productCode: updateData.productCode || currentProduct.productCode,
        productName: updateData.productName || currentProduct.productName,
        action: "update",
        previousStock: currentProduct.stockQuantity,
        newStock: updateData.stockQuantity !== undefined ? updateData.stockQuantity : currentProduct.stockQuantity,
        quantityChange: stockChanged ? (updateData.stockQuantity! - currentProduct.stockQuantity) : undefined,
        userId: ctx.userId,
        userName: ctx.user.name,
        organizationId: ctx.user.organizationId,
        notes: stockChanged ? `Stock manually adjusted from ${currentProduct.stockQuantity} to ${updateData.stockQuantity}` : "Product details updated",
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

  // Delete product
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      const result = await db.collection("products").deleteOne({
        _id: new ObjectId(input.id),
        organizationId: ctx.user.organizationId,
      });

      if (result.deletedCount === 0) {
        throw new Error("Product not found");
      }

      // Log delete product activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "delete product",
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
