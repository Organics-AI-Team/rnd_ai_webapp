/**
 * AI gateway — the one authenticated entry point for a governed run (G4.9).
 *
 * `create_run` builds an accepted run without depending on the request staying
 * alive: it validates the input, compiles and pins the effective policy,
 * assembles and pins the context pack, reserves budget, and — in a single Mongo
 * transaction — creates the AIRun and enqueues exactly one worker job. It is
 * idempotent on the run's idempotency key: a retry returns the same run and never
 * double-enqueues. The private worker drains the queue and drives the loop; the
 * HTTP request only returns 202 + a run id.
 *
 * The heavy control-plane collaborators (policy compilation, context assembly,
 * budget reservation) are injected as narrow ports so this orchestration is
 * testable in isolation; concrete adapters bridge them to the AIPolicyRepository,
 * ContextAssembler, and BudgetService at wiring time.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { createHash } from "node:crypto";
import { ObjectId, type Document, type MongoClient, type WithId } from "mongodb";
import type { EffectiveAIPolicy, TenantExecutionContext } from "@rnd-ai/shared-types";
import { agent_run_input_v1_schema } from "@rnd-ai/shared-types/src/ai/contracts";
import type { AgentRunInputV1 } from "@rnd-ai/shared-types/src/ai/contracts";

import type { AIRunRepository } from "../../repositories/ai-run-repository";
import type { RunJobQueue } from "./run-job-queue";
import {
  select_executor,
  select_run_executor,
  type ExecutorSelection,
  type RolloutAssignmentSource,
  type RolloutConfig,
} from "./run-selector";

/** Versions, hashes, and provider selection pinned onto the AIRun at creation. */
export interface RunPolicyPins {
  readonly policyVersion: number;
  readonly policySnapshot: unknown;
  readonly deploymentId: string;
  readonly agentDefinitionVersion: string;
  readonly orchestratorVersion: string;
  readonly promptVersionId: string;
  readonly inputSchemaVersion: string;
  readonly outputSchemaVersion: string;
  readonly provider: string | null;
  readonly model: string | null;
}

/** The compiled policy plus what the gateway needs to reserve and record. */
export interface CompiledRunPolicy {
  /** False when AI is disabled for the tenant (fail closed). */
  readonly enabled: boolean;
  /** Safe reason surfaced when disabled. */
  readonly disabled_reason?: string;
  /** Pins recorded on the AIRun. */
  readonly pins: RunPolicyPins;
  /** Estimate passed to the budget reserver. */
  readonly budget_estimate: unknown;
  /** Request budget snapshot stored on the AIRun. */
  readonly request_budget: unknown;
  /** Frozen compiled policy consumed by context assembly and budget admission. */
  readonly effective_policy: EffectiveAIPolicy;
}

/** Compiles and pins the effective tenant AI policy for a run. */
export interface GatewayPolicySource {
  compile(
    tenant: TenantExecutionContext,
    input: AgentRunInputV1,
  ): Promise<CompiledRunPolicy>;
}

/** Assembles and pins the run's context pack. */
export interface GatewayContextSource {
  assemble(
    tenant: TenantExecutionContext,
    input: AgentRunInputV1,
    compiled: CompiledRunPolicy,
  ): Promise<{ pack_hash: string }>;
}

/** Reserves budget idempotently before a run starts. */
export interface GatewayBudgetReserver {
  reserve(
    tenant: TenantExecutionContext,
    policy: EffectiveAIPolicy,
    estimate: unknown,
    idempotency_key: string,
    run_id: string,
  ): Promise<{ reservation_id: string }>;
}

/** Injected collaborators and deterministic sources for the gateway. */
export interface AIGatewayDeps {
  readonly client: MongoClient;
  readonly runs: AIRunRepository;
  readonly jobs: RunJobQueue;
  readonly policy: GatewayPolicySource;
  readonly context: GatewayContextSource;
  readonly budget: GatewayBudgetReserver;
  /** G5 tenant-stable assignment source used by production admission. */
  readonly rollout_assignments?: RolloutAssignmentSource;
  /** Credential-free compatibility source used by isolated G4 tests only. */
  readonly rollout?: RolloutConfig;
  readonly now: () => Date;
  readonly correlation_id: () => string;
  readonly events_url: (run_id: string) => string;
}

/** The 202-accepted result returned to the caller. */
export interface AcceptedRun {
  readonly run_id: string;
  readonly status: "accepted";
  readonly executor: string;
  readonly events_url: string;
  /** True when this run already existed (idempotent retry). */
  readonly already_accepted: boolean;
}

/** Thrown when the submitted run input violates its contract. */
export class AIRunInputInvalidError extends Error {
  readonly code = "AI_RUN_INPUT_INVALID";
  constructor() {
    super("The AI run input is invalid.");
    this.name = "AIRunInputInvalidError";
  }
}

/** Thrown when AI is disabled for the tenant (fail closed). */
export class AIDisabledError extends Error {
  readonly code = "AI_DISABLED";
  constructor(reason: string) {
    super(reason);
    this.name = "AIDisabledError";
  }
}

/** Thrown when a tenant has no safe, internally consistent rollout selection. */
export class AIRolloutUnavailableError extends Error {
  readonly code = "AI_ROLLOUT_UNAVAILABLE";
  readonly cause?: unknown;
  constructor(cause?: unknown) {
    super("No approved rollout assignment is available for this tenant.");
    this.name = "AIRolloutUnavailableError";
    this.cause = cause;
  }
}

/** The gateway surface consumed by the run routes. */
export interface AIGateway {
  create_run(
    tenant: TenantExecutionContext,
    input: unknown,
  ): Promise<AcceptedRun>;
}

/**
 * Create the AI gateway bound to its collaborators.
 *
 * @param deps - Persistence, queue, control-plane ports, and deterministic sources.
 * @returns The gateway with `create_run`.
 */
export function create_ai_gateway(deps: AIGatewayDeps): AIGateway {
  return {
    async create_run(tenant, raw_input) {
      const parsed = agent_run_input_v1_schema.safeParse(raw_input);
      if (!parsed.success) throw new AIRunInputInvalidError();
      const input = parsed.data;

      // Idempotent short-circuit: an already-accepted run never re-compiles,
      // re-reserves, or re-enqueues.
      const existing = await deps.runs.find_by_idempotency(
        tenant.tenant_id,
        input.idempotency_key,
      );
      if (existing) {
        return accepted(deps, existing, String(existing.executor ?? "agentic"), true);
      }

      const compiled = await deps.policy.compile(tenant, input);
      if (!compiled.enabled) {
        throw new AIDisabledError(compiled.disabled_reason ?? "AI is disabled for this tenant.");
      }

      const selection = await resolve_executor_selection(tenant, compiled, deps);
      const { pack_hash } = await deps.context.assemble(tenant, input, compiled);
      const run_id = deterministic_run_id(tenant.tenant_id, input.idempotency_key);
      const reservation = await deps.budget.reserve(
        tenant,
        compiled.effective_policy,
        compiled.budget_estimate,
        input.idempotency_key,
        run_id,
      );

      const now = deps.now();
      const document = build_run_document(
        tenant,
        input,
        compiled,
        selection,
        pack_hash,
        deps.correlation_id(),
        run_id,
        reservation.reservation_id,
      );

      const session = deps.client.startSession();
      try {
        let result: { run: WithId<Document>; created: boolean } | undefined;
        await session.withTransaction(async () => {
          result = await deps.runs.create(
            { tenant_id: tenant.tenant_id, document },
            now,
            session,
          );
          if (result.created) {
            await deps.jobs.enqueue(
              {
                tenant_id: tenant.tenant_id,
                run_id: String(result.run._id),
                command: "start",
                idempotency_key: "start",
              },
              now,
              session,
            );
          }
        });
        // withTransaction ran the callback, so `result` is always set here.
        const settled = result!;
        return accepted(deps, settled.run, selection.executor, !settled.created);
      } finally {
        await session.endSession();
      }
    },
  };
}

/** Resolve and validate the executor/deployment pins before reserving budget. */
async function resolve_executor_selection(
  tenant: TenantExecutionContext,
  compiled: CompiledRunPolicy,
  deps: AIGatewayDeps,
): Promise<ExecutorSelection> {
  if (deps.rollout_assignments) {
    try {
      const selection = await select_executor(tenant.tenant_id, deps.rollout_assignments);
      if (
        selection.executor === "agentic" &&
        selection.deployment_id !== compiled.pins.deploymentId
      ) {
        throw new AIRolloutUnavailableError();
      }
      return selection;
    } catch (error) {
      if (error instanceof AIRolloutUnavailableError) throw error;
      throw new AIRolloutUnavailableError(error);
    }
  }

  if (!deps.rollout) throw new AIRolloutUnavailableError();
  return Object.freeze({
    executor: select_run_executor(tenant.tenant_id, deps.rollout),
    deployment_id: compiled.pins.deploymentId,
    assignment_id: "",
    assignment_version: 0,
  });
}

/**
 * Build the AIRun document with all pins recorded.
 *
 * @param tenant - Verified tenant execution context.
 * @param input - Validated run input.
 * @param compiled - Compiled policy + pins.
 * @param selection - Selected executor and immutable rollout pins.
 * @param context_pack_hash - Pinned context-pack hash.
 * @param correlation_id - Unique correlation id for the run.
 * @returns The AIRun document (tenantId is stamped by the repository).
 */
function build_run_document(
  tenant: TenantExecutionContext,
  input: AgentRunInputV1,
  compiled: CompiledRunPolicy,
  selection: ExecutorSelection,
  context_pack_hash: string,
  correlation_id: string,
  run_id: string,
  reservation_id: string,
): Record<string, unknown> {
  const request_budget =
    compiled.request_budget && typeof compiled.request_budget === "object"
      ? { ...(compiled.request_budget as Record<string, unknown>), reservation_id }
      : { snapshot: compiled.request_budget, reservation_id };
  return {
    _id: new ObjectId(run_id),
    actorProfileId: tenant.actor_profile_id,
    threadId: input.thread_id,
    agentKey: input.agent_key,
    deploymentId: selection.deployment_id,
    agentDefinitionVersion: compiled.pins.agentDefinitionVersion,
    orchestratorVersion: compiled.pins.orchestratorVersion,
    policyVersion: compiled.pins.policyVersion,
    policySnapshot: compiled.pins.policySnapshot,
    promptVersionId: compiled.pins.promptVersionId,
    inputSchemaVersion: compiled.pins.inputSchemaVersion,
    outputSchemaVersion: compiled.pins.outputSchemaVersion,
    provider: compiled.pins.provider,
    model: compiled.pins.model,
    executor: selection.executor,
    ...(selection.assignment_id
      ? {
          rolloutAssignmentId: selection.assignment_id,
          rolloutAssignmentVersion: selection.assignment_version,
        }
      : {}),
    contextPackHash: context_pack_hash,
    // The validated public input is required by the private executor and an
    // authorized shadow run; it contains no tenant/actor/provider identity.
    input,
    requestBudget: request_budget,
    usageReservationId: reservation_id,
    status: "queued",
    correlationId: correlation_id,
    idempotencyKey: input.idempotency_key,
  };
}

/** Stable ObjectId for a tenant/idempotency pair, shared by retries and races. */
function deterministic_run_id(tenant_id: string, idempotency_key: string): string {
  return createHash("sha256")
    .update(`${tenant_id}\u0000${idempotency_key}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

/**
 * Build the accepted-run result for a stored run.
 *
 * @param deps - Gateway deps (events URL builder).
 * @param run - The stored AIRun document.
 * @param executor - The run's executor.
 * @param already_accepted - Whether the run pre-existed.
 * @returns The AcceptedRun result.
 */
function accepted(
  deps: AIGatewayDeps,
  run: { _id: unknown },
  executor: string,
  already_accepted: boolean,
): AcceptedRun {
  const run_id = String(run._id);
  return {
    run_id,
    status: "accepted",
    executor,
    events_url: deps.events_url(run_id),
    already_accepted,
  };
}
