import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, tenantMemberProcedure, managerProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { ObjectId } from "mongodb";
import {
  find_tenant_organization,
  legacy_organization_filter,
  require_tenant_organization,
} from "./users";

/**
 * Organization (university) router. Every procedure is scoped to
 * ctx.tenant_context.tenant_id: reads return only the caller's own tenant,
 * arbitrary organization lookup and organization creation do not exist, and
 * credit mutations require the manager role.
 */
export const organizationsRouter = router({
  /**
   * List the caller's organization. The legacy anonymous "list all
   * organizations" behavior is removed; the response stays an array for
   * client compatibility but contains only the caller's tenant.
   */
  list: tenantMemberProcedure.query(async ({ ctx }) => {
    const client = await client_promise;
    const db = client.db();
    const org = await find_tenant_organization(db, ctx.tenant_context.tenant_id);
    if (!org) return [];
    return [{ ...org, _id: org._id.toString() }];
  }),

  /**
   * Get an organization by ID — permitted only for the caller's own tenant.
   * Any other ID is indistinguishable from a missing one: NOT_FOUND.
   */
  getById: tenantMemberProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      if (input.id !== ctx.tenant_context.tenant_id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }
      const client = await client_promise;
      const db = client.db();
      const org = await require_tenant_organization(
        db,
        ctx.tenant_context.tenant_id,
      );
      return {
        ...org,
        _id: org._id.toString(),
      };
    }),

  /**
   * Add credits to the caller's own organization. Manager only; the target
   * organization and the acting identity derive from the tenant context.
   */
  addCredits: managerProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        description: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();
      const tenant_id = ctx.tenant_context.tenant_id;

      const org = await require_tenant_organization(db, tenant_id);

      const balanceBefore = org.credits || 0;
      const balanceAfter = balanceBefore + input.amount;

      // TODO(G2.6): move into a tenant repository
      await db.collection("organizations").updateOne(
        { _id: new ObjectId(tenant_id) },
        {
          $set: {
            credits: balanceAfter,
            updatedAt: new Date(),
          },
        }
      );

      // TODO(G2.6): move into a tenant repository
      await db.collection("credit_transactions").insertOne({
        organizationId: tenant_id,
        organizationName: org.name,
        type: "add",
        amount: input.amount,
        balanceBefore,
        balanceAfter,
        description: input.description,
        performedBy: ctx.tenant_context.actor_profile_id,
        performedByName: ctx.user.name,
        createdAt: new Date(),
      });

      return {
        success: true,
        newBalance: balanceAfter,
      };
    }),

  /**
   * Set the caller's own organization credits to a specific amount.
   * Manager only; identity fields derive from the tenant context.
   */
  adjustCredits: managerProcedure
    .input(
      z.object({
        newAmount: z.number().nonnegative(),
        description: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const client = await client_promise;
      const db = client.db();
      const tenant_id = ctx.tenant_context.tenant_id;

      const org = await require_tenant_organization(db, tenant_id);

      const balanceBefore = org.credits || 0;
      const balanceAfter = input.newAmount;
      const amount = balanceAfter - balanceBefore;

      // TODO(G2.6): move into a tenant repository
      await db.collection("organizations").updateOne(
        { _id: new ObjectId(tenant_id) },
        {
          $set: {
            credits: balanceAfter,
            updatedAt: new Date(),
          },
        }
      );

      // TODO(G2.6): move into a tenant repository
      await db.collection("credit_transactions").insertOne({
        organizationId: tenant_id,
        organizationName: org.name,
        type: "adjust",
        amount,
        balanceBefore,
        balanceAfter,
        description: input.description,
        performedBy: ctx.tenant_context.actor_profile_id,
        performedByName: ctx.user.name,
        createdAt: new Date(),
      });

      return {
        success: true,
        newBalance: balanceAfter,
      };
    }),

  /**
   * Credit transactions for the caller's own organization only.
   */
  getTransactions: tenantProcedure("tenant:analytics:read").query(
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
        .toArray();
      return transactions.map((transaction) => ({
        ...transaction,
        _id: transaction._id.toString(),
      }));
    },
  ),

  /**
   * Recent credit transactions, scoped to the caller's organization.
   * The legacy anonymous all-tenants view is removed.
   */
  getAllTransactions: managerProcedure.query(async ({ ctx }) => {
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
  }),
});
