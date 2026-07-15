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

import type { Document, MongoClient, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";
import { agent_run_input_v1_schema } from "@rnd-ai/shared-types/src/ai/contracts";
import type { AgentRunInputV1 } from "@rnd-ai/shared-types/src/ai/contracts";

import type { AIRunRepository } from "../../repositories/ai-run-repository";
import type { RunJobQueue } from "./run-job-queue";
import { select_run_executor, type RolloutConfig } from "./run-selector";

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
}

/** Compiles and pins the effective tenant AI policy for a run. */
export interface GatewayPolicySource {
  compile(tenant: TenantExecutionContext): Promise<CompiledRunPolicy>;
}

/** Assembles and pins the run's context pack. */
export interface GatewayContextSource {
  assemble(
    tenant: TenantExecutionContext,
    input: AgentRunInputV1,
  ): Promise<{ pack_hash: string }>;
}

/** Reserves budget idempotently before a run starts. */
export interface GatewayBudgetReserver {
  reserve(
    tenant: TenantExecutionContext,
    estimate: unknown,
    idempotency_key: string,
  ): Promise<void>;
}

/** Injected collaborators and deterministic sources for the gateway. */
export interface AIGatewayDeps {
  readonly client: MongoClient;
  readonly runs: AIRunRepository;
  readonly jobs: RunJobQueue;
  readonly policy: GatewayPolicySource;
  readonly context: GatewayContextSource;
  readonly budget: GatewayBudgetReserver;
  readonly rollout: RolloutConfig;
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

      const compiled = await deps.policy.compile(tenant);
      if (!compiled.enabled) {
        throw new AIDisabledError(compiled.disabled_reason ?? "AI is disabled for this tenant.");
      }

      const { pack_hash } = await deps.context.assemble(tenant, input);
      const executor = select_run_executor(tenant.tenant_id, deps.rollout);
      await deps.budget.reserve(tenant, compiled.budget_estimate, input.idempotency_key);

      const now = deps.now();
      const document = build_run_document(tenant, input, compiled, executor, pack_hash, deps.correlation_id());

      const session = deps.client.startSession();
      try {
        let result: { run: WithId<Document>; created: boolean } | undefined;
        await session.withTransaction(async () => {
          result = await deps.runs.create(
            { tenant_id: tenant.tenant_id, document },
            now,
            session,
          );
          if (result.created && executor === "agentic") {
            await deps.jobs.enqueue(
              { tenant_id: tenant.tenant_id, run_id: String(result.run._id), command: "start" },
              now,
              session,
            );
          }
        });
        // withTransaction ran the callback, so `result` is always set here.
        const settled = result!;
        return accepted(deps, settled.run, executor, !settled.created);
      } finally {
        await session.endSession();
      }
    },
  };
}

/**
 * Build the AIRun document with all pins recorded.
 *
 * @param tenant - Verified tenant execution context.
 * @param input - Validated run input.
 * @param compiled - Compiled policy + pins.
 * @param executor - Selected executor.
 * @param context_pack_hash - Pinned context-pack hash.
 * @param correlation_id - Unique correlation id for the run.
 * @returns The AIRun document (tenantId is stamped by the repository).
 */
function build_run_document(
  tenant: TenantExecutionContext,
  input: AgentRunInputV1,
  compiled: CompiledRunPolicy,
  executor: string,
  context_pack_hash: string,
  correlation_id: string,
): Record<string, unknown> {
  return {
    actorProfileId: tenant.actor_profile_id,
    threadId: input.thread_id,
    agentKey: input.agent_key,
    deploymentId: compiled.pins.deploymentId,
    agentDefinitionVersion: compiled.pins.agentDefinitionVersion,
    orchestratorVersion: compiled.pins.orchestratorVersion,
    policyVersion: compiled.pins.policyVersion,
    policySnapshot: compiled.pins.policySnapshot,
    promptVersionId: compiled.pins.promptVersionId,
    inputSchemaVersion: compiled.pins.inputSchemaVersion,
    outputSchemaVersion: compiled.pins.outputSchemaVersion,
    provider: compiled.pins.provider,
    model: compiled.pins.model,
    executor,
    contextPackHash: context_pack_hash,
    requestBudget: compiled.request_budget,
    status: "queued",
    correlationId: correlation_id,
    idempotencyKey: input.idempotency_key,
  };
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
