/** Production composition for one checkpointed, governed agentic AIRun. */

import { randomUUID } from "node:crypto";
import type { Db, Document, MongoClient, WithId } from "mongodb";
import {
  default_loop_config,
  get_mongodb_saver,
  type AgentLoopRuntime,
  type ContextPackV1,
  type RunRepository,
  type TrustedRuntimeContext,
  type UsageService,
} from "@rnd-ai/ai-orchestration";
import type {
  EffectiveAIPolicy,
  TenantExecutionContext,
} from "@rnd-ai/shared-types";

import { create_ai_approval_service } from "../../repositories/ai-approval-service";
import { create_ai_approval_gate } from "../../repositories/ai-approval-gate";
import { create_ai_artifact_repository } from "../../repositories/ai-artifact-repository";
import {
  create_ai_runtime_state_repository,
  type RuntimeDeploymentRecord,
} from "../../repositories/ai-runtime-state-repository";
import { create_ai_tool_runtime_ports } from "../../repositories/ai-tool-runtime-repository";
import { create_ai_usage_repository } from "../../repositories/ai-usage-repository";
import { create_conversation_repository } from "../../repositories/conversation-repository";
import { create_formula_repository } from "../../repositories/formula-repository";
import { create_product_repository } from "../../repositories/product-repository";
import { create_material_evidence_provider } from "../../repositories/material-evidence-provider";
import { GeminiEmbeddingService } from "../../../services/embeddings/gemini-embedding-service";
import {
  create_knowledge_qdrant_driver,
} from "../../../services/vector/qdrant-service";
import { create_budget_service } from "../ai-control/budget-service";
import { ContextAssembler } from "../ai-control/context-assembler";
import { create_ai_execution_context } from "../ai-control/create-ai-execution-context";
import { FormulaArtifactService } from "../ai-control/formula-artifact-service";
import { canonical_json, sha256_hex } from "../ai-control/hashing";
import { create_orchestration_tool_executor } from "../ai-control/orchestration-tool-executor";
import { create_gemini_model_gateway } from "../ai-control/providers/gemini-model-gateway";
import { create_google_custom_search_port } from "../ai-control/providers/google-custom-search";
import { create_runtime_policy_engine } from "../ai-control/runtime-policy-engine";
import { ToolCatalogue } from "../ai-control/tool-catalogue";
import { ToolExecutor } from "../ai-control/tool-executor";
import { create_all_governed_tool_definitions } from "../ai-control/tools";
import { create_repository_backed_tool_ports } from "../ai-control/tools/repository-adapters";
import { create_knowledge_gateway } from "../knowledge/knowledge-gateway";
import { create_qdrant_knowledge_adapter } from "../knowledge/qdrant-collections";
import type { ClaimedRunJob } from "./run-job-queue";
import {
  create_agentic_run_executor,
  type AgenticRunRuntimeBundle,
} from "./governed-run-executor";
import type { RunExecutor } from "./run-worker";

/** Safe, stable runtime construction failure. */
export class ProductionRunRuntimeError extends Error {
  readonly code = "RUN_RUNTIME_UNAVAILABLE";
  readonly retryable = false;
  constructor() {
    super("The trusted run runtime is invalid or unavailable.");
    this.name = "ProductionRunRuntimeError";
  }
}

/** Private model/rate/vector settings loaded only by the worker process. */
export interface ProductionAgenticRuntimeOptions {
  readonly gemini_api_key: string;
  readonly rate_card_version: string;
  readonly input_price_microusd_per_million_tokens: bigint;
  readonly output_price_microusd_per_million_tokens: bigint;
  readonly embedding_model: string;
  readonly embedding_version: string;
  readonly embedding_dimensions: number;
  readonly google_search_api_key?: string;
  readonly google_search_cse_id?: string;
  readonly web_search_fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly next_id?: () => string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductionRunRuntimeError();
  }
  return value as Record<string, unknown>;
}

function required_string(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProductionRunRuntimeError();
  }
  return value;
}

function positive_integer(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ProductionRunRuntimeError();
  }
  return parsed;
}

function bigint_value(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  throw new ProductionRunRuntimeError();
}

/** Rehydrate bigint fields and verify the policy's canonical self-hash. */
export function hydrate_effective_policy(value: unknown): EffectiveAIPolicy {
  const snapshot = record(value);
  const provider_models_raw = record(snapshot.provider_models);
  const provider_models: Record<string, readonly string[]> = {};
  for (const [provider, models] of Object.entries(provider_models_raw)) {
    if (!Array.isArray(models) || models.some((model) => typeof model !== "string")) {
      throw new ProductionRunRuntimeError();
    }
    provider_models[provider] = models as string[];
  }
  if (!Array.isArray(snapshot.allowed_tools)) throw new ProductionRunRuntimeError();
  const allowed_tools = snapshot.allowed_tools.map(required_string);
  const approval_rules_raw = record(snapshot.approval_rules);
  const approval_rules: Record<string, "none" | "manager"> = {};
  for (const [tool, requirement] of Object.entries(approval_rules_raw)) {
    if (requirement !== "none" && requirement !== "manager") {
      throw new ProductionRunRuntimeError();
    }
    approval_rules[tool] = requirement;
  }

  const policy_without_hash: Omit<EffectiveAIPolicy, "hash"> = {
    tenant_id: required_string(snapshot.tenant_id),
    version: positive_integer(snapshot.version),
    enabled: snapshot.enabled === true,
    provider_models,
    allowed_tools,
    monthly_request_limit: bigint_value(snapshot.monthly_request_limit),
    monthly_token_limit: bigint_value(snapshot.monthly_token_limit),
    monthly_cost_limit_microusd: bigint_value(snapshot.monthly_cost_limit_microusd),
    per_user_monthly_request_limit: bigint_value(snapshot.per_user_monthly_request_limit),
    per_user_monthly_token_limit: bigint_value(snapshot.per_user_monthly_token_limit),
    per_user_monthly_cost_limit_microusd: bigint_value(
      snapshot.per_user_monthly_cost_limit_microusd,
    ),
    per_run_token_limit: bigint_value(snapshot.per_run_token_limit),
    per_run_cost_limit_microusd: bigint_value(snapshot.per_run_cost_limit_microusd),
    max_concurrent_runs: positive_integer(snapshot.max_concurrent_runs),
    default_locale: required_string(snapshot.default_locale),
    max_iterations: positive_integer(snapshot.max_iterations),
    approval_rules,
  };
  const hash = required_string(snapshot.hash);
  if (sha256_hex(canonical_json(policy_without_hash)) !== hash) {
    throw new ProductionRunRuntimeError();
  }
  return Object.freeze({ ...policy_without_hash, hash });
}

function assert_deployment_pins(
  run: WithId<Document>,
  deployment: RuntimeDeploymentRecord,
): void {
  if (
    deployment.deployment_id !== String(run.deploymentId) ||
    deployment.agent_definition_version !== String(run.agentDefinitionVersion) ||
    deployment.orchestrator_version !== String(run.orchestratorVersion) ||
    deployment.prompt_version_id !== String(run.promptVersionId) ||
    deployment.input_schema_version !== String(run.inputSchemaVersion) ||
    deployment.output_schema_version !== String(run.outputSchemaVersion) ||
    !Number.isSafeInteger(deployment.revision)
  ) {
    throw new ProductionRunRuntimeError();
  }
}

/** Convert a decimal USD amount to micro-USD, rounding upward, never down. */
export function usd_to_microusd(value: string): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new ProductionRunRuntimeError();
  const [whole, raw_fraction = ""] = value.split(".");
  const micros = raw_fraction.slice(0, 6).padEnd(6, "0");
  const remainder = raw_fraction.slice(6);
  return (
    BigInt(whole) * BigInt(1_000_000) +
    BigInt(micros) +
    (/[1-9]/.test(remainder) ? BigInt(1) : BigInt(0))
  );
}

function worker_owned_run_port(context: TrustedRuntimeContext): RunRepository {
  const assert = (run_id: string, candidate: TrustedRuntimeContext): void => {
    if (
      run_id !== context.run_id ||
      candidate.run_id !== context.run_id ||
      candidate.tenant_id !== context.tenant_id
    ) {
      throw new ProductionRunRuntimeError();
    }
  };
  return {
    async mark_completed(run_id, _output, candidate) {
      // The leased worker persists events and terminal status atomically in its
      // append-before-ack sequence after graph.invoke returns.
      assert(run_id, candidate);
    },
    async mark_failed(run_id, _error, candidate) {
      assert(run_id, candidate);
    },
  };
}

/** Create the trusted runtime loader consumed by the governed run executor. */
export function create_production_agentic_runtime_loader(
  _client: MongoClient,
  db: Db,
  options: ProductionAgenticRuntimeOptions,
): (run: WithId<Document>, job: ClaimedRunJob) => Promise<AgenticRunRuntimeBundle> {
  if (
    !options.gemini_api_key.trim() ||
    !options.rate_card_version.trim() ||
    !options.embedding_model.trim() ||
    !/^[A-Za-z0-9_-]+$/.test(options.embedding_version) ||
    !Number.isSafeInteger(options.embedding_dimensions) ||
    options.embedding_dimensions <= 0 ||
    options.input_price_microusd_per_million_tokens < BigInt(0) ||
    options.output_price_microusd_per_million_tokens < BigInt(0)
  ) {
    throw new ProductionRunRuntimeError();
  }
  const google_search_api_key = options.google_search_api_key?.trim();
  const google_search_cse_id = options.google_search_cse_id?.trim();
  if (Boolean(google_search_api_key) !== Boolean(google_search_cse_id)) {
    throw new ProductionRunRuntimeError();
  }
  const now = options.now ?? (() => new Date());
  const next_id = options.next_id ?? randomUUID;
  const runtime_state = create_ai_runtime_state_repository(db);
  const usage_repository = create_ai_usage_repository(db);
  const budget_service = create_budget_service(usage_repository, { clock: now });

  return async (run, job) => {
    const tenant_id = required_string(run.tenantId);
    const actor_profile_id = required_string(run.actorProfileId);
    const run_id = String(run._id);
    const agent_key = required_string(run.agentKey);
    const deployment_id = required_string(run.deploymentId);
    const reservation_id = required_string(run.usageReservationId);
    if (
      run.executor !== "agentic" ||
      job.tenant_id !== tenant_id ||
      job.run_id !== run_id
    ) {
      throw new ProductionRunRuntimeError();
    }

    const policy = hydrate_effective_policy(run.policySnapshot);
    if (
      policy.tenant_id !== tenant_id ||
      policy.version !== Number(run.policyVersion) ||
      !policy.enabled
    ) {
      throw new ProductionRunRuntimeError();
    }
    const [member, deployment] = await Promise.all([
      runtime_state.load_member_identity(tenant_id, actor_profile_id),
      runtime_state.load_active_deployment(tenant_id, deployment_id, agent_key),
    ]);
    if (!member || !deployment) throw new ProductionRunRuntimeError();
    assert_deployment_pins(run, deployment);

    const provider = required_string(run.provider);
    const model = required_string(run.model);
    if (
      !["google", "gemini"].includes(provider) ||
      !policy.provider_models[provider]?.includes(model)
    ) {
      throw new ProductionRunRuntimeError();
    }
    const current = await runtime_state.load_current_authorization({
      tenant_id,
      actor_profile_id,
      run_id,
      deployment_id,
      agent_key,
      reservation_id,
    });
    if (
      current.emergency_disabled ||
      !current.tenant_ai_active ||
      !current.deployment_active ||
      !current.membership_active ||
      !current.reservation_open
    ) {
      throw new ProductionRunRuntimeError();
    }

    const tenant_context: TenantExecutionContext = Object.freeze({
      tenant_id,
      actor_profile_id,
      clerk_user_id: member.clerk_user_id,
      clerk_organization_id: "",
      membership_id: member.membership_id,
      tenant_role: member.tenant_role,
      permissions: member.permissions,
      access_mode: "member",
      support_grant_id: null,
      correlation_id: required_string(run.correlationId),
      request_started_at: now().toISOString(),
    });
    const abort_controller = new AbortController();
    create_ai_execution_context({
      tenant: tenant_context,
      policy,
      deployment: {
        deployment_id,
        tenant_id,
        agent_key,
        revision: deployment.revision,
        status: "active",
        agent_definition_version: deployment.agent_definition_version,
        orchestrator_version: deployment.orchestrator_version,
        prompt_version_id: deployment.prompt_version_id,
        input_schema_version: deployment.input_schema_version,
        output_schema_version: deployment.output_schema_version,
      },
      run_id,
      reservation_id,
      prompt_version_id: required_string(run.promptVersionId),
      correlation_id: required_string(run.correlationId),
      signal: abort_controller.signal,
    });

    const formula_repository = create_formula_repository(db);
    const formula_artifact_service = new FormulaArtifactService(
      create_material_evidence_provider(db),
      undefined,
      create_ai_artifact_repository(db),
      formula_repository,
      tenant_context,
    );
    const repository_ports = create_repository_backed_tool_ports({
      tenant_context,
      formula_repository,
      product_repository: create_product_repository(db),
      formula_commit: {
        service: formula_artifact_service,
        approval_gate: create_ai_approval_gate(db),
      },
    });
    const embedding = new GeminiEmbeddingService(options.gemini_api_key, {
      model: options.embedding_model,
      dimensions: options.embedding_dimensions,
      batchSize: 16,
    });
    // The low-level legacy Qdrant service connects eagerly when constructed.
    // Keep that construction behind each actual vector operation so rebuilding
    // a runtime (or executing a formula-only run) never performs network IO.
    const vector_port = create_qdrant_knowledge_adapter({
      driver: {
        ensure_collection: (definition) =>
          create_knowledge_qdrant_driver().ensure_collection(definition),
        search: (collection_name, vector, search_options) =>
          create_knowledge_qdrant_driver().search(
            collection_name,
            vector,
            search_options,
          ),
        upsert: (collection_name, points) =>
          create_knowledge_qdrant_driver().upsert(collection_name, points),
        delete: (collection_name, filter) =>
          create_knowledge_qdrant_driver().delete(collection_name, filter),
      },
      embedding_version: options.embedding_version,
      vector_size: options.embedding_dimensions,
    });
    const knowledge_gateway = create_knowledge_gateway({
      vector_port,
      embedding_port: {
        embed: (text) => embedding.createEmbedding(text),
      },
      access_policy: {
        async authorize(candidate, _scope) {
          if (
            candidate.tenant_id !== tenant_id ||
            !tenant_context.permissions.includes("tenant:knowledge:read")
          ) {
            throw new ProductionRunRuntimeError();
          }
        },
      },
      embedding_version: options.embedding_version,
    });
    const governed_ports = {
      ...repository_ports,
      ...(google_search_api_key && google_search_cse_id
        ? {
            web_search: create_google_custom_search_port({
              api_key: google_search_api_key,
              cse_id: google_search_cse_id,
              ...(options.web_search_fetch
                ? { fetch_impl: options.web_search_fetch }
                : {}),
            }),
          }
        : {}),
      knowledge_search: {
        async search_knowledge(args: {
          query: string;
          scope?: "platform" | "tenant" | "both";
          top_k?: number;
        }) {
          const evidence = await knowledge_gateway.search(tenant_context, {
            query: args.query,
            scope: args.scope ?? "both",
            limit: args.top_k,
          });
          return {
            results: evidence.map((row) => ({
              source_id: row.source_id,
              source_name: row.locator,
              scope: row.scope,
              excerpt: row.content,
              relevance_score: Math.max(0, Math.min(1, row.score)),
              content_hash: row.content_hash,
            })),
          };
        },
      },
    };
    const catalogue = new ToolCatalogue();
    for (const definition of create_all_governed_tool_definitions(governed_ports)) {
      catalogue.register(definition);
    }
    const context_pack = (await new ContextAssembler({ catalogue }).assemble({
      agent_key,
      policy,
    })) as ContextPackV1;
    if (context_pack.pack_hash !== String(run.contextPackHash)) {
      throw new ProductionRunRuntimeError();
    }

    const control_executor = new ToolExecutor(
      catalogue,
      create_ai_tool_runtime_ports(db, tenant_context),
    );
    const trusted_context: TrustedRuntimeContext = Object.freeze({
      tenant_id,
      actor_profile_id,
      run_id,
      parent_run_id: null,
      delegation_depth: 0,
      correlation_id: required_string(run.correlationId),
    });
    const reservation_entry = await usage_repository.with_transaction((session) =>
      usage_repository.find_reservation(tenant_id, reservation_id, session),
    );
    if (
      !reservation_entry ||
      reservation_entry.kind !== "reservation" ||
      reservation_entry.run_id !== run_id ||
      reservation_entry.rate_card_version !== options.rate_card_version
    ) {
      throw new ProductionRunRuntimeError();
    }
    const usage_context = {
      tenant_id,
      actor_profile_id,
      run_id,
      policy,
      rate_card_version: options.rate_card_version,
    };
    const usage: UsageService = {
      async reconcile(candidate_run_id, counters, candidate_context) {
        if (
          candidate_run_id !== run_id ||
          candidate_context.run_id !== run_id ||
          candidate_context.tenant_id !== tenant_id
        ) {
          throw new ProductionRunRuntimeError();
        }
        await budget_service.reconcile_usage(
          usage_context,
          {
            reservation_id,
            idempotency_key: reservation_entry.idempotency_key,
            run_id,
            requests: reservation_entry.requests,
            tokens: reservation_entry.tokens,
            cost_microusd: reservation_entry.cost_microusd,
          },
          {
            requests: BigInt(1),
            tokens: BigInt(counters.tokens_used),
            cost_microusd: usd_to_microusd(counters.cost_usd_used),
          },
          `run:${run_id}:reconcile`,
        );
      },
    };
    const conversation_repository = create_conversation_repository(db);
    const runtime: AgentLoopRuntime = {
      context: trusted_context,
      config: default_loop_config,
      logger: {
        log(level, event, fields) {
          const method = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
          method({ boundary: "agent-loop", event, ...fields });
        },
      },
      policy: create_runtime_policy_engine({
        policy,
        describe_tool(tool_name) {
          const definition = catalogue.get(tool_name);
          return definition
            ? {
                required_permission: definition.required_permission,
                approval_requirement: definition.approval_requirement,
              }
            : null;
        },
        authorization: {
          async load_current(candidate) {
            if (
              candidate.run_id !== run_id ||
              candidate.actor_profile_id !== actor_profile_id ||
              candidate.tenant_id !== tenant_id
            ) {
              throw new ProductionRunRuntimeError();
            }
            return runtime_state.load_current_authorization({
              tenant_id,
              actor_profile_id,
              run_id,
              deployment_id,
              agent_key,
              reservation_id,
            });
          },
        },
      }),
      ports: {
        model: create_gemini_model_gateway({
          api_key: options.gemini_api_key,
          model,
          input_price_microusd_per_million_tokens:
            options.input_price_microusd_per_million_tokens,
          output_price_microusd_per_million_tokens:
            options.output_price_microusd_per_million_tokens,
          signal: abort_controller.signal,
        }),
        tools: create_orchestration_tool_executor({
          catalogue,
          executor: control_executor,
          policy,
          permissions: member.permissions,
        }),
        artifacts: formula_artifact_service,
        runs: worker_owned_run_port(trusted_context),
        approvals: create_ai_approval_service(db, tenant_id, { now }),
        usage,
        knowledge: {
          async load_thread_summary(thread_id, candidate) {
            if (
              candidate.tenant_id !== tenant_id ||
              candidate.actor_profile_id !== actor_profile_id
            ) {
              throw new ProductionRunRuntimeError();
            }
            try {
              const messages = await conversation_repository.list_chat_messages(
                tenant_context,
                thread_id,
              );
              const compact = messages.slice(-8).map((message) => {
                const role = String(message.role ?? "user").slice(0, 20);
                const content = String(message.content ?? message.message ?? "").slice(0, 1_000);
                return `${role}: ${content}`;
              }).filter((line) => !line.endsWith(": "));
              return compact.length > 0 ? compact.join("\n").slice(0, 8_000) : null;
            } catch {
              return null;
            }
          },
        },
        clock: {
          now_iso: () => now().toISOString(),
          now_ms: () => now().getTime(),
        },
        ids: { next_id },
      },
    };
    return { runtime, context_pack };
  };
}

/** Create the real agentic RunExecutor used by the private worker. */
export function create_production_agentic_run_executor(
  client: MongoClient,
  db: Db,
  options: ProductionAgenticRuntimeOptions & {
    readonly run_timeout_ms: number;
  },
): RunExecutor {
  return create_agentic_run_executor({
    load_runtime: create_production_agentic_runtime_loader(client, db, options),
    create_checkpointer: () => get_mongodb_saver(client),
    now: options.now ?? (() => new Date()),
    run_timeout_ms: options.run_timeout_ms,
  });
}
