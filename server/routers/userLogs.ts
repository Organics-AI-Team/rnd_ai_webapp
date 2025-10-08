import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import clientPromise from "@/lib/mongodb";

export const userLogsRouter = router({
  // Get all logs for organization
  list: protectedProcedure
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
      const client = await clientPromise;
      const db = client.db();

      const filter: any = {
        organizationId: ctx.user.organizationId,
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

      const logs = await db
        .collection("user_logs")
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(input?.offset || 0)
        .limit(input?.limit || 100)
        .toArray();

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

  // Get logs for current user
  myLogs: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().positive().optional().default(50),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const client = await clientPromise;
      const db = client.db();

      const logs = await db
        .collection("user_logs")
        .find({ userId: ctx.userId })
        .sort({ createdAt: -1 })
        .limit(input?.limit || 50)
        .toArray();

      return logs.map((log) => ({
        ...log,
        _id: log._id.toString(),
      }));
    }),

  // Get activity summary
  summary: protectedProcedure
    .input(
      z.object({
        startDate: z.string().optional(), // DD/MM/YYYY
        endDate: z.string().optional(), // DD/MM/YYYY
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const client = await clientPromise;
      const db = client.db();

      const filter: any = {
        organizationId: ctx.user.organizationId,
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

  // Clear old logs (admin only)
  clearOldLogs: protectedProcedure
    .input(
      z.object({
        daysOld: z.number().int().positive().default(90),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const client = await clientPromise;
      const db = client.db();

      // Only allow admin role
      if (ctx.user.role !== "admin") {
        throw new Error("Only admins can clear logs");
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - input.daysOld);

      const result = await db.collection("user_logs").deleteMany({
        organizationId: ctx.user.organizationId,
        createdAt: { $lt: cutoffDate },
      });

      return {
        success: true,
        deletedCount: result.deletedCount,
      };
    }),
});
