/**
 * Deterministic hashing utilities shared by contracts, loop detection,
 * idempotency keys, and context-pack pinning.
 */
import { createHash } from "node:crypto";

/**
 * Compute the SHA-256 hex digest of a UTF-8 string.
 *
 * @param text - Input text.
 * @returns Lowercase 64-character hex digest.
 */
export function sha256_hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Serialize a JSON-compatible value canonically: object keys sorted
 * recursively so semantically identical values always hash identically.
 *
 * @param value - JSON-compatible value (undefined serializes as null).
 * @returns Stable JSON text.
 */
export function canonical_json(value: unknown): string {
  return JSON.stringify(sort_value(value));
}

/**
 * Recursively sort object keys for canonical serialization.
 *
 * @param value - Arbitrary JSON-compatible value.
 * @returns Structurally identical value with deterministically ordered keys.
 */
function sort_value(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_value);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sort_value((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value === undefined ? null : value;
}

/**
 * Hash tool-call arguments canonically for decision records, idempotency
 * keys, and normalized-action loop detection.
 *
 * @param arguments_value - Raw arguments payload from a native tool call.
 * @returns SHA-256 hex digest of the canonical JSON serialization.
 */
export function hash_arguments(arguments_value: unknown): string {
  return sha256_hex(canonical_json(arguments_value ?? null));
}
