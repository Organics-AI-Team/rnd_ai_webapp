/**
 * Trusted, immutable per-run AI execution context (G3.7).
 *
 * This is the only context handed to governed provider, knowledge, tool, and
 * usage adapters. It binds the verified tenant principal to the exact policy,
 * deployment, prompt, reservation, and cancellation signal admitted for the
 * run. Mismatched pins fail closed before any adapter can execute.
 */
import type { EffectiveAIPolicy, TenantExecutionContext } from "@rnd-ai/shared-types";

/** Immutable deployment fields required by the governed runtime. */
export interface AgentDeploymentSnapshot {
  readonly deployment_id: string;
  readonly tenant_id: string;
  readonly agent_key: string;
  readonly revision: number;
  readonly status: "active" | "draft" | "retired";
  readonly agent_definition_version: string;
  readonly orchestrator_version: string;
  readonly prompt_version_id: string;
  readonly input_schema_version: string;
  readonly output_schema_version: string;
}

/** Complete trusted scope for one admitted AI run. */
export interface TenantAIExecutionContext {
  readonly tenant: TenantExecutionContext;
  readonly policy: EffectiveAIPolicy;
  readonly deployment: AgentDeploymentSnapshot;
  readonly run_id: string;
  readonly reservation_id: string;
  readonly prompt_version_id: string;
  readonly correlation_id: string;
  readonly signal: AbortSignal;
}

/** Stable fail-closed error for inconsistent run pins. */
export class AIExecutionContextInvalidError extends Error {
  readonly code = "AI_EXECUTION_CONTEXT_INVALID";

  constructor() {
    super("The AI execution context is inconsistent.");
    this.name = "AIExecutionContextInvalidError";
  }
}

/** Inputs accepted only from the authenticated AI gateway/worker. */
export interface CreateAIExecutionContextArgs extends TenantAIExecutionContext {}

/** Deep-freeze plain records and arrays without touching host objects. */
function deep_freeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deep_freeze(child);
  }
  return Object.freeze(value);
}

function present(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Validate all cross-object pins and freeze the resulting trusted context.
 */
export function create_ai_execution_context(
  args: CreateAIExecutionContextArgs,
): TenantAIExecutionContext {
  const valid =
    present(args.run_id) &&
    present(args.reservation_id) &&
    present(args.prompt_version_id) &&
    present(args.correlation_id) &&
    args.policy.enabled &&
    args.policy.tenant_id === args.tenant.tenant_id &&
    args.deployment.tenant_id === args.tenant.tenant_id &&
    args.deployment.status === "active" &&
    args.deployment.prompt_version_id === args.prompt_version_id;
  if (!valid) throw new AIExecutionContextInvalidError();

  deep_freeze(args.tenant);
  deep_freeze(args.policy);
  deep_freeze(args.deployment);
  return Object.freeze({ ...args });
}
