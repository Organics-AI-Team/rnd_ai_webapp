/**
 * Production composition seam for the governed AI run API (G4.9g).
 *
 * Assembles the credential-free collaborators the run routes need from the
 * shared MongoDB client: policy compilation, context-card assembly, budget
 * reservation, run/job persistence, event replay/tail, and secure resume.
 * Provider credentials are deliberately not required to admit a run; only the
 * private worker's model adapter needs them.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { randomUUID } from "node:crypto";
import client_promise from "@rnd-ai/shared-database";
import type { RequestPrincipal, TenantExecutionContext } from "@rnd-ai/shared-types";
import type { Db, MongoClient } from "mongodb";

import { build_tenant_execution_context } from "../../auth/tenant-execution-context";
import { create_ai_policy_repository } from "../../repositories/ai-policy-repository";
import { create_ai_rollout_repository } from "../../repositories/ai-rollout-repository";
import { create_ai_run_repository } from "../../repositories/ai-run-repository";
import { create_ai_usage_repository } from "../../repositories/ai-usage-repository";
import { create_budget_service } from "../ai-control/budget-service";
import { ContextAssembler } from "../ai-control/context-assembler";
import { canonical_json } from "../ai-control/hashing";
import { ToolCatalogue } from "../ai-control/tool-catalogue";
import {
  create_all_governed_tool_definitions,
  create_not_wired_governed_tool_ports,
} from "../ai-control/tools";
import {
  AIDisabledError,
  create_ai_gateway,
  type AIGateway,
  type CompiledRunPolicy,
} from "./ai-gateway";
import { create_event_store } from "./event-store";
import { create_run_job_queue } from "./run-job-queue";
import { submit_resume } from "./resume-handler";
import type { RunApiCollaborators } from "./run-api-handlers";

/** Deterministic and operational sources for production gateway composition. */
export interface ProductionRunGatewayOptions {
  readonly now?: () => Date;
  readonly correlation_id?: () => string;
}

function required_deployment(compiled: Awaited<ReturnType<ReturnType<typeof create_ai_policy_repository>["compile_for_tenant"]>>) {
  const pins = compiled.deployment_pins;
  if (
    !compiled.deployment_id ||
    !compiled.prompt_version_id ||
    !pins ||
    !pins.agent_definition_version ||
    !pins.orchestrator_version ||
    !pins.input_schema_version ||
    !pins.output_schema_version
  ) {
    throw new AIDisabledError("No approved active agent deployment is available.");
  }
  return {
    deployment_id: compiled.deployment_id,
    prompt_version_id: compiled.prompt_version_id,
    ...pins,
  };
}

/**
 * Compose the real credential-free run-admission gateway over MongoDB.
 */
export function create_production_run_gateway(
  client: MongoClient,
  database: Db,
  options: ProductionRunGatewayOptions = {},
): AIGateway {
  const policy_repository = create_ai_policy_repository(database);
  const usage_repository = create_ai_usage_repository(database);
  const budget_service = create_budget_service(usage_repository, {
    clock: options.now,
  });
  const catalogue = new ToolCatalogue();
  const definitions = create_all_governed_tool_definitions(
    create_not_wired_governed_tool_ports(),
  );
  for (const definition of definitions) catalogue.register(definition);
  const assembler = new ContextAssembler({ catalogue });

  return create_ai_gateway({
    client,
    runs: create_ai_run_repository(database),
    jobs: create_run_job_queue(database),
    policy: {
      async compile(tenant, input): Promise<CompiledRunPolicy> {
        const compiled = await policy_repository.compile_for_tenant(
          tenant.tenant_id,
          input.agent_key,
          {
            response_language: input.response_preferences.language,
            response_detail:
              input.response_preferences.detail === "concise"
                ? "brief"
                : input.response_preferences.detail,
          },
        );
        const deployment = required_deployment(compiled);
        const provider = Object.keys(compiled.policy.provider_models).sort()[0];
        const model = provider
          ? [...(compiled.policy.provider_models[provider] ?? [])].sort()[0]
          : undefined;
        if (!provider || !model) {
          throw new AIDisabledError("The active deployment has no approved model.");
        }
        return {
          enabled: compiled.policy.enabled,
          disabled_reason: compiled.policy.enabled
            ? undefined
            : "AI is disabled for this tenant.",
          effective_policy: compiled.policy,
          pins: {
            policyVersion: compiled.policy.version,
            policySnapshot: JSON.parse(canonical_json(compiled.policy)),
            deploymentId: deployment.deployment_id,
            agentDefinitionVersion: deployment.agent_definition_version,
            orchestratorVersion: deployment.orchestrator_version,
            promptVersionId: deployment.prompt_version_id,
            inputSchemaVersion: deployment.input_schema_version,
            outputSchemaVersion: deployment.output_schema_version,
            provider,
            model,
          },
          budget_estimate: {
            requests: BigInt(1),
            tokens: compiled.policy.per_run_token_limit,
            cost_microusd: compiled.policy.per_run_cost_limit_microusd,
          },
          request_budget: {
            max_iterations: compiled.policy.max_iterations,
            max_total_tokens: compiled.policy.per_run_token_limit.toString(),
            max_cost_microusd: compiled.policy.per_run_cost_limit_microusd.toString(),
            policy_hash: compiled.policy.hash,
          },
        };
      },
    },
    context: {
      async assemble(_tenant, input, compiled) {
        const pack = await assembler.assemble({
          agent_key: input.agent_key,
          policy: compiled.effective_policy,
        });
        return { pack_hash: pack.pack_hash };
      },
    },
    budget: {
      async reserve(tenant, policy, estimate, idempotency_key, run_id) {
        const reservation = await budget_service.reserve_usage(
          {
            tenant_id: tenant.tenant_id,
            actor_profile_id: tenant.actor_profile_id,
            run_id,
            policy,
            rate_card_version: process.env.AI_RATE_CARD_VERSION ?? "commercial-2026-07-v1",
          },
          estimate as {
            requests: bigint;
            tokens: bigint;
            cost_microusd: bigint;
          },
          `run:${tenant.tenant_id}:${idempotency_key}:reservation`,
        );
        return { reservation_id: reservation.reservation_id };
      },
    },
    rollout_assignments: create_ai_rollout_repository(database),
    now: options.now ?? (() => new Date()),
    correlation_id:
      options.correlation_id ??
      (() => `ai-run-${randomUUID()}`),
    events_url: (run_id) => `/api/ai/runs/${run_id}/events`,
  });
}

/**
 * Resolve the run-API collaborators bound to the shared MongoDB database.
 *
 * @returns Collaborators for the create/events/resume handlers.
 */
export async function resolve_run_api_runtime(): Promise<RunApiCollaborators> {
  console.info({ boundary: "run-api", op: "resolve_runtime", phase: "start" });
  const client = await client_promise;
  const database = client.db();
  const runs = create_ai_run_repository(database);
  const jobs = create_run_job_queue(database);
  const events = create_event_store(database);

  return {
    gateway: create_production_run_gateway(client, database),
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
