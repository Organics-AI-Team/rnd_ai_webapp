/**
 * Durable run resume flow (G4.7).
 *
 * A resume never trusts a client-supplied checkpoint blob. It re-resolves the
 * trusted context, loads the run, verifies the caller owns the tenant (or holds
 * manager permission) and that every pinned version is still available, then
 * invokes the compiled graph with the resume Command against the durable
 * thread. The checkpointer restores the interrupted state; only the resume
 * VALUE crosses the boundary.
 */

import { Command } from "@langchain/langgraph";
import type { RunPinsV1 } from "./contracts";
import type { TrustedRuntimeContext } from "./ports";
import { build_thread_config } from "./checkpoint";

/** Stable resume failure codes. */
export type ResumeErrorCode =
  | "RESUME_RUN_NOT_FOUND"
  | "RESUME_TENANT_MISMATCH"
  | "RESUME_FORBIDDEN"
  | "RESUME_VERSION_UNAVAILABLE";

/** Typed resume failure. */
export class ResumeError extends Error {
  public readonly code: ResumeErrorCode;
  /**
   * @param code - Stable failure code.
   * @param message - Safe description.
   */
  constructor(code: ResumeErrorCode, message: string) {
    super(message);
    this.name = "ResumeError";
    this.code = code;
  }
}

/** A loaded run record needed to authorize and validate a resume. */
export interface ResumableRun {
  readonly run_id: string;
  readonly tenant_id: string;
  readonly thread_id: string;
  readonly pins: RunPinsV1;
}

/** Injected dependencies for the resume flow. */
export interface ResumeDeps {
  /** Load the run record (already tenant-scoped where possible). */
  load_run(run_id: string, context: TrustedRuntimeContext): Promise<ResumableRun | null>;
  /** Whether the caller may resume this run (owner or manager permission). */
  can_resume(run: ResumableRun, context: TrustedRuntimeContext): boolean;
  /** Whether every pinned version is still available/supported. */
  verify_pins(pins: RunPinsV1): Promise<boolean>;
  /** Invoke the compiled, checkpointed graph with the resume command. */
  invoke_resume(
    thread_config: { configurable: { thread_id: string } },
    command: Command,
  ): Promise<unknown>;
}

/**
 * Resume an interrupted run after verifying authority and version availability.
 *
 * @param deps - Injected run loader, authorization, pin verifier, and invoker.
 * @param args - Run ID, trusted context, and the untrusted resume value.
 * @returns The graph invocation result.
 * @throws ResumeError when the run is missing, cross-tenant, forbidden, or its
 *         pinned versions are no longer available.
 */
export async function resume_run(
  deps: ResumeDeps,
  args: {
    readonly run_id: string;
    readonly context: TrustedRuntimeContext;
    readonly resume_value: unknown;
  },
): Promise<unknown> {
  const run = await deps.load_run(args.run_id, args.context);
  if (!run) {
    throw new ResumeError("RESUME_RUN_NOT_FOUND", "The run was not found.");
  }
  if (run.tenant_id !== args.context.tenant_id) {
    throw new ResumeError(
      "RESUME_TENANT_MISMATCH",
      "The run belongs to a different tenant.",
    );
  }
  if (!deps.can_resume(run, args.context)) {
    throw new ResumeError(
      "RESUME_FORBIDDEN",
      "You are not permitted to resume this run.",
    );
  }
  if (!(await deps.verify_pins(run.pins))) {
    throw new ResumeError(
      "RESUME_VERSION_UNAVAILABLE",
      "A pinned orchestrator/policy/deployment/prompt/context-pack version is no longer available.",
    );
  }
  const thread_config = build_thread_config(run.tenant_id, run.thread_id);
  return deps.invoke_resume(thread_config, new Command({ resume: args.resume_value }));
}
