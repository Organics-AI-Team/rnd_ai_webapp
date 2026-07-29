/** Exact executor dispatch for rollout/canary pins stored on AIRun. */

import type { RunExecutor } from "./run-worker";

export class PinnedExecutorMismatchError extends Error {
  readonly code = "PINNED_EXECUTOR_MISMATCH";
  readonly retryable = false;
  constructor() {
    super("The run's pinned executor is unsupported or inconsistent.");
    this.name = "PinnedExecutorMismatchError";
  }
}

export interface PinnedRunExecutorDeps {
  readonly agentic: RunExecutor;
  readonly legacy: RunExecutor;
}

/** Dispatch once by the immutable run.executor value; never try the other path. */
export function create_pinned_run_executor(deps: PinnedRunExecutorDeps): RunExecutor {
  return {
    async execute(job, run) {
      if (
        job.run_id !== String(run._id) ||
        job.tenant_id !== String(run.tenantId)
      ) {
        throw new PinnedExecutorMismatchError();
      }
      if (run.executor === "agentic") return deps.agentic.execute(job, run);
      if (run.executor === "legacy") return deps.legacy.execute(job, run);
      throw new PinnedExecutorMismatchError();
    },
  };
}
