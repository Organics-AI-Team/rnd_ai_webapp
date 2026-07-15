/**
 * Concrete FormulaApprovalGate over ai_approvals (G4.8d-iii wiring).
 *
 * Answers whether a durable, approved AIApproval covers committing a formula
 * artifact. This is a pure tenant-scoped database read — no model, no provider
 * credentials — so it is the sanctioned adapter the gateway injects into
 * FormulaArtifactService.commit_confirmed. A commit proceeds only when an
 * approval for this tenant, run, and artifact is in the "approved" state.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { Db } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import type { FormulaApprovalGate } from "../services/ai-control/formula-artifact-service";

/**
 * Create the ai_approvals-backed approval gate.
 *
 * @param db - Connected MongoDB database.
 * @returns A FormulaApprovalGate that reads approved approvals tenant-scoped.
 */
export function create_ai_approval_gate(db: Db): FormulaApprovalGate {
  const approvals = db.collection("ai_approvals");
  return {
    /**
     * @param query - Tenant, artifact, and run identifying the approval.
     * @param _context - Verified tenant execution context (scope already in query).
     * @returns True when an approved AIApproval covers the commit.
     */
    async has_approved_artifact(
      query: { tenant_id: string; artifact_id: string; run_id: string },
      _context: TenantExecutionContext,
    ): Promise<boolean> {
      const approval = await approvals.findOne({
        tenantId: query.tenant_id,
        runId: query.run_id,
        artifactId: query.artifact_id,
        status: "approved",
      });
      return approval !== null;
    },
  };
}
