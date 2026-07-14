import type { Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  list_scoped_documents,
  update_scoped_document,
} from "./tenant-repository-base";

const NOT_FOUND = "ORDER_NOT_FOUND";

/**
 * Tenant-scoped repository over the orders collection. Every method takes a
 * TenantExecutionContext — never a tenant ID.
 */
export interface OrderRepository {
  create_order(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  get_order(context: TenantExecutionContext, order_id: string): Promise<WithId<Document>>;
  list_orders(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  update_order(
    context: TenantExecutionContext,
    order_id: string,
    patch: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  delete_order(context: TenantExecutionContext, order_id: string): Promise<void>;
}

/**
 * Create the order repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance; all failures use code "ORDER_NOT_FOUND".
 */
export function create_order_repository(db: Db): OrderRepository {
  const orders = db.collection("orders");
  return {
    async create_order(context, input) {
      return insert_scoped_document(orders, context, input, "actor");
    },
    async get_order(context, order_id) {
      return get_scoped_document(orders, context, order_id, NOT_FOUND);
    },
    async list_orders(context) {
      return list_scoped_documents(orders, context);
    },
    async update_order(context, order_id, patch) {
      return update_scoped_document(orders, context, order_id, NOT_FOUND, patch);
    },
    async delete_order(context, order_id) {
      return delete_scoped_document(orders, context, order_id, NOT_FOUND);
    },
  };
}
