import type { Db, Document, Sort, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  ResourceNotFoundError,
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  list_scoped_documents,
  object_id_or_not_found,
  scoped_id_filter,
  tenant_scope,
  update_scoped_document,
} from "./tenant-repository-base";

const NOT_FOUND = "PRODUCT_NOT_FOUND";

/**
 * Document fields matched by the free-text product search. Canonical product
 * names plus the legacy raw-material aliases still present on migrated rows.
 */
const SEARCHABLE_PRODUCT_FIELDS = [
  "productCode",
  "rm_code",
  "productName",
  "trade_name",
  "name",
  "INCI_name",
  "inci_name",
  "cas_no",
  "supplier",
  "benefits",
  "benefits_cached",
  "usecase",
  "usecase_cached",
] as const;

/** Options accepted by the paginated tenant product search. */
export interface ProductSearchOptions {
  /** Case-insensitive free-text term matched across product/search fields. */
  readonly search_term?: string;
  /** Document field to sort by; defaults to _id. */
  readonly sort_field?: string;
  /** Sort direction; defaults to ascending. */
  readonly sort_direction?: "asc" | "desc";
  /** Number of documents to skip (pagination offset). */
  readonly skip?: number;
  /** Maximum number of documents to return. */
  readonly limit?: number;
}

/** One page of tenant products plus the total scoped match count. */
export interface ProductSearchResult {
  readonly documents: WithId<Document>[];
  readonly total_count: number;
}

/**
 * Escape regex metacharacters in a caller-supplied search term so it can be
 * embedded in a MongoDB $regex without becoming an injection vector.
 *
 * @param term - Raw search term from the client.
 * @returns Literal-safe regex source string.
 */
function escape_regex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the optional free-text $or filter for a product search.
 *
 * @param search_term - Raw search term; empty/undefined yields no filter.
 * @returns Filter fragment to merge into the tenant-scoped query.
 */
function build_product_search_filter(search_term?: string): Document {
  if (!search_term) return {};
  const pattern = { $regex: escape_regex(search_term), $options: "i" };
  return { $or: SEARCHABLE_PRODUCT_FIELDS.map((field) => ({ [field]: pattern })) };
}

/**
 * Tenant-scoped repository over the products collection. Every method takes
 * a TenantExecutionContext — never a tenant ID — so callers cannot widen the
 * scope of any read or write.
 */
export interface ProductRepository {
  create_product(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  get_product(context: TenantExecutionContext, product_id: string): Promise<WithId<Document>>;
  list_products(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  update_product(
    context: TenantExecutionContext,
    product_id: string,
    patch: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  delete_product(context: TenantExecutionContext, product_id: string): Promise<void>;
  search_products(
    context: TenantExecutionContext,
    options: ProductSearchOptions,
  ): Promise<ProductSearchResult>;
  count_products(context: TenantExecutionContext): Promise<number>;
  find_latest_product(context: TenantExecutionContext): Promise<WithId<Document> | null>;
  find_product_by_code(
    context: TenantExecutionContext,
    product_code: string,
    exclude_product_id?: string,
  ): Promise<WithId<Document> | null>;
  adjust_stock_quantity(
    context: TenantExecutionContext,
    product_id: string,
    quantity_delta: number,
  ): Promise<WithId<Document>>;
  list_low_stock_products(context: TenantExecutionContext): Promise<WithId<Document>[]>;
}

/**
 * Create the product repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance; all failures use code "PRODUCT_NOT_FOUND".
 */
export function create_product_repository(db: Db): ProductRepository {
  const products = db.collection("products");
  return {
    async create_product(context, input) {
      return insert_scoped_document(products, context, input, "actor");
    },
    async get_product(context, product_id) {
      return get_scoped_document(products, context, product_id, NOT_FOUND);
    },
    async list_products(context) {
      return list_scoped_documents(products, context);
    },
    async update_product(context, product_id, patch) {
      return update_scoped_document(products, context, product_id, NOT_FOUND, patch);
    },
    async delete_product(context, product_id) {
      return delete_scoped_document(products, context, product_id, NOT_FOUND);
    },

    /**
     * Paginated, sorted, free-text product search always constrained by the
     * tenant scope; sorting on text fields uses a case-insensitive collation
     * with a secondary _id sort for deterministic ordering.
     */
    async search_products(context, options) {
      const filter: Document = {
        ...build_product_search_filter(options.search_term),
        ...tenant_scope(context),
      };
      const sort_field = options.sort_field || "_id";
      const direction = options.sort_direction === "desc" ? -1 : 1;
      const sort: Sort =
        sort_field === "_id" ? { _id: direction } : { [sort_field]: direction, _id: 1 };

      const total_count = await products.countDocuments(filter);
      const cursor = products.find(filter);
      // Collation only helps lexicographic (text) sorts; skip for numerics.
      const is_numeric_sort = sort_field === "price" || sort_field === "rm_cost";
      const documents = await (is_numeric_sort
        ? cursor
        : cursor.collation({ locale: "en", strength: 2 })
      )
        .sort(sort)
        .skip(options.skip ?? 0)
        .limit(options.limit ?? 50)
        .toArray();
      return { documents, total_count };
    },

    /** Count every product owned by the context tenant. */
    async count_products(context) {
      return products.countDocuments(tenant_scope(context));
    },

    /** Fetch the most recently inserted tenant product (highest _id), if any. */
    async find_latest_product(context) {
      const latest = await products
        .find(tenant_scope(context))
        .sort({ _id: -1 })
        .limit(1)
        .toArray();
      return latest[0] ?? null;
    },

    /**
     * Find a tenant product carrying a given code (canonical productCode or
     * legacy rm_code alias), optionally excluding one product ID — used for
     * uniqueness checks before code updates.
     */
    async find_product_by_code(context, product_code, exclude_product_id) {
      const filter: Document = {
        ...tenant_scope(context),
        $or: [{ productCode: product_code }, { rm_code: product_code }],
      };
      if (exclude_product_id) {
        filter._id = { $ne: object_id_or_not_found(exclude_product_id, NOT_FOUND) };
      }
      return products.findOne(filter);
    },

    /**
     * Atomically increment (or decrement, with a negative delta) a tenant
     * product's stockQuantity, returning the updated document.
     *
     * @throws ResourceNotFoundError for cross-tenant, missing, or malformed IDs.
     */
    async adjust_stock_quantity(context, product_id, quantity_delta) {
      const updated = await products.findOneAndUpdate(
        scoped_id_filter(context, product_id, NOT_FOUND),
        {
          $inc: { stockQuantity: quantity_delta },
          $set: { updatedAt: new Date() },
        },
        { returnDocument: "after" },
      );
      if (!updated) throw new ResourceNotFoundError(NOT_FOUND);
      return updated;
    },

    /** List active tenant products at or below their low-stock threshold. */
    async list_low_stock_products(context) {
      return products
        .find({
          ...tenant_scope(context),
          isActive: true,
          $expr: { $lte: ["$stockQuantity", "$lowStockThreshold"] },
        })
        .sort({ stockQuantity: 1 })
        .toArray();
    },
  };
}
