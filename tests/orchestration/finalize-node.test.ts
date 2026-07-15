/**
 * G4.8c — the finalize node.
 *
 * finalize authoritatively validates any produced tenant artifact via the
 * injected ArtifactService, then either completes the run (building the public
 * output with a draft artifact reference and computed quality dimensions) or —
 * while iteration budget remains — routes a blocking validation back to the
 * agent as a typed observation. It never lets the model pass a failed check.
 */

import { Command } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import { finalize } from "../../packages/ai-orchestration/src/nodes/finalize";
import { hash_arguments } from "../../packages/ai-orchestration/src/hash";
import { build_observation } from "../../packages/ai-orchestration/src/schemas/observation";
import type { ProposedActionV1, QualityDimensionsV1 } from "../../packages/ai-orchestration/src/contracts";
import type { AgentLoopStateType } from "../../packages/ai-orchestration/src/state";
import type { ObservationV1 } from "../../packages/ai-orchestration/src/schemas/observation";
import {
  FakeArtifactService,
  goto_targets,
  make_fake_runtime,
  make_loop_state,
} from "./helpers/fake_runtime";

/** A finalize proposal as the agent node would set it. */
function finalize_action(): ProposedActionV1 {
  const request = { answer: "Final answer.", citations: [], uncertainty: [] };
  return {
    kind: "finalize",
    call_id: "call_finalize",
    request,
    arguments_hash: hash_arguments(request),
  };
}

/** A tool_result observation from the produces_artifact `formula.draft` tool. */
function artifact_observation(payload: object): ObservationV1 {
  return build_observation({
    observation_id: "obs_formula_1",
    run_id: "run_0001",
    iteration: 1,
    type: "tool_result",
    source: { kind: "tool", tool_name: "formula.draft", source_ids: [] },
    content: JSON.stringify(payload),
    trust: "trusted_system",
    cost_usd: "0",
    latency_ms: 0,
    occurred_at: "2026-07-15T00:00:01.000Z",
    metadata: { schema_valid: true },
  });
}

const QUALITY: QualityDimensionsV1 = {
  groundedness: 1,
  evidence_coverage: 1,
  source_quality: 1,
  source_freshness_days: null,
  contradiction_state: "none",
  validation_rate: 1,
  completeness: 1,
  risk_severity: "none",
};

describe("finalize node", () => {
  it("completes an answer-only run with no artifact reference", async () => {
    const state = { ...make_loop_state(), pending_action: finalize_action() };
    const { runtime, runs } = make_fake_runtime();
    const update = (await finalize(state, runtime)) as Partial<AgentLoopStateType>;
    expect((update as { goto?: unknown }).goto).toBeUndefined(); // a terminal update, not a Command
    expect(update.output?.status).toBe("completed");
    expect(update.output?.artifacts).toEqual([]);
    expect(runs.completed).toHaveLength(1);
  });

  it("completes with a draft artifact reference and passes through quality dimensions", async () => {
    const artifacts = new FakeArtifactService({
      valid: true,
      findings: [],
      quality_dimensions: QUALITY,
    });
    const observation = artifact_observation({ name: "Summer serum" });
    const state = {
      ...make_loop_state({ observations: [observation] }),
      pending_action: finalize_action(),
    };
    const { runtime, runs } = make_fake_runtime({ artifacts });
    const update = (await finalize(state, runtime)) as Partial<AgentLoopStateType>;
    expect(update.output?.status).toBe("completed");
    expect(update.output?.artifacts?.[0]).toMatchObject({
      artifact_id: observation.content_hash,
      artifact_type: "formula",
      version: 1,
      status: "draft",
    });
    expect(update.output?.quality_dimensions).toEqual(QUALITY);
    expect(artifacts.validated).toHaveLength(1);
    expect(runs.completed).toHaveLength(1);
  });

  it("routes a blocking validation back to the agent while budget remains", async () => {
    const artifacts = new FakeArtifactService({
      valid: false,
      findings: [
        {
          code: "TOTAL_PERCENTAGE_OUT_OF_TOLERANCE",
          severity: "blocking",
          safe_message: "Ingredient percentages must total 100.00 (+/-0.01).",
        },
      ],
    });
    const state = {
      ...make_loop_state({ observations: [artifact_observation({})], iteration: 2 }),
      pending_action: finalize_action(),
    };
    const { runtime, runs, usage } = make_fake_runtime({ artifacts });
    const command = (await finalize(state, runtime)) as Command;
    expect(goto_targets(command)).toEqual(["agent"]); // routed back to revise, not terminal
    const update = command.update as Partial<AgentLoopStateType>;
    expect(update.output ?? null).toBeNull();
    const finding = (update.observations ?? []).find(
      (obs) => obs.type === "validation_finding",
    );
    expect(finding?.content).toContain("TOTAL_PERCENTAGE_OUT_OF_TOLERANCE");
    expect(finding?.metadata).toMatchObject({ blocking: true, phase: "finalize" });
    expect(update.pending_action ?? null).toBeNull();
    // The run did not complete or reconcile when it routes back to revise.
    expect(runs.completed).toHaveLength(0);
    expect(usage.reconciled).toHaveLength(0);
  });

  it("completes with findings as warnings when the budget is exhausted", async () => {
    const artifacts = new FakeArtifactService({
      valid: false,
      findings: [
        {
          code: "TOTAL_PERCENTAGE_OUT_OF_TOLERANCE",
          severity: "blocking",
          safe_message: "Ingredient percentages must total 100.00 (+/-0.01).",
        },
      ],
    });
    // iteration === max_iterations (8) leaves zero budget to revise.
    const state = {
      ...make_loop_state({ observations: [artifact_observation({})], iteration: 8 }),
      pending_action: finalize_action(),
    };
    const { runtime, runs } = make_fake_runtime({ artifacts });
    const update = (await finalize(state, runtime)) as Partial<AgentLoopStateType>;
    expect(update.output?.status).toBe("completed");
    expect(update.output?.artifacts).toEqual([]); // nothing confirmable
    expect(update.output?.warnings).toContain(
      "Ingredient percentages must total 100.00 (+/-0.01).",
    );
    expect(runs.completed).toHaveLength(1);
  });

  it("errors when finalize is reached without a finalize proposal", async () => {
    const state = { ...make_loop_state(), pending_action: null };
    const { runtime } = make_fake_runtime();
    const update = (await finalize(state, runtime)) as Partial<AgentLoopStateType>;
    expect(update.error?.code).toBe("ORCHESTRATOR_INVARIANT_VIOLATION");
  });
});
