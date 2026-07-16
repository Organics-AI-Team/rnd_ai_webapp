/**
 * Adapter from the governed AI control-plane executor to the orchestration
 * loop's deliberately small tool port.
 *
 * The orchestration request carries only a proposed tool call and its replay
 * key. Tenant, actor, policy, and permissions are injected here from trusted
 * runtime state and never accepted from model-visible arguments.
 */

import type {
  ToolExecutionRequestV1,
  ToolExecutionResultV1,
  ToolExecutor as OrchestrationToolExecutor,
  ToolRuntimeDefinitionV1,
  TrustedRuntimeContext,
} from "@rnd-ai/ai-orchestration";
import type { EffectiveAIPolicy } from "@rnd-ai/shared-types";

import { as_tool_governance_error } from "./errors";
import type { ToolCatalogue } from "./tool-catalogue";
import type {
  ToolCallProposal,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./tool-executor";

/** Structural port implemented by the governed control-plane ToolExecutor. */
export interface ControlToolExecutionPort {
  execute(
    proposal: ToolCallProposal,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
}

/** Trusted dependencies pinned for the lifetime of one graph invocation. */
export interface OrchestrationToolExecutorDeps {
  readonly catalogue: ToolCatalogue;
  readonly executor: ControlToolExecutionPort;
  readonly policy: EffectiveAIPolicy;
  readonly permissions: readonly string[];
}

function map_side_effect(
  side_effect: "read" | "draft_write" | "commit",
): ToolRuntimeDefinitionV1["side_effect"] {
  return side_effect === "draft_write" ? "draft" : side_effect;
}

function is_untrusted_content_tool(tool_name: string): boolean {
  return tool_name.startsWith("knowledge.") || tool_name.startsWith("web.");
}

function produces_artifact(tool_name: string): boolean {
  return tool_name === "formula.draft" || tool_name === "formula.revise";
}

function safe_error_result(error: unknown): ToolExecutionResultV1 {
  const governance_error = as_tool_governance_error(error);
  if (governance_error) {
    return {
      status: "error",
      output: null,
      error_code: governance_error.code,
      safe_error_message: governance_error.message,
      retryable: governance_error.retryable,
      cost_usd: "0",
      latency_ms: 0,
    };
  }
  return {
    status: "error",
    output: null,
    error_code: "TOOL_EXECUTION_FAILED",
    safe_error_message: "The governed tool failed to execute.",
    retryable: false,
    cost_usd: "0",
    latency_ms: 0,
  };
}

/**
 * Bind a governed catalogue/executor pair to a pinned tenant policy and
 * trusted permission snapshot for use by the checkpointed agent loop.
 */
export function create_orchestration_tool_executor(
  deps: OrchestrationToolExecutorDeps,
): OrchestrationToolExecutor {
  return {
    describe(
      tool_name: string,
      context: TrustedRuntimeContext,
    ): ToolRuntimeDefinitionV1 | null {
      if (context.tenant_id !== deps.policy.tenant_id) return null;
      const definition = deps.catalogue.get(tool_name);
      if (!definition) return null;
      return {
        name: definition.name,
        version: definition.version,
        side_effect: map_side_effect(definition.side_effect),
        required_permission: definition.required_permission,
        output_schema: definition.output_schema,
        result_trust: is_untrusted_content_tool(definition.name)
          ? "untrusted_content"
          : "trusted_system",
        produces_artifact: produces_artifact(definition.name),
        // The control-plane executor already owns its bounded retry policy.
        retry: 0,
        timeout_ms: definition.timeout_ms,
      };
    },

    async execute(
      request: ToolExecutionRequestV1,
      context: TrustedRuntimeContext,
    ): Promise<ToolExecutionResultV1> {
      if (
        request.run_id !== context.run_id ||
        context.tenant_id !== deps.policy.tenant_id
      ) {
        return {
          status: "error",
          output: null,
          error_code: "TOOL_EXECUTION_FAILED",
          safe_error_message: "Trusted tool execution scope is inconsistent.",
          retryable: false,
          cost_usd: "0",
          latency_ms: 0,
        };
      }
      try {
        const result = await deps.executor.execute(
          { name: request.tool_name, arguments: request.arguments },
          {
            tenant_id: context.tenant_id,
            actor_profile_id: context.actor_profile_id,
            permissions: deps.permissions,
            policy: deps.policy,
            run_id: context.run_id,
            step_id: request.idempotency_key,
            correlation_id: context.correlation_id,
          },
        );
        return {
          status: "ok",
          output: result.output,
          error_code: null,
          safe_error_message: null,
          retryable: false,
          cost_usd: "0",
          latency_ms: result.duration_ms,
        };
      } catch (error) {
        return safe_error_result(error);
      }
    },
  };
}
