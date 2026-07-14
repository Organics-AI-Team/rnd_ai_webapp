/**
 * Context assembler (G4 Task 3, Step 9; agentic design §4.2).
 *
 * Builds the ContextPackV1 injected into the orchestrator system context at
 * run ingress: orchestrator contract card + agent card for the run's
 * agent_key + a plain-language policy digest rendered from the pinned
 * EffectiveAIPolicy + capability cards for ONLY the policy-allowed tools.
 * Every card is pinned by SHA-256 and the pack carries a deterministic
 * pack_hash so any run is reproducible and auditable. Assembly fails
 * closed on a missing card, frontmatter drift, or a disabled policy.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { join } from "node:path";

import { load_capability_card, resolve_cards_root } from "./card-loader";
import { ToolGovernanceError } from "./errors";
import { sha256_hex } from "./hashing";
import { log_error, log_info } from "./logger";
import type { EffectiveAIPolicy } from "./policy-types";
import type { ToolCatalogue } from "./tool-catalogue";
import type { AnyToolDefinition } from "./tool-definition";

const MODULE = "context-assembler";

/** Version of the ContextPack contract produced by this assembler. */
export const CONTEXT_PACK_SCHEMA_VERSION = "1";

/** One pinned card entry inside a context pack. */
export interface ContextPackCard {
  readonly name: string;
  readonly version: string;
  readonly sha256: string;
  readonly markdown: string;
}

/** ContextPackV1-shaped assembly result (validated again in G4.2's package). */
export interface ContextPackV1 {
  readonly schema_version: typeof CONTEXT_PACK_SCHEMA_VERSION;
  readonly orchestrator_card: ContextPackCard;
  readonly agent_card: ContextPackCard;
  readonly policy_digest: string;
  readonly tool_cards: Readonly<Record<string, ContextPackCard>>;
  readonly pack_hash: string;
}

/** Runtime inputs for one assembly (pins resolved by the AI gateway). */
export interface ContextAssemblyRuntime {
  /** Agent key pinned via AgentDeployment/PromptVersion, e.g. "formulation". */
  readonly agent_key: string;
  /** Immutable compiled tenant policy snapshot pinned on the run. */
  readonly policy: EffectiveAIPolicy;
}

/** Constructor options for the assembler. */
export interface ContextAssemblerOptions {
  /** Governed tool catalogue whose definitions are card-verified. */
  readonly catalogue: ToolCatalogue;
  /** Cards root override; defaults to the repository cards directory. */
  readonly cards_root?: string;
}

/**
 * Render the plain-language policy digest injected into the system context
 * so the model plans within constraints instead of discovering them
 * through gate denials. Deterministic ordering for stable pack hashes.
 *
 * @param policy - Pinned effective tenant policy.
 * @param allowed_tools - Tool names allowed for this run, sorted.
 * @param disallowed_tools - Registered tool names excluded by policy, sorted.
 * @returns Markdown policy digest.
 */
function render_policy_digest(
  policy: EffectiveAIPolicy,
  allowed_tools: readonly string[],
  disallowed_tools: readonly string[],
): string {
  const approval_lines = Object.entries(policy.approval_rules)
    .filter(([tool_name, rule]) => rule !== "none" && allowed_tools.includes(tool_name))
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([tool_name, rule]) => `- \`${tool_name}\`: requires ${rule} approval before it can run.`);
  const disallowed_lines = disallowed_tools.map(
    (tool_name) => `- \`${tool_name}\` is not available in this run; never propose it.`,
  );
  return [
    `# Policy digest (tenant ${policy.tenant_id}, policy v${policy.version}, hash ${policy.hash})`,
    "",
    "## Budgets",
    `- Maximum reasoning iterations this run: ${policy.max_iterations}`,
    `- Per-run token limit: ${policy.per_run_token_limit.toString()} tokens`,
    `- Per-run cost limit: ${policy.per_run_cost_limit_microusd.toString()} micro-USD`,
    "- Exhausting any budget ends the run; plan the shortest useful tool sequence.",
    "",
    "## Tenant boundary",
    `- All data access is confined to tenant ${policy.tenant_id}. Cross-tenant data does not exist for you.`,
    "- Identity, permissions, and data scope are injected by trusted code; tool arguments never carry them.",
    "",
    "## Approval rules",
    ...(approval_lines.length > 0 ? approval_lines : ["- No tool in this run requires prior approval."]),
    "",
    "## Allowed tools",
    ...allowed_tools.map((tool_name) => `- \`${tool_name}\``),
    "",
    "## Disallowed actions",
    ...(disallowed_lines.length > 0
      ? disallowed_lines
      : ["- No registered tool is excluded for this run."]),
    "- A gate denial is final for this run; never retry a denied action unchanged.",
  ].join("\n");
}

/**
 * Assemble validated, policy-filtered, hash-pinned context packs.
 */
export class ContextAssembler {
  private readonly catalogue: ToolCatalogue;
  private readonly cards_root: string;

  /**
   * Create an assembler bound to a catalogue and cards root.
   *
   * @param options - Catalogue plus optional cards root override.
   */
  constructor(options: ContextAssemblerOptions) {
    this.catalogue = options.catalogue;
    this.cards_root = options.cards_root ?? resolve_cards_root();
  }

  /**
   * Assemble the ContextPackV1 for one run.
   *
   * @param runtime - Agent key and pinned policy for the run.
   * @returns Immutable ContextPackV1 with deterministic pack_hash.
   * @throws ToolGovernanceError POLICY_DISABLED when AI is off,
   *         CONTEXT_CARD_MISSING when the orchestrator/agent/tool card is
   *         absent, CONTEXT_CARD_DRIFT when a tool card no longer matches
   *         its registered definition.
   */
  async assemble(runtime: ContextAssemblyRuntime): Promise<ContextPackV1> {
    log_info(MODULE, "assemble — start", {
      agent_key: runtime.agent_key,
      tenant_id: runtime.policy.tenant_id,
      policy_version: runtime.policy.version,
    });
    if (!runtime.policy.enabled) {
      throw new ToolGovernanceError(
        "POLICY_DISABLED",
        "Cannot assemble a context pack: AI is disabled by the tenant policy.",
      );
    }
    const orchestrator_card = this.load_pack_card("orchestrator.md", "orchestrator");
    const agent_card = this.load_pack_card(
      join("agents", `${runtime.agent_key}.md`),
      "agent",
      runtime.agent_key,
    );

    const allowed_definitions = this.catalogue.filter_by_policy(runtime.policy);
    const disallowed_tools = this.catalogue
      .list()
      .map((definition) => definition.name)
      .filter((name) => !allowed_definitions.some((definition) => definition.name === name))
      .sort();
    const tool_cards: Record<string, ContextPackCard> = {};
    for (const definition of [...allowed_definitions].sort((left, right) =>
      left.name < right.name ? -1 : 1,
    )) {
      tool_cards[definition.name] = this.load_tool_card(definition);
    }

    const allowed_tool_names = Object.keys(tool_cards);
    const policy_digest = render_policy_digest(
      runtime.policy,
      allowed_tool_names,
      disallowed_tools,
    );
    const pack_hash = this.compute_pack_hash(
      orchestrator_card,
      agent_card,
      tool_cards,
      policy_digest,
    );
    log_info(MODULE, "assemble — done", {
      agent_key: runtime.agent_key,
      tool_count: allowed_tool_names.length,
      pack_hash: pack_hash.slice(0, 12),
    });
    return {
      schema_version: CONTEXT_PACK_SCHEMA_VERSION,
      orchestrator_card,
      agent_card,
      policy_digest,
      tool_cards,
      pack_hash,
    };
  }

  /**
   * Load an orchestrator or agent card, failing closed when absent or of
   * the wrong kind/name.
   *
   * @param relative_path - Card path relative to the cards root.
   * @param expected_kind - Required card kind.
   * @param expected_name - Required frontmatter name (defaults to kind).
   * @returns Pinned ContextPackCard.
   * @throws ToolGovernanceError CONTEXT_CARD_MISSING.
   */
  private load_pack_card(
    relative_path: string,
    expected_kind: "orchestrator" | "agent",
    expected_name?: string,
  ): ContextPackCard {
    try {
      const card = load_capability_card(relative_path, this.cards_root);
      if (card.kind !== expected_kind || card.name !== (expected_name ?? expected_kind)) {
        throw new ToolGovernanceError(
          "CONTEXT_CARD_MISSING",
          `Card ${relative_path} does not declare kind=${expected_kind} name=${expected_name ?? expected_kind}.`,
        );
      }
      return {
        name: card.name,
        version: card.version,
        sha256: card.sha256,
        markdown: card.markdown,
      };
    } catch (error) {
      throw this.as_fail_closed(error, relative_path);
    }
  }

  /**
   * Load a tool card and re-verify frontmatter against the registered
   * definition, so post-registration drift fails closed at ingress.
   *
   * @param definition - Registered tool definition.
   * @returns Pinned ContextPackCard for the tool.
   * @throws ToolGovernanceError CONTEXT_CARD_MISSING or CONTEXT_CARD_DRIFT.
   */
  private load_tool_card(definition: AnyToolDefinition): ContextPackCard {
    try {
      const card = load_capability_card(
        definition.capability_card_path,
        this.cards_root,
      );
      const matches =
        card.kind === "tool" &&
        card.name === definition.name &&
        card.version === definition.version &&
        card.side_effect === definition.side_effect &&
        card.required_permission === definition.required_permission;
      if (!matches) {
        throw new ToolGovernanceError(
          "CONTEXT_CARD_DRIFT",
          `Capability card for ${definition.name} no longer matches its registered definition.`,
        );
      }
      return {
        name: card.name,
        version: card.version,
        sha256: card.sha256,
        markdown: card.markdown,
      };
    } catch (error) {
      throw this.as_fail_closed(error, definition.capability_card_path);
    }
  }

  /**
   * Compute the deterministic pack hash over every card hash and the
   * policy digest.
   *
   * @param orchestrator_card - Pinned orchestrator card.
   * @param agent_card - Pinned agent card.
   * @param tool_cards - Pinned tool cards keyed by tool name.
   * @param policy_digest - Rendered policy digest markdown.
   * @returns SHA-256 hex pack hash.
   */
  private compute_pack_hash(
    orchestrator_card: ContextPackCard,
    agent_card: ContextPackCard,
    tool_cards: Readonly<Record<string, ContextPackCard>>,
    policy_digest: string,
  ): string {
    const lines = [
      `orchestrator:${orchestrator_card.sha256}`,
      `agent:${agent_card.name}:${agent_card.sha256}`,
      ...Object.entries(tool_cards)
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([name, card]) => `tool:${name}:${card.sha256}`),
      `policy_digest:${sha256_hex(policy_digest)}`,
    ];
    return sha256_hex(lines.join("\n"));
  }

  /**
   * Normalize load errors into fail-closed context errors.
   *
   * @param error - Original thrown value.
   * @param card_path - Card path for the safe message.
   * @returns ToolGovernanceError with a CONTEXT_* or original code.
   */
  private as_fail_closed(error: unknown, card_path: string): ToolGovernanceError {
    if (error instanceof ToolGovernanceError) {
      log_error(MODULE, "assemble — card failure", {
        card: card_path,
        code: error.code,
      });
      if (error.code === "TOOL_CARD_MISSING" || error.code === "CARD_INVALID") {
        return new ToolGovernanceError(
          "CONTEXT_CARD_MISSING",
          `Context assembly failed closed: card ${card_path} is missing or invalid.`,
        );
      }
      return error;
    }
    log_error(MODULE, "assemble — unexpected card failure", { card: card_path });
    return new ToolGovernanceError(
      "CONTEXT_CARD_MISSING",
      `Context assembly failed closed loading card ${card_path}.`,
    );
  }
}
