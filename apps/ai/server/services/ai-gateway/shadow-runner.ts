/** Read-only, separately metered commercial shadow execution (G5.4). */
import { hash_canonical } from "../ai-control/hashing";

export interface ShadowPolicy {
  readonly tenant_opt_in: boolean;
  readonly platform_approved: boolean;
  readonly sampling_rate: number;
  readonly purpose: string;
  readonly retention_days: number;
  readonly cost_ceiling_microusd: number;
}

export interface ShadowRunRequest {
  readonly policy: ShadowPolicy;
  readonly tenant_id: string;
  readonly primary_run_id: string;
  readonly primary_status: string;
  readonly input: unknown;
  readonly primary_result: unknown;
  readonly policy_hash: string;
}

export interface ShadowExecutionResult {
  readonly status: "completed" | "failed";
  readonly score?: number;
  readonly [key: string]: unknown;
}

export interface ShadowRunnerPorts {
  reserve_shadow_budget(args: {
    tenant_id: string;
    primary_run_id: string;
    ceiling_microusd: number;
    purpose: string;
  }): Promise<string>;
  execute_shadow(args: {
    tenant_id: string;
    primary_run_id: string;
    reservation_id: string;
    input: unknown;
    policy_hash: string;
  }): Promise<ShadowExecutionResult>;
  record_comparison(event: {
    tenant_id: string;
    primary_run_id: string;
    input_hash: string;
    primary_result_hash: string;
    policy_hash: string;
    shadow_status: string;
    scorer_result: Readonly<Record<string, unknown>>;
    retention_days: number;
  }): Promise<void>;
  record_incident(event: {
    tenant_id: string;
    primary_run_id: string;
    code: "SHADOW_EXECUTION_FAILED";
  }): Promise<void>;
}

export interface ShadowSources {
  /** Injected deterministic sampler in [0, 1). */
  readonly sample: () => number;
}

export class ShadowPolicyInvalidError extends Error {
  readonly code = "SHADOW_POLICY_INVALID";

  constructor() {
    super("The shadow execution policy is invalid.");
    this.name = "ShadowPolicyInvalidError";
  }
}

export type ShadowRunOutcome =
  | { readonly selected: false; readonly status: "not_selected" }
  | { readonly selected: true; readonly status: "completed" | "failed" };

function validate_policy(policy: ShadowPolicy): void {
  if (
    !Number.isFinite(policy.sampling_rate) ||
    policy.sampling_rate < 0 ||
    policy.sampling_rate > 1 ||
    !Number.isInteger(policy.retention_days) ||
    policy.retention_days < 1 ||
    policy.retention_days > 365 ||
    !Number.isSafeInteger(policy.cost_ceiling_microusd) ||
    policy.cost_ceiling_microusd <= 0 ||
    policy.purpose.trim().length === 0
  ) {
    throw new ShadowPolicyInvalidError();
  }
}

/** Build a shadow runner whose failures are isolated from the primary run. */
export function create_shadow_runner(
  ports: ShadowRunnerPorts,
  sources: ShadowSources,
): { run_after_primary(request: ShadowRunRequest): Promise<ShadowRunOutcome> } {
  return {
    async run_after_primary(request) {
      validate_policy(request.policy);
      const selected =
        request.primary_status === "completed" &&
        request.policy.tenant_opt_in &&
        request.policy.platform_approved &&
        sources.sample() < request.policy.sampling_rate;
      if (!selected) return { selected: false, status: "not_selected" };

      try {
        const reservation_id = await ports.reserve_shadow_budget({
          tenant_id: request.tenant_id,
          primary_run_id: request.primary_run_id,
          ceiling_microusd: request.policy.cost_ceiling_microusd,
          purpose: request.policy.purpose,
        });
        const result = await ports.execute_shadow({
          tenant_id: request.tenant_id,
          primary_run_id: request.primary_run_id,
          reservation_id,
          input: request.input,
          policy_hash: request.policy_hash,
        });
        const { status: shadow_status, ...scorer_result } = result;
        await ports.record_comparison({
          tenant_id: request.tenant_id,
          primary_run_id: request.primary_run_id,
          input_hash: hash_canonical(request.input),
          primary_result_hash: hash_canonical(request.primary_result),
          policy_hash: request.policy_hash,
          shadow_status,
          scorer_result: Object.freeze(scorer_result),
          retention_days: request.policy.retention_days,
        });
        return { selected: true, status: shadow_status };
      } catch {
        await Promise.resolve(
          ports.record_incident({
            tenant_id: request.tenant_id,
            primary_run_id: request.primary_run_id,
            code: "SHADOW_EXECUTION_FAILED",
          }),
        ).catch(() => undefined);
        return { selected: true, status: "failed" };
      }
    },
  };
}
