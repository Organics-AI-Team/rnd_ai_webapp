import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { OrderSchema, OrderStatus } from "@/lib/types";
import { ObjectId } from "mongodb";
import { logActivity } from "@/lib/userLog";
import { logProductActivity } from "@/lib/productLog";

export const ordersRouter = router({
  // รับออเดอร์ (Receive Order) - Admin creates order manually
  create: publicProcedure
    .input(OrderSchema.omit({ _id: true, createdAt: true, updatedAt: true }))
    .mutation(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();

      // If productId is provided, reduce stock from inventory
      if (input.productId) {
        const product = await db.collection("products").findOne({
          _id: new ObjectId(input.productId),
          organizationId: input.organizationId,
        });

        if (!product) {
          throw new Error("Product not found");
        }

        if (!product.isActive) {
          throw new Error("Product is not active");
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

        // Use product data if not overridden
        input.productCode = input.productCode || product.productCode;
        input.productName = input.productName || product.productName;
        input.price = input.price || product.price;

        // Get user for logging
        const user = input.createdBy
          ? await db.collection("users").findOne({ _id: new ObjectId(input.createdBy) })
          : null;

        // Log product stock reduction
        await logProductActivity({
          db,
          productId: input.productId,
          productCode: product.productCode,
          productName: product.productName,
          action: "reduce_stock",
          previousStock: product.stockQuantity,
          newStock: product.stockQuantity - input.quantity,
          quantityChange: -input.quantity,
          userId: input.createdBy || "system",
          userName: user?.name || "System",
          organizationId: input.organizationId,
          refId: "", // Will be updated after order is created
          notes: `Stock reduced by order for customer: ${input.customerName}`,
        });
      }

      const result = await db.collection("orders").insertOne({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Get user info for logging
      const user = input.createdBy
        ? await db.collection("users").findOne({ _id: new ObjectId(input.createdBy) })
        : null;

      // Log create order activity
      if (user) {
        await logActivity({
          db,
          userId: user._id.toString(),
          userName: user.name,
          activity: "create order",
          refId: result.insertedId.toString(),
          organizationId: input.organizationId,
        });
      }

      return { id: result.insertedId.toString() };
    }),

  // Client order submission - Public endpoint for clients to submit orders
  submitClientOrder: publicProcedure
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

  list: publicProcedure
    .input(z.object({ organizationId: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const client = await client_promise;
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
      const client = await client_promise;
      const db = client.db();

      // Get the current order
      const order = await db.collection("orders").findOne({ _id: new ObjectId(input.id) });
      if (!order) {
        throw new Error("Order not found");
      }

      // If changing to cancelled and order has a productId, restore stock and deduct credits
      if (input.status === "cancelled" && order.status !== "cancelled") {
        // Restore stock if productId exists
        if (order.productId) {
          const product = await db.collection("products").findOne({
            _id: new ObjectId(order.productId),
          });

          if (product) {
            await db.collection("products").updateOne(
              { _id: new ObjectId(order.productId) },
              {
                $inc: { stockQuantity: order.quantity },
                $set: { updatedAt: new Date() },
              }
            );

            // Get user for logging
            const user = order.createdBy
              ? await db.collection("users").findOne({ _id: new ObjectId(order.createdBy) })
              : null;

            // Log product stock restoration
            await logProductActivity({
              db,
              productId: order.productId,
              productCode: product.productCode,
              productName: product.productName,
              action: "add_stock",
              previousStock: product.stockQuantity,
              newStock: product.stockQuantity + order.quantity,
              quantityChange: order.quantity,
              userId: order.createdBy || "system",
              userName: user?.name || "System",
              organizationId: order.organizationId,
              refId: input.id,
              notes: `Stock restored from cancelled order for customer: ${order.customerName}`,
            });
          }
        }

        // Deduct cancellation fee: 10 THB per piece
        const cancellationFee = order.quantity * 10;
        await db.collection("organizations").updateOne(
          { _id: new ObjectId(order.organizationId) },
          {
            $inc: { credits: -cancellationFee },
          }
        );
      }

      // Update order status
      await db.collection("orders").updateOne(
        { _id: new ObjectId(input.id) },
        {
          $set: {
            status: input.status,
            updatedAt: new Date(),
          },
        }
      );

      // Get user info for logging
      const user = order.createdBy
        ? await db.collection("users").findOne({ _id: new ObjectId(order.createdBy) })
        : null;

      // Log update order status activity
      if (user) {
        await logActivity({
          db,
          userId: user._id.toString(),
          userName: user.name,
          activity: `update order status to ${input.status}`,
          refId: input.id,
          organizationId: order.organizationId,
        });
      }

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
      const client = await client_promise;
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
