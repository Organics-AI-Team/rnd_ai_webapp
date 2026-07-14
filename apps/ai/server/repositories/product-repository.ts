import type { Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  list_scoped_documents,
  update_scoped_document,
} from "./tenant-repository-base";

const NOT_FOUND = "PRODUCT_NOT_FOUND";

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
  };
}
