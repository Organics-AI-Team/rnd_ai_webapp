import type { Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  list_scoped_documents,
  update_scoped_document,
} from "./tenant-repository-base";

const NOT_FOUND = "STOCK_ENTRY_NOT_FOUND";

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
  };
}
