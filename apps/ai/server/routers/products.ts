import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, throw_from_repository_error } from "../trpc";
import client_promise, { parseArrayField } from "@rnd-ai/shared-database";
import { ObjectId, type Document, type WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";
import { logActivity } from "@/lib/userLog";
import { auto_index_material, auto_delete_material } from "../services/auto-index-service";
import type { ProductRepository } from "../repositories/product-repository";

/**
 * G2.5 conversion note: this router now reads and writes the canonical
 * tenant-scoped `products` collection through ctx.repositories.products
 * (previously it operated on the legacy shared `raw_materials_console`
 * collection with no tenant boundary). Legacy raw-material field aliases
 * (rm_code/trade_name/rm_cost/...) are still read for migrated rows.
 */

/**
 * Batch-lookup CAS numbers from raw_materials_myskin by inci_name.
 * raw_materials_myskin is platform-global chemical reference data (not
 * tenant-owned), so the raw read below carries no tenant filter.
 * // TODO(G2.6): move into a reference-data repository.
 *
 * @param db - MongoDB Db instance.
 * @param materials - Product/raw-material documents to resolve.
 * @returns Map from lowercase inci_name to cas_no string.
 */
async function build_cas_no_map(
  db: any,
  materials: any[]
): Promise<Map<string, string>> {
  console.log("[products] build_cas_no_map — start, materials:", materials.length);

  const inci_names = [
    ...new Set(
      materials
        .map((m: any) => (m.INCI_name || m.inci_name || "").trim())
        .filter((n: string) => n.length > 0)
    ),
  ] as string[];

  if (inci_names.length === 0) {
    console.log("[products] build_cas_no_map — no inci_names to lookup");
    return new Map();
  }

  // Case-insensitive regex match for each inci_name
  const myskin_docs = await db
    .collection("raw_materials_myskin")
    .find({
      inci_name: {
        $in: inci_names.map((n: string) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")),
      },
      cas_no: { $exists: true, $ne: "" },
    })
    .project({ inci_name: 1, cas_no: 1 })
    .toArray();

  const cas_map = new Map<string, string>();
  for (const doc of myskin_docs) {
    const key = (doc.inci_name || "").toLowerCase().trim();
    if (key && doc.cas_no && !cas_map.has(key)) {
      cas_map.set(key, doc.cas_no);
    }
  }

  console.log(
    "[products] build_cas_no_map — done, matched:",
    cas_map.size,
    "of",
    inci_names.length,
    "inci_names"
  );
  return cas_map;
}

/**
 * Compute the next auto-generated tenant product code (RM######) from the
 * tenant's product count and the highest number embedded in the latest
 * product's code.
 *
 * @param products_repository - Tenant-scoped product repository.
 * @param tenant_context - Verified tenant execution context.
 * @returns Next code string plus the numeric base it was derived from.
 */
async function compute_next_product_code(
  products_repository: ProductRepository,
  tenant_context: TenantExecutionContext,
): Promise<{ next_code: string; max_number: number }> {
  const [total_count, latest_product] = await Promise.all([
    products_repository.count_products(tenant_context),
    products_repository.find_latest_product(tenant_context),
  ]);

  let max_number = total_count;
  const latest_code = latest_product?.productCode || latest_product?.rm_code;
  if (latest_code) {
    const match = latest_code.toString().match(/(\d+)/);
    if (match) {
      max_number = Math.max(max_number, parseInt(match[1], 10));
    }
  }

  return { next_code: `RM${String(max_number + 1).padStart(6, "0")}`, max_number };
}

/**
 * Map a canonical product document (tolerating legacy raw-material aliases
 * on migrated rows) to the frontend product response shape.
 *
 * @param product - Tenant-scoped product document.
 * @param cas_no_map - inci_name → cas_no lookup from reference data.
 * @param favorites - Organization favorite ingredient IDs.
 * @param fallback_code - Code used when the document carries none.
 * @returns Frontend-shaped product record.
 */
function map_product_response(
  product: WithId<Document>,
  cas_no_map: Map<string, string>,
  favorites: string[],
  fallback_code: string,
) {
  const doc = product as any;
  const trade_name = doc.productName || doc.name || doc.trade_name || "";
  const inci_name = doc.INCI_name || doc.inci_name || "";
  const cas_no =
    doc.cas_no || (inci_name ? cas_no_map.get(inci_name.toLowerCase().trim()) : "") || "";

  return {
    _id: product._id.toString(),
    productCode: doc.productCode || doc.rm_code || fallback_code,
    productName: trade_name || inci_name,
    inci_name,
    cas_no,
    description:
      doc.description || doc.Chem_IUPAC_Name_Description || doc.Function || "",
    price: doc.price ?? doc.rm_cost ?? 0,
    supplier: doc.supplier || "",
    benefits: parseArrayField(doc.benefits || doc.benefits_cached),
    usecase: parseArrayField(doc.usecase || doc.usecase_cached),
    stockQuantity: doc.stockQuantity ?? 0,
    lowStockThreshold: doc.lowStockThreshold ?? 10,
    isActive: doc.isActive ?? true,
    isFavorited: favorites.includes(product._id.toString()),
    company_name: "",
    companies_id: 1,
  };
}

/**
 * Read the tenant organization's favorite ingredient IDs for display.
 * // TODO(G2.6): move into a tenant repository (organizations projection).
 *
 * @param db - MongoDB Db instance.
 * @param tenant_id - Verified tenant ID from the execution context.
 * @returns Favorite ingredient ID strings (empty when unavailable).
 */
async function read_favorite_ingredients(db: any, tenant_id: string): Promise<string[]> {
  if (!ObjectId.isValid(tenant_id)) return [];
  const organization = await db
    .collection("organizations")
    .findOne({ _id: new ObjectId(tenant_id) });
  return organization?.favoriteIngredients || [];
}

/**
 * Build the legacy raw-material-shaped view of a product document consumed by
 * the Qdrant auto-index side call, which still expects rm_code/trade_name.
 *
 * @param product - Canonical product document (with _id).
 * @returns Legacy-shaped material record for indexing.
 */
function to_indexable_material(product: WithId<Document>): any {
  const doc = product as any;
  return {
    _id: product._id,
    rm_code: doc.productCode || doc.rm_code || "",
    trade_name: doc.productName || doc.name || doc.trade_name || "",
    inci_name: doc.inci_name || doc.INCI_name || "",
    supplier: doc.supplier || "",
    rm_cost: doc.price ?? doc.rm_cost ?? 0,
    benefits: doc.benefits || "",
    usecase: doc.usecase || "",
    benefits_cached: doc.benefits || "",
    usecase_cached: doc.usecase || "",
  };
}

export const productsRouter = router({
  // Get all products for the tenant (canonical `products` collection)
  list: tenantProcedure("tenant:knowledge:read")
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
    const client = await client_promise;
    const db = client.db();

    const limit = input?.limit || 50;
    const offset = input?.offset || 0;
    const sortField = input?.sortField || "_id";
    const sortDirection = input?.sortDirection || "asc";
    const searchTerm = input?.searchTerm || "";

    // Map frontend sort keys onto canonical document fields.
    const dbSortField = sortField === "productCode" ? "productCode" :
                        sortField === "productName" ? "productName" :
                        sortField === "price" ? "price" :
                        sortField === "supplier" ? "supplier" : "_id";

    const { documents, total_count } = await ctx.repositories.products.search_products(
      ctx.tenant_context,
      {
        search_term: searchTerm,
        sort_field: dbSortField,
        sort_direction: sortDirection,
        skip: offset,
        limit,
      },
    );

    const favorites = await read_favorite_ingredients(db, ctx.tenant_context.tenant_id);

    // Batch-lookup CAS numbers from platform reference data by inci_name.
    const cas_no_map = await build_cas_no_map(db, documents);

    const products = documents.map((product, index) =>
      map_product_response(
        product,
        cas_no_map,
        favorites,
        `RM${String(offset + index + 1).padStart(6, "0")}`,
      ),
    );

    return {
      products,
      totalCount: total_count,
      hasMore: offset + limit < total_count,
      currentPage: Math.floor(offset / limit) + 1,
      totalPages: Math.ceil(total_count / limit),
    };
  }),

  // Get single tenant product
  getById: tenantProcedure("tenant:knowledge:read")
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      let product: WithId<Document>;
      try {
        product = await ctx.repositories.products.get_product(
          ctx.tenant_context,
          input.id,
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      const cas_no_map = await build_cas_no_map(db, [product]);
      const { isFavorited: _ignored, ...mapped } = map_product_response(
        product,
        cas_no_map,
        [],
        "",
      );
      return mapped;
    }),

  // Get next auto-generated product code
  getNextCode: tenantProcedure("tenant:knowledge:read")
    .query(async ({ ctx }) => {
      const { next_code, max_number } = await compute_next_product_code(
        ctx.repositories.products,
        ctx.tenant_context,
      );
      return { nextCode: next_code, maxNumber: max_number };
    }),

  // Create new material (เพิ่มสาร - Add Material)
  create: tenantProcedure("tenant:knowledge:manage")
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
      const client = await client_promise;
      const db = client.db();

      const { next_code } = await compute_next_product_code(
        ctx.repositories.products,
        ctx.tenant_context,
      );

      // tenantId/actorProfileId/createdAt/updatedAt are stamped by the
      // repository from the execution context — never from the input.
      const created = await ctx.repositories.products.create_product(
        ctx.tenant_context,
        {
          productCode: next_code,
          productName: input.productName,
          name: input.productName,
          inci_name: input.inciName || "",
          description: input.description || "",
          supplier: input.supplier || "",
          price: input.price || 0,
          benefits: input.benefits || "",
          usecase: input.details || "",
          stockQuantity: input.stockQuantity ?? 0,
          lowStockThreshold: input.lowStockThreshold ?? 10,
          isActive: true,
        },
      );

      // Display-only activity log; identity fields are for audit text only.
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "create material",
        refId: created._id.toString(),
        organizationId: ctx.tenant_context.tenant_id,
      });

      // 🔄 AUTO-SYNC: Index new material to Qdrant for AI search
      // This runs asynchronously without blocking the response
      auto_index_material(to_indexable_material(created)).then(success => {
        if (success) {
          console.log(`✅ [ProductsRouter] Auto-indexed material ${next_code} to Qdrant`);
        } else {
          console.warn(`⚠️  [ProductsRouter] Failed to auto-index material ${next_code} to Qdrant`);
        }
      }).catch(error => {
        console.error(`❌ [ProductsRouter] Error auto-indexing material ${next_code}:`, error);
      });

      return {
        _id: created._id.toString(),
        success: true,
      };
    }),

  // Update material
  update: tenantProcedure("tenant:knowledge:manage")
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
      const client = await client_promise;
      const db = client.db();

      const { id, ...updateData } = input;

      // If updating material code, check it doesn't conflict within the tenant.
      if (updateData.productCode) {
        const existing = await ctx.repositories.products.find_product_by_code(
          ctx.tenant_context,
          updateData.productCode,
          id,
        );
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Material code already exists",
          });
        }
      }

      // Build the canonical patch (updatedAt is stamped by the repository).
      const patch: Record<string, unknown> = {};
      if (updateData.productCode) patch.productCode = updateData.productCode;
      if (updateData.productName) {
        patch.productName = updateData.productName;
        patch.name = updateData.productName;
      }
      if (updateData.inciName !== undefined) patch.inci_name = updateData.inciName;
      if (updateData.description !== undefined) patch.description = updateData.description;
      if (updateData.price !== undefined) patch.price = updateData.price;
      if (updateData.supplier !== undefined) patch.supplier = updateData.supplier;
      if (updateData.benefits !== undefined) patch.benefits = updateData.benefits;
      if (updateData.details !== undefined) patch.usecase = updateData.details;
      if (updateData.stockQuantity !== undefined) patch.stockQuantity = updateData.stockQuantity;
      if (updateData.lowStockThreshold !== undefined) {
        patch.lowStockThreshold = updateData.lowStockThreshold;
      }
      if (updateData.isActive !== undefined) patch.isActive = updateData.isActive;

      let updated: WithId<Document>;
      try {
        updated = await ctx.repositories.products.update_product(
          ctx.tenant_context,
          id,
          patch,
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "update material",
        refId: id,
        organizationId: ctx.tenant_context.tenant_id,
      });

      // 🔄 AUTO-SYNC: Re-index updated material to Qdrant
      auto_index_material(to_indexable_material(updated)).then(success => {
        if (success) {
          console.log(`✅ [ProductsRouter] Auto-updated material in Qdrant`);
        } else {
          console.warn(`⚠️  [ProductsRouter] Failed to auto-update material in Qdrant`);
        }
      }).catch(error => {
        console.error(`❌ [ProductsRouter] Error auto-updating material:`, error);
      });

      return { success: true };
    }),

  // Add stock (เพิ่มสต๊อก)
  addStock: tenantProcedure("tenant:knowledge:manage")
    .input(
      z.object({
        id: z.string(),
        quantity: z.number().int().positive("Quantity must be positive"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      try {
        await ctx.repositories.products.adjust_stock_quantity(
          ctx.tenant_context,
          input.id,
          input.quantity,
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "add stock",
        refId: input.id,
        organizationId: ctx.tenant_context.tenant_id,
      });

      return { success: true };
    }),

  // Delete material
  delete: tenantProcedure("tenant:knowledge:manage")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      // Read before delete: the Qdrant cleanup needs the product code.
      let product: WithId<Document>;
      try {
        product = await ctx.repositories.products.get_product(
          ctx.tenant_context,
          input.id,
        );
        await ctx.repositories.products.delete_product(ctx.tenant_context, input.id);
      } catch (error) {
        throw_from_repository_error(error);
      }

      const product_code = (product as any).productCode || (product as any).rm_code;

      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "delete material",
        refId: input.id,
        organizationId: ctx.tenant_context.tenant_id,
      });

      // 🔄 AUTO-SYNC: Delete material from Qdrant
      if (product_code) {
        auto_delete_material(product_code).then(success => {
          if (success) {
            console.log(`✅ [ProductsRouter] Auto-deleted material ${product_code} from Qdrant`);
          } else {
            console.warn(`⚠️  [ProductsRouter] Failed to auto-delete material ${product_code} from Qdrant`);
          }
        }).catch(error => {
          console.error(`❌ [ProductsRouter] Error auto-deleting material ${product_code}:`, error);
        });
      }

      return { success: true };
    }),

  // Get low stock products
  lowStock: tenantProcedure("tenant:knowledge:read").query(async ({ ctx }) => {
    const products = await ctx.repositories.products.list_low_stock_products(
      ctx.tenant_context,
    );

    return products.map((product) => ({
      ...product,
      _id: product._id.toString(),
    }));
  }),

  // Toggle favorite ingredient
  toggleFavorite: tenantProcedure("tenant:knowledge:manage")
    .input(z.object({ ingredientId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      // Favorites live on the tenant organization record, always addressed by
      // the verified tenant ID — never a caller-supplied one.
      // TODO(G2.6): move into a tenant repository (organizations projection).
      const tenant_org_id = new ObjectId(ctx.tenant_context.tenant_id);
      const organization = await db.collection("organizations").findOne({
        _id: tenant_org_id,
      });

      if (!organization) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const favorites = organization.favoriteIngredients || [];
      const isFavorited = favorites.includes(input.ingredientId);

      if (isFavorited) {
        await db.collection("organizations").updateOne(
          { _id: tenant_org_id },
          { $pull: { favoriteIngredients: input.ingredientId } } as any
        );
      } else {
        await db.collection("organizations").updateOne(
          { _id: tenant_org_id },
          { $addToSet: { favoriteIngredients: input.ingredientId } } as any
        );
      }

      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: isFavorited ? "remove favorite ingredient" : "add favorite ingredient",
        refId: input.ingredientId,
        organizationId: ctx.tenant_context.tenant_id,
      });

      return { success: true, isFavorited: !isFavorited };
    }),

  // Duplicate ingredient (creates copy with new auto-generated code)
  duplicate: tenantProcedure("tenant:knowledge:manage")
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      let original: WithId<Document>;
      try {
        original = await ctx.repositories.products.get_product(
          ctx.tenant_context,
          input.id,
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      const { next_code } = await compute_next_product_code(
        ctx.repositories.products,
        ctx.tenant_context,
      );

      const doc = original as any;
      const trade_name = doc.productName || doc.name || doc.trade_name || "";
      const inci_name = doc.INCI_name || doc.inci_name || "";
      const product_name = trade_name || inci_name;

      // Return duplicated data for editing (not saved yet)
      return {
        _id: "", // Empty ID indicates this is new
        productCode: next_code,
        productName: `${product_name} (Copy)`,
        inci_name,
        description:
          doc.description || doc.Chem_IUPAC_Name_Description || doc.Function || "",
        price: doc.price ?? doc.rm_cost ?? 0,
        supplier: doc.supplier || "",
        benefits: parseArrayField(doc.benefits || doc.benefits_cached),
        usecase: parseArrayField(doc.usecase || doc.usecase_cached),
        isDuplicate: true,
      };
    }),
});
