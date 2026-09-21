/**
 * Deterministic hashing helpers for the AI control plane.
 *
 * Provides canonical JSON serialization (stable key order, bigint-safe) and
 * SHA-256 hex digests used for card pinning, argument hashing, and call
 * idempotency keys.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { createHash } from "node:crypto";

/**
 * Serialize a value to canonical JSON with recursively sorted object keys.
 *
 * BigInt values serialize as decimal strings so policy snapshots hash
 * deterministically. undefined object members are dropped (JSON semantics).
 *
 * @param value - Any JSON-compatible value (bigint allowed).
 * @returns Canonical JSON string independent of original key order.
 */
export function canonical_json(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical_json(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry_value]) => entry_value !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry_value]) => `${JSON.stringify(key)}:${canonical_json(entry_value)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Compute the SHA-256 hex digest of a UTF-8 string.
 *
 * @param content - Input string to hash.
 * @returns Lowercase 64-character hex digest.
 */
export function sha256_hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Hash an arbitrary argument object canonically.
 *
 * @param value - JSON-compatible value (typically validated tool arguments).
 * @returns SHA-256 hex digest of the canonical JSON form.
 */
export function hash_canonical(value: unknown): string {
  return sha256_hex(canonical_json(value));
}
