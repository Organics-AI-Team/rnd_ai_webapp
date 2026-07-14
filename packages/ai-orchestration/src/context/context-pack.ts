/**
 * ContextPackV1: the validated, hash-pinned system context for one run.
 *
 * Packs are assembled outside this package (control plane, plan Task 3) and
 * validated here so the orchestration loop never trusts an unvalidated pack.
 * The pack is pinned on the run by content hash and immutable within a run.
 */
import { z } from "zod";
import { sha256_hex } from "../hash";

/** One capability card pinned into a context pack. */
export const capability_card_v1_schema = z
  .object({
    name: z.string().min(1).max(200),
    version: z.string().min(1).max(64),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    markdown: z.string().min(1).max(200_000),
  })
  .strict();
export type CapabilityCardV1 = z.infer<typeof capability_card_v1_schema>;

/** Tool-card entry keyed by tool name inside the pack. */
export const tool_card_entry_v1_schema = z
  .object({
    version: z.string().min(1).max(64),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    markdown: z.string().min(1).max(200_000),
  })
  .strict();
export type ToolCardEntryV1 = z.infer<typeof tool_card_entry_v1_schema>;

/** Rendered plain-language policy digest with its content hash. */
export const policy_digest_v1_schema = z
  .object({
    markdown: z.string().min(1).max(100_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type PolicyDigestV1 = z.infer<typeof policy_digest_v1_schema>;

/** Full validated context pack schema. */
export const context_pack_v1_schema = z
  .object({
    schema_version: z.literal("1"),
    orchestrator_card: capability_card_v1_schema,
    agent_card: capability_card_v1_schema,
    policy_digest: policy_digest_v1_schema,
    tool_cards: z.record(z.string().min(1).max(200), tool_card_entry_v1_schema),
    pack_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ContextPackV1 = z.infer<typeof context_pack_v1_schema>;

/** Raised when a context pack fails validation; the run must fail closed. */
export class ContextPackValidationError extends Error {
  /** Stable error code for safe surfacing. */
  public readonly code = "CONTEXT_PACK_INVALID";

  /**
   * @param detail - Safe human-readable validation failure detail.
   */
  constructor(detail: string) {
    super(`CONTEXT_PACK_INVALID: ${detail}`);
    this.name = "ContextPackValidationError";
  }
}

/**
 * Compute the deterministic pack hash over every pinned card hash.
 * Order-independent for tool cards (sorted by name).
 *
 * @param pack - Pack content without (or ignoring) its pack_hash field.
 * @returns SHA-256 hex digest binding all card and digest hashes.
 */
export function compute_pack_hash(pack: {
  readonly orchestrator_card: { readonly sha256: string };
  readonly agent_card: { readonly sha256: string };
  readonly policy_digest: { readonly sha256: string };
  readonly tool_cards: Readonly<Record<string, { readonly sha256: string }>>;
}): string {
  const tool_lines = Object.keys(pack.tool_cards)
    .sort()
    .map((name) => {
      const entry = pack.tool_cards[name];
      return `tool:${name}:${entry ? entry.sha256 : ""}`;
    });
  const material = [
    `orchestrator:${pack.orchestrator_card.sha256}`,
    `agent:${pack.agent_card.sha256}`,
    `policy:${pack.policy_digest.sha256}`,
    ...tool_lines,
  ].join("\n");
  return sha256_hex(material);
}

/**
 * Validate an untrusted context pack fail-closed: structural schema, per-card
 * content-hash integrity, and the binding pack hash must all be consistent.
 *
 * @param input - Untrusted pack value from the gateway or a checkpoint.
 * @returns The validated, typed ContextPackV1.
 * @throws ContextPackValidationError when structure, any card hash, or the
 *         pack hash is inconsistent; callers must fail the run, never repair.
 */
export function validate_context_pack(input: unknown): ContextPackV1 {
  const parsed = context_pack_v1_schema.safeParse(input);
  if (!parsed.success) {
    throw new ContextPackValidationError(
      `structural validation failed: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }
  const pack = parsed.data;
  const card_checks: ReadonlyArray<[string, { sha256: string; markdown: string }]> = [
    ["orchestrator_card", pack.orchestrator_card],
    ["agent_card", pack.agent_card],
    ["policy_digest", pack.policy_digest],
    ...Object.entries(pack.tool_cards).map(
      (entry): [string, { sha256: string; markdown: string }] => [
        `tool_cards.${entry[0]}`,
        entry[1],
      ],
    ),
  ];
  for (const [label, card] of card_checks) {
    if (sha256_hex(card.markdown) !== card.sha256) {
      throw new ContextPackValidationError(
        `card content hash mismatch at ${label}`,
      );
    }
  }
  if (compute_pack_hash(pack) !== pack.pack_hash) {
    throw new ContextPackValidationError("pack hash does not bind its cards");
  }
  return pack;
}
