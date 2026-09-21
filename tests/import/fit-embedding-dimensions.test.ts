import { describe, it, expect } from "vitest";
import { fit_embedding_dimensions } from "../../apps/ai/services/embeddings/gemini-embedding-service";

describe("fit_embedding_dimensions", () => {
  it("truncates oversized vectors and L2-normalizes", () => {
    const raw = Array.from({ length: 3072 }, (_, i) => (i < 3 ? 1 : 0.0001));
    const fitted = fit_embedding_dimensions(raw, 768);
    expect(fitted).toHaveLength(768);
    const norm = Math.sqrt(fitted.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("returns exact-size vectors untouched", () => {
    const raw = [0.5, 0.5];
    expect(fit_embedding_dimensions(raw, 2)).toBe(raw);
  });

  it("keeps vectors as-is when no target is configured", () => {
    const raw = [1, 2, 3];
    expect(fit_embedding_dimensions(raw)).toBe(raw);
  });

  it("throws when the API returned fewer dims than requested", () => {
    expect(() => fit_embedding_dimensions([1, 2], 768)).toThrow(/768/);
  });
});
