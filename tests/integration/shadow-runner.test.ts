import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ToolCatalogue } from "../../apps/ai/server/services/ai-control/tool-catalogue";
import type { ToolDefinition } from "../../apps/ai/server/services/ai-control/tool-definition";
import {
  SimulationToolExecutor,
  type SimulationToolCall,
} from "../../apps/ai/server/services/ai-control/simulation-tool-executor";
import {
  create_shadow_runner,
  ShadowPolicyInvalidError,
} from "../../apps/ai/server/services/ai-gateway/shadow-runner";
import {
  make_temp_cards_root,
  write_matching_tool_card,
} from "../ai-control/helpers";

function catalogue_with(side_effect: "read" | "draft_write" | "commit") {
  const root = make_temp_cards_root();
  const catalogue = new ToolCatalogue({ cards_root: root });
  const definition: ToolDefinition<{ value: string }, { result: string }> = {
    name: `example.${side_effect}`,
    version: "1.0.0",
    description: "Test tool",
    input_schema: z.object({ value: z.string() }).strict(),
    output_schema: z.object({ result: z.string() }).strict(),
    required_permission: "tenant:read",
    side_effect,
    approval_requirement: "none",
    timeout_ms: 100,
    retry: { max_attempts: 1, backoff_ms: 0 },
    capability_card_path: `tools/example.${side_effect}.md`,
    async execute(args) {
      return { result: args.value };
    },
  };
  write_matching_tool_card(root, definition);
  catalogue.register(definition);
  return { catalogue, tool_name: definition.name };
}

const call = (name: string): SimulationToolCall => ({
  name,
  arguments: { value: "secret production text" },
});

describe("SimulationToolExecutor", () => {
  it.each(["draft_write", "commit"] as const)(
    "suppresses the real %s side effect and records intent",
    async (side_effect) => {
      const { catalogue, tool_name } = catalogue_with(side_effect);
      const real = { execute: vi.fn() };
      const intents: unknown[] = [];
      const simulation = new SimulationToolExecutor(catalogue, real, {
        record_would_have_called: async (intent) => void intents.push(intent),
      });

      await expect(simulation.execute(call(tool_name))).resolves.toMatchObject({
        code: "SIDE_EFFECT_SUPPRESSED",
        tool_name,
        side_effect,
      });
      expect(real.execute).not.toHaveBeenCalled();
      expect(intents).toEqual([
        expect.objectContaining({ tool_name, arguments_hash: expect.any(String) }),
      ]);
      expect(JSON.stringify(intents)).not.toContain("secret production text");
    },
  );

  it("allows only a governed read through the injected read-only executor", async () => {
    const { catalogue, tool_name } = catalogue_with("read");
    const real = { execute: vi.fn(async () => ({ result: "snapshot" })) };
    const simulation = new SimulationToolExecutor(catalogue, real, {
      record_would_have_called: vi.fn(),
    });
    await expect(simulation.execute(call(tool_name))).resolves.toEqual({ result: "snapshot" });
    expect(real.execute).toHaveBeenCalledOnce();
  });
});

describe("shadow runner", () => {
  const policy = {
    tenant_opt_in: true,
    platform_approved: true,
    sampling_rate: 1,
    purpose: "commercial_quality_evaluation",
    retention_days: 7,
    cost_ceiling_microusd: 50_000,
  } as const;

  it("runs after primary completion with separate budget and content-free telemetry", async () => {
    const telemetry: unknown[] = [];
    const ports = {
      reserve_shadow_budget: vi.fn(async () => "shadow-reservation-1"),
      execute_shadow: vi.fn(async () => ({ score: 0.9, status: "completed" as const })),
      record_comparison: vi.fn(async (event) => void telemetry.push(event)),
      record_incident: vi.fn(),
    };
    const runner = create_shadow_runner(ports, { sample: () => 0 });
    const outcome = await runner.run_after_primary({
      policy,
      tenant_id: "tenant-a",
      primary_run_id: "run-primary",
      primary_status: "completed",
      input: { message: "private customer formula" },
      primary_result: { answer: "private answer" },
      policy_hash: "a".repeat(64),
    });

    expect(outcome).toEqual({ selected: true, status: "completed" });
    expect(ports.reserve_shadow_budget).toHaveBeenCalledOnce();
    expect(ports.execute_shadow).toHaveBeenCalledOnce();
    expect(JSON.stringify(telemetry)).not.toContain("private customer formula");
    expect(JSON.stringify(telemetry)).not.toContain("private answer");
    expect(telemetry).toEqual([
      expect.objectContaining({ input_hash: expect.any(String), primary_result_hash: expect.any(String) }),
    ]);
  });

  it("never lets a shadow failure alter the completed primary outcome", async () => {
    const ports = {
      reserve_shadow_budget: vi.fn(async () => "shadow-reservation-1"),
      execute_shadow: vi.fn(async () => { throw new Error("provider secret details"); }),
      record_comparison: vi.fn(),
      record_incident: vi.fn(),
    };
    const runner = create_shadow_runner(ports, { sample: () => 0 });
    await expect(runner.run_after_primary({
      policy,
      tenant_id: "tenant-a",
      primary_run_id: "run-primary",
      primary_status: "completed",
      input: {},
      primary_result: {},
      policy_hash: "a".repeat(64),
    })).resolves.toEqual({ selected: true, status: "failed" });
    expect(ports.record_incident).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SHADOW_EXECUTION_FAILED", primary_run_id: "run-primary" }),
    );
  });

  it("does not select a tenant without every shadow authorization condition", async () => {
    const ports = {
      reserve_shadow_budget: vi.fn(),
      execute_shadow: vi.fn(),
      record_comparison: vi.fn(),
      record_incident: vi.fn(),
    };
    const runner = create_shadow_runner(ports, { sample: () => 0 });
    await expect(runner.run_after_primary({
      policy: { ...policy, tenant_opt_in: false },
      tenant_id: "tenant-a",
      primary_run_id: "run-primary",
      primary_status: "completed",
      input: {},
      primary_result: {},
      policy_hash: "a".repeat(64),
    })).resolves.toEqual({ selected: false, status: "not_selected" });
    expect(ports.reserve_shadow_budget).not.toHaveBeenCalled();
  });

  it("rejects malformed sampling, retention, or cost policy", async () => {
    const runner = create_shadow_runner({
      reserve_shadow_budget: vi.fn(),
      execute_shadow: vi.fn(),
      record_comparison: vi.fn(),
      record_incident: vi.fn(),
    }, { sample: () => 0 });
    await expect(runner.run_after_primary({
      policy: { ...policy, sampling_rate: 2 },
      tenant_id: "tenant-a",
      primary_run_id: "run-primary",
      primary_status: "completed",
      input: {},
      primary_result: {},
      policy_hash: "a".repeat(64),
    })).rejects.toBeInstanceOf(ShadowPolicyInvalidError);
  });
});
