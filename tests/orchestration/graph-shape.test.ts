import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compile_agent_loop_graph } from "../../packages/ai-orchestration/src/graph";
import { make_fake_runtime } from "./helpers/fake_runtime";

const package_src = resolve(
  __dirname,
  "..",
  "..",
  "packages",
  "ai-orchestration",
  "src",
);

/**
 * Recursively collect TypeScript sources under the orchestration src tree.
 *
 * @param directory - Absolute directory to walk.
 * @returns Absolute .ts file paths.
 */
function collect_sources(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full_path = join(directory, entry);
    if (statSync(full_path).isDirectory()) {
      collected.push(...collect_sources(full_path));
    } else if (entry.endsWith(".ts")) {
      collected.push(full_path);
    }
  }
  return collected;
}

describe("governed agentic loop graph shape", () => {
  const { runtime } = make_fake_runtime();
  const compiled = compile_agent_loop_graph(runtime);
  const drawable = compiled.getGraph();

  it("contains exactly the governed loop nodes", () => {
    const nodes = Object.keys(drawable.nodes)
      .filter((name) => !name.startsWith("__"))
      .sort();
    expect(nodes).toEqual([
      "act",
      "agent",
      "fail",
      "finalize",
      "gate",
      "ingress",
      "request_approval",
      "request_clarification",
    ]);
  });

  it("allows exactly the governed loop edges", () => {
    const edges = drawable.edges
      .map((edge) => `${edge.source}->${edge.target}`)
      .sort();
    expect(edges).toEqual(
      [
        "__start__->ingress",
        "ingress->agent",
        "agent->gate",
        "agent->request_clarification",
        "agent->finalize",
        "agent->fail",
        "gate->act",
        "gate->request_approval",
        "gate->agent",
        "gate->fail",
        "act->agent",
        "request_clarification->agent",
        "request_approval->gate",
        "finalize->__end__",
        "fail->__end__",
      ].sort(),
    );
  });

  it("keeps agent as the only model-facing node", () => {
    const files_touching_model: string[] = [];
    for (const file of collect_sources(package_src)) {
      const source = readFileSync(file, "utf8");
      if (/\bcomplete_turn\s*\(/.test(source) && !file.endsWith("ports.ts")) {
        files_touching_model.push(file.slice(package_src.length + 1));
      }
    }
    const allowed = new Set(["nodes/agent.ts"]);
    expect(
      files_touching_model.filter((file) => !allowed.has(file)),
    ).toEqual([]);
  });

  it("has no fixed phase channel in the loop state", async () => {
    const state_module = await import(
      "../../packages/ai-orchestration/src/state"
    );
    const channels = Object.keys(state_module.AgentLoopState.spec);
    expect(channels).not.toContain("phase");
    for (const required of [
      "run_id",
      "tenant_id",
      "iteration",
      "context_pack",
      "observations",
      "action_results",
      "decision_log",
      "events",
      "warnings",
      "pending_action",
      "output",
      "error",
    ]) {
      expect(channels, `channel ${required}`).toContain(required);
    }
  });
});
