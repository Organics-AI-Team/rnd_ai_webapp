import { describe, expect, it, vi } from "vitest";

import type { ModelTurnRequestV1, TrustedRuntimeContext } from "@rnd-ai/ai-orchestration";
import {
  create_gemini_model_gateway,
  ModelProviderRequestError,
  type GeminiGenerationClient,
} from "../../apps/ai/server/services/ai-control/providers/gemini-model-gateway";

const context: TrustedRuntimeContext = {
  tenant_id: "507f1f77bcf86cd7994390a1",
  actor_profile_id: "507f1f77bcf86cd7994390b1",
  run_id: "507f1f77bcf86cd7994390c1",
  parent_run_id: null,
  delegation_depth: 0,
  correlation_id: "corr-model-gateway",
};

const request: ModelTurnRequestV1 = {
  system: "Pinned system context",
  messages: [
    { role: "user", content: "Find evidence", tool_call_id: null },
    { role: "tool", content: "Untrusted evidence block", tool_call_id: "call-old" },
  ],
  tools: [{
    name: "knowledge.search",
    description: "Search governed knowledge",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  }],
};

describe("Gemini model gateway", () => {
  it("maps dotted governed tools to provider-safe names and restores them", async () => {
    const generate = vi.fn<GeminiGenerationClient["generate"]>(async () => ({
      text: "Searching the governed corpus.",
      function_calls: [{ name: "tool_knowledge__search", args: { query: "surfactants" } }],
      usage: { input_tokens: 100, output_tokens: 50 },
    }));
    const gateway = create_gemini_model_gateway({
      api_key: "test-key",
      model: "gemini-test",
      input_price_microusd_per_million_tokens: 1_000_000n,
      output_price_microusd_per_million_tokens: 2_000_000n,
      client: { generate },
    });

    const turn = await gateway.complete_turn(request, context);

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-test",
      system: "Pinned system context",
      tools: [expect.objectContaining({ name: "tool_knowledge__search" })],
      messages: [
        { role: "user", text: "Find evidence" },
        { role: "user", text: "[tool observation]\nUntrusted evidence block" },
      ],
    }));
    expect(turn).toMatchObject({
      content: "Searching the governed corpus.",
      tool_calls: [{ tool_name: "knowledge.search", arguments: { query: "surfactants" } }],
      usage: { input_tokens: 100, output_tokens: 50, cost_usd: "0.0002" },
    });
    expect(turn.tool_calls[0]?.call_id).toMatch(/^gemini_[a-f0-9]{32}$/);
  });

  it("returns deterministic call ids for a replayed provider response", async () => {
    const response = {
      text: null,
      function_calls: [{ name: "tool_knowledge__search", args: { query: "same" } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const gateway = create_gemini_model_gateway({
      api_key: "test-key",
      model: "gemini-test",
      input_price_microusd_per_million_tokens: 1n,
      output_price_microusd_per_million_tokens: 1n,
      client: { generate: async () => response },
    });

    const first = await gateway.complete_turn(request, context);
    const replay = await gateway.complete_turn(request, context);
    expect(replay.tool_calls[0]?.call_id).toBe(first.tool_calls[0]?.call_id);
  });

  it("surfaces only a safe provider error", async () => {
    const gateway = create_gemini_model_gateway({
      api_key: "secret-key-that-must-not-leak",
      model: "gemini-test",
      input_price_microusd_per_million_tokens: 1n,
      output_price_microusd_per_million_tokens: 1n,
      client: {
        async generate() {
          throw new Error("secret-key-that-must-not-leak provider body");
        },
      },
    });

    const failure = await gateway.complete_turn(request, context).catch((error) => error);
    expect(failure).toBeInstanceOf(ModelProviderRequestError);
    expect(String(failure.message)).not.toContain("secret-key-that-must-not-leak");
  });
});
