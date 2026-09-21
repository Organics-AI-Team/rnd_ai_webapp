import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import type { EffectiveAIPolicy } from "@rnd-ai/shared-types";
import type { TrustedRuntimeContext } from "@rnd-ai/ai-orchestration";
import { ToolCatalogue } from "../../apps/ai/server/services/ai-control/tool-catalogue";
import { ToolGovernanceError } from "../../apps/ai/server/services/ai-control/errors";
import {
  create_orchestration_tool_executor,
  type ControlToolExecutionPort,
} from "../../apps/ai/server/services/ai-control/orchestration-tool-executor";
import { make_temp_cards_root, write_card_file } from "./helpers";
import { join } from "node:path";

const policy: EffectiveAIPolicy = {
  tenant_id: "tenant-a",
  version: 1,
  hash: "a".repeat(64),
  enabled: true,
  provider_models: { google: ["gemini-test"] },
  allowed_tools: ["formula.draft"],
  monthly_request_limit: 10n,
  monthly_token_limit: 10n,
  monthly_cost_limit_microusd: 10n,
  per_user_monthly_request_limit: 10n,
  per_user_monthly_token_limit: 10n,
  per_user_monthly_cost_limit_microusd: 10n,
  per_run_token_limit: 10n,
  per_run_cost_limit_microusd: 10n,
  max_concurrent_runs: 1,
  default_locale: "en-US",
  max_iterations: 4,
  approval_rules: {},
};

const context: TrustedRuntimeContext = {
  tenant_id: "tenant-a",
  actor_profile_id: "profile-a",
  run_id: "run-a",
  parent_run_id: null,
  delegation_depth: 0,
  correlation_id: "corr-a",
};

function catalogue(): ToolCatalogue {
  const cards_root = make_temp_cards_root();
  write_card_file(join(cards_root, "tools", "formula.draft.md"), {
    name: "formula.draft",
    version: "1.0.0",
    kind: "tool",
    side_effect: "draft_write",
    required_permission: "formula:draft",
  });
  const value = new ToolCatalogue({ cards_root });
  value.register({
    name: "formula.draft",
    version: "1.0.0",
    description: "Draft",
    input_schema: z.object({ name: z.string() }).strict(),
    output_schema: z.object({ id: z.string() }).strict(),
    required_permission: "formula:draft",
    side_effect: "draft_write",
    approval_requirement: "none",
    timeout_ms: 1000,
    retry: { max_attempts: 1, backoff_ms: 0 },
    capability_card_path: "tools/formula.draft.md",
    execute: async () => ({ id: "unused" }),
  });
  return value;
}

describe("orchestration tool executor adapter", () => {
  it("maps catalogue governance metadata into the loop port", () => {
    const adapter = create_orchestration_tool_executor({
      catalogue: catalogue(),
      executor: { execute: vi.fn() },
      policy,
      permissions: ["formula:draft"],
    });
    expect(adapter.describe("formula.draft", context)).toMatchObject({
      name: "formula.draft",
      version: "1.0.0",
      side_effect: "draft",
      required_permission: "formula:draft",
      result_trust: "trusted_system",
      produces_artifact: true,
      retry: 0,
      timeout_ms: 1000,
    });
    expect(adapter.describe("unknown", context)).toBeNull();
  });

  it("injects trusted scope and normalizes a successful tool result", async () => {
    const execute = vi.fn<ControlToolExecutionPort["execute"]>(async () => ({
      tool_name: "formula.draft",
      idempotency_key: "control-key",
      output: { id: "draft-1" },
      duration_ms: 12,
      attempts: 1,
      from_cache: false,
    }));
    const adapter = create_orchestration_tool_executor({
      catalogue: catalogue(),
      executor: { execute },
      policy,
      permissions: ["formula:draft"],
    });
    const result = await adapter.execute({
      idempotency_key: "run-a:1:formula.draft:hash",
      tool_name: "formula.draft",
      arguments: { name: "serum" },
      run_id: "run-a",
      iteration: 1,
    }, context);

    expect(execute).toHaveBeenCalledWith(
      { name: "formula.draft", arguments: { name: "serum" } },
      expect.objectContaining({
        tenant_id: "tenant-a",
        actor_profile_id: "profile-a",
        run_id: "run-a",
        step_id: "run-a:1:formula.draft:hash",
        policy,
      }),
    );
    expect(result).toEqual({
      status: "ok",
      output: { id: "draft-1" },
      error_code: null,
      safe_error_message: null,
      retryable: false,
      cost_usd: "0",
      latency_ms: 12,
    });
  });

  it("returns a safe typed error for a governance denial", async () => {
    const adapter = create_orchestration_tool_executor({
      catalogue: catalogue(),
      executor: {
        async execute() {
          throw new ToolGovernanceError("TOOL_PERMISSION_DENIED", "Safe denial.");
        },
      },
      policy,
      permissions: [],
    });
    await expect(adapter.execute({
      idempotency_key: "key",
      tool_name: "formula.draft",
      arguments: { name: "serum" },
      run_id: "run-a",
      iteration: 1,
    }, context)).resolves.toMatchObject({
      status: "error",
      error_code: "TOOL_PERMISSION_DENIED",
      safe_error_message: "Safe denial.",
      retryable: false,
    });
  });
});
