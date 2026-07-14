import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicClientOrderProcedure, tenantProcedure, throw_from_repository_error } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { OrderSchema, OrderStatus } from "@/lib/types";
import { ObjectId, type Document, type WithId } from "mongodb";
import { logActivity } from "@/lib/userLog";
import { logProductActivity } from "@/lib/productLog";
import { ResourceNotFoundError } from "../repositories/tenant-repository-base";

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
async function resolve_creator_name(db: any, profile_id: unknown): Promise<string | null> {
  if (typeof profile_id !== "string" || !ObjectId.isValid(profile_id)) return null;
  const user = await db.collection("users").findOne({ _id: new ObjectId(profile_id) });
  return user?.name ?? null;
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

      // If productId is provided, reduce stock from the tenant's inventory.
      if (input.productId) {
        let product: WithId<Document>;
        try {
          product = await ctx.repositories.products.get_product(
            ctx.tenant_context,
            input.productId,
          );
        } catch (error) {
          throw_from_repository_error(error);
        }

        if (!(product as any).isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Product is not active" });
        }

        if ((product as any).stockQuantity < input.quantity) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Insufficient stock. Available: ${(product as any).stockQuantity}, Requested: ${input.quantity}`,
          });
        }

        // Reduce stock atomically within the tenant scope.
        await ctx.repositories.products.adjust_stock_quantity(
          ctx.tenant_context,
          input.productId,
          -input.quantity,
        );

        // Use product data if not overridden
        input.productCode = input.productCode || (product as any).productCode;
        input.productName = input.productName || (product as any).productName;
        input.price = input.price || (product as any).price;

        // Log product stock reduction (display-only identity fields).
        await logProductActivity({
          db,
          productId: input.productId,
          productCode: (product as any).productCode,
          productName: (product as any).productName,
          action: "reduce_stock",
          previousStock: (product as any).stockQuantity,
          newStock: (product as any).stockQuantity - input.quantity,
          quantityChange: -input.quantity,
          userId: ctx.userId,
          userName: ctx.user.name || "System",
          organizationId: ctx.tenant_context.tenant_id,
          refId: "", // Will be updated after order is created
          notes: `Stock reduced by order for customer: ${input.customerName}`,
        });
      }

      // tenantId/actorProfileId/createdAt/updatedAt are stamped by the
      // repository from the execution context — never from the input.
      const created = await ctx.repositories.orders.create_order(
        ctx.tenant_context,
        { ...input },
      );

      // Log create order activity (display-only identity fields).
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: "create order",
        refId: created._id.toString(),
        organizationId: ctx.tenant_context.tenant_id,
      });

      return { id: created._id.toString() };
    }),

  // Client order submission - Public endpoint for clients to submit orders
  submitClientOrder: publicClientOrderProcedure
    .input(
      z.object({
        organizationId: z.string(),
        productId: z.string().optional(),
        productCode: z.string().optional(),
        productName: z.string().min(1, "Product name is required"),
        price: z.number().positive("Price must be positive"),
        quantity: z.number().int().positive("Quantity must be positive"),
        channel: z.enum(["line", "shopee", "lazada", "other"]),
        customerName: z.string().min(1, "Customer name is required"),
        customerContact: z.string().min(1, "Customer contact is required"),
        shippingAddress: z.string().min(1, "Shipping address is required"),
        orderDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();

      // If productId is provided, check stock and reduce
      if (input.productId) {
        const product = await db.collection("products").findOne({
          _id: new ObjectId(input.productId),
          organizationId: input.organizationId,
        });

        if (!product) {
          throw new Error("Product not found");
        }

        if (!product.isActive) {
          throw new Error("Product is not available");
        }

        if (product.stockQuantity < input.quantity) {
          throw new Error(
            `Insufficient stock. Available: ${product.stockQuantity}, Requested: ${input.quantity}`
          );
        }

        // Reduce stock
        await db.collection("products").updateOne(
          { _id: new ObjectId(input.productId) },
          {
            $inc: { stockQuantity: -input.quantity },
            $set: { updatedAt: new Date() },
          }
        );
      }

      const result = await db.collection("orders").insertOne({
        ...input,
        orderSource: "client",
        status: "pending",
        createdBy: "client", // No user authentication required for client orders
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Log client order activity (without user ID since it's public)
      await logActivity({
        db,
        userId: "client",
        userName: input.customerName,
        activity: "submit client order",
        refId: result.insertedId.toString(),
        organizationId: input.organizationId,
      });

      return {
        success: true,
        id: result.insertedId.toString(),
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

      // Enrich orders with creator display names.
      const enrichedOrders = await Promise.all(
        orders.map(async (order: any) => {
          const creator_name = await resolve_creator_name(
            db,
            order.actorProfileId ?? order.createdBy,
          );
          return {
            ...order,
            _id: order._id.toString(),
            creatorName: creator_name || "Unknown",
            organizationName: org?.name || "Unknown",
          };
        })
      );

      return enrichedOrders;
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

      // Get the current order within the tenant scope.
      let order: WithId<Document>;
      try {
        order = await ctx.repositories.orders.get_order(ctx.tenant_context, input.id);
      } catch (error) {
        throw_from_repository_error(error);
      }

      // If changing to cancelled and order has a productId, restore stock and deduct credits
      if (input.status === "cancelled" && (order as any).status !== "cancelled") {
        // Restore stock if productId exists (skip silently when the product
        // no longer exists, matching legacy behavior).
        if ((order as any).productId) {
          try {
            const restored = await ctx.repositories.products.adjust_stock_quantity(
              ctx.tenant_context,
              (order as any).productId,
              (order as any).quantity,
            );

            // Log product stock restoration (display-only identity fields).
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
            });
          } catch (error) {
            if (!(error instanceof ResourceNotFoundError)) throw error;
          }
        }

        // Deduct cancellation fee: 10 THB per piece — billed to the caller's
        // verified tenant only.
        // TODO(G2.6): move into a tenant repository (credit ledger).
        const cancellationFee = (order as any).quantity * 10;
        await db.collection("organizations").updateOne(
          { _id: new ObjectId(ctx.tenant_context.tenant_id) },
          {
            $inc: { credits: -cancellationFee },
          }
        );
      }

      // Update order status within the tenant scope.
      try {
        await ctx.repositories.orders.update_order(ctx.tenant_context, input.id, {
          status: input.status,
        });
      } catch (error) {
        throw_from_repository_error(error);
      }

      // Log update order status activity (display-only identity fields).
      await logActivity({
        db,
        userId: ctx.userId,
        userName: ctx.user.name,
        activity: `update order status to ${input.status}`,
        refId: input.id,
        organizationId: ctx.tenant_context.tenant_id,
      });

      return { success: true };
    }),

  getStats: tenantProcedure("tenant:analytics:read").query(async ({ ctx }) => {
    // Tenant scope plus own-actor filter both derive from the context.
    const orders = await ctx.repositories.orders.list_actor_orders(
      ctx.tenant_context,
    );

    const stats = {
      total: orders.length,
      pending: orders.filter((o: any) => o.status === "pending").length,
      processing: orders.filter((o: any) => o.status === "processing").length,
      sent_to_logistic: orders.filter((o: any) => o.status === "sent_to_logistic").length,
      delivered: orders.filter((o: any) => o.status === "delivered").length,
      cancelled: orders.filter((o: any) => o.status === "cancelled").length,
      totalRevenue: orders.reduce((sum: number, o: any) => sum + (o.price * o.quantity), 0),
    };

    return stats;
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

      // Get the order within the tenant scope to calculate the total.
      let order: WithId<Document>;
      try {
        order = await ctx.repositories.orders.get_order(ctx.tenant_context, input.id);
      } catch (error) {
        throw_from_repository_error(error);
      }

      // The billed organization always derives from the verified tenant.
      // TODO(G2.6): move into a tenant repository (credit ledger).
      const org = await db.collection("organizations").findOne({
        _id: new ObjectId(ctx.tenant_context.tenant_id),
      });
      if (!org) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const quantity = (order as any).quantity || 1;

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

      // Check if organization has enough credits
      const currentCredits = org.credits || 0;
      if (currentCredits < totalShippingCost) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient credits. Required: ฿${totalShippingCost.toFixed(2)}, Available: ฿${currentCredits.toFixed(2)}`,
        });
      }

      // Deduct credits from the caller's verified tenant organization.
      // TODO(G2.6): move into a tenant repository (credit ledger).
      const newBalance = currentCredits - totalShippingCost;
      await db.collection("organizations").updateOne(
        { _id: new ObjectId(ctx.tenant_context.tenant_id) },
        {
          $set: {
            credits: newBalance,
            updatedAt: new Date(),
          },
        }
      );

      // Log the credit transaction against the verified tenant.
      // TODO(G2.6): move into a tenant repository (credit ledger).
      await db.collection("credit_transactions").insertOne({
        organizationId: ctx.tenant_context.tenant_id,
        organizationName: org.name,
        type: "deduct",
        amount: totalShippingCost,
        balanceBefore: currentCredits,
        balanceAfter: newBalance,
        description: `Shipping cost for order ${(order as any).productName} (${quantity} items)`,
        orderId: input.id,
        createdAt: new Date(),
      });

      // Update order with shipping costs within the tenant scope.
      try {
        await ctx.repositories.orders.update_order(ctx.tenant_context, input.id, {
          pickPackCost,
          bubbleCost,
          paperInsideCost,
          cancelOrderCost,
          codCost,
          boxCost,
          deliveryFeeCost,
          totalShippingCost,
        });
      } catch (error) {
        throw_from_repository_error(error);
      }

      return {
        success: true,
        totalShippingCost,
        newBalance,
      };
    }),
});
