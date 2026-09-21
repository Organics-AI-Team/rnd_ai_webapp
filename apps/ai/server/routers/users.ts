import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, managerProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { UserSchema } from "@/lib/types";
import { ObjectId, type Db, type Document } from "mongodb";
import { InsufficientCreditsError, mutate_credit_balance } from "../services/credit-ledger";

/**
 * Build the tenant filter value for the legacy `organizationId` field.
 *
 * Legacy documents store the tenant reference as an ObjectId while rows
 * written by these routers historically stored plain strings, so reads must
 * match both encodings. The value derives exclusively from the verified
 * tenant execution context — never from input or ctx.user.
 *
 * @param tenant_id - Verified tenant ID from ctx.tenant_context.tenant_id.
 * @returns Mongo `$in` fragment matching both stored encodings.
 */
export function legacy_organization_filter(
  tenant_id: string,
): { $in: (string | ObjectId)[] } {
  const values: (string | ObjectId)[] = [tenant_id];
  if (ObjectId.isValid(tenant_id)) {
    values.push(new ObjectId(tenant_id));
  }
  return { $in: values };
}

/**
 * Load the caller's own organization document, or null when the tenant ID is
 * not ObjectId-shaped or no document exists.
 *
 * @param db - Connected database handle.
 * @param tenant_id - Verified tenant ID from ctx.tenant_context.tenant_id.
 * @returns The organization document, or null.
 */
export async function find_tenant_organization(
  db: Db,
  tenant_id: string,
): Promise<Document | null> {
  if (!ObjectId.isValid(tenant_id)) return null;
  const tenant = await db.collection("tenants").findOne({
    _id: new ObjectId(tenant_id),
  });
  if (tenant) {
    return {
      ...tenant,
      credits: Number(tenant.creditBalance ?? tenant.credits ?? 0),
      __creditAccountCollection: "tenants",
    };
  }
  return db.collection("organizations").findOne({ _id: new ObjectId(tenant_id) });
}

/**
 * Load the caller's own organization document or fail closed.
 *
 * @param db - Connected database handle.
 * @param tenant_id - Verified tenant ID from ctx.tenant_context.tenant_id.
 * @returns The organization document.
 * @throws TRPCError NOT_FOUND when the tenant has no organization document.
 */
export async function require_tenant_organization(
  db: Db,
  tenant_id: string,
): Promise<Document> {
  const organization = await find_tenant_organization(db, tenant_id);
  if (!organization) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  }
  return organization;
}

/**
 * Load a user document and assert it belongs to the caller's tenant.
 * Missing and cross-tenant IDs are indistinguishable: both are NOT_FOUND.
 *
 * @param db - Connected database handle.
 * @param user_id - Target user ID from validated input (resource ID).
 * @param tenant_id - Verified tenant ID from ctx.tenant_context.tenant_id.
 * @returns The user document.
 * @throws TRPCError NOT_FOUND when absent or owned by another tenant.
 */
async function require_same_tenant_user(
  db: Db,
  user_id: string,
  tenant_id: string,
): Promise<Document> {
  const not_found = new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  if (!ObjectId.isValid(user_id)) throw not_found;
  // TODO(G2.6): move into a tenant repository
  const user = await db.collection("users").findOne({
    _id: new ObjectId(user_id),
    organizationId: legacy_organization_filter(tenant_id),
  });
  if (user) return user;
  const membership = await db.collection("tenant_membership_projections").findOne({
    tenantId: tenant_id,
    userProfileId: user_id,
    status: { $ne: "revoked" },
  });
  if (!membership) throw not_found;
  const profile = await db.collection("user_profiles").findOne({
    _id: new ObjectId(user_id),
  });
  if (!profile) throw not_found;
  return {
    ...profile,
    name: profile.displayName ?? profile.name ?? "",
    email: profile.primaryEmail ?? profile.email ?? "",
    organizationId: tenant_id,
  };
}

/**
 * User router. Every operation is scoped by ctx.tenant_context.tenant_id.
 * Member reads require tenant:members:read, profile creation requires
 * tenant:members:invite_user, transaction reads require
 * tenant:analytics:read, and credit changes stay manager-only until a
 * fine-grained credit permission exists in the catalogue.
 */
export const usersRouter = router({
  /**
   * List users in the caller's tenant with organization credits.
   */
  list: tenantProcedure("tenant:members:read").query(async ({ ctx }) => {
    const client = await client_promise;
    const db = client.db();
    const tenant_id = ctx.tenant_context.tenant_id;

    // TODO(G2.6): move into a tenant repository
    const legacy_users = await db
      .collection("users")
      .find({ organizationId: legacy_organization_filter(tenant_id) })
      .sort({ createdAt: -1 })
      .toArray();

    const memberships = await db
      .collection("tenant_membership_projections")
      .find({ tenantId: tenant_id, status: { $ne: "revoked" } })
      .toArray();
    const profile_ids = memberships
      .map((membership) => String(membership.userProfileId))
      .filter(ObjectId.isValid)
      .map((id) => new ObjectId(id));
    const profiles = profile_ids.length > 0
      ? await db.collection("user_profiles").find({ _id: { $in: profile_ids } }).toArray()
      : [];
    const modern_users = profiles.map((profile) => ({
      ...profile,
      name: profile.displayName ?? profile.name ?? "",
      email: profile.primaryEmail ?? profile.email ?? "",
    }));
    const users = modern_users.length > 0 ? modern_users : legacy_users;
    const organization = await find_tenant_organization(db, tenant_id);

    return users.map((user) => ({
      ...user,
      _id: user._id.toString(),
      credits: organization?.credits || 0,
      organizationName: organization?.name || "Unknown",
    }));
  }),

  /**
   * Get a user by ID within the caller's tenant only.
   */
  getById: tenantProcedure("tenant:members:read")
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();
      const user = await require_same_tenant_user(
        db,
        input.id,
        ctx.tenant_context.tenant_id,
      );
      return {
        ...user,
        _id: user._id.toString(),
      };
    }),

  /**
   * Create a user profile inside the caller's tenant. organizationId always
   * derives from the tenant execution context, never from input.
   */
  create: tenantProcedure("tenant:members:invite_user")
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

      // TODO(G2.6): move into a tenant repository
      const existingUser = await db.collection("users").findOne({ email: input.email });
      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User with this email already exists",
        });
      }

      // TODO(G2.6): move into a tenant repository
      const result = await db.collection("users").insertOne({
        ...input,
        organizationId: ctx.tenant_context.tenant_id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { id: result.insertedId.toString() };
    }),

  /**
   * Add credits to the organization of a user in the caller's tenant.
   * Manager only; the acting identity derives from the tenant context.
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
      const tenant_id = ctx.tenant_context.tenant_id;

      const user = await require_same_tenant_user(db, input.userId, tenant_id);
      const organization = await require_tenant_organization(db, tenant_id);

      const result = await mutate_credit_balance(client, {
        tenant_id,
        type: "add",
        amount: input.amount,
        transaction: {
        organizationName: organization.name,
        userId: input.userId,
        userName: user.name,
        userEmail: user.email,
        description: input.description,
        performedBy: ctx.tenant_context.actor_profile_id,
        },
      });

      return {
        success: true,
        newBalance: result.balance_after,
      };
    }),

  /**
   * Deduct credits from the tenant account, attributing the transaction to a
   * user in that tenant. Manager only.
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
      const tenant_id = ctx.tenant_context.tenant_id;

      const user = await require_same_tenant_user(db, input.userId, tenant_id);
      const organization = await require_tenant_organization(db, tenant_id);
      let result;
      try {
        result = await mutate_credit_balance(client, {
          tenant_id,
          type: "deduct",
          amount: input.amount,
          transaction: {
        userId: input.userId,
        userName: user.name,
        userEmail: user.email,
        organizationName: organization.name,
        description: input.description,
        orderId: input.orderId,
        performedBy: ctx.tenant_context.actor_profile_id,
          },
        });
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Insufficient credits" });
        }
        throw error;
      }

      return {
        success: true,
        newBalance: result.balance_after,
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
      const tenant_id = ctx.tenant_context.tenant_id;

      const user = await require_same_tenant_user(db, input.userId, tenant_id);
      const organization = await require_tenant_organization(db, tenant_id);

      const result = await mutate_credit_balance(client, {
        tenant_id,
        type: "adjust",
        new_balance: input.newAmount,
        transaction: {
        organizationName: organization.name,
        userId: input.userId,
        userName: user.name,
        userEmail: user.email,
        description: input.description,
        performedBy: ctx.tenant_context.actor_profile_id,
        },
      });

      return {
        success: true,
        newBalance: result.balance_after,
      };
    }),

  /**
   * Credit transactions for a user in the caller's tenant.
   */
  getTransactions: tenantProcedure("tenant:analytics:read")
    .input(z.object({ userId: z.string() }))
    .query(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();
      await require_same_tenant_user(db, input.userId, ctx.tenant_context.tenant_id);
      // TODO(G2.6): move into a tenant repository
      const transactions = await db
        .collection("credit_transactions")
        .find({
          userId: input.userId,
          organizationId: legacy_organization_filter(ctx.tenant_context.tenant_id),
        })
        .sort({ createdAt: -1 })
        .toArray();
      return transactions.map((transaction) => ({
        ...transaction,
        _id: transaction._id.toString(),
      }));
    }),

  /**
   * Recent credit transactions in the caller's tenant.
   */
  getAllTransactions: tenantProcedure("tenant:analytics:read").query(
    async ({ ctx }) => {
      const client = await client_promise;
      const db = client.db();

      // TODO(G2.6): move into a tenant repository
      const transactions = await db
        .collection("credit_transactions")
        .find({
          organizationId: legacy_organization_filter(ctx.tenant_context.tenant_id),
        })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      return transactions.map((transaction) => ({
        ...transaction,
        _id: transaction._id.toString(),
      }));
    },
  ),
});
