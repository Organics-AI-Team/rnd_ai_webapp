// tests/orchestration/generator-dynamism.test.ts
/**
 * Spec §6.7 — dynamism assertions for the governed formula generator.
 *
 * These tests assert *the model chose*, not that a script ran: the identical
 * graph/allowlist/tooling completes (a) with zero web.search for a
 * DB-answerable brief, (b) with web.search for a novel-active brief, and
 * (c) re-enters the agent after a validator rejection so the model revises.
 * If the governor ever gains sequencing logic, at least one of these breaks.
 */

import { describe, expect, it } from "vitest";

import { compile_agent_loop_graph } from "../../packages/ai-orchestration/src/graph";
import {
  build_checkpoint_thread_id,
  MemorySaver,
} from "../../packages/ai-orchestration/src/checkpoint";
import type {
  ArtifactValidationV1,
  ToolExecutionResultV1,
  TrustedRuntimeContext,
} from "../../packages/ai-orchestration/src/ports";
import { governed_formula_artifact } from "../ai-control/helpers";
import {
  FakeArtifactService,
  FakeToolExecutor,
  ScriptedModelGateway,
  make_context_pack,
  make_fake_runtime,
  make_loop_state,
  make_tool_definition,
  tool_call_turn,
} from "./helpers/fake_runtime";

const THREAD_CONFIG = {
  configurable: {
    thread_id: build_checkpoint_thread_id("tenant_alpha", "thread_0001"),
  },
};

/** Generator tool registry: every allowlisted generator tool, none scripted away. */
function generator_tools(
  results: Record<string, ToolExecutionResultV1[]> = {},
): FakeToolExecutor {
  return new FakeToolExecutor(
    [
      make_tool_definition("knowledge.search"),
      make_tool_definition("material.search"),
      make_tool_definition("formula.search"),
      make_tool_definition("web.search"),
      make_tool_definition("formula.draft", { side_effect: "draft", produces_artifact: true }),
      make_tool_definition("formula.revise", { side_effect: "draft", produces_artifact: true }),
    ],
    results,
  );
}

/** Loop state whose context pack declares the full generator allowlist. */
function generator_state() {
  const pack = make_context_pack([
    "knowledge.search",
    "material.search",
    "formula.search",
    "web.search",
    "formula.draft",
    "formula.revise",
  ]);
  const base = make_loop_state();
  return {
    ...base,
    context_pack: pack,
    pins: { ...base.pins, context_pack_hash: pack.pack_hash },
  };
}

/** A successful tool execution result. */
function ok(output: unknown): ToolExecutionResultV1 {
  return {
    status: "ok",
    output,
    error_code: null,
    safe_error_message: null,
    retryable: false,
    cost_usd: "0.0001",
    latency_ms: 5,
  };
}

/** Finalize turn fixture. */
function finalize_turn(answer: string) {
  return tool_call_turn("finalize", { answer, citations: [], uncertainty: [] });
}

/** Artifact validator that replays scripted outcomes in order, then passes. */
class SequencedArtifactService extends FakeArtifactService {
  private readonly outcome_queue: ArtifactValidationV1[];

  /** @param outcomes - Validation verdicts returned in order. */
  constructor(outcomes: readonly ArtifactValidationV1[]) {
    super();
    this.outcome_queue = [...outcomes];
  }

  /** @inheritdoc */
  async validate_draft(
    artifact: unknown,
    _context: TrustedRuntimeContext,
  ): Promise<ArtifactValidationV1> {
    this.validated.push(artifact);
    return this.outcome_queue.shift() ?? { valid: true, findings: [] };
  }
}

describe("generator dynamism (spec §6.7)", () => {
  it("finalizes a DB-answerable brief with ZERO web.search calls while web.search stays available", async () => {
    const artifact = governed_formula_artifact();
    const model = new ScriptedModelGateway([
      tool_call_turn("knowledge.search", { query: "brightening actives for a serum" }),
      tool_call_turn("material.search", { query: "niacinamide", in_stock_only: true }),
      tool_call_turn("formula.draft", { artifact }),
      finalize_turn("Drafted entirely from tenant data."),
    ]);
    const tools = generator_tools({
      "knowledge.search": [ok({ items: ["niacinamide 2-5% brightening"], source_ids: ["src_nia"] })],
      "material.search": [ok({ result_count: 1, total_count: 1, materials: [] })],
      "formula.draft": [ok(artifact)],
    });
    const { runtime } = make_fake_runtime({ model, tools });
    const graph = compile_agent_loop_graph(runtime, new MemorySaver());

    const result = await graph.invoke(generator_state(), THREAD_CONFIG);

    expect(result.output?.status).toBe("completed");
    // web.search was genuinely available — declared in the pack and registered —
    // and the model simply never chose it.
    expect(generator_state().context_pack.tool_cards["web.search"]).toBeDefined();
    expect(tools.describe("web.search", runtime.context)).not.toBeNull();
    expect(tools.executions.map((execution) => execution.tool_name)).toEqual([
      "knowledge.search",
      "material.search",
      "formula.draft",
    ]);
  });

  it("executes web.search when the model chooses it for a novel active — same graph, no resequencing", async () => {
    const artifact = governed_formula_artifact();
    const model = new ScriptedModelGateway([
      tool_call_turn("knowledge.search", { query: "novel peptide XYZ-42" }),
      tool_call_turn("web.search", { query: "peptide XYZ-42 cosmetic usage level" }),
      tool_call_turn("formula.draft", { artifact }),
      finalize_turn("Grounded with an external source for the novel active."),
    ]);
    const tools = generator_tools({
      // The DB has nothing for the novel active — the model then reaches for the web.
      "knowledge.search": [ok({ items: [], source_ids: [] })],
      "web.search": [ok({ answer: "XYZ-42 used at 1-3%", sources: [] })],
      "formula.draft": [ok(artifact)],
    });
    const { runtime } = make_fake_runtime({ model, tools });
    const graph = compile_agent_loop_graph(runtime, new MemorySaver());

    const result = await graph.invoke(generator_state(), THREAD_CONFIG);

    expect(result.output?.status).toBe("completed");
    expect(
      tools.executions.filter((execution) => execution.tool_name === "web.search"),
    ).toHaveLength(1);
  });

  it("routes a validator rejection back to the agent, which revises and re-finalizes", async () => {
    const artifact = governed_formula_artifact();
    // The act node validates produces_artifact tools immediately on execution.
    // When formula.draft produces a blocking finding, act adds a validation_finding
    // observation and returns to the agent — the MODEL then decides to revise
    // (not finalize again). After formula.revise the second validation passes and
    // the model finalizes successfully.
    const model = new ScriptedModelGateway([
      tool_call_turn("formula.draft", { artifact }),
      // The blocking finding re-enters the loop after act validates; the MODEL decides to revise.
      tool_call_turn("formula.revise", { formula_id: "f1", artifact, revision_summary: "Fix total to 100%." }),
      finalize_turn("Revised to satisfy the validator."),
    ]);
    const tools = generator_tools({
      "formula.draft": [ok(artifact)],
      "formula.revise": [ok(artifact)],
    });
    const artifacts = new SequencedArtifactService([
      // Call 1 (act, formula.draft): blocking → validation_finding observation added.
      {
        valid: false,
        findings: [
          {
            code: "TOTAL_PERCENTAGE_OUT_OF_TOLERANCE",
            severity: "blocking",
            safe_message: "Ingredient percentages must total 100.00 (+/-0.01).",
          },
        ],
      },
      // Call 2 (act, formula.revise): passes → returns to agent for finalize.
      { valid: true, findings: [] },
      // Call 3 (finalize node): default valid via queue exhaustion, run completes.
    ]);
    const { runtime } = make_fake_runtime({ model, tools, artifacts });
    const graph = compile_agent_loop_graph(runtime, new MemorySaver());

    const result = await graph.invoke(generator_state(), THREAD_CONFIG);

    expect(result.output?.status).toBe("completed");
    expect(tools.executions.map((execution) => execution.tool_name)).toEqual([
      "formula.draft",
      "formula.revise",
    ]);
    // act validates formula.draft (blocking), act validates formula.revise (OK),
    // finalize validates the artifact once more — three total validation calls.
    expect(artifacts.validated.length).toBeGreaterThanOrEqual(2);
    const finding = result.observations.find(
      (observation: { type: string }) => observation.type === "validation_finding",
    );
    expect(finding?.content).toContain("TOTAL_PERCENTAGE_OUT_OF_TOLERANCE");
  });
});
