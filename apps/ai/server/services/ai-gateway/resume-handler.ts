/**
 * Run resume handler (G4.9g).
 *
 * The core the `POST /api/ai/runs/[runId]/resume` route calls after resolving
 * the principal: it accepts ONLY a strict clarification response or approval
 * decision (`resume_request_v1_schema`) — never arbitrary graph state — persists
 * the validated payload on the tenant-scoped run for the worker to consume, and
 * enqueues a resume job. The graph is resumed by the private worker, never inside
 * the HTTP request. Tenant scoping is enforced by the run repository: a
 * cross-tenant or missing run raises AIRunNotFoundError before any job is queued.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { resume_request_v1_schema } from "@rnd-ai/shared-types/src/ai/contracts";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import type { AIRunRepository } from "../../repositories/ai-run-repository";
import type { RunJobQueue } from "./run-job-queue";

/** Thrown when the resume payload is not a valid interrupt response. */
export class ResumeRequestInvalidError extends Error {
  /** Stable, client-safe error code. */
  readonly code = "RESUME_REQUEST_INVALID";
  constructor() {
    super("The resume request is not a valid clarification response or approval decision.");
    this.name = "ResumeRequestInvalidError";
  }
}

/** Thrown when the verified caller may not resume the requested run/action. */
export class ResumeForbiddenError extends Error {
  /** Stable, client-safe error code. */
  readonly code = "RESUME_FORBIDDEN";
  constructor() {
    super("You are not permitted to resume this AI run.");
    this.name = "ResumeForbiddenError";
  }
}

/** The accepted-resume result returned to the caller. */
export interface ResumeAccepted {
  readonly run_id: string;
  readonly status: "accepted";
}

/** Injected collaborators for the resume handler. */
export interface ResumeHandlerDeps {
  readonly runs: AIRunRepository;
  readonly jobs: RunJobQueue;
  readonly now: () => Date;
}

/**
 * Validate a resume request, persist it on the run, and enqueue a resume job.
 *
 * @param args - Tenant id, run id, and the untrusted resume payload.
 * @param deps - Run repository, job queue, and clock.
 * @returns The accepted-resume result.
 * @throws ResumeRequestInvalidError when the payload is not a strict
 *         clarification response or approval decision.
 * @throws AIRunNotFoundError when the run is missing or cross-tenant.
 */
export async function submit_resume(
  args: { tenant: TenantExecutionContext; run_id: string; payload: unknown },
  deps: ResumeHandlerDeps,
): Promise<ResumeAccepted> {
  const parsed = resume_request_v1_schema.safeParse(args.payload);
  if (!parsed.success) throw new ResumeRequestInvalidError();

  // get() is tenant-scoped: a missing or cross-tenant run fails before any
  // authorization decision or queue write.
  const run = await deps.runs.get(args.tenant.tenant_id, args.run_id);
  const can_manage =
    args.tenant.tenant_role === "manager" &&
    args.tenant.permissions.includes("formula:confirm");
  if (String(run.actorProfileId ?? "") !== args.tenant.actor_profile_id && !can_manage) {
    throw new ResumeForbiddenError();
  }
  if (parsed.data.kind === "approval" && !can_manage) {
    throw new ResumeForbiddenError();
  }

  const graph_resume = parsed.data.kind === "approval"
    ? {
        approval_id: parsed.data.approval_id,
        decision: parsed.data.decision,
        decided_by_profile_id: args.tenant.actor_profile_id,
      }
    : { answer: parsed.data.answer };

  await deps.runs.mark_status(args.tenant.tenant_id, args.run_id, {
    pendingResume: graph_resume,
    pendingResumeIdempotencyKey: parsed.data.idempotency_key,
  });
  await deps.jobs.enqueue(
    {
      tenant_id: args.tenant.tenant_id,
      run_id: args.run_id,
      command: "resume",
      idempotency_key: parsed.data.idempotency_key,
      resume_payload: graph_resume,
    },
    deps.now(),
  );
  return { run_id: args.run_id, status: "accepted" };
}
