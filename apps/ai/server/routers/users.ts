import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { UserSchema, CreditTransactionSchema, CreditTransactionType } from "@/lib/types";
import { ObjectId } from "mongodb";

export const usersRouter = router({
  // List all users with their organization credits (filtered by user's organization)
  list: publicProcedure.query(async ({ ctx }) => {
    const client = await client_promise;
    const db = client.db();

    const filter: any = {};

    // Filter by logged-in user's organization
    if (ctx.organizationId) {
      filter.organizationId = ctx.organizationId;
    }

    const users = await db
      .collection("users")
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    // Enrich users with organization data
    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        const organization = await db
          .collection("organizations")
          .findOne({ _id: new ObjectId(user.organizationId) });

        return {
          ...user,
          _id: user._id.toString(),
          credits: organization?.credits || 0,
          organizationName: organization?.name || "Unknown",
        };
      })
    );

    return enrichedUsers;
  }),

  // Get user by ID
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();
      const user = await db.collection("users").findOne({ _id: new ObjectId(input.id) });
      if (!user) {
        throw new Error("User not found");
      }
      return {
        ...user,
        _id: user._id.toString(),
      };
    }),

  // Create user
  create: publicProcedure
    .input(UserSchema.omit({ _id: true, createdAt: true, updatedAt: true }))
    .mutation(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();

      // Check if user already exists
      const existingUser = await db.collection("users").findOne({ email: input.email });
      if (existingUser) {
        throw new Error("User with this email already exists");
      }

      const result = await db.collection("users").insertOne({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { id: result.insertedId.toString() };
    }),

  // Add credits to organization
  addCredits: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        amount: z.number().positive(),
        description: z.string(),
        performedBy: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();

      const user = await db.collection("users").findOne({ _id: new ObjectId(input.userId) });
      if (!user) {
        throw new Error("User not found");
      }

      const organization = await db.collection("organizations").findOne({
        _id: new ObjectId(user.organizationId)
      });
      if (!organization) {
        throw new Error("Organization not found");
      }

      const balanceBefore = organization.credits || 0;
      const balanceAfter = balanceBefore + input.amount;

      // Update organization credits
      await db.collection("organizations").updateOne(
        { _id: new ObjectId(user.organizationId) },
        {
          $set: {
            credits: balanceAfter,
            updatedAt: new Date(),
          },
        }
      );

      // Log transaction
      await db.collection("credit_transactions").insertOne({
        organizationId: user.organizationId,
        organizationName: organization.name,
        userId: input.userId,
        userName: user.name,
        userEmail: user.email,
        type: "add",
        amount: input.amount,
        balanceBefore,
        balanceAfter,
        description: input.description,
        performedBy: input.performedBy,
        createdAt: new Date(),
      });

      return {
        success: true,
        newBalance: balanceAfter,
      };
    }),

  // Deduct credits from user
  deductCredits: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        amount: z.number().positive(),
        description: z.string(),
        orderId: z.string().optional(),
        performedBy: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();

      const user = await db.collection("users").findOne({ _id: new ObjectId(input.userId) });
      if (!user) {
        throw new Error("User not found");
      }

      const balanceBefore = user.credits || 0;
      if (balanceBefore < input.amount) {
        throw new Error("Insufficient credits");
      }

      const balanceAfter = balanceBefore - input.amount;

      // Update user credits
      await db.collection("users").updateOne(
        { _id: new ObjectId(input.userId) },
        {
          $set: {
            credits: balanceAfter,
            updatedAt: new Date(),
          },
        }
      );

      // Log transaction
      await db.collection("credit_transactions").insertOne({
        userId: input.userId,
        userName: user.name,
        userEmail: user.email,
        type: "deduct",
        amount: input.amount,
        balanceBefore,
        balanceAfter,
        description: input.description,
        orderId: input.orderId,
        performedBy: input.performedBy,
        createdAt: new Date(),
      });

      return {
        success: true,
        newBalance: balanceAfter,
      };
    }),

  // Adjust organization credits (can be positive or negative)
  adjustCredits: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        newAmount: z.number().nonnegative(),
        description: z.string(),
        performedBy: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();

      const user = await db.collection("users").findOne({ _id: new ObjectId(input.userId) });
      if (!user) {
        throw new Error("User not found");
      }

      const organization = await db.collection("organizations").findOne({
        _id: new ObjectId(user.organizationId)
      });
      if (!organization) {
        throw new Error("Organization not found");
      }

      const balanceBefore = organization.credits || 0;
      const balanceAfter = input.newAmount;
      const amount = balanceAfter - balanceBefore;

      // Update organization credits
      await db.collection("organizations").updateOne(
        { _id: new ObjectId(user.organizationId) },
        {
          $set: {
            credits: balanceAfter,
            updatedAt: new Date(),
          },
        }
      );

      // Log transaction
      await db.collection("credit_transactions").insertOne({
        organizationId: user.organizationId,
        organizationName: organization.name,
        userId: input.userId,
        userName: user.name,
        userEmail: user.email,
        type: "adjust",
        amount,
        balanceBefore,
        balanceAfter,
        description: input.description,
        performedBy: input.performedBy,
        createdAt: new Date(),
      });

      return {
        success: true,
        newBalance: balanceAfter,
      };
    }),

  // Get credit transactions for a user
  getTransactions: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      const client = await client_promise;
      const db = client.db();
      const transactions = await db
        .collection("credit_transactions")
        .find({ userId: input.userId })
        .sort({ createdAt: -1 })
        .toArray();
      return transactions.map((transaction) => ({
        ...transaction,
        _id: transaction._id.toString(),
      }));
    }),

  // Get all credit transactions (filtered by user's organization)
  getAllTransactions: publicProcedure.query(async ({ ctx }) => {
    const client = await client_promise;
    const db = client.db();

    const filter: any = {};

    // Filter by logged-in user's organization
    if (ctx.organizationId) {
      filter.organizationId = ctx.organizationId;
    }

    const transactions = await db
      .collection("credit_transactions")
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return transactions.map((transaction) => ({
      ...transaction,
      _id: transaction._id.toString(),
    }));
  }),
});
