/**
 * Specialist delegation service (G4.6).
 *
 * Runs a specialist as a recursive invocation of the SAME governed loop graph:
 * a fresh child run with inherited tenant/actor identity, a context pack
 * filtered to the specialist's allowlist (minus every delegation tool), a
 * budget slice reserved from the parent BEFORE dispatch, and run-ID lineage
 * (parent_run_id, depth+1). Delegation depth is capped at 1 — a specialist can
 * never delegate. The specialist commits nothing: its result returns normalized
 * observations and non-commit proposals to the parent loop, which alone selects
 * the next action.
 *
 * The recursive graph run is injected as `run_child_loop` (defaulting to the
 * real compiled graph) and the filtered child context pack is injected as
 * `build_child_context_pack`, so this module stays free of the context-assembly
 * and provider wiring the gateway owns.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { ContextPackV1 } from "../context/context-pack";
import type { AgentRunInputV1, RunBudgetV1, RunPinsV1 } from "../contracts";
import { compile_agent_loop_graph } from "../graph";
import type {
  AgentLoopRuntime,
  PolicyEngine,
  TrustedRuntimeContext,
} from "../ports";
import { log_loop_event } from "../ports";
import {
  build_initial_loop_state,
  type AgentLoopStateType,
} from "../state";
import {
  get_specialist,
  is_read_only_specialist,
  MAX_DELEGATION_DEPTH,
  type SpecialistDefinition,
} from "./delegation-registry";
import {
  specialist_request_v1_schema,
  type SpecialistProposalV1,
  type SpecialistRequestV1,
  type SpecialistResultV1,
} from "../schemas/specialist";

/** Stable delegation failure codes. */
export type DelegationErrorCode =
  | "DELEGATION_UNKNOWN_SPECIALIST"
  | "DELEGATION_INPUT_INVALID"
  | "DELEGATION_DEPTH_EXCEEDED"
  | "DELEGATION_BUDGET_INSUFFICIENT"
  | "DELEGATION_NOT_READ_ONLY"
  | "DELEGATION_INVARIANT_VIOLATION";

/** Typed delegation failure. */
export class DelegationError extends Error {
  public readonly code: DelegationErrorCode;

  /**
   * @param code - Stable failure code.
   * @param message - Safe description.
   */
  constructor(code: DelegationErrorCode, message: string) {
    super(message);
    this.name = "DelegationError";
    this.code = code;
  }
}

/**
 * Wrap a policy engine so any tool outside the specialist's allowlist is denied
 * (non-fatal) at the gate — defence in depth beyond the filtered context pack,
 * so a specialist can never execute a tool it was not granted (including any
 * commit-class or delegation tool).
 *
 * @param policy - The parent policy engine.
 * @param allowed - The specialist's allowed tool names.
 * @returns A policy engine that denies out-of-allowlist tools first.
 */
function restrict_policy_to_allowlist(
  policy: PolicyEngine,
  allowed: ReadonlySet<string>,
): PolicyEngine {
  return {
    async evaluate_action(action, context) {
      if (!allowed.has(action.tool_name)) {
        return {
          kind: "denied",
          reason_code: "TOOL_NOT_IN_SPECIALIST_ALLOWLIST",
          safe_reason: "That tool is not available to this specialist.",
          fatal: false,
        };
      }
      return policy.evaluate_action(action, context);
    },
  };
}

/** Runs a child loop to completion and returns its final state. */
export type ChildLoopRunner = (
  runtime: AgentLoopRuntime,
  initial_state: ReturnType<typeof build_initial_loop_state>,
) => Promise<AgentLoopStateType>;

/** Dependencies for the delegation service (bound per parent run). */
export interface DelegationServiceDeps {
  /** The parent run's runtime (ports, policy, config, trusted context). */
  readonly parent_runtime: AgentLoopRuntime;
  /** The parent run's remaining budget; each delegation reserves a slice. */
  readonly parent_budget: RunBudgetV1;
  /** Thread the specialist run belongs to (inherited from the parent). */
  readonly parent_thread_id: string;
  /** Version pins inherited by the child (context_pack_hash is overwritten). */
  readonly parent_pins: RunPinsV1;
  /** Deterministic child run start/deadline timestamps. */
  readonly started_at: string;
  readonly deadline_at: string;
  /** Build a context pack filtered to the specialist's allowed tools. */
  readonly build_child_context_pack: (
    definition: SpecialistDefinition,
    allowed_tools: readonly string[],
  ) => ContextPackV1;
  /** Injected loop runner; defaults to the real compiled graph. */
  readonly run_child_loop?: ChildLoopRunner;
}

/** The delegation service surface. */
export interface DelegationService {
  invoke(
    specialist_key: string,
    request: SpecialistRequestV1,
  ): Promise<SpecialistResultV1>;
  invoke_parallel(
    branches: ReadonlyArray<{ specialist_key: string; request: SpecialistRequestV1 }>,
  ): Promise<SpecialistResultV1[]>;
}

/**
 * Reserve a budget slice for a specialist from the parent's remaining budget.
 *
 * @param parent - The parent run budget.
 * @param definition - The specialist (fraction + iteration ceiling).
 * @returns The reserved child budget.
 * @throws DelegationError DELEGATION_BUDGET_INSUFFICIENT when the slice rounds
 *         to no usable tokens.
 */
function reserve_budget(
  parent: RunBudgetV1,
  definition: SpecialistDefinition,
): RunBudgetV1 {
  const fraction = definition.budget_fraction;
  const max_iterations = Math.max(
    1,
    Math.min(definition.max_iterations, Math.floor(parent.max_iterations * fraction)),
  );
  const max_total_tokens = Math.floor(parent.max_total_tokens * fraction);
  const max_cost_usd = (Number(parent.max_cost_usd) * fraction).toFixed(4);
  if (max_total_tokens < 1 || Number(max_cost_usd) <= 0) {
    throw new DelegationError(
      "DELEGATION_BUDGET_INSUFFICIENT",
      `The reserved budget slice for '${definition.key}' is too small to run.`,
    );
  }
  return { max_iterations, max_total_tokens, max_cost_usd };
}

/**
 * Create the delegation service for one parent run.
 *
 * @param deps - Parent runtime/budget, pins, timestamps, and injected builders.
 * @returns A DelegationService bound to the parent run.
 */
export function create_delegation_service(
  deps: DelegationServiceDeps,
): DelegationService {
  const run_child_loop: ChildLoopRunner =
    deps.run_child_loop ??
    (async (runtime, initial_state) =>
      (await compile_agent_loop_graph(runtime).invoke(initial_state)) as AgentLoopStateType);

  const parent_context = deps.parent_runtime.context;

  /**
   * Resolve and validate a specialist for delegation, enforcing the depth cap.
   *
   * @param specialist_key - Key with or without the delegation prefix.
   * @param request - The public delegation request.
   * @returns The resolved definition and validated request.
   * @throws DelegationError on unknown specialist, invalid input, or depth.
   */
  function resolve(
    specialist_key: string,
    request: SpecialistRequestV1,
  ): { definition: SpecialistDefinition; parsed: SpecialistRequestV1 } {
    const definition = get_specialist(specialist_key);
    if (!definition) {
      throw new DelegationError(
        "DELEGATION_UNKNOWN_SPECIALIST",
        `Unknown specialist '${specialist_key}'.`,
      );
    }
    if (parent_context.delegation_depth + 1 > MAX_DELEGATION_DEPTH) {
      throw new DelegationError(
        "DELEGATION_DEPTH_EXCEEDED",
        "A specialist cannot delegate; delegation depth is capped at 1.",
      );
    }
    const validation = specialist_request_v1_schema.safeParse(request);
    if (!validation.success) {
      throw new DelegationError(
        "DELEGATION_INPUT_INVALID",
        "The delegation request is invalid.",
      );
    }
    return { definition, parsed: validation.data };
  }

  /**
   * Run one specialist with a pre-reserved budget slice.
   *
   * @param definition - The specialist to run.
   * @param request - The validated request.
   * @param child_budget - The reserved budget slice.
   * @param child_run_id - Fresh run ID for the child.
   * @returns The specialist result mapped from the child loop output.
   */
  async function run_one(
    definition: SpecialistDefinition,
    request: SpecialistRequestV1,
    child_budget: RunBudgetV1,
    child_run_id: string,
  ): Promise<SpecialistResultV1> {
    const child_context: TrustedRuntimeContext = {
      ...parent_context,
      run_id: child_run_id,
      parent_run_id: parent_context.run_id,
      delegation_depth: parent_context.delegation_depth + 1,
    };
    // The allowlist already excludes delegation tools (validated at
    // registration); filter again defensively before building the pack.
    const allowed_tools = definition.tool_allowlist.filter(
      (tool) => !tool.startsWith("delegate."),
    );
    const context_pack = deps.build_child_context_pack(definition, allowed_tools);

    const objective =
      request.context_note && request.context_note.length > 0
        ? `${request.objective}\n\nContext: ${request.context_note}`
        : request.objective;
    const child_input: AgentRunInputV1 = {
      schema_version: "1",
      thread_id: deps.parent_thread_id,
      agent_key: definition.key,
      message: objective,
      attachment_source_ids: [],
      response_preferences: { language: "en", detail: "standard" },
      idempotency_key: `${parent_context.run_id}:delegate:${definition.key}:${child_run_id}`,
    } as AgentRunInputV1;

    const child_runtime: AgentLoopRuntime = {
      ...deps.parent_runtime,
      context: child_context,
      policy: restrict_policy_to_allowlist(
        deps.parent_runtime.policy,
        new Set(allowed_tools),
      ),
    };

    const initial_state = build_initial_loop_state({
      run_id: child_run_id,
      thread_id: deps.parent_thread_id,
      tenant_id: child_context.tenant_id,
      actor_profile_id: child_context.actor_profile_id,
      input: child_input,
      context_pack,
      pins: { ...deps.parent_pins, context_pack_hash: context_pack.pack_hash },
      budget: child_budget,
      started_at: deps.started_at,
      deadline_at: deps.deadline_at,
    });

    log_loop_event(deps.parent_runtime, "info", "delegation.dispatch", {
      specialist: definition.key,
      child_run_id,
      depth: child_context.delegation_depth,
    });

    const final = await run_child_loop(child_runtime, initial_state);
    return map_result(definition, child_context, final);
  }

  /**
   * Map a completed child loop state to a specialist result, deriving non-commit
   * proposals from the tools the specialist actually executed.
   *
   * @param definition - The specialist.
   * @param child_context - The child trusted context (tenant/lineage source).
   * @param final - The child loop's final state.
   * @returns The specialist result.
   * @throws DelegationError DELEGATION_INVARIANT_VIOLATION if the specialist
   *         somehow executed a commit-class tool.
   */
  function map_result(
    definition: SpecialistDefinition,
    child_context: TrustedRuntimeContext,
    final: AgentLoopStateType,
  ): SpecialistResultV1 {
    const output = final.output;
    const proposals: SpecialistProposalV1[] = [];
    for (const result of final.action_results) {
      if (result.status !== "ok") continue;
      const definition_meta = deps.parent_runtime.ports.tools.describe(
        result.tool_name,
        child_context,
      );
      const side_effect = definition_meta?.side_effect ?? "read";
      if (side_effect === "commit") {
        throw new DelegationError(
          "DELEGATION_INVARIANT_VIOLATION",
          `Specialist '${definition.key}' executed a commit tool.`,
        );
      }
      proposals.push({
        tool_name: result.tool_name,
        side_effect,
        summary: `Executed ${result.tool_name}.`,
      });
    }
    return {
      specialist_key: definition.key,
      tenant_id: child_context.tenant_id,
      parent_run_id: parent_context.run_id,
      depth: child_context.delegation_depth,
      status: output?.status === "completed" ? "complete" : "incomplete",
      summary: output?.answer ?? "",
      evidence_ids: (output?.citations ?? []).map((citation) => citation.source_id),
      proposals,
      uncertainty: output?.warnings ?? [],
    };
  }

  return {
    async invoke(specialist_key, request) {
      const { definition, parsed } = resolve(specialist_key, request);
      const child_budget = reserve_budget(deps.parent_budget, definition);
      const child_run_id = deps.parent_runtime.ports.ids.next_id();
      return run_one(definition, parsed, child_budget, child_run_id);
    },

    async invoke_parallel(branches) {
      // Every branch must be read-only, and the total reserved budget must fit
      // within the parent, reserved BEFORE any dispatch.
      const resolved = branches.map(({ specialist_key, request }) =>
        resolve(specialist_key, request),
      );
      for (const { definition } of resolved) {
        if (!is_read_only_specialist(definition)) {
          throw new DelegationError(
            "DELEGATION_NOT_READ_ONLY",
            `Parallel delegation requires read-only specialists; '${definition.key}' is not.`,
          );
        }
      }
      const total_fraction = resolved.reduce(
        (sum, { definition }) => sum + definition.budget_fraction,
        0,
      );
      if (total_fraction > 1) {
        throw new DelegationError(
          "DELEGATION_BUDGET_INSUFFICIENT",
          "The combined reserved budget for parallel delegation exceeds the parent budget.",
        );
      }
      const reservations = resolved.map(({ definition, parsed }) => ({
        definition,
        parsed,
        budget: reserve_budget(deps.parent_budget, definition),
        child_run_id: deps.parent_runtime.ports.ids.next_id(),
      }));
      return Promise.all(
        reservations.map(({ definition, parsed, budget, child_run_id }) =>
          run_one(definition, parsed, budget, child_run_id),
        ),
      );
    },
  };
}
