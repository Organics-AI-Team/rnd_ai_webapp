import { z } from "zod";
import { router, tenantProcedure, managerProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { legacy_organization_filter } from "./users";

/**
 * User activity log router. Log reads are analytics surfaces gated by
 * tenant:analytics:read; retention cleanup is manager-only. Every query is
 * scoped by ctx.tenant_context.tenant_id — never by client input or ctx.user.
 */
export const userLogsRouter = router({
  /**
   * List activity logs for the caller's tenant with optional user/activity/
   * date-range filters. `userId` is a resource filter within the tenant.
   */
  list: tenantProcedure("tenant:analytics:read")
    .input(
      z.object({
        limit: z.number().int().positive().optional().default(100),
        offset: z.number().int().min(0).optional().default(0),
        userId: z.string().optional(), // Filter by specific user
        activity: z.string().optional(), // Filter by activity type
        startDate: z.string().optional(), // Filter by date range (DD/MM/YYYY)
        endDate: z.string().optional(), // Filter by date range (DD/MM/YYYY)
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const client = await client_promise;
      const db = client.db();

      const filter: any = {
        organizationId: legacy_organization_filter(ctx.tenant_context.tenant_id),
      };

      // Apply filters
      if (input?.userId) {
        filter.userId = input.userId;
      }

      if (input?.activity) {
        filter.activity = { $regex: input.activity, $options: "i" };
      }

      if (input?.startDate || input?.endDate) {
        filter.date = {};
        if (input.startDate) {
          filter.date.$gte = input.startDate;
        }
        if (input.endDate) {
          filter.date.$lte = input.endDate;
        }
      }

      // TODO(G2.6): move into a tenant repository
      const logs = await db
        .collection("user_logs")
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(input?.offset || 0)
        .limit(input?.limit || 100)
        .toArray();

      // TODO(G2.6): move into a tenant repository
      const total = await db.collection("user_logs").countDocuments(filter);

      return {
        logs: logs.map((log) => ({
          ...log,
          _id: log._id.toString(),
        })),
        total,
        hasMore: total > (input?.offset || 0) + (input?.limit || 100),
      };
    }),

  /**
   * Logs of the calling member only, scoped to the caller's tenant and the
   * verified actor profile from the tenant execution context.
   */
  myLogs: tenantProcedure("tenant:analytics:read")
    .input(
      z.object({
        limit: z.number().int().positive().optional().default(50),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const client = await client_promise;
      const db = client.db();

      // TODO(G2.6): move into a tenant repository
      const logs = await db
        .collection("user_logs")
        .find({
          organizationId: legacy_organization_filter(ctx.tenant_context.tenant_id),
          userId: ctx.tenant_context.actor_profile_id,
        })
        .sort({ createdAt: -1 })
        .limit(input?.limit || 50)
        .toArray();

      return logs.map((log) => ({
        ...log,
        _id: log._id.toString(),
      }));
    }),

  /**
   * Activity summary (counts per activity and per user) for the caller's
   * tenant within an optional DD/MM/YYYY date range.
   */
  summary: tenantProcedure("tenant:analytics:read")
    .input(
      z.object({
        startDate: z.string().optional(), // DD/MM/YYYY
        endDate: z.string().optional(), // DD/MM/YYYY
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const client = await client_promise;
      const db = client.db();

      const filter: any = {
        organizationId: legacy_organization_filter(ctx.tenant_context.tenant_id),
      };

      if (input?.startDate || input?.endDate) {
        filter.date = {};
        if (input.startDate) {
          filter.date.$gte = input.startDate;
        }
        if (input.endDate) {
          filter.date.$lte = input.endDate;
        }
      }

      // TODO(G2.6): move into a tenant repository
      const logs = await db.collection("user_logs").find(filter).toArray();

      // Group by activity
      const activityCounts: Record<string, number> = {};
      const userActivity: Record<string, number> = {};

      logs.forEach((log) => {
        activityCounts[log.activity] = (activityCounts[log.activity] || 0) + 1;
        userActivity[log.userName || log.userId] =
          (userActivity[log.userName || log.userId] || 0) + 1;
      });

      return {
        totalLogs: logs.length,
        activityCounts,
        userActivity,
        mostActiveUser: Object.keys(userActivity).reduce((a, b) =>
          userActivity[a] > userActivity[b] ? a : b
        , ""),
        mostCommonActivity: Object.keys(activityCounts).reduce((a, b) =>
          activityCounts[a] > activityCounts[b] ? a : b
        , ""),
      };
    }),

  /**
   * Delete logs older than the given retention window in the caller's
   * tenant. Manager only; the role gate lives in the procedure, not in the
   * handler body.
   */
  clearOldLogs: managerProcedure
    .input(
      z.object({
        daysOld: z.number().int().positive().default(90),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const client = await client_promise;
      const db = client.db();

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - input.daysOld);

      // TODO(G2.6): move into a tenant repository
      const result = await db.collection("user_logs").deleteMany({
        organizationId: legacy_organization_filter(ctx.tenant_context.tenant_id),
        createdAt: { $lt: cutoffDate },
      });

      return {
        success: true,
        deletedCount: result.deletedCount,
      };
    }),
});
