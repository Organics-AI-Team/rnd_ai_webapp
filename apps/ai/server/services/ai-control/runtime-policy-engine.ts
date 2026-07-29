/** Current-state policy engine used immediately before every tool action. */

import type {
  ActionVerdictV1,
  PolicyEngine,
  TrustedRuntimeContext,
} from "@rnd-ai/ai-orchestration";
import type { EffectiveAIPolicy } from "@rnd-ai/shared-types";

/** Security state reloaded from persistence at action time, never from input. */
export interface CurrentRunAuthorizationState {
  readonly emergency_disabled: boolean;
  readonly tenant_ai_active: boolean;
  readonly deployment_active: boolean;
  readonly membership_active: boolean;
  readonly reservation_open: boolean;
  readonly permissions: readonly string[];
}

/** Repository seam that refreshes mutable authorization state per action. */
export interface CurrentRunAuthorizationSource {
  load_current(context: TrustedRuntimeContext): Promise<CurrentRunAuthorizationState>;
}

/** Governor metadata for one tool; sourced from the registered catalogue. */
export interface RuntimePolicyToolDescription {
  readonly required_permission: string | null;
  readonly approval_requirement: "none" | "manager";
}

export interface RuntimePolicyEngineDeps {
  readonly policy: EffectiveAIPolicy;
  readonly describe_tool: (tool_name: string) => RuntimePolicyToolDescription | null;
  readonly authorization: CurrentRunAuthorizationSource;
}

function denied(
  reason_code: string,
  safe_reason: string,
  fatal: boolean,
): ActionVerdictV1 {
  return { kind: "denied", reason_code, safe_reason, fatal };
}

/** Bind the immutable policy snapshot to mutable, per-action safety checks. */
export function create_runtime_policy_engine(
  deps: RuntimePolicyEngineDeps,
): PolicyEngine {
  return {
    async evaluate_action(action, context) {
      if (
        context.tenant_id !== deps.policy.tenant_id ||
        !deps.policy.enabled
      ) {
        return denied(
          "POLICY_DEPLOYMENT_REVOKED",
          "The run's pinned policy is no longer executable.",
          true,
        );
      }

      const description = deps.describe_tool(action.tool_name);
      if (
        !description ||
        !deps.policy.allowed_tools.includes(action.tool_name)
      ) {
        return denied(
          "POLICY_TOOL_NOT_ALLOWED",
          "The action is not allowed by the pinned policy.",
          false,
        );
      }

      let current: CurrentRunAuthorizationState;
      try {
        current = await deps.authorization.load_current(context);
      } catch {
        return denied(
          "POLICY_DEPLOYMENT_REVOKED",
          "Current authorization state is unavailable.",
          true,
        );
      }
      if (current.emergency_disabled) {
        return denied(
          "POLICY_EMERGENCY_DISABLED",
          "AI is disabled by the platform emergency control.",
          true,
        );
      }
      if (!current.tenant_ai_active || !current.deployment_active) {
        return denied(
          "POLICY_DEPLOYMENT_REVOKED",
          "The tenant policy or pinned deployment is no longer active.",
          true,
        );
      }
      if (!current.membership_active) {
        return denied(
          "POLICY_PERMISSION_MISSING",
          "The acting membership is no longer active.",
          true,
        );
      }
      if (!current.reservation_open) {
        return denied(
          "BUDGET_RESERVATION_FAILED",
          "The run no longer has an open usage reservation.",
          true,
        );
      }
      if (
        description.required_permission &&
        !current.permissions.includes(description.required_permission)
      ) {
        return denied(
          "POLICY_PERMISSION_MISSING",
          "The current membership lacks permission for this action.",
          false,
        );
      }

      const policy_requirement =
        deps.policy.approval_rules[action.tool_name] ?? "none";
      if (
        description.approval_requirement === "manager" ||
        policy_requirement === "manager"
      ) {
        return {
          kind: "approval_required",
          reason_code: "POLICY_APPROVAL_REQUIRED",
          safe_reason: "This action requires an active tenant manager's approval.",
        };
      }
      return { kind: "allowed" };
    },
  };
}
