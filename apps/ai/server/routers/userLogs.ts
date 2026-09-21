import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, managerProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { legacy_organization_filter } from "./users";

function escape_regex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parse_log_date(value: string, end_of_day: boolean): Date {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Activity-log date is invalid." });
  }
  const [, day_text, month_text, year_text] = match;
  const day = Number(day_text);
  const month = Number(month_text);
  const year = Number(year_text);
  const date = new Date(
    Date.UTC(year, month - 1, day, end_of_day ? 23 : 0, end_of_day ? 59 : 0, end_of_day ? 59 : 0, end_of_day ? 999 : 0),
  );
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Activity-log date is invalid." });
  }
  return date;
}

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
        limit: z.number().int().min(1).max(200).optional().default(100),
        offset: z.number().int().min(0).optional().default(0),
        userId: z.string().max(128).optional(), // Filter by specific user
        activity: z.string().trim().min(1).max(100).optional(), // Filter by activity type
        startDate: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional(),
        endDate: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional(),
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
        filter.activity = { $regex: escape_regex(input.activity), $options: "i" };
      }

      if (input?.startDate || input?.endDate) {
        filter.createdAt = {};
        if (input.startDate) {
          filter.createdAt.$gte = parse_log_date(input.startDate, false);
        }
        if (input.endDate) {
          filter.createdAt.$lte = parse_log_date(input.endDate, true);
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
        limit: z.number().int().min(1).max(200).optional().default(50),
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
        startDate: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional(),
        endDate: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const client = await client_promise;
      const db = client.db();

      const filter: any = {
        organizationId: legacy_organization_filter(ctx.tenant_context.tenant_id),
      };

      if (input?.startDate || input?.endDate) {
        filter.createdAt = {};
        if (input.startDate) {
          filter.createdAt.$gte = parse_log_date(input.startDate, false);
        }
        if (input.endDate) {
          filter.createdAt.$lte = parse_log_date(input.endDate, true);
        }
      }

      const [summary] = await db.collection("user_logs").aggregate([
        { $match: filter },
        {
          $facet: {
            total: [{ $count: "count" }],
            activities: [{ $group: { _id: "$activity", count: { $sum: 1 } } }],
            users: [{ $group: { _id: { $ifNull: ["$userName", "$userId"] }, count: { $sum: 1 } } }],
          },
        },
      ]).toArray();
      const activityCounts = Object.fromEntries(
        (summary?.activities ?? []).map((entry) => [String(entry._id ?? ""), Number(entry.count)]),
      );
      const userActivity = Object.fromEntries(
        (summary?.users ?? []).map((entry) => [String(entry._id ?? ""), Number(entry.count)]),
      );

      return {
        totalLogs: Number(summary?.total?.[0]?.count ?? 0),
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
