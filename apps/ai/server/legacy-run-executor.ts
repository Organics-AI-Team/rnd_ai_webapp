/**
 * Rollback-only compatibility executor for AIRuns pinned to `legacy`.
 *
 * It deliberately lives outside the governed ai-gateway directory: the gateway
 * never imports a legacy agent. The private worker dispatches by the immutable
 * AIRun executor pin and this adapter drives the existing AgentManager without
 * compiling or invoking the governed graph.
 */

import { randomUUID } from "node:crypto";
import type { Db, Document, WithId } from "mongodb";
import {
  agent_run_event_v1_schema,
  agent_run_input_v1_schema,
  agent_run_output_v1_schema,
  type ModelGateway,
  type ModelTurnUsageV1,
  type TrustedRuntimeContext,
} from "@rnd-ai/ai-orchestration";
import type { FeedbackPatterns } from "../types/ai-types";

import { AgentManager } from "../agents/agent-manager";
import { create_ai_runtime_state_repository } from "./repositories/ai-runtime-state-repository";
import { create_ai_usage_repository } from "./repositories/ai-usage-repository";
import { create_budget_service } from "./services/ai-control/budget-service";
import { create_gemini_model_gateway } from "./services/ai-control/providers/gemini-model-gateway";
import {
  hydrate_effective_policy,
  usd_to_microusd,
  type ProductionAgenticRuntimeOptions,
} from "./services/ai-gateway/production-run-runtime";
import type { RunExecutionResult, RunExecutor } from "./services/ai-gateway/run-worker";

const AGENT_MAP = Object.freeze({
  raw_material_research: "raw-materials-specialist",
  formulation: "formulation-advisor",
  sales_rnd: "market-analyst",
} as const);

export class LegacyRunExecutionError extends Error {
  readonly code = "LEGACY_RUN_EXECUTION_FAILED";
  readonly retryable = false;
  constructor() {
    super("The pinned legacy run could not be executed safely.");
    this.name = "LegacyRunExecutionError";
  }
}

interface LegacyModelService {
  readonly manager_service: ConstructorParameters<typeof AgentManager>[0];
  usage(): ModelTurnUsageV1;
}

function feedback_patterns(): FeedbackPatterns {
  return {
    averageScore: 0,
    commonIssues: [],
    preferredLength: "medium",
    preferredComplexity: "moderate",
    totalFeedback: 0,
  };
}

/** Adapt the safe provider-neutral ModelGateway to the old AgentManager port. */
function legacy_model_service(
  model: ModelGateway,
  model_name: string,
  context: TrustedRuntimeContext,
): LegacyModelService {
  let last_usage: ModelTurnUsageV1 = {
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: "0",
  };
  const manager_service = {
    async generateResponse(request: {
      prompt: string;
      context?: Record<string, unknown>;
    }) {
      const system =
        typeof request.context?.systemPrompt === "string"
          ? request.context.systemPrompt
          : "Provide a concise, safe answer from the supplied context.";
      const turn = await model.complete_turn(
        {
          system,
          messages: [{ role: "user", content: request.prompt, tool_call_id: null }],
          tools: [],
        },
        context,
      );
      if (turn.tool_calls.length > 0 || !turn.content) {
        throw new LegacyRunExecutionError();
      }
      last_usage = turn.usage;
      const now = new Date();
      return {
        id: randomUUID(),
        response: turn.content,
        model: model_name,
        temperature: 0,
        maxTokens: turn.usage.output_tokens,
        timestamp: now,
        context: {
          length: turn.content.length,
          complexity: "moderate" as const,
          feedbackAdjusted: false,
        },
        metadata: {
          promptTokens: turn.usage.input_tokens,
          completionTokens: turn.usage.output_tokens,
          totalTokens: turn.usage.input_tokens + turn.usage.output_tokens,
          latency: 0,
        },
      };
    },
    addFeedback() {},
    getFeedbackHistory() { return []; },
    analyzeFeedbackPatterns() { return feedback_patterns(); },
    getLearningInsights() {
      return {
        feedbackPatterns: feedback_patterns(),
        currentPreferences: null,
        recommendations: [],
      };
    },
  } as ConstructorParameters<typeof AgentManager>[0];
  return { manager_service, usage: () => last_usage };
}

function required(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LegacyRunExecutionError();
  }
  return value;
}

/** Create the rollback executor over the old single-agent/RAG manager. */
export function create_production_legacy_run_executor(
  db: Db,
  options: ProductionAgenticRuntimeOptions,
): RunExecutor {
  const now = options.now ?? (() => new Date());
  const runtime_state = create_ai_runtime_state_repository(db);
  const usage_repository = create_ai_usage_repository(db);
  const budgets = create_budget_service(usage_repository, { clock: now });

  return {
    async execute(job, run: WithId<Document>): Promise<RunExecutionResult> {
      const tenant_id = required(run.tenantId);
      const actor_profile_id = required(run.actorProfileId);
      const run_id = String(run._id);
      if (
        run.executor !== "legacy" ||
        job.run_id !== run_id ||
        job.tenant_id !== tenant_id
      ) {
        throw new LegacyRunExecutionError();
      }
      const input = agent_run_input_v1_schema.safeParse(run.input);
      if (!input.success) throw new LegacyRunExecutionError();
      const legacy_agent = AGENT_MAP[input.data.agent_key];
      if (!legacy_agent) throw new LegacyRunExecutionError();

      const deployment_id = required(run.deploymentId);
      const reservation_id = required(run.usageReservationId);
      const policy = hydrate_effective_policy(run.policySnapshot);
      const current = await runtime_state.load_current_authorization({
        tenant_id,
        actor_profile_id,
        run_id,
        deployment_id,
        agent_key: input.data.agent_key,
        reservation_id,
      });
      if (
        policy.tenant_id !== tenant_id ||
        current.emergency_disabled ||
        !current.tenant_ai_active ||
        !current.deployment_active ||
        !current.membership_active ||
        !current.reservation_open
      ) {
        throw new LegacyRunExecutionError();
      }

      const provider = required(run.provider);
      const model_name = required(run.model);
      if (
        !["google", "gemini"].includes(provider) ||
        !policy.provider_models[provider]?.includes(model_name)
      ) {
        throw new LegacyRunExecutionError();
      }
      const context: TrustedRuntimeContext = {
        tenant_id,
        actor_profile_id,
        run_id,
        parent_run_id: null,
        delegation_depth: 0,
        correlation_id: required(run.correlationId),
      };
      const model = legacy_model_service(
        create_gemini_model_gateway({
          api_key: options.gemini_api_key,
          model: model_name,
          input_price_microusd_per_million_tokens:
            options.input_price_microusd_per_million_tokens,
          output_price_microusd_per_million_tokens:
            options.output_price_microusd_per_million_tokens,
        }),
        model_name,
        context,
      );
      const started = now();
      const result = await new AgentManager(model.manager_service).executeAgent({
        agentId: legacy_agent,
        userId: actor_profile_id,
        request: input.data.message,
        options: { forceRAG: true },
      });
      const completed = now();
      const turn_usage = model.usage();
      const total_tokens = turn_usage.input_tokens + turn_usage.output_tokens;
      const sources = Array.isArray(result.ragResults?.sources)
        ? result.ragResults.sources.map(String).slice(0, 20)
        : [];
      const output = agent_run_output_v1_schema.parse({
        schema_version: "1",
        run_id,
        status: "completed",
        answer: result.response.response,
        decision_summary: {
          facts_considered: [],
          evidence_references: sources,
          action_rationales: ["Executed by the tenant's pinned rollback compatibility path."],
          validation_results: [],
          uncertainty: sources.length > 0
            ? []
            : ["The rollback path returned no structured retrieval provenance."],
        },
        citations: sources.map((source) => ({
          source_id: source,
          source_type: "knowledge" as const,
          reference: source.slice(0, 500),
          retrieved_at: null,
        })),
        artifacts: [],
        quality_dimensions: {
          groundedness: sources.length > 0 ? 0.5 : 0,
          evidence_coverage: sources.length > 0 ? 0.5 : 0,
          source_quality: sources.length > 0 ? 0.25 : 0,
          source_freshness_days: null,
          contradiction_state: "unknown",
          validation_rate: 0,
          completeness: result.response.response.length > 0 ? 0.5 : 0,
          risk_severity: "medium",
        },
        warnings: [
          "This response was produced by the pinned legacy rollback executor and was not artifact-validated by the governed loop.",
        ],
        usage_summary: {
          model_calls: 1,
          tool_calls: 0,
          input_tokens: turn_usage.input_tokens,
          output_tokens: turn_usage.output_tokens,
          total_tokens,
          cost_usd: turn_usage.cost_usd,
        },
        started_at: started.toISOString(),
        completed_at: completed.toISOString(),
      });

      const reservation = await usage_repository.with_transaction((session) =>
        usage_repository.find_reservation(tenant_id, reservation_id, session),
      );
      if (
        !reservation ||
        reservation.run_id !== run_id ||
        reservation.rate_card_version !== options.rate_card_version
      ) {
        throw new LegacyRunExecutionError();
      }
      await budgets.reconcile_usage(
        {
          tenant_id,
          actor_profile_id,
          run_id,
          policy,
          rate_card_version: options.rate_card_version,
        },
        {
          reservation_id,
          idempotency_key: reservation.idempotency_key,
          run_id,
          requests: reservation.requests,
          tokens: reservation.tokens,
          cost_microusd: reservation.cost_microusd,
        },
        {
          requests: BigInt(1),
          tokens: BigInt(total_tokens),
          cost_microusd: usd_to_microusd(turn_usage.cost_usd),
        },
        `run:${run_id}:reconcile`,
      );

      const events = [
        agent_run_event_v1_schema.parse({
          schema_version: "1",
          event_id: randomUUID(),
          run_id,
          sequence: 0,
          occurred_at: started.toISOString(),
          type: "run.accepted",
          payload: {
            agent_key: input.data.agent_key,
            context_pack_hash: required(run.contextPackHash),
            orchestrator_version: required(run.orchestratorVersion),
          },
        }),
        agent_run_event_v1_schema.parse({
          schema_version: "1",
          event_id: randomUUID(),
          run_id,
          sequence: 1,
          occurred_at: completed.toISOString(),
          type: "run.completed",
          payload: { status: "completed", output_schema_version: "1", output },
        }),
      ];
      return {
        status: "completed",
        events,
        output,
        usage_summary: output.usage_summary,
      };
    },
  };
}
