/**
 * Formula Version Logs tRPC Router
 * Provides read access to the immutable version audit trail for formulas.
 * Each log entry records who changed the formula (AI or user), what changed,
 * and a snapshot of ingredients at that point in time.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { logActivity } from "@/lib/userLog";

export const formulaVersionLogsRouter = router({
  /**
   * List all version log entries for a formula, ordered by creation time.
   *
   * @param formulaId - The formula to fetch logs for
   * @returns Array of version log entries with _id as string
   */
  list: protectedProcedure
    .input(z.object({ formulaId: z.string() }))
    .query(async ({ input }) => {
      console.log("[formula-version-logs] list — start", { formulaId: input.formulaId });

      const client = await client_promise;
      const db = client.db();

      const logs = await db
        .collection("formula_version_logs")
        .find({ formulaId: input.formulaId })
        .sort({ createdAt: 1 })
        .toArray();

      console.log("[formula-version-logs] list — done", { count: logs.length });

      return logs.map((log) => ({
        ...log,
        _id: log._id.toString(),
      }));
    }),
});
