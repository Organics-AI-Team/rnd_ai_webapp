import type { Db, Document, Sort, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  list_scoped_documents,
  tenant_scope,
  update_scoped_document,
} from "./tenant-repository-base";

const NOT_FOUND = "STOCK_ENTRY_NOT_FOUND";

/** Options accepted by the paginated tenant stock-entry search. */
export interface StockSearchOptions {
  /** Restrict results to one material's batches. */
  readonly material_id?: string;
  /** Restrict results to one lifecycle status. */
  readonly status?: "active" | "expired" | "depleted";
  /** Document field to sort by; defaults to createdAt. */
  readonly sort_field?: string;
  /** Sort direction; defaults to descending (newest first). */
  readonly sort_direction?: "asc" | "desc";
  /** Number of documents to skip (pagination offset). */
  readonly skip?: number;
  /** Maximum number of documents to return. */
  readonly limit?: number;
}

/** One page of tenant stock entries plus the total scoped match count. */
export interface StockSearchResult {
  readonly documents: WithId<Document>[];
  readonly total_count: number;
}

/**
 * Tenant-scoped repository over the stock_entries collection. Every method
 * takes a TenantExecutionContext — never a tenant ID.
 */
export interface StockRepository {
  create_stock_entry(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  get_stock_entry(context: TenantExecutionContext, entry_id: string): Promise<WithId<Document>>;
  list_stock_entries(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  update_stock_entry(
    context: TenantExecutionContext,
    entry_id: string,
    patch: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  delete_stock_entry(context: TenantExecutionContext, entry_id: string): Promise<void>;
  search_stock_entries(
    context: TenantExecutionContext,
    options: StockSearchOptions,
  ): Promise<StockSearchResult>;
  summarize_stock(
    context: TenantExecutionContext,
    material_id?: string,
  ): Promise<Document[]>;
}

/**
 * Create the stock repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance; all failures use code "STOCK_ENTRY_NOT_FOUND".
 */
export function create_stock_repository(db: Db): StockRepository {
  const stock_entries = db.collection("stock_entries");
  return {
    async create_stock_entry(context, input) {
      return insert_scoped_document(stock_entries, context, input, "actor");
    },
    async get_stock_entry(context, entry_id) {
      return get_scoped_document(stock_entries, context, entry_id, NOT_FOUND);
    },
    async list_stock_entries(context) {
      return list_scoped_documents(stock_entries, context);
    },
    async update_stock_entry(context, entry_id, patch) {
      return update_scoped_document(stock_entries, context, entry_id, NOT_FOUND, patch);
    },
    async delete_stock_entry(context, entry_id) {
      return delete_scoped_document(stock_entries, context, entry_id, NOT_FOUND);
    },

    /**
     * Paginated, filtered stock-entry listing always constrained by the
     * tenant scope, with a total match count for pagination metadata.
     */
    async search_stock_entries(context, options) {
      const filter: Document = { ...tenant_scope(context) };
      if (options.material_id) filter.materialId = options.material_id;
      if (options.status) filter.status = options.status;

      const sort_field = options.sort_field || "createdAt";
      const direction = options.sort_direction === "asc" ? 1 : -1;
      const sort: Sort = { [sort_field]: direction };

      const total_count = await stock_entries.countDocuments(filter);
      const documents = await stock_entries
        .find(filter)
        .sort(sort)
        .skip(options.skip ?? 0)
        .limit(options.limit ?? 50)
        .toArray();
      return { documents, total_count };
    },

    /**
     * Aggregate the tenant's ACTIVE stock grouped by material: quantities,
     * value, batch counts, expiration horizons, and average unit price. The
     * $match stage always carries the tenant scope.
     *
     * @param context - Verified tenant execution context.
     * @param material_id - Optional single-material narrowing.
     * @returns Aggregation rows sorted by material name.
     */
    async summarize_stock(context, material_id) {
      const match: Document = { ...tenant_scope(context), status: "active" };
      if (material_id) match.materialId = material_id;
      return stock_entries
        .aggregate([
          { $match: match },
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
    },
  };
}
