/**
 * Formula Version Logs tRPC Router (G2.5).
 * Provides read access to the immutable version audit trail for formulas via
 * ctx.repositories.formulas scoped by ctx.tenant_context (formula:read).
 * Each log entry records who changed the formula (AI or user), what changed,
 * and a snapshot of ingredients at that point in time.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import { z } from "zod";
import { router, tenantProcedure, throw_from_repository_error } from "../trpc";

export const formulaVersionLogsRouter = router({
  /**
   * List all version log entries for a formula, ordered by creation time.
   * Cross-tenant or missing formula IDs surface as NOT_FOUND.
   *
   * @param formulaId - The formula to fetch logs for
   * @returns Array of version log entries with _id as string
   */
  list: tenantProcedure("formula:read")
    .input(z.object({ formulaId: z.string() }))
    .query(async ({ input, ctx }) => {
      console.log("[formula-version-logs] list — start", {
        formulaId: input.formulaId,
        correlationId: ctx.tenant_context.correlation_id,
      });

      try {
        const logs = await ctx.repositories.formulas.list_version_logs(
          ctx.tenant_context,
          input.formulaId,
        );
        const sorted = logs.sort(
          (a, b) =>
            new Date(a.createdAt ?? 0).getTime() -
            new Date(b.createdAt ?? 0).getTime(),
        );

        console.log("[formula-version-logs] list — done", { count: sorted.length });

        return sorted.map((log) => ({
          ...log,
          _id: log._id.toString(),
        }));
      } catch (error) {
        throw_from_repository_error(error);
      }
    }),
});
