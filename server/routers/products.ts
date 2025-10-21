import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import clientPromise from "@/lib/mongodb";
import { ProductSchema } from "@/lib/types";
import { ObjectId } from "mongodb";
import { logActivity } from "@/lib/userLog";
import { logProductActivity } from "@/lib/productLog";

export const productsRouter = router({
  // Get all products for organization (from raw_meterials_console collection)
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(1000).default(50),
        offset: z.number().min(0).default(0),
        sortField: z.string().optional(),
        sortDirection: z.enum(["asc", "desc"]).optional(),
        searchTerm: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
    const client = await clientPromise;
    const db = client.db();

    const limit = input?.limit || 50;
    const offset = input?.offset || 0;
    const sortField = input?.sortField || "_id";
    const sortDirection = input?.sortDirection || "asc";
    const searchTerm = input?.searchTerm || "";

    // Build search filter
    const searchFilter: any = {};
    if (searchTerm) {
      searchFilter.$or = [
        { rm_code: { $regex: searchTerm, $options: "i" } },
        { trade_name: { $regex: searchTerm, $options: "i" } },
        { INCI_name: { $regex: searchTerm, $options: "i" } },
        { inci_name: { $regex: searchTerm, $options: "i" } },
        { supplier: { $regex: searchTerm, $options: "i" } },
        { benefits: { $regex: searchTerm, $options: "i" } },
        { benefits_cached: { $regex: searchTerm, $options: "i" } },
        { usecase: { $regex: searchTerm, $options: "i" } },
        { usecase_cached: { $regex: searchTerm, $options: "i" } },
      ];
    }

    // Get total count with filter
    const totalCount = await db
      .collection("raw_meterials_console")
      .countDocuments(searchFilter);

    // Build sort object
    const sortObj: any = {};
    const dbSortField = sortField === "productCode" ? "rm_code" :
                        sortField === "productName" ? "trade_name" :
                        sortField === "price" ? "rm_cost" :
                        sortField === "supplier" ? "supplier" : "_id";
    sortObj[dbSortField] = sortDirection === "asc" ? 1 : -1;

    const rawMaterials = await db
      .collection("raw_meterials_console")
      .find(searchFilter)
      .sort(sortObj)
      .skip(offset)
      .limit(limit)
      .toArray();

    // Get organization's favorites
    const organization = await db.collection("organizations").findOne({
      _id: new ObjectId(ctx.user.organizationId),
    });
    const favorites = organization?.favoriteIngredients || [];

    // Map raw_meterials_console fields to product fields for frontend compatibility
    const products = rawMaterials.map((material: any, index: number) => {
      // Helper function to parse array fields into actual arrays
      const parseArrayField = (field: any): string[] => {
        if (!field) return [];
        if (Array.isArray(field)) {
          // Filter out empty items
          return field.filter(item => item && item.trim() !== '');
        }
        if (typeof field === 'string') {
          // Handle string representation of array like "['item1', 'item2']"
          try {
            // Remove outer brackets and split by comma
            const cleaned = field.replace(/^\[\'|'\]$/g, '').trim();
            if (!cleaned) return [];

            // Split by ', ' and clean up each item
            const items = cleaned.split(/\'\s*,\s*\'/).map(item =>
              item.replace(/^\'|\'$/g, '').trim()
            ).filter(item => item !== '');

            return items;
          } catch {
            // If parsing fails, return the original string as single item
            return [field];
          }
        }
        return [String(field)];
      };

      // Prioritize trade_name, fallback to INCI_name
      const tradeName = material.trade_name || "";
      const inciName = material.INCI_name || material.inci_name || "";
      const productName = tradeName || inciName;

      return {
        _id: material._id.toString(),
        productCode: material.rm_code || `RM${String(offset + index + 1).padStart(6, '0')}`,
        productName: productName,
        inci_name: inciName,
        description: material.Chem_IUPAC_Name_Description || material.Function || "",
        price: material.rm_cost || 0,
        supplier: material.supplier || "",
        benefits: parseArrayField(material.benefits || material.benefits_cached),
        usecase: parseArrayField(material.usecase || material.usecase_cached),
        stockQuantity: 0,
        lowStockThreshold: 10,
        isActive: true,
        isFavorited: favorites.includes(material._id.toString()),
        company_name: "",
        companies_id: 1,
      };
    });

    return {
      products,
      totalCount,
      hasMore: offset + limit < totalCount,
      currentPage: Math.floor(offset / limit) + 1,
      totalPages: Math.ceil(totalCount / limit),
    };
  }),

  // Get single product (from raw_meterials_console collection)
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      const material: any = await db.collection("raw_meterials_console").findOne({
        _id: new ObjectId(input.id),
      });

      if (!material) {
        throw new Error("Material not found");
      }

      // Helper function to parse array fields into actual arrays
      const parseArrayField = (field: any): string[] => {
        if (!field) return [];
        if (Array.isArray(field)) {
          return field.filter(item => item && item.trim() !== '');
        }
        if (typeof field === 'string') {
          try {
            const cleaned = field.replace(/^\[\'|'\]$/g, '').trim();
            if (!cleaned) return [];

            const items = cleaned.split(/\'\s*,\s*\'/).map(item =>
              item.replace(/^\'|\'$/g, '').trim()
            ).filter(item => item !== '');

            return items;
          } catch {
            return [field];
          }
        }
        return [String(field)];
      };

      const tradeName = material.trade_name || "";
      const inciName = material.INCI_name || material.inci_name || "";
      const productName = tradeName || inciName;

      return {
        _id: material._id.toString(),
        productCode: material.rm_code || "",
        productName: productName,
        inci_name: inciName,
        description: material.Chem_IUPAC_Name_Description || material.Function || "",
        price: material.rm_cost || 0,
        supplier: material.supplier || "",
        benefits: parseArrayField(material.benefits || material.benefits_cached),
        usecase: parseArrayField(material.usecase || material.usecase_cached),
        stockQuantity: 0,
        lowStockThreshold: 10,
        isActive: true,
        company_name: "",
        companies_id: 1,
      };
    }),

  // Get next auto-generated product code
  getNextCode: protectedProcedure
    .query(async ({ ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      // Get total count of materials
      const totalCount = await db.collection("raw_meterials_console").countDocuments();

      // Try to get the latest rm_code to check if there's a higher number
      const latestMaterial = await db.collection("raw_meterials_console")
        .find({})
        .sort({ _id: -1 })
        .limit(1)
        .toArray();

      let maxNumber = totalCount;

      if (latestMaterial.length > 0 && latestMaterial[0].rm_code) {
        const match = latestMaterial[0].rm_code.toString().match(/(\d+)/);
        if (match) {
          const codeNumber = parseInt(match[1], 10);
          maxNumber = Math.max(maxNumber, codeNumber);
        }
      }

      const nextCode = `RM${String(maxNumber + 1).padStart(6, '0')}`;

      return { nextCode, maxNumber };
    }),

  // Create new material (เพิ่มสาร - Add Material)
  create: protectedProcedure
    .input(
      z.object({
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

      // Always auto-generate rm_code: Get total count and use as next number
      const totalCount = await db.collection("raw_meterials_console").countDocuments();

      // Try to get the latest rm_code to check if there's a higher number
      const latestMaterial = await db.collection("raw_meterials_console")
        .find({})
        .sort({ _id: -1 })
        .limit(1)
        .toArray();

      let maxNumber = totalCount;

      if (latestMaterial.length > 0 && latestMaterial[0].rm_code) {
        const match = latestMaterial[0].rm_code.toString().match(/(\d+)/);
        if (match) {
          const codeNumber = parseInt(match[1], 10);
          maxNumber = Math.max(maxNumber, codeNumber);
        }
      }

      const rmCode = `RM${String(maxNumber + 1).padStart(6, '0')}`;

      const now = new Date();
      const result = await db.collection("raw_meterials_console").insertOne({
        rm_code: rmCode,
        trade_name: input.productName,
        inci_name: input.inciName || "",
        supplier: input.supplier || "",
        createdAt: now,
        updatedAt: now,
        rm_cost: input.price || 0,
        benefits: input.benefits || "",
        usecase: input.details || "",
        benefits_cached: input.benefits || "",
        usecase_cached: input.details || "",
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
      const currentMaterial = await db.collection("raw_meterials_console").findOne({
        _id: new ObjectId(id),
      });

      if (!currentMaterial) {
        throw new Error("Material not found");
      }

      // If updating material code, check it doesn't conflict
      if (updateData.productCode) {
        const existingMaterial = await db.collection("raw_meterials_console").findOne({
          rm_code: updateData.productCode,
          _id: { $ne: new ObjectId(id) },
        });

        if (existingMaterial) {
          throw new Error("Material code already exists");
        }
      }

      // Build update object with raw_meterials_console field names
      const rawMaterialUpdate: any = {
        updatedAt: new Date(), // Always update timestamp
      };
      if (updateData.productCode) rawMaterialUpdate.rm_code = updateData.productCode;
      if (updateData.productName) rawMaterialUpdate.trade_name = updateData.productName;
      if (updateData.inciName !== undefined) rawMaterialUpdate.inci_name = updateData.inciName;
      if (updateData.price !== undefined) rawMaterialUpdate.rm_cost = updateData.price;
      if (updateData.supplier !== undefined) rawMaterialUpdate.supplier = updateData.supplier;
      if (updateData.benefits !== undefined) {
        rawMaterialUpdate.benefits = updateData.benefits;
        rawMaterialUpdate.benefits_cached = updateData.benefits;
      }
      if (updateData.details !== undefined) {
        rawMaterialUpdate.usecase = updateData.details;
        rawMaterialUpdate.usecase_cached = updateData.details;
      }

      const result = await db.collection("raw_meterials_console").updateOne(
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

      const result = await db.collection("raw_meterials_console").deleteOne({
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

  // Toggle favorite ingredient
  toggleFavorite: protectedProcedure
    .input(z.object({ ingredientId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      // Get organization's current favorites
      const organization = await db.collection("organizations").findOne({
        _id: new ObjectId(ctx.user.organizationId),
      });

      if (!organization) {
        throw new Error("Organization not found");
      }

      const favorites = organization.favoriteIngredients || [];
      const isFavorited = favorites.includes(input.ingredientId);

      // Toggle favorite
      if (isFavorited) {
        // Remove from favorites
        await db.collection("organizations").updateOne(
          { _id: new ObjectId(ctx.user.organizationId) },
          { $pull: { favoriteIngredients: input.ingredientId } }
        );
      } else {
        // Add to favorites
        await db.collection("organizations").updateOne(
          { _id: new ObjectId(ctx.user.organizationId) },
          { $addToSet: { favoriteIngredients: input.ingredientId } }
        );
      }

      // Log favorite activity
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: isFavorited ? "remove favorite ingredient" : "add favorite ingredient",
        refId: input.ingredientId,
        organizationId: ctx.user.organizationId,
      });

      return { success: true, isFavorited: !isFavorited };
    }),

  // Duplicate ingredient (creates copy with new auto-generated code)
  duplicate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      // Get original material
      const originalMaterial: any = await db.collection("raw_meterials_console").findOne({
        _id: new ObjectId(input.id),
      });

      if (!originalMaterial) {
        throw new Error("Material not found");
      }

      // Generate new rm_code: Get total count and use as next number
      const totalCount = await db.collection("raw_meterials_console").countDocuments();

      // Try to get the latest rm_code to check if there's a higher number
      const latestMaterial = await db.collection("raw_meterials_console")
        .find({})
        .sort({ _id: -1 })
        .limit(1)
        .toArray();

      let maxNumber = totalCount;

      if (latestMaterial.length > 0 && latestMaterial[0].rm_code) {
        const match = latestMaterial[0].rm_code.toString().match(/(\d+)/);
        if (match) {
          const codeNumber = parseInt(match[1], 10);
          maxNumber = Math.max(maxNumber, codeNumber);
        }
      }

      const newRmCode = `RM${String(maxNumber + 1).padStart(6, '0')}`;

      // Helper function to parse array fields into actual arrays
      const parseArrayField = (field: any): string[] => {
        if (!field) return [];
        if (Array.isArray(field)) {
          return field.filter(item => item && item.trim() !== '');
        }
        if (typeof field === 'string') {
          try {
            const cleaned = field.replace(/^\[\'|'\]$/g, '').trim();
            if (!cleaned) return [];

            const items = cleaned.split(/\'\s*,\s*\'/).map(item =>
              item.replace(/^\'|\'$/g, '').trim()
            ).filter(item => item !== '');

            return items;
          } catch {
            return [field];
          }
        }
        return [String(field)];
      };

      const tradeName = originalMaterial.trade_name || "";
      const inciName = originalMaterial.INCI_name || originalMaterial.inci_name || "";
      const productName = tradeName || inciName;

      // Return duplicated data for editing (not saved yet)
      return {
        _id: "", // Empty ID indicates this is new
        productCode: newRmCode,
        productName: `${productName} (Copy)`,
        inci_name: inciName,
        description: originalMaterial.Chem_IUPAC_Name_Description || originalMaterial.Function || "",
        price: originalMaterial.rm_cost || 0,
        supplier: originalMaterial.supplier || "",
        benefits: parseArrayField(originalMaterial.benefits || originalMaterial.benefits_cached),
        usecase: parseArrayField(originalMaterial.usecase || originalMaterial.usecase_cached),
        isDuplicate: true,
      };
    }),
});
