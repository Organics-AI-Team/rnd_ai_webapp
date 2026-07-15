/**
 * Production composition seam for the governed AI run API (G4.9g).
 *
 * Assembles the credential-free collaborators the run routes need from the
 * shared MongoDB client: the tenant-scoped event store (replay/tail), run
 * authorization (tenant-scoped run lookup), and the resume handler (validate +
 * enqueue). Run creation is fronted by a placeholder gateway that surfaces a
 * 503 RUN_API_NOT_WIRED until the concrete policy/context/budget adapters and
 * provider credentials land — the same external gate that blocks the run
 * worker's model execution. Wiring those adapters flips creation on without
 * touching the routes or handlers.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import client_promise from "@rnd-ai/shared-database";
import type { RequestPrincipal, TenantExecutionContext } from "@rnd-ai/shared-types";

import { build_tenant_execution_context } from "../../auth/tenant-execution-context";
import { create_ai_run_repository } from "../../repositories/ai-run-repository";
import type { AIGateway } from "./ai-gateway";
import { create_event_store } from "./event-store";
import { create_run_job_queue } from "./run-job-queue";
import { submit_resume } from "./resume-handler";
import { RunApiNotWiredError, type RunApiCollaborators } from "./run-api-handlers";

/**
 * Placeholder gateway: run creation needs the concrete policy/context/budget
 * adapters and provider credentials (PENDING_EXTERNAL_ROTATION). Until then a
 * create attempt fails closed with a retryable 503 rather than a silent stub.
 */
const NOT_WIRED_GATEWAY: AIGateway = {
  async create_run() {
    throw new RunApiNotWiredError();
  },
};

/**
 * Resolve the run-API collaborators bound to the shared MongoDB database.
 *
 * @returns Collaborators for the create/events/resume handlers.
 */
export async function resolve_run_api_runtime(): Promise<RunApiCollaborators> {
  console.info({ boundary: "run-api", op: "resolve_runtime", phase: "start" });
  const database = (await client_promise).db();
  const runs = create_ai_run_repository(database);
  const jobs = create_run_job_queue(database);
  const events = create_event_store(database);

  return {
    gateway: NOT_WIRED_GATEWAY,
    events,
    authorize_run: async (tenant_id, run_id) => {
      // get() throws AIRunNotFoundError for cross-tenant or missing runs.
      await runs.get(tenant_id, run_id);
    },
    submit_resume: (args) => submit_resume(args, { runs, jobs, now: () => new Date() }),
  };
}

/**
 * Build the frozen per-request tenant execution context from a verified
 * principal, mirroring the tRPC tenant scope. RequestPrincipal carries no
 * provider organization id, so clerk_organization_id is recorded as "" until the
 * Clerk membership projection exposes it.
 *
 * @param principal - Verified request principal with an active membership.
 * @returns The frozen tenant execution context.
 * @throws TenantContextError when the membership cannot scope a tenant.
 */
export function tenant_context_from_principal(
  principal: RequestPrincipal,
): TenantExecutionContext {
  return build_tenant_execution_context(principal, null, {
    clerk_organization_id: "",
    membership_id: null,
  });
}
