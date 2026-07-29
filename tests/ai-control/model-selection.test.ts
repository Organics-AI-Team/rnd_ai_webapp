/**
 * G6.6 — platform model selection tests.
 *
 * Run admission pins the newest platform-ranked model present in the
 * effective allowlist; unknown models fall back deterministically and an
 * empty map selects nothing.
 */

import { describe, expect, it } from "vitest";

import {
  PLATFORM_MODEL_PREFERENCE,
  PLATFORM_PROVIDER_UNIVERSE,
  select_preferred_model,
} from "../../apps/ai/server/services/ai-control/platform-ai-constraints";

describe("select_preferred_model", () => {
  it("pins the newest ranked model when the allowlist contains it", () => {
    expect(
      select_preferred_model({
        google: ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-2.5-pro"],
      }),
    ).toEqual({ provider: "google", model: "gemini-3.5-flash" });
  });

  it("follows the preference ranking when the newest is not allowed", () => {
    expect(
      select_preferred_model({
        google: ["gemini-2.5-flash", "gemini-2.5-pro"],
      }),
    ).toEqual({ provider: "google", model: "gemini-2.5-pro" });
  });

  it("falls back to the lexicographically first model outside the ranking", () => {
    expect(
      select_preferred_model({ other: ["zeta-model", "alpha-model"] }),
    ).toEqual({ provider: "other", model: "alpha-model" });
  });

  it("selects nothing from an empty or model-less map", () => {
    expect(select_preferred_model({})).toBeNull();
    expect(select_preferred_model({ google: [] })).toBeNull();
  });

  it("keeps every ranked model inside the platform universe", () => {
    const universe = Object.values(PLATFORM_PROVIDER_UNIVERSE).flat();
    for (const model of PLATFORM_MODEL_PREFERENCE) {
      expect(universe, `${model} missing from universe`).toContain(model);
    }
  });

  it("ranks the platform's newest generally available model first", () => {
    expect(PLATFORM_MODEL_PREFERENCE[0]).toBe("gemini-3.5-flash");
  });
});
