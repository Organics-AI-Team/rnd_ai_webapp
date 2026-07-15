/**
 * Private run worker — job processing orchestration (G4.9).
 *
 * `process_one_job` claims one leased job, loads the pinned AIRun, runs (or
 * resumes) the governed graph through an injected `RunExecutor`, appends the
 * produced events, records the run's terminal/interim status, and completes the
 * job — or releases it with a backoff on a handled failure so it is retried. A
 * genuine worker crash runs no cleanup at all; the queue's lease simply expires
 * and another worker reclaims the job, so the run never depends on a single
 * process. The concrete `RunExecutor` rebuilds the trusted runtime ports from the
 * pinned AIRun (model, tools, artifacts, knowledge, approvals, usage) and drives
 * the graph with the MongoDBSaver; it is injected so this orchestration is tested
 * without provider credentials.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { Document, WithId } from "mongodb";
import type { AgentRunEventV1 } from "@rnd-ai/shared-types/src/ai/contracts";

import type { AIRunRepository } from "../../repositories/ai-run-repository";
import type { EventStore } from "./event-store";
import type { ClaimedRunJob, RunJobQueue } from "./run-job-queue";

/** Terminal or interim status a run reaches after one execution turn. */
export type RunTurnStatus =
  | "completed"
  | "failed"
  | "waiting_clarification"
  | "waiting_approval";

/** Result of running or resuming the graph for one job. */
export interface RunExecutionResult {
  readonly status: RunTurnStatus;
  /** Events produced this turn, to append (append-before-send). */
  readonly events: readonly AgentRunEventV1[];
  /** Public usage summary to record on the run (already reconciled by the loop). */
  readonly usage_summary?: unknown;
  /** Safe error code when the status is failed. */
  readonly error_code?: string;
  /** Stage label for an interim (waiting_*) status. */
  readonly current_stage?: string;
}

/** Rebuilds the runtime from a pinned run and drives the governed graph. */
export interface RunExecutor {
  /**
   * @param job - The claimed job (start or resume).
   * @param run - The pinned AIRun document.
   * @returns The turn result: produced events, status, and usage.
   */
  execute(job: ClaimedRunJob, run: WithId<Document>): Promise<RunExecutionResult>;
}

/** Injected collaborators and knobs for the worker. */
export interface RunWorkerDeps {
  readonly jobs: RunJobQueue;
  readonly runs: AIRunRepository;
  readonly events: EventStore;
  readonly executor: RunExecutor;
  readonly worker_id: string;
  readonly now: () => Date;
  readonly lease_ms: number;
  readonly backoff_ms: number;
}

/** Outcome of one processing attempt. */
export interface ProcessOutcome {
  readonly processed: boolean;
  readonly run_id?: string;
  readonly status?: string;
}

/** Non-terminal statuses: the run pauses awaiting a resume job. */
const WAITING_STATUSES: ReadonlySet<RunTurnStatus> = new Set([
  "waiting_clarification",
  "waiting_approval",
]);

/**
 * Build the run status patch from an execution result.
 *
 * @param result - The execution turn result.
 * @param now - Deterministic completion timestamp.
 * @returns The `mark_status` patch.
 */
function status_patch(result: RunExecutionResult, now: Date): Record<string, unknown> {
  if (WAITING_STATUSES.has(result.status)) {
    return { status: result.status, currentStage: result.current_stage ?? null };
  }
  return {
    status: result.status,
    completedAt: now,
    ...(result.usage_summary !== undefined ? { usageSummary: result.usage_summary } : {}),
    ...(result.error_code ? { errorCode: result.error_code } : {}),
  };
}

/**
 * Reduce a thrown value to a short, safe error string for the job's lastError.
 *
 * @param error - The caught value.
 * @returns A bounded safe message.
 */
function safe_error(error: unknown): string {
  const message = error instanceof Error ? error.message : "worker execution failed";
  return message.slice(0, 300);
}

/**
 * Claim and process one job, if any is available.
 *
 * @param deps - Injected queue, repositories, executor, and knobs.
 * @returns Whether a job was processed and the resulting run status.
 */
export async function process_one_job(deps: RunWorkerDeps): Promise<ProcessOutcome> {
  const now = deps.now();
  const job = await deps.jobs.claim({
    worker_id: deps.worker_id,
    now,
    lease_ms: deps.lease_ms,
  });
  if (!job) return { processed: false };

  let run: WithId<Document>;
  try {
    run = await deps.runs.get(job.tenant_id, job.run_id);
  } catch {
    // The run vanished (or is cross-tenant): nothing to execute — retire the job.
    await deps.jobs.complete({ job_id: job.job_id, worker_id: deps.worker_id });
    return { processed: true, run_id: job.run_id, status: "orphaned" };
  }

  try {
    await deps.runs.mark_status(job.tenant_id, job.run_id, { status: "running", startedAt: now });
    const result = await deps.executor.execute(job, run);
    await deps.events.append(
      { tenant_id: job.tenant_id, run_id: job.run_id },
      result.events,
    );
    await deps.runs.mark_status(job.tenant_id, job.run_id, status_patch(result, deps.now()));
    await deps.jobs.complete({ job_id: job.job_id, worker_id: deps.worker_id });
    return { processed: true, run_id: job.run_id, status: result.status };
  } catch (error) {
    // Handled failure: release with a backoff so the job is retried. (A hard
    // crash runs no cleanup; the lease expires and another worker reclaims it.)
    await deps.jobs.release({
      job_id: job.job_id,
      worker_id: deps.worker_id,
      now: deps.now(),
      backoff_ms: deps.backoff_ms,
      error: safe_error(error),
    });
    return { processed: true, run_id: job.run_id, status: "released" };
  }
}
