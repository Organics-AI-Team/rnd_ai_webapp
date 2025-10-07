import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import clientPromise from "@/lib/mongodb";
import { UserSchema, CreditTransactionSchema, CreditTransactionType } from "@/lib/types";
import { ObjectId } from "mongodb";

export const usersRouter = router({
  // List all users
  list: publicProcedure.query(async () => {
    const client = await clientPromise;
    const db = client.db();
    const users = await db
      .collection("users")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    return users.map((user) => ({
      ...user,
      _id: user._id.toString(),
    }));
  }),

  // Get user by ID
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const client = await clientPromise;
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
      const client = await clientPromise;
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

  // Add credits to user
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
      const client = await clientPromise;
      const db = client.db();

      const user = await db.collection("users").findOne({ _id: new ObjectId(input.userId) });
      if (!user) {
        throw new Error("User not found");
      }

      const balanceBefore = user.credits || 0;
      const balanceAfter = balanceBefore + input.amount;

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
      const client = await clientPromise;
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

  // Adjust credits (can be positive or negative)
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
      const client = await clientPromise;
      const db = client.db();

      const user = await db.collection("users").findOne({ _id: new ObjectId(input.userId) });
      if (!user) {
        throw new Error("User not found");
      }

      const balanceBefore = user.credits || 0;
      const balanceAfter = input.newAmount;
      const amount = balanceAfter - balanceBefore;

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
      const client = await clientPromise;
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
