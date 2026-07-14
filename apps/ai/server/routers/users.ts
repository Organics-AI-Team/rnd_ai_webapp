import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, managerProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { UserSchema } from "@/lib/types";
import { ObjectId, type Db } from "mongodb";

/**
 * Load a user document and assert it belongs to the caller's organization.
 *
 * @param db - Connected database handle.
 * @param user_id - Target user ID from validated input.
 * @param organization_id - Caller's verified tenant ID.
 * @returns The user document.
 * @throws TRPCError NOT_FOUND when absent, FORBIDDEN when cross-tenant.
 */
async function require_same_org_user(
  db: Db,
  user_id: string,
  organization_id: string,
) {
  const user = await db.collection("users").findOne({ _id: new ObjectId(user_id) });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  if (String(user.organizationId) !== organization_id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cross-tenant access is not permitted.",
    });
  }
  return user;
}

/**
 * User router. All operations are scoped to the caller's organization;
 * user administration and credit changes require the manager role.
 */
export const usersRouter = router({
  /**
   * List users in the caller's organization with organization credits.
   */
  list: tenantProcedure("tenant:read").query(async ({ ctx }) => {
    const client = await client_promise;
    const db = client.db();

    const users = await db
      .collection("users")
      .find({ organizationId: ctx.organizationId })
      .sort({ createdAt: -1 })
      .toArray();

    const organization = await db
      .collection("organizations")
      .findOne({ _id: new ObjectId(ctx.organizationId) });

    return users.map((user) => ({
      ...user,
      _id: user._id.toString(),
      credits: organization?.credits || 0,
      organizationName: organization?.name || "Unknown",
    }));
  }),

  /**
   * Get a user by ID within the caller's organization only.
   */
  getById: tenantProcedure("tenant:read")
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();
      const user = await require_same_org_user(db, input.id, ctx.organizationId);
      return {
        ...user,
        _id: user._id.toString(),
      };
    }),

  /**
   * Create a user profile inside the caller's organization. Manager only.
   * organizationId always derives from the principal, never from input.
   */
  create: managerProcedure
    .input(
      UserSchema.omit({
        _id: true,
        organizationId: true,
        createdAt: true,
        updatedAt: true,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      const existingUser = await db.collection("users").findOne({ email: input.email });
      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User with this email already exists",
        });
      }

      const result = await db.collection("users").insertOne({
        ...input,
        organizationId: ctx.organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { id: result.insertedId.toString() };
    }),

  /**
   * Add credits to the organization of a user in the caller's tenant.
   * Manager only; the acting identity derives from the principal.
   */
  addCredits: managerProcedure
    .input(
      z.object({
        userId: z.string(),
        amount: z.number().positive(),
        description: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      const user = await require_same_org_user(db, input.userId, ctx.organizationId);

      const organization = await db.collection("organizations").findOne({
        _id: new ObjectId(ctx.organizationId),
      });
      if (!organization) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const balanceBefore = organization.credits || 0;
      const balanceAfter = balanceBefore + input.amount;

      await db.collection("organizations").updateOne(
        { _id: new ObjectId(ctx.organizationId) },
        {
          $set: {
            credits: balanceAfter,
            updatedAt: new Date(),
          },
        }
      );

      await db.collection("credit_transactions").insertOne({
        organizationId: ctx.organizationId,
        organizationName: organization.name,
        userId: input.userId,
        userName: user.name,
        userEmail: user.email,
        type: "add",
        amount: input.amount,
        balanceBefore,
        balanceAfter,
        description: input.description,
        performedBy: ctx.userId,
        createdAt: new Date(),
      });

      return {
        success: true,
        newBalance: balanceAfter,
      };
    }),

  /**
   * Deduct credits from a user in the caller's tenant. Manager only.
   */
  deductCredits: managerProcedure
    .input(
      z.object({
        userId: z.string(),
        amount: z.number().positive(),
        description: z.string(),
        orderId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      const user = await require_same_org_user(db, input.userId, ctx.organizationId);

      const balanceBefore = user.credits || 0;
      if (balanceBefore < input.amount) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Insufficient credits",
        });
      }

      const balanceAfter = balanceBefore - input.amount;

      await db.collection("users").updateOne(
        { _id: new ObjectId(input.userId) },
        {
          $set: {
            credits: balanceAfter,
            updatedAt: new Date(),
          },
        }
      );

      await db.collection("credit_transactions").insertOne({
        userId: input.userId,
        userName: user.name,
        userEmail: user.email,
        organizationId: ctx.organizationId,
        type: "deduct",
        amount: input.amount,
        balanceBefore,
        balanceAfter,
        description: input.description,
        orderId: input.orderId,
        performedBy: ctx.userId,
        createdAt: new Date(),
      });

      return {
        success: true,
        newBalance: balanceAfter,
      };
    }),

  /**
   * Set the organization credits via a user in the caller's tenant.
   * Manager only.
   */
  adjustCredits: managerProcedure
    .input(
      z.object({
        userId: z.string(),
        newAmount: z.number().nonnegative(),
        description: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();

      const user = await require_same_org_user(db, input.userId, ctx.organizationId);

      const organization = await db.collection("organizations").findOne({
        _id: new ObjectId(ctx.organizationId),
      });
      if (!organization) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const balanceBefore = organization.credits || 0;
      const balanceAfter = input.newAmount;
      const amount = balanceAfter - balanceBefore;

      await db.collection("organizations").updateOne(
        { _id: new ObjectId(ctx.organizationId) },
        {
          $set: {
            credits: balanceAfter,
            updatedAt: new Date(),
          },
        }
      );

      await db.collection("credit_transactions").insertOne({
        organizationId: ctx.organizationId,
        organizationName: organization.name,
        userId: input.userId,
        userName: user.name,
        userEmail: user.email,
        type: "adjust",
        amount,
        balanceBefore,
        balanceAfter,
        description: input.description,
        performedBy: ctx.userId,
        createdAt: new Date(),
      });

      return {
        success: true,
        newBalance: balanceAfter,
      };
    }),

  /**
   * Credit transactions for a user in the caller's tenant.
   */
  getTransactions: tenantProcedure("tenant:read")
    .input(z.object({ userId: z.string() }))
    .query(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();
      await require_same_org_user(db, input.userId, ctx.organizationId);
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

  /**
   * Recent credit transactions in the caller's organization.
   */
  getAllTransactions: tenantProcedure("tenant:read").query(async ({ ctx }) => {
    const client = await client_promise;
    const db = client.db();

    const transactions = await db
      .collection("credit_transactions")
      .find({ organizationId: ctx.organizationId })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return transactions.map((transaction) => ({
      ...transaction,
      _id: transaction._id.toString(),
    }));
  }),
});
