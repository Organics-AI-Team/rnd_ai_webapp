/**
 * G4 Task 3 — capability card tests.
 *
 * Asserts that every registered governed tool has exactly one card, that
 * card frontmatter matches its ToolDefinition, that bodies carry the
 * required operator sections, that cards respect the size budget, and that
 * orchestrator/agent cards parse with valid frontmatter.
 */

import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Permission } from "@rnd-ai/shared-types";

import {
  get_card_size_budget_chars,
  load_capability_card,
  resolve_cards_root,
} from "../../apps/ai/server/services/ai-control/card-loader";
import { ToolCatalogue } from "../../apps/ai/server/services/ai-control/tool-catalogue";
import {
  create_all_governed_tool_definitions,
  create_not_wired_governed_tool_ports,
} from "../../apps/ai/server/services/ai-control/tools";
import {
  REQUIRED_CARD_SECTIONS,
  make_echo_tool,
  make_temp_cards_root,
  write_card_file,
} from "./helpers";

const AGENT_KEYS = ["raw_material_research", "formulation", "sales_rnd"] as const;

/**
 * Delegation capability cards (G4.6). These are orchestration-level specialist
 * capabilities (packages/ai-orchestration), not ai-control governed
 * ToolDefinitions, so they are a distinct card category rather than orphans.
 */
const DELEGATION_CARD_NAMES = [
  "delegate.raw_material_research",
  "delegate.formulation",
  "delegate.sales_rnd",
] as const;

const EXPECTED_PERMISSION_BY_TOOL = {
  "formula.comment": "formula:comment:create",
  "formula.confirm": "formula:confirm",
  "formula.draft": "formula:draft:create",
  "formula.revise": "formula:draft:update_own",
  "formula.search": "formula:read",
  "knowledge.search": "tenant:knowledge:read",
  // No narrower web-specific permission exists; web search runs inside ai:run.
  "web.search": "ai:run",
} as const satisfies Readonly<Record<string, Permission>>;

/**
 * Build all governed tool definitions with fail-closed NOT_WIRED ports.
 *
 * @returns The seven production ToolDefinitions.
 */
function governed_definitions() {
  return create_all_governed_tool_definitions(
    create_not_wired_governed_tool_ports(),
  );
}

describe("governed tool capability cards", () => {
  it("registers every governed tool, proving each card exists and matches", () => {
    const catalogue = new ToolCatalogue();
    for (const definition of governed_definitions()) {
      catalogue.register(definition);
    }
    expect(catalogue.list().map((definition) => definition.name).sort()).toEqual([
      "formula.comment",
      "formula.confirm",
      "formula.draft",
      "formula.revise",
      "formula.search",
      "knowledge.search",
      "web.search",
    ]);
  });

  it("uses the canonical shared-auth permission for every governed tool", () => {
    const actual = Object.fromEntries(
      governed_definitions().map((definition) => [
        definition.name,
        definition.required_permission,
      ]),
    );
    expect(actual).toEqual(EXPECTED_PERMISSION_BY_TOOL);
  });

  it("has exactly one card file per registered tool plus the delegation cards, no orphans", () => {
    const cards_root = resolve_cards_root();
    const card_files = readdirSync(join(cards_root, "tools"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/, ""))
      .sort();
    // Governed tool cards (one per ai-control ToolDefinition) plus the
    // orchestration-level delegation cards (G4.6) are the only permitted cards.
    const expected = [
      ...governed_definitions().map((definition) => definition.name),
      ...DELEGATION_CARD_NAMES,
    ].sort();
    expect(card_files).toEqual(expected);
  });

  it("keeps card frontmatter aligned with each ToolDefinition", () => {
    for (const definition of governed_definitions()) {
      const card = load_capability_card(definition.capability_card_path);
      expect(card.kind).toBe("tool");
      expect(card.name).toBe(definition.name);
      expect(card.version).toBe(definition.version);
      expect(card.side_effect).toBe(definition.side_effect);
      expect(card.required_permission).toBe(definition.required_permission);
      expect(card.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("contains every required operator section in each tool card", () => {
    for (const definition of governed_definitions()) {
      const card = load_capability_card(definition.capability_card_path);
      for (const section of REQUIRED_CARD_SECTIONS) {
        expect(card.markdown, `${definition.name} missing ${section}`).toContain(
          section,
        );
      }
    }
  });

  it("keeps every card within the configured size budget", () => {
    const budget = get_card_size_budget_chars();
    const cards_root = resolve_cards_root();
    const relative_paths = [
      "orchestrator.md",
      ...AGENT_KEYS.map((key) => join("agents", `${key}.md`)),
      ...governed_definitions().map((definition) => definition.capability_card_path),
      ...DELEGATION_CARD_NAMES.map((name) => join("tools", `${name}.md`)),
    ];
    for (const relative_path of relative_paths) {
      const card = load_capability_card(relative_path, cards_root);
      expect(
        card.markdown.length,
        `${relative_path} exceeds budget ${budget}`,
      ).toBeLessThanOrEqual(budget);
    }
  });

  it("parses the orchestrator card with valid frontmatter", () => {
    const card = load_capability_card("orchestrator.md");
    expect(card.kind).toBe("orchestrator");
    expect(card.name).toBe("orchestrator");
    expect(card.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(card.side_effect).toBeNull();
    expect(card.required_permission).toBeNull();
    expect(card.markdown).toContain("evidence");
  });

  it("parses one agent card per agent key with valid frontmatter", () => {
    for (const agent_key of AGENT_KEYS) {
      const card = load_capability_card(join("agents", `${agent_key}.md`));
      expect(card.kind).toBe("agent");
      expect(card.name).toBe(agent_key);
      expect(card.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe("card enforcement at registration", () => {
  it("fails registration when the capability card is missing", () => {
    const cards_root = make_temp_cards_root();
    const catalogue = new ToolCatalogue();
    const definition = make_echo_tool(cards_root, {
      capability_card_path: join(cards_root, "tools", "missing.md"),
    });
    expect(() => catalogue.register(definition)).toThrowError(
      expect.objectContaining({ code: "TOOL_CARD_MISSING" }),
    );
  });

  it("fails registration when card frontmatter drifts from the definition", () => {
    const cards_root = make_temp_cards_root();
    const catalogue = new ToolCatalogue();
    const drifted_path = write_card_file(
      join(cards_root, "tools", "tool.echo.md"),
      {
        name: "tool.echo",
        version: "9.9.9",
        kind: "tool",
        side_effect: "read",
        required_permission: "formula:read",
      },
    );
    const definition = make_echo_tool(cards_root, {
      capability_card_path: drifted_path,
    });
    expect(() => catalogue.register(definition)).toThrowError(
      expect.objectContaining({ code: "TOOL_CARD_DRIFT" }),
    );
  });

  it("fails registration when the card kind is not tool", () => {
    const cards_root = make_temp_cards_root();
    const catalogue = new ToolCatalogue();
    const agent_card_path = write_card_file(
      join(cards_root, "tools", "tool.echo.md"),
      { name: "tool.echo", version: "1.0.0", kind: "agent" },
    );
    const definition = make_echo_tool(cards_root, {
      capability_card_path: agent_card_path,
    });
    expect(() => catalogue.register(definition)).toThrowError(
      expect.objectContaining({ code: "TOOL_CARD_DRIFT" }),
    );
  });
});

describe("card loader", () => {
  it("rejects malformed frontmatter", () => {
    const cards_root = make_temp_cards_root();
    const bad_path = join(cards_root, "bad.md");
    writeFileSync(bad_path, "# no frontmatter at all\n", "utf8");
    expect(() => load_capability_card(bad_path)).toThrowError(
      expect.objectContaining({ code: "CARD_INVALID" }),
    );
  });

  it("rejects frontmatter that fails the schema", () => {
    const cards_root = make_temp_cards_root();
    const bad_path = write_card_file(join(cards_root, "bad-kind.md"), {
      name: "tool.echo",
      version: "1.0.0",
      kind: "wizard",
    });
    expect(() => load_capability_card(bad_path)).toThrowError(
      expect.objectContaining({ code: "CARD_INVALID" }),
    );
  });

  it("requires side_effect and required_permission on tool cards only", () => {
    const cards_root = make_temp_cards_root();
    const incomplete_tool = write_card_file(join(cards_root, "tool-card.md"), {
      name: "tool.echo",
      version: "1.0.0",
      kind: "tool",
    });
    expect(() => load_capability_card(incomplete_tool)).toThrowError(
      expect.objectContaining({ code: "CARD_INVALID" }),
    );
    const decorated_agent = write_card_file(join(cards_root, "agent-card.md"), {
      name: "formulation",
      version: "1.0.0",
      kind: "agent",
      side_effect: "read",
    });
    expect(() => load_capability_card(decorated_agent)).toThrowError(
      expect.objectContaining({ code: "CARD_INVALID" }),
    );
  });

  it("caches parsed cards by content hash", () => {
    const cards_root = make_temp_cards_root();
    const card_path = write_card_file(join(cards_root, "cached.md"), {
      name: "cached_agent",
      version: "1.0.0",
      kind: "agent",
    });
    const first = load_capability_card(card_path);
    const second = load_capability_card(card_path);
    expect(second).toBe(first);
    write_card_file(join(cards_root, "cached.md"), {
      name: "cached_agent",
      version: "1.0.1",
      kind: "agent",
    });
    const third = load_capability_card(card_path);
    expect(third).not.toBe(first);
    expect(third.version).toBe("1.0.1");
    expect(third.sha256).not.toBe(first.sha256);
  });
});
