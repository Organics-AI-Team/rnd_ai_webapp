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

  list: publicProcedure.query(async () => {
    const client = await clientPromise;
    const db = client.db();
    const orders = await db
      .collection("orders")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    return orders.map((order) => ({
      ...order,
      _id: order._id.toString(),
    }));
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

  getStats: publicProcedure.query(async () => {
    const client = await clientPromise;
    const db = client.db();
    const orders = await db.collection("orders").find({}).toArray();

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
        userId: z.string(),
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

      // Get the user
      const user = await db.collection("users").findOne({ _id: new ObjectId(input.userId) });
      if (!user) {
        throw new Error("User not found");
      }

      const quantity = order.quantity || 1;

      // Calculate costs based on credits usage
      const pickPackCost = input.pickPackCost ?? 0;
      const bubbleCost = (input.bubbleCost ?? 0) * quantity;
      const paperInsideCost = (input.paperInsideCost ?? 0) * quantity;
      const cancelOrderCost = input.cancelOrderCost ?? 0;
      const codCost = input.codCost ?? 0;
      const boxCost = (input.boxCost ?? 0) * quantity;
      const deliveryFeeCost = (input.deliveryFeeCost ?? 0) * quantity;

      const totalShippingCost =
        pickPackCost +
        bubbleCost +
        paperInsideCost +
        cancelOrderCost +
        codCost +
        boxCost +
        deliveryFeeCost;

      // Check if user has enough credits
      const currentCredits = user.credits || 0;
      if (currentCredits < totalShippingCost) {
        throw new Error(`Insufficient credits. Required: ${totalShippingCost}, Available: ${currentCredits}`);
      }

      // Deduct credits from user
      const newBalance = currentCredits - totalShippingCost;
      await db.collection("users").updateOne(
        { _id: new ObjectId(input.userId) },
        {
          $set: {
            credits: newBalance,
            updatedAt: new Date(),
          },
        }
      );

      // Log the credit transaction
      await db.collection("credit_transactions").insertOne({
        userId: input.userId,
        userName: user.name,
        userEmail: user.email,
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
            userId: input.userId,
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
