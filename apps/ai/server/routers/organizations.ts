import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import clientPromise from "@/lib/mongodb";
import { CreditTransactionType } from "@/lib/types";
import { ObjectId } from "mongodb";

export const organizationsRouter = router({
  // List all organizations (admin only in production)
  list: publicProcedure.query(async () => {
    const client = await clientPromise;
    const db = client.db();
    const organizations = await db
      .collection("organizations")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    return organizations.map((org) => ({
      ...org,
      _id: org._id.toString(),
    }));
  }),

  // Get organization by ID
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const client = await clientPromise;
      const db = client.db();
      const org = await db.collection("organizations").findOne({ _id: new ObjectId(input.id) });
      if (!org) {
        throw new Error("Organization not found");
      }
      return {
        ...org,
        _id: org._id.toString(),
      };
    }),

  // Add credits to organization
  addCredits: publicProcedure
    .input(
      z.object({
        organizationId: z.string(),
        amount: z.number().positive(),
        description: z.string(),
        performedBy: z.string().optional(),
        performedByName: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const client = await clientPromise;
      const db = client.db();

      const org = await db.collection("organizations").findOne({ _id: new ObjectId(input.organizationId) });
      if (!org) {
        throw new Error("Organization not found");
      }

      const balanceBefore = org.credits || 0;
      const balanceAfter = balanceBefore + input.amount;

      // Update organization credits
      await db.collection("organizations").updateOne(
        { _id: new ObjectId(input.organizationId) },
        {
          $set: {
            credits: balanceAfter,
            updatedAt: new Date(),
          },
        }
      );

      // Log transaction
      await db.collection("credit_transactions").insertOne({
        organizationId: input.organizationId,
        organizationName: org.name,
        type: "add",
        amount: input.amount,
        balanceBefore,
        balanceAfter,
        description: input.description,
        performedBy: input.performedBy,
        performedByName: input.performedByName,
        createdAt: new Date(),
      });

      return {
        success: true,
        newBalance: balanceAfter,
      };
    }),

  // Adjust credits (set to specific amount)
  adjustCredits: publicProcedure
    .input(
      z.object({
        organizationId: z.string(),
        newAmount: z.number().nonnegative(),
        description: z.string(),
        performedBy: z.string().optional(),
        performedByName: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const client = await clientPromise;
      const db = client.db();

      const org = await db.collection("organizations").findOne({ _id: new ObjectId(input.organizationId) });
      if (!org) {
        throw new Error("Organization not found");
      }

      const balanceBefore = org.credits || 0;
      const balanceAfter = input.newAmount;
      const amount = balanceAfter - balanceBefore;

      // Update organization credits
      await db.collection("organizations").updateOne(
        { _id: new ObjectId(input.organizationId) },
        {
          $set: {
            credits: balanceAfter,
            updatedAt: new Date(),
          },
        }
      );

      // Log transaction
      await db.collection("credit_transactions").insertOne({
        organizationId: input.organizationId,
        organizationName: org.name,
        type: "adjust",
        amount,
        balanceBefore,
        balanceAfter,
        description: input.description,
        performedBy: input.performedBy,
        performedByName: input.performedByName,
        createdAt: new Date(),
      });

      return {
        success: true,
        newBalance: balanceAfter,
      };
    }),

  // Get credit transactions for an organization
  getTransactions: publicProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ input }) => {
      const client = await clientPromise;
      const db = client.db();
      const transactions = await db
        .collection("credit_transactions")
        .find({ organizationId: input.organizationId })
        .sort({ createdAt: -1 })
        .toArray();
      return transactions.map((transaction) => ({
        ...transaction,
        _id: transaction._id.toString(),
      }));
    }),

  // Get all credit transactions (for admin)
  getAllTransactions: publicProcedure.query(async () => {
    const client = await clientPromise;
    const db = client.db();
    const transactions = await db
      .collection("credit_transactions")
      .find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return transactions.map((transaction) => ({
      ...transaction,
      _id: transaction._id.toString(),
    }));
  }),
});
