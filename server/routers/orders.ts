import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import clientPromise from "@/lib/mongodb";
import { OrderSchema, OrderStatus } from "@/lib/types";
import { ObjectId } from "mongodb";

export const ordersRouter = router({
  create: publicProcedure
    .input(OrderSchema.omit({ _id: true, createdAt: true, updatedAt: true }))
    .mutation(async ({ input }) => {
      const client = await clientPromise;
      const db = client.db();
      const result = await db.collection("orders").insertOne({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { id: result.insertedId.toString() };
    }),

  list: publicProcedure
    .input(z.object({ organizationId: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const client = await clientPromise;
      const db = client.db();

      const filter: any = {};

      // Filter by logged-in user's ID
      if (ctx.userId) {
        filter.createdBy = ctx.userId;
      }

      if (input?.organizationId) {
        filter.organizationId = input.organizationId;
      }

      const orders = await db
        .collection("orders")
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray();

      // Enrich orders with creator info
      const enrichedOrders = await Promise.all(
        orders.map(async (order) => {
          const creator = order.createdBy
            ? await db.collection("users").findOne({ _id: new ObjectId(order.createdBy) })
            : null;

          const org = order.organizationId
            ? await db.collection("organizations").findOne({ _id: new ObjectId(order.organizationId) })
            : null;

          return {
            ...order,
            _id: order._id.toString(),
            creatorName: creator?.name || "Unknown",
            organizationName: org?.name || "Unknown",
          };
        })
      );

      return enrichedOrders;
    }),

  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.string(),
        status: OrderStatus,
      })
    )
    .mutation(async ({ input }) => {
      const client = await clientPromise;
      const db = client.db();
      await db.collection("orders").updateOne(
        { _id: new ObjectId(input.id) },
        {
          $set: {
            status: input.status,
            updatedAt: new Date(),
          },
        }
      );
      return { success: true };
    }),

  getStats: publicProcedure.query(async ({ ctx }) => {
    const client = await clientPromise;
    const db = client.db();

    const filter: any = {};
    // Filter by logged-in user's ID
    if (ctx.userId) {
      filter.createdBy = ctx.userId;
    }

    const orders = await db.collection("orders").find(filter).toArray();

    const stats = {
      total: orders.length,
      pending: orders.filter((o) => o.status === "pending").length,
      processing: orders.filter((o) => o.status === "processing").length,
      sent_to_logistic: orders.filter((o) => o.status === "sent_to_logistic").length,
      delivered: orders.filter((o) => o.status === "delivered").length,
      cancelled: orders.filter((o) => o.status === "cancelled").length,
      totalRevenue: orders.reduce((sum, o) => sum + (o.price * o.quantity), 0),
    };

    return stats;
  }),

  updateShippingCost: publicProcedure
    .input(
      z.object({
        id: z.string(),
        organizationId: z.string(),
        pickPackCost: z.number().optional(),
        bubbleCost: z.number().optional(),
        paperInsideCost: z.number().optional(),
        cancelOrderCost: z.number().optional(),
        codCost: z.number().optional(),
        boxCost: z.number().optional(),
        deliveryFeeCost: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const client = await clientPromise;
      const db = client.db();

      // Get the order to calculate total
      const order = await db.collection("orders").findOne({ _id: new ObjectId(input.id) });
      if (!order) {
        throw new Error("Order not found");
      }

      // Get the organization
      const org = await db.collection("organizations").findOne({ _id: new ObjectId(input.organizationId) });
      if (!org) {
        throw new Error("Organization not found");
      }

      const quantity = order.quantity || 1;

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
        throw new Error(`Insufficient credits. Required: ฿${totalShippingCost.toFixed(2)}, Available: ฿${currentCredits.toFixed(2)}`);
      }

      // Deduct credits from organization
      const newBalance = currentCredits - totalShippingCost;
      await db.collection("organizations").updateOne(
        { _id: new ObjectId(input.organizationId) },
        {
          $set: {
            credits: newBalance,
            updatedAt: new Date(),
          },
        }
      );

      // Log the credit transaction
      await db.collection("credit_transactions").insertOne({
        organizationId: input.organizationId,
        organizationName: org.name,
        type: "deduct",
        amount: totalShippingCost,
        balanceBefore: currentCredits,
        balanceAfter: newBalance,
        description: `Shipping cost for order ${order.productName} (${quantity} items)`,
        orderId: input.id,
        createdAt: new Date(),
      });

      // Update order with shipping costs
      await db.collection("orders").updateOne(
        { _id: new ObjectId(input.id) },
        {
          $set: {
            pickPackCost,
            bubbleCost,
            paperInsideCost,
            cancelOrderCost,
            codCost,
            boxCost,
            deliveryFeeCost,
            totalShippingCost,
            updatedAt: new Date(),
          },
        }
      );

      return {
        success: true,
        totalShippingCost,
        newBalance,
      };
    }),
});
