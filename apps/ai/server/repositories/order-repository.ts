import type { ClientSession, Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  tenant_scope,
  update_scoped_document,
} from "./tenant-repository-base";

const NOT_FOUND = "ORDER_NOT_FOUND";

export interface OrderStats {
  readonly total: number;
  readonly pending: number;
  readonly processing: number;
  readonly sent_to_logistic: number;
  readonly delivered: number;
  readonly cancelled: number;
  readonly total_revenue: number;
}

/**
 * Tenant-scoped repository over the orders collection. Every method takes a
 * TenantExecutionContext — never a tenant ID.
 */
export interface OrderRepository {
  create_order(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<WithId<Document>>;
  get_order(
    context: TenantExecutionContext,
    order_id: string,
    session?: ClientSession,
  ): Promise<WithId<Document>>;
  list_orders(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  update_order(
    context: TenantExecutionContext,
    order_id: string,
    patch: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<WithId<Document>>;
  delete_order(context: TenantExecutionContext, order_id: string): Promise<void>;
  list_actor_orders(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  summarize_orders(
    context: TenantExecutionContext,
    actor_profile_id?: string,
  ): Promise<OrderStats>;
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
    async create_order(context, input, session) {
      return insert_scoped_document(orders, context, input, "actor", session);
    },
    async get_order(context, order_id, session) {
      return get_scoped_document(orders, context, order_id, NOT_FOUND, session);
    },
    async list_orders(context) {
      return orders.find(tenant_scope(context)).sort({ createdAt: -1 }).toArray();
    },
    async update_order(context, order_id, patch, session) {
      return update_scoped_document(orders, context, order_id, NOT_FOUND, patch, {}, session);
    },
    async delete_order(context, order_id) {
      return delete_scoped_document(orders, context, order_id, NOT_FOUND);
    },

    /**
     * List the tenant orders created by the acting profile, newest first.
     * Both the tenant scope and the actor come from the execution context,
     * so a caller can never widen the listing to another user's orders.
     *
     * @param context - Verified tenant execution context.
     * @returns The actor's orders sorted by createdAt descending.
     */
    async list_actor_orders(context) {
      return orders
        .find({ ...tenant_scope(context), actorProfileId: context.actor_profile_id })
        .sort({ createdAt: -1 })
        .toArray();
    },

    async summarize_orders(context, actor_profile_id) {
      const match: Document = {
        ...tenant_scope(context),
        ...(actor_profile_id ? { actorProfileId: actor_profile_id } : {}),
      };
      const [summary] = await orders.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
            processing: { $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] } },
            sent_to_logistic: { $sum: { $cond: [{ $eq: ["$status", "sent_to_logistic"] }, 1, 0] } },
            delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
            total_revenue: {
              $sum: {
                $multiply: [
                  { $convert: { input: "$price", to: "double", onError: 0, onNull: 0 } },
                  { $convert: { input: "$quantity", to: "double", onError: 0, onNull: 0 } },
                ],
              },
            },
          },
        },
      ]).toArray();
      return {
        total: Number(summary?.total ?? 0),
        pending: Number(summary?.pending ?? 0),
        processing: Number(summary?.processing ?? 0),
        sent_to_logistic: Number(summary?.sent_to_logistic ?? 0),
        delivered: Number(summary?.delivered ?? 0),
        cancelled: Number(summary?.cancelled ?? 0),
        total_revenue: Number(summary?.total_revenue ?? 0),
      };
    },
  };
}
