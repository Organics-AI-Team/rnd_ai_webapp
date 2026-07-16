/**
 * G6.5 — orchestrator guide drift test.
 *
 * The developer/operator guide (docs/ai/orchestrator-guide.md) must mention
 * every registered governed tool, every delegation card, every agent key,
 * and every required card section — so adding a tool without documenting it
 * fails CI, exactly like the card no-orphan test.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  create_all_governed_tool_definitions,
  create_not_wired_governed_tool_ports,
} from "../../apps/ai/server/services/ai-control/tools";
import { REQUIRED_CARD_SECTIONS } from "./helpers";

const repository_root = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const AGENT_KEYS = ["raw_material_research", "formulation", "sales_rnd"] as const;
const DELEGATION_CARD_NAMES = [
  "delegate.raw_material_research",
  "delegate.formulation",
  "delegate.sales_rnd",
] as const;

/**
 * Read the orchestrator guide source.
 *
 * @returns Guide markdown contents.
 */
function guide_source(): string {
  return readFileSync(
    join(repository_root, "docs/ai/orchestrator-guide.md"),
    "utf8",
  );
}

describe("orchestrator guide (docs/ai/orchestrator-guide.md)", () => {
  it("documents every registered governed tool", () => {
    const guide = guide_source();
    const definitions = create_all_governed_tool_definitions(
      create_not_wired_governed_tool_ports(),
    );
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(guide, `guide missing tool ${definition.name}`).toContain(
        `\`${definition.name}\``,
      );
      expect(
        guide,
        `guide missing permission ${definition.required_permission}`,
      ).toContain(definition.required_permission);
    }
  });

  it("documents every delegation capability and agent persona", () => {
    const guide = guide_source();
    for (const name of DELEGATION_CARD_NAMES) {
      expect(guide, `guide missing delegation ${name}`).toContain(name);
    }
    for (const agent_key of AGENT_KEYS) {
      expect(guide, `guide missing agent ${agent_key}`).toContain(agent_key);
    }
  });

  it("documents the required capability-card sections for tool authors", () => {
    const guide = guide_source();
    for (const section of REQUIRED_CARD_SECTIONS) {
      const heading = section.replace(/^## /, "");
      expect(guide, `guide missing card section ${heading}`).toContain(heading);
    }
  });

  it("documents the reasoning chain, search ordering, and model pinning", () => {
    const guide = guide_source();
    for (const anchor of [
      "request_clarification",
      "request_approval",
      "finalize",
      "knowledge.search",
      "web.search",
      "PLATFORM_PROVIDER_UNIVERSE",
      "run.model",
      "Last-Event-ID",
    ]) {
      expect(guide, `guide missing anchor ${anchor}`).toContain(anchor);
    }
  });
});
