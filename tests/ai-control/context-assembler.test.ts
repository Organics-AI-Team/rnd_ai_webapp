/**
 * G4 Task 3 — context assembler tests.
 *
 * Asserts policy-filtered card assembly, stable and drift-sensitive
 * pack hashing, policy digest rendering, and fail-closed behavior when a
 * card is missing or its frontmatter drifts from the tool definition.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ContextAssembler } from "../../apps/ai/server/services/ai-control/context-assembler";
import { ToolCatalogue } from "../../apps/ai/server/services/ai-control/tool-catalogue";
import { validate_context_pack } from "../../packages/ai-orchestration/src/context/context-pack";
import {
  create_all_governed_tool_definitions,
  create_not_wired_governed_tool_ports,
} from "../../apps/ai/server/services/ai-control/tools";
import {
  make_echo_tool,
  make_policy,
  make_temp_cards_root,
  write_card_file,
} from "./helpers";

/**
 * Build an assembler over the production catalogue and cards directory.
 *
 * @returns ContextAssembler with all seven governed tools registered.
 */
function make_production_assembler(): ContextAssembler {
  const catalogue = new ToolCatalogue();
  for (const definition of create_all_governed_tool_definitions(
    create_not_wired_governed_tool_ports(),
  )) {
    catalogue.register(definition);
  }
  return new ContextAssembler({ catalogue });
}

/**
 * Build an assembler over a synthetic temp cards root with one echo tool.
 *
 * @returns Assembler, temp cards root, and the registered tool name.
 */
function make_synthetic_assembler() {
  const cards_root = make_temp_cards_root();
  write_card_file(join(cards_root, "orchestrator.md"), {
    name: "orchestrator",
    version: "1.0.0",
    kind: "orchestrator",
  });
  write_card_file(join(cards_root, "agents", "formulation.md"), {
    name: "formulation",
    version: "1.0.0",
    kind: "agent",
  });
  const catalogue = new ToolCatalogue({ cards_root });
  catalogue.register(make_echo_tool(cards_root));
  const assembler = new ContextAssembler({ catalogue, cards_root });
  return { assembler, cards_root };
}

describe("context assembler", () => {
  it("excludes cards for tools outside the tenant policy allowlist", async () => {
    const assembler = make_production_assembler();
    const pack = await assembler.assemble({
      agent_key: "formulation",
      policy: make_policy({ allowed_tools: ["knowledge.search"] }),
    });
    expect(Object.keys(pack.tool_cards)).toEqual(["knowledge.search"]);
    expect(pack.pack_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns a ContextPackV1-shaped object", async () => {
    const assembler = make_production_assembler();
    const pack = await assembler.assemble({
      agent_key: "raw_material_research",
      policy: make_policy(),
    });
    expect(pack.schema_version).toBe("1");
    expect(pack.orchestrator_card).toMatchObject({
      name: "orchestrator",
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(pack.orchestrator_card.markdown.length).toBeGreaterThan(0);
    expect(pack.agent_card).toMatchObject({ name: "raw_material_research" });
    expect(() => validate_context_pack(pack)).not.toThrow();
    expect(Object.keys(pack.tool_cards).sort()).toEqual([
      "formula.comment",
      "formula.confirm",
      "formula.draft",
      "formula.revise",
      "formula.search",
      "knowledge.search",
      "web.search",
    ]);
    for (const tool_card of Object.values(pack.tool_cards)) {
      expect(tool_card.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(tool_card.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(tool_card.markdown.length).toBeGreaterThan(0);
    }
  });

  it("computes a stable pack_hash for identical inputs", async () => {
    const assembler = make_production_assembler();
    const runtime = { agent_key: "formulation", policy: make_policy() };
    const first = await assembler.assemble(runtime);
    const second = await assembler.assemble(runtime);
    expect(second.pack_hash).toBe(first.pack_hash);
  });

  it("changes pack_hash when the policy changes", async () => {
    const assembler = make_production_assembler();
    const full = await assembler.assemble({
      agent_key: "formulation",
      policy: make_policy(),
    });
    const narrowed = await assembler.assemble({
      agent_key: "formulation",
      policy: make_policy({ allowed_tools: ["knowledge.search"] }),
    });
    expect(narrowed.pack_hash).not.toBe(full.pack_hash);
  });

  it("changes pack_hash when any card content changes", async () => {
    const { assembler, cards_root } = make_synthetic_assembler();
    const runtime = {
      agent_key: "formulation",
      policy: make_policy({ allowed_tools: ["tool.echo"] }),
    };
    const before = await assembler.assemble(runtime);
    write_card_file(
      join(cards_root, "tools", "tool.echo.md"),
      {
        name: "tool.echo",
        version: "1.0.0",
        kind: "tool",
        side_effect: "read",
        required_permission: "tool:echo",
      },
      "## Purpose\n\nUpdated body changes the hash.\n",
    );
    const after = await assembler.assemble(runtime);
    expect(after.pack_hash).not.toBe(before.pack_hash);
  });

  it("renders budgets, boundary, approvals, and disallowed actions in the digest", async () => {
    const assembler = make_production_assembler();
    const policy = make_policy({
      allowed_tools: ["formula.search", "formula.confirm"],
    });
    const pack = await assembler.assemble({ agent_key: "sales_rnd", policy });
    expect(pack.policy_digest.markdown).toContain(String(policy.max_iterations));
    expect(pack.policy_digest.markdown).toContain(policy.per_run_token_limit.toString());
    expect(pack.policy_digest.markdown).toContain(
      policy.per_run_cost_limit_microusd.toString(),
    );
    expect(pack.policy_digest.markdown).toContain(policy.tenant_id);
    expect(pack.policy_digest.markdown).toContain("formula.confirm");
    expect(pack.policy_digest.markdown).toContain("manager");
    expect(pack.policy_digest.markdown).toContain("web.search");
    expect(pack.policy_digest.markdown).toContain("not available");
  });

  it("fails closed when the agent card is missing", async () => {
    const assembler = make_production_assembler();
    await expect(
      assembler.assemble({ agent_key: "unknown_agent", policy: make_policy() }),
    ).rejects.toMatchObject({ code: "CONTEXT_CARD_MISSING" });
  });

  it("fails closed when a tool card drifts after registration", async () => {
    const { assembler, cards_root } = make_synthetic_assembler();
    write_card_file(join(cards_root, "tools", "tool.echo.md"), {
      name: "tool.echo",
      version: "2.0.0",
      kind: "tool",
      side_effect: "read",
      required_permission: "tool:echo",
    });
    await expect(
      assembler.assemble({
        agent_key: "formulation",
        policy: make_policy({ allowed_tools: ["tool.echo"] }),
      }),
    ).rejects.toMatchObject({ code: "CONTEXT_CARD_DRIFT" });
  });

  it("fails closed when the tenant policy disables AI", async () => {
    const assembler = make_production_assembler();
    await expect(
      assembler.assemble({
        agent_key: "formulation",
        policy: make_policy({ enabled: false }),
      }),
    ).rejects.toMatchObject({ code: "POLICY_DISABLED" });
  });
});
