/**
 * G4.11 — OODA orchestration-boundary enforcement.
 *
 * The scanner rejects any production caller that drives the governed loop graph
 * directly (`graph.invoke/stream`, `compile_agent_loop_graph(...).invoke/stream`)
 * instead of going through the AI gateway that pins policy, budget, and identity.
 * The orchestration package, the AI gateway, and test files are exempt; unrelated
 * `.invoke`/`.stream` calls (llm, tools, streamEvents, a legacy `this.graph`) must
 * not be flagged.
 */

import { describe, expect, it } from "vitest";

import {
  reject_ooda_boundary_bypass,
  type SecurityFinding,
  type SourceFile,
} from "../../scripts/security/scan-private-boundaries";

/** Build a source fixture at a given repo-relative path. */
function source(path: string, content: string): SourceFile {
  return { path, content };
}

/** Whether any finding carries the OODA bypass code. */
function has_bypass(findings: readonly SecurityFinding[]): boolean {
  return findings.some((finding) => finding.code === "OODA_GATEWAY_BYPASS");
}

const APP_ROUTE = "apps/web/app/api/example/route.ts";

describe("reject_ooda_boundary_bypass", () => {
  it("flags streaming a loop graph held in a local variable", () => {
    const findings = reject_ooda_boundary_bypass(
      source(
        APP_ROUTE,
        "const graph = compile_agent_loop_graph(runtime); await graph.stream(input);",
      ),
    );
    expect(findings).toEqual([
      expect.objectContaining({ code: "OODA_GATEWAY_BYPASS", file: APP_ROUTE }),
    ]);
  });

  it("flags a loop graph bound to any variable name", () => {
    const findings = reject_ooda_boundary_bypass(
      source(APP_ROUTE, "const app = build_agent_loop_graph(rt); const out = await app.invoke(s);"),
    );
    expect(has_bypass(findings)).toBe(true);
  });

  it("flags invoking a freshly compiled loop graph", () => {
    const findings = reject_ooda_boundary_bypass(
      source(
        "apps/ai/server/routes/run.ts",
        "const out = await compile_agent_loop_graph(runtime).invoke(state);",
      ),
    );
    expect(has_bypass(findings)).toBe(true);
  });

  it("exempts the orchestration package (owns the graph and delegation)", () => {
    const findings = reject_ooda_boundary_bypass(
      source(
        "packages/ai-orchestration/src/delegation/delegate-tool-factory.ts",
        "await compile_agent_loop_graph(runtime).invoke(initial_state);",
      ),
    );
    expect(findings).toEqual([]);
  });

  it("exempts the AI gateway itself", () => {
    const findings = reject_ooda_boundary_bypass(
      source(
        "apps/ai/server/services/ai-gateway/ai-gateway.ts",
        "return graph.stream(initial_state);",
      ),
    );
    expect(findings).toEqual([]);
  });

  it("exempts test files", () => {
    const findings = reject_ooda_boundary_bypass(
      source("tests/orchestration/governor.test.ts", "await graph.invoke(state);"),
    );
    expect(findings).toEqual([]);
  });

  it("does not flag unrelated invoke/stream calls", () => {
    const findings = reject_ooda_boundary_bypass(
      source(
        "apps/ai/agents/raw-materials-ai/langgraph-agent.ts",
        [
          "await this.llm.invoke(messages);",
          "await this.tools.search.invoke(args);",
          "await chain.invoke(payload);",
          "await this.graph.invoke(state);", // legacy agent's own graph, not the governed loop
          "const graph = await this.buildGraph(cfg); await graph.invoke(x);", // legacy StateGraph named 'graph'
          "await graph.streamEvents(input);", // streamEvents is not stream
        ].join("\n"),
      ),
    );
    expect(findings).toEqual([]);
  });
});
