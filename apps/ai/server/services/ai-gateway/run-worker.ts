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
import type {
  AgentRunEventV1,
  AgentRunOutputV1,
  RunErrorCodeV1,
} from "@rnd-ai/shared-types/src/ai/contracts";
import { run_error_code_v1 } from "@rnd-ai/shared-types/src/ai/contracts";

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
  /** Public terminal output to persist for retrieval and replay. */
  readonly output?: AgentRunOutputV1;
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

/** Optional post-primary shadow hook. It can never alter the primary result. */
export interface ShadowAfterPrimaryPort {
  run_after_primary(args: {
    readonly run: WithId<Document>;
    readonly result: RunExecutionResult;
  }): Promise<unknown>;
}

/** Injected collaborators and knobs for the worker. */
export interface RunWorkerDeps {
  readonly jobs: RunJobQueue;
  readonly runs: AIRunRepository;
  readonly events: EventStore;
  readonly executor: RunExecutor;
  readonly shadow?: ShadowAfterPrimaryPort;
  readonly worker_id: string;
  readonly now: () => Date;
  readonly lease_ms: number;
  /** Lease-renew cadence; defaults to one third of the lease duration. */
  readonly heartbeat_interval_ms?: number;
  readonly backoff_ms: number;
  /** Total worker attempts before a retryable poison job is retired. */
  readonly max_attempts?: number;
  /** Upper bound for exponential retry delay. */
  readonly max_backoff_ms?: number;
  /** Deterministic [0,1] source used only to jitter retry delays. */
  readonly retry_jitter?: () => number;
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
    ...(result.output !== undefined ? { output: result.output } : {}),
    ...(result.error_code ? { errorCode: result.error_code } : {}),
  };
}

/**
 * Reduce a thrown value to a short, safe error string for the job's lastError.
 *
 * @param error - The caught value.
 * @returns A bounded safe message.
 */
function safe_error_code(error: unknown): string {
  const code =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "WORKER_EXECUTION_FAILED";
  return /^[A-Z][A-Z0-9_]{1,79}$/.test(code) ? code : "WORKER_EXECUTION_FAILED";
}

/** Only explicitly classified dependency failures may be replayed. */
function is_retryable(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as { retryable?: unknown }).retryable === true,
  );
}

/** Bounded exponential backoff with an injected, deterministic jitter source. */
function retry_backoff_ms(deps: RunWorkerDeps, attempts: number): number {
  const maximum = deps.max_backoff_ms ?? 60_000;
  const exponent = Math.max(0, Math.min(20, attempts - 1));
  const unjittered = Math.min(maximum, deps.backoff_ms * (2 ** exponent));
  const source = deps.retry_jitter;
  if (!source) return unjittered;
  const sample = source();
  const bounded_sample = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
  return Math.max(1, Math.round(unjittered * (0.8 + bounded_sample * 0.4)));
}

/** Renew one claimed lease while its executor turn is in flight. */
function start_lease_heartbeat(
  deps: RunWorkerDeps,
  job: ClaimedRunJob,
): { stop(): Promise<boolean> } {
  const interval_ms =
    deps.heartbeat_interval_ms ?? Math.max(1_000, Math.floor(deps.lease_ms / 3));
  let lease_owned = true;
  let running = false;
  let in_flight: Promise<void> = Promise.resolve();
  let stopped = false;
  const timer = setInterval(() => {
    if (running || stopped || !lease_owned) return;
    running = true;
    in_flight = deps.jobs
      .heartbeat({
        job_id: job.job_id,
        worker_id: deps.worker_id,
        now: deps.now(),
        lease_ms: deps.lease_ms,
      })
      .then((renewed) => {
        if (!renewed) lease_owned = false;
      })
      .catch(() => {
        lease_owned = false;
      })
      .finally(() => {
        running = false;
      });
  }, interval_ms);
  if (typeof timer === "object" && "unref" in timer) timer.unref();

  return {
    async stop() {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
      }
      await in_flight;
      return lease_owned;
    },
  };
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
    const heartbeat = start_lease_heartbeat(deps, job);
    await deps.runs.mark_status(job.tenant_id, job.run_id, { status: "running", startedAt: now });
    let result: RunExecutionResult;
    try {
      result = await deps.executor.execute(job, run);
    } catch (error) {
      await heartbeat.stop();
      throw error;
    }
    if (!(await heartbeat.stop())) {
      // Another worker owns the lease now. It will resume from the durable
      // checkpoint; this worker must not append or acknowledge anything.
      return { processed: true, run_id: job.run_id, status: "lease_lost" };
    }
    await deps.events.append(
      { tenant_id: job.tenant_id, run_id: job.run_id },
      result.events,
    );
    await deps.runs.mark_status(job.tenant_id, job.run_id, status_patch(result, deps.now()));
    await deps.jobs.complete({ job_id: job.job_id, worker_id: deps.worker_id });
    // Shadow work starts only after the primary events/status and queue ack are
    // durable. Its failure is intentionally isolated from the accepted result.
    if (result.status === "completed" && deps.shadow) {
      const completed_run = {
        ...run,
        status: result.status,
        ...(result.output !== undefined ? { output: result.output } : {}),
      } as WithId<Document>;
      await deps.shadow.run_after_primary({ run: completed_run, result }).catch(() => undefined);
    }
    return { processed: true, run_id: job.run_id, status: result.status };
  } catch (error) {
    const error_code = safe_error_code(error);
    const max_attempts = deps.max_attempts ?? 5;
    if (is_retryable(error) && job.attempts < max_attempts) {
      // Only an explicitly retryable dependency failure is released. A hard
      // crash still performs no cleanup; its lease expires naturally.
      await deps.jobs.release({
        job_id: job.job_id,
        worker_id: deps.worker_id,
        now: deps.now(),
        backoff_ms: retry_backoff_ms(deps, job.attempts),
        error: error_code,
      });
      return { processed: true, run_id: job.run_id, status: "released" };
    }

    const failed_at = deps.now();
    await deps.runs.mark_status(job.tenant_id, job.run_id, {
      status: "failed",
      completedAt: failed_at,
      errorCode: error_code,
    });
    // A terminally failed job must still emit run.failed — without it, SSE
    // consumers wait forever (observed: MODEL_PROVIDER_ERROR run with zero
    // events; the UI hung with no terminal signal).
    await append_terminal_failure_event(deps, job, error_code, failed_at);
    await deps.jobs.fail({
      job_id: job.job_id,
      worker_id: deps.worker_id,
      now: failed_at,
      error: error_code,
    });
    return { processed: true, run_id: job.run_id, status: "failed" };
  }
}

/**
 * Map an internal job error code onto the public run-error enum.
 *
 * @param code - Internal code from safe_error_code (e.g. MODEL_PROVIDER_ERROR).
 * @returns A valid RunErrorCodeV1 (unknown codes become PROVIDER_UNAVAILABLE —
 *          honest for dependency failures without leaking internals).
 */
function public_error_code(code: string): RunErrorCodeV1 {
  const parsed = run_error_code_v1.safeParse(code);
  return parsed.success ? parsed.data : "PROVIDER_UNAVAILABLE";
}

/**
 * Append the terminal run.failed event after retries are exhausted.
 *
 * Best-effort by design: event persistence must never mask the terminal
 * failure bookkeeping (run status + job fail) that already happened.
 *
 * @param deps - Worker dependencies (event store, clock).
 * @param job - The claimed job whose run terminally failed.
 * @param error_code - Internal error code recorded on the run/job.
 * @param failed_at - Terminal failure timestamp.
 */
async function append_terminal_failure_event(
  deps: RunWorkerDeps,
  job: ClaimedRunJob,
  error_code: string,
  failed_at: Date,
): Promise<void> {
  try {
    const ref = { tenant_id: job.tenant_id, run_id: job.run_id };
    const next_sequence = (await deps.events.latest_sequence(ref)) + 1;
    await deps.events.append(ref, [
      {
        schema_version: "1",
        event_id: `terminal-failure-${job.run_id}-${next_sequence}`,
        run_id: job.run_id,
        sequence: next_sequence,
        occurred_at: failed_at.toISOString(),
        type: "run.failed",
        payload: {
          code: public_error_code(error_code),
          safe_message: "The AI run could not be completed.",
          retryable: false,
        },
      },
    ]);
  } catch {
    console.error({
      boundary: "ai-worker",
      event: "terminal_event_append_failed",
      run_id: job.run_id,
    });
  }
}
