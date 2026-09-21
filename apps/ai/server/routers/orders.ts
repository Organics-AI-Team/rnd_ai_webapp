import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicClientOrderProcedure, tenantProcedure, throw_from_repository_error } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { OrderSchema, OrderStatus } from "@/lib/types";
import { ObjectId, type ClientSession, type Document, type MongoClient, type WithId } from "mongodb";
import { logActivity } from "../../lib/userLog";
import { logProductActivity } from "../../lib/productLog";
import { ResourceNotFoundError } from "../repositories/tenant-repository-base";
import { InsufficientCreditsError, mutate_credit_balance } from "../services/credit-ledger";

/**
 * G2.5 conversion note: authenticated order and product access now goes
 * through the tenant-scoped repositories (ctx.repositories.orders/products).
 * The public client-order ingress (submitClientOrder) is deliberately left
 * untouched. Organization credit/favorite records and user display names are
 * still raw reads scoped by the verified tenant/actor IDs.
 */

/**
 * Resolve a display name for an order's creator from the users collection.
 * Display-only; never used for authorization.
 * // TODO(G2.6): move into a tenant repository (member profile projection).
 *
 * @param db - MongoDB Db instance.
 * @param profile_id - Actor profile ID stamped on the order (may be absent).
 * @returns The user's name, or null when unresolvable.
 */
async function resolve_creator_names(
  db: any,
  orders: readonly Document[],
): Promise<Map<string, string>> {
  const profile_ids = [...new Set(
    orders
      .map((order) => String(order.actorProfileId ?? order.createdBy ?? ""))
      .filter(ObjectId.isValid),
  )].map((id) => new ObjectId(id));
  if (profile_ids.length === 0) return new Map();
  const [users, profiles] = await Promise.all([
    db.collection("users").find({ _id: { $in: profile_ids } }).toArray(),
    db.collection("user_profiles").find({ _id: { $in: profile_ids } }).toArray(),
  ]);
  const names = new Map<string, string>();
  for (const user of users) {
    if (typeof user.name === "string" && user.name.trim()) {
      names.set(String(user._id), user.name);
    }
  }
  for (const profile of profiles) {
    const name = profile.displayName ?? profile.name;
    if (typeof name === "string" && name.trim()) {
      names.set(String(profile._id), name);
    }
  }
  return names;
}

/** Commit order rows, stock changes, and their activity records together. */
async function in_order_transaction<T>(
  client: MongoClient,
  operation: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = client.startSession();
  try {
    return await session.withTransaction(() => operation(session));
  } finally {
    await session.endSession();
  }
}

/** Return true only for a duplicate order-idempotency index collision. */
function is_duplicate_client_order_submission(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === 11_000;
}

export const ordersRouter = router({
  // รับออเดอร์ (Receive Order) - Admin creates order manually
  create: tenantProcedure("tenant:knowledge:manage")
    .input(
      OrderSchema.omit({
        _id: true,
        organizationId: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      let created: WithId<Document>;
      try {
        created = await in_order_transaction(client, async (session) => {
          if (input.productId) {
            const product = await ctx.repositories.products.get_product(
              ctx.tenant_context,
              input.productId,
              session,
            );
            const updated_product = await ctx.repositories.products.decrement_stock_if_available(
              ctx.tenant_context,
              input.productId,
              input.quantity,
              session,
            );
            if (!updated_product) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "The selected product is unavailable or no longer has sufficient stock.",
              });
            }

            input.productCode = input.productCode || (product as any).productCode;
            input.productName = input.productName || (product as any).productName;
            input.price = input.price || (product as any).price;
            await logProductActivity({
              db,
              productId: input.productId,
              productCode: (updated_product as any).productCode,
              productName: (updated_product as any).productName,
              action: "reduce_stock",
              previousStock: (updated_product as any).stockQuantity + input.quantity,
              newStock: (updated_product as any).stockQuantity,
              quantityChange: -input.quantity,
              userId: ctx.userId,
              userName: ctx.user.name || "System",
              organizationId: ctx.tenant_context.tenant_id,
              refId: "",
              notes: `Stock reduced by order for customer: ${input.customerName}`,
              session,
            });
          }

          const order = await ctx.repositories.orders.create_order(
            ctx.tenant_context,
            { ...input },
            session,
          );
          await logActivity({
            db,
            userId: ctx.userId,
            userName: ctx.user.name,
            activity: "create order",
            refId: order._id.toString(),
            organizationId: ctx.tenant_context.tenant_id,
            session,
          });
          return order;
        });
      } catch (error) {
        throw_from_repository_error(error);
      }

      return { id: created._id.toString() };
    }),

  // Client order submission - Public endpoint for clients to submit orders
  submitClientOrder: publicClientOrderProcedure
    .input(
      z.object({
        organizationId: z.string().regex(/^[a-f\d]{24}$/i),
        productId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
        productCode: z.string().trim().min(1).max(64).optional(),
        productName: z.string().trim().min(1, "Product name is required").max(200),
        price: z.number().finite().positive("Price must be positive").max(1_000_000_000),
        quantity: z.number().int().positive("Quantity must be positive").max(100_000),
        channel: z.enum(["line", "shopee", "lazada", "other"]),
        customerName: z.string().trim().min(1, "Customer name is required").max(200),
        customerContact: z.string().trim().min(1, "Customer contact is required").max(200),
        shippingAddress: z.string().trim().min(1, "Shipping address is required").max(2_000),
        orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        idempotencyKey: z.string().uuid(),
      }).strict(),
    )
    .mutation(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();
      const tenant_object_id = new ObjectId(input.organizationId);
      const [tenant, organization] = await Promise.all([
        db.collection("tenants").findOne({ _id: tenant_object_id }),
        db.collection("organizations").findOne({ _id: tenant_object_id }),
      ]);
      if (!tenant && !organization) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order destination is unavailable." });
      }

      let order_id: string;
      try {
        order_id = await in_order_transaction(client, async (session) => {
          const existing_order = await db.collection("orders").findOne(
            {
              tenantId: input.organizationId,
              idempotencyKey: input.idempotencyKey,
              orderSource: "client",
            },
            { session },
          );
          if (existing_order) return existing_order._id.toString();

          let product_details: Record<string, unknown> | null = null;
          if (input.productId) {
            const product = await db.collection("products").findOneAndUpdate(
              {
                _id: new ObjectId(input.productId),
                $or: [
                  { tenantId: input.organizationId },
                  { organizationId: { $in: [input.organizationId, tenant_object_id] } },
                ],
                isActive: { $ne: false },
                stockQuantity: { $gte: input.quantity },
              },
              {
                $inc: { stockQuantity: -input.quantity },
                $set: { updatedAt: new Date() },
              },
              { returnDocument: "after", session },
            );
            if (!product) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "The selected product is unavailable or no longer has sufficient stock.",
              });
            }
            product_details = product;
          }

          const product_name = String(
            product_details?.productName ?? product_details?.name ?? input.productName,
          );
          const product_code = String(
            product_details?.productCode ?? product_details?.rm_code ?? input.productCode ?? "",
          );
          const price = typeof product_details?.price === "number"
            ? product_details.price
            : input.price;
          const created_order = await db.collection("orders").insertOne({
            ...input,
            tenantId: input.organizationId,
            productName: product_name,
            productCode: product_code,
            price,
            orderSource: "client",
            status: "pending",
            createdBy: "client",
            createdAt: new Date(),
            updatedAt: new Date(),
          }, { session });
          await logActivity({
            db,
            userId: "client",
            userName: input.customerName,
            activity: "submit client order",
            refId: created_order.insertedId.toString(),
            organizationId: input.organizationId,
            session,
          });
          return created_order.insertedId.toString();
        });
      } catch (error) {
        if (!is_duplicate_client_order_submission(error)) throw error;
        const existing_order = await db.collection("orders").findOne({
          tenantId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
          orderSource: "client",
        });
        if (!existing_order) throw error;
        order_id = existing_order._id.toString();
      }

      return {
        success: true,
        id: order_id,
        message: "Order submitted successfully"
      };
    }),

  list: tenantProcedure("tenant:analytics:read")
    .query(async ({ ctx }) => {
      const client = await client_promise;
      const db = client.db();

      // Tenant scope plus own-actor filter both derive from the context.
      const orders = await ctx.repositories.orders.list_actor_orders(
        ctx.tenant_context,
      );

      // Organization display name for the caller's own tenant only.
      // TODO(G2.6): move into a tenant repository (organizations projection).
      const org = ObjectId.isValid(ctx.tenant_context.tenant_id)
        ? await db.collection("organizations").findOne({
            _id: new ObjectId(ctx.tenant_context.tenant_id),
          })
        : null;
      const creator_names = await resolve_creator_names(db, orders);

      const enrichedOrders = orders.map((order: any) => ({
        ...order,
        _id: order._id.toString(),
        creatorName: creator_names.get(String(order.actorProfileId ?? order.createdBy)) || "Unknown",
        organizationName: org?.name || "Unknown",
      }));

      return enrichedOrders;
    }),

  listTenant: tenantProcedure("tenant:knowledge:manage")
    .query(async ({ ctx }) => {
      const client = await client_promise;
      const db = client.db();
      const orders = await ctx.repositories.orders.list_orders(ctx.tenant_context);
      const org = ObjectId.isValid(ctx.tenant_context.tenant_id)
        ? await db.collection("organizations").findOne({
            _id: new ObjectId(ctx.tenant_context.tenant_id),
          })
        : null;
      const creator_names = await resolve_creator_names(db, orders);
      const enriched_orders = orders.map((order: any) => ({
        ...order,
        _id: order._id.toString(),
        creatorName:
          creator_names.get(String(order.actorProfileId ?? order.createdBy)) || "Client",
        organizationName: org?.name || "Unknown",
      }));
      return enriched_orders;
    }),

  updateStatus: tenantProcedure("tenant:knowledge:manage")
    .input(
      z.object({
        id: z.string(),
        status: OrderStatus,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      try {
        await in_order_transaction(client, async (session) => {
          const order = await ctx.repositories.orders.get_order(
            ctx.tenant_context,
            input.id,
            session,
          );
          if (input.status === "cancelled" && (order as any).status !== "cancelled") {
            if ((order as any).productId) {
              let restored: WithId<Document>;
              try {
                restored = await ctx.repositories.products.adjust_stock_quantity(
                  ctx.tenant_context,
                  (order as any).productId,
                  (order as any).quantity,
                  session,
                );
              } catch (error) {
                if (error instanceof ResourceNotFoundError) {
                  throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: "Order cancellation requires manual review because its product no longer exists.",
                  });
                }
                throw error;
              }
              await logProductActivity({
                db,
                productId: (order as any).productId,
                productCode: (restored as any).productCode,
                productName: (restored as any).productName,
                action: "add_stock",
                previousStock: (restored as any).stockQuantity - (order as any).quantity,
                newStock: (restored as any).stockQuantity,
                quantityChange: (order as any).quantity,
                userId: ctx.userId,
                userName: ctx.user.name || "System",
                organizationId: ctx.tenant_context.tenant_id,
                refId: input.id,
                notes: `Stock restored from cancelled order for customer: ${(order as any).customerName}`,
                session,
              });
            }

            const cancellation_fee = (order as any).quantity * 10;
            await mutate_credit_balance(client, {
              tenant_id: ctx.tenant_context.tenant_id,
              type: "deduct",
              amount: cancellation_fee,
              transaction: {
                description: `Cancellation fee for order ${(order as any).productName}`,
                orderId: input.id,
                performedBy: ctx.tenant_context.actor_profile_id,
              },
            }, session);
          }

          await ctx.repositories.orders.update_order(
            ctx.tenant_context,
            input.id,
            { status: input.status },
            session,
          );
          await logActivity({
            db,
            userId: ctx.userId,
            userName: ctx.user.name,
            activity: `update order status to ${input.status}`,
            refId: input.id,
            organizationId: ctx.tenant_context.tenant_id,
            session,
          });
        });
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Insufficient credits for the cancellation fee.",
          });
        }
        throw_from_repository_error(error);
      }

      return { success: true };
    }),

  getStats: tenantProcedure("tenant:analytics:read").query(async ({ ctx }) => {
    const stats = await ctx.repositories.orders.summarize_orders(
      ctx.tenant_context,
      ctx.tenant_context.actor_profile_id,
    );
    return { ...stats, totalRevenue: stats.total_revenue };
  }),

  getTenantStats: tenantProcedure("tenant:knowledge:manage").query(async ({ ctx }) => {
    const stats = await ctx.repositories.orders.summarize_orders(ctx.tenant_context);
    return { ...stats, totalRevenue: stats.total_revenue };
  }),

  // Managers hold tenant:knowledge:manage, so the manager-tier privilege of
  // the legacy managerProcedure is preserved by this named permission.
  updateShippingCost: tenantProcedure("tenant:knowledge:manage")
    .input(
      z.object({
        id: z.string(),
        pickPackCost: z.number().optional(),
        bubbleCost: z.number().optional(),
        paperInsideCost: z.number().optional(),
        cancelOrderCost: z.number().optional(),
        codCost: z.number().optional(),
        boxCost: z.number().optional(),
        deliveryFeeCost: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      // Use the costs sent from frontend (already calculated)
      const pickPackCost = input.pickPackCost ?? 0;
      const bubbleCost = input.bubbleCost ?? 0;
      const paperInsideCost = input.paperInsideCost ?? 0;
      const cancelOrderCost = input.cancelOrderCost ?? 0;
      const codCost = input.codCost ?? 0;
      const boxCost = input.boxCost ?? 0;
      const deliveryFeeCost = input.deliveryFeeCost ?? 0;

      const totalShippingCost =
        pickPackCost +
        bubbleCost +
        paperInsideCost +
        cancelOrderCost +
        codCost +
        boxCost +
        deliveryFeeCost;

      let newBalance: number;
      try {
        newBalance = await in_order_transaction(client, async (session) => {
          const order = await ctx.repositories.orders.get_order(
            ctx.tenant_context,
            input.id,
            session,
          );
          const quantity = (order as any).quantity || 1;
          const credit_result = await mutate_credit_balance(client, {
            tenant_id: ctx.tenant_context.tenant_id,
            type: "deduct",
            amount: totalShippingCost,
            transaction: {
              description: `Shipping cost for order ${(order as any).productName} (${quantity} items)`,
              orderId: input.id,
              performedBy: ctx.tenant_context.actor_profile_id,
            },
          }, session);
          await ctx.repositories.orders.update_order(ctx.tenant_context, input.id, {
            pickPackCost,
            bubbleCost,
            paperInsideCost,
            cancelOrderCost,
            codCost,
            boxCost,
            deliveryFeeCost,
            totalShippingCost,
          }, session);
          return credit_result.balance_after;
        });
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Insufficient credits. Required: ฿${totalShippingCost.toFixed(2)}`,
          });
        }
        throw_from_repository_error(error);
      }

      return {
        success: true,
        totalShippingCost,
        newBalance,
      };
    }),
});
