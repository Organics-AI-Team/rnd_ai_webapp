/**
 * Capability-card loader (G4 Task 3 Step 8).
 *
 * Loads markdown capability cards, parses their YAML-style frontmatter with
 * a minimal strict hand-rolled parser (gray-matter is deliberately not added
 * to keep the dependency graph frozen at this gate), validates it with a Zod
 * schema, pins the card by SHA-256 of its full content, and caches parsed
 * cards in-process keyed by that content hash.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

import { ToolGovernanceError } from "./errors";
import { sha256_hex } from "./hashing";
import { log_info } from "./logger";
import type { SideEffectClass } from "./tool-definition";

const MODULE = "card-loader";

/** Card classification mirrored from the agentic design §4.1. */
export type CapabilityCardKind = "orchestrator" | "agent" | "tool";

/**
 * Parsed, hash-pinned capability card (implementation anchor, G4 Task 3).
 */
export interface CapabilityCard {
  readonly name: string;
  readonly version: string;
  readonly kind: CapabilityCardKind;
  readonly side_effect: SideEffectClass | null;
  /** Raw frontmatter value; registration compares it to a typed ToolDefinition. */
  readonly required_permission: string | null;
  /** Full original markdown content including frontmatter. */
  readonly markdown: string;
  /** SHA-256 hex digest of the full markdown content. */
  readonly sha256: string;
}

/**
 * Strict frontmatter schema. Tool cards must declare side_effect and
 * required_permission; orchestrator/agent cards must not.
 */
const capability_card_frontmatter_schema = z
  .object({
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    kind: z.enum(["orchestrator", "agent", "tool"]),
    side_effect: z.enum(["read", "draft_write", "commit"]).optional(),
    required_permission: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((frontmatter, refinement_context) => {
    const is_tool = frontmatter.kind === "tool";
    const has_tool_fields =
      frontmatter.side_effect !== undefined ||
      frontmatter.required_permission !== undefined;
    if (is_tool && (!frontmatter.side_effect || !frontmatter.required_permission)) {
      refinement_context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tool cards require side_effect and required_permission",
      });
    }
    if (!is_tool && has_tool_fields) {
      refinement_context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only tool cards may declare side_effect/required_permission",
      });
    }
  });

/** Default maximum card size in characters (~3k tokens). */
const DEFAULT_CARD_SIZE_BUDGET_CHARS = 12_000;

/** In-process card cache keyed by content SHA-256. */
const card_cache = new Map<string, CapabilityCard>();

/**
 * Return the configured per-card size budget in characters.
 *
 * Reads AI_CAPABILITY_CARD_MAX_CHARS so operators can tighten the prompt
 * budget without a code change; falls back to a safe default.
 *
 * @returns Maximum allowed characters per capability card.
 */
export function get_card_size_budget_chars(): number {
  const configured = Number(process.env.AI_CAPABILITY_CARD_MAX_CHARS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_CARD_SIZE_BUDGET_CHARS;
}

/** Candidate cards directories relative to the process working directory. */
const CARDS_ROOT_CANDIDATES = [
  join("apps", "ai", "server", "services", "ai-control", "cards"),
  join("ai", "server", "services", "ai-control", "cards"),
  join("server", "services", "ai-control", "cards"),
  "cards",
  // Next standalone chdir()s to <root>/apps/web at boot; reach the sibling
  // ai workspace from there (defense in depth behind AI_CAPABILITY_CARDS_ROOT).
  join("..", "ai", "server", "services", "ai-control", "cards"),
];

/**
 * Resolve the repository cards root directory.
 *
 * Honors AI_CAPABILITY_CARDS_ROOT, then probes known relative locations so
 * the loader works from the monorepo root, the ai workspace, or the server
 * directory without absolute OS-specific paths.
 *
 * @returns Absolute path of the cards root directory.
 * @throws ToolGovernanceError CARDS_ROOT_NOT_FOUND when no candidate exists.
 */
export function resolve_cards_root(): string {
  const configured = process.env.AI_CAPABILITY_CARDS_ROOT;
  if (configured && existsSync(configured)) return resolve(configured);
  for (const candidate of CARDS_ROOT_CANDIDATES) {
    const absolute = resolve(process.cwd(), candidate);
    if (existsSync(absolute)) return absolute;
  }
  throw new ToolGovernanceError(
    "CARDS_ROOT_NOT_FOUND",
    "Capability cards directory not found; set AI_CAPABILITY_CARDS_ROOT.",
  );
}

/**
 * Parse strict `key: value` frontmatter delimited by --- lines.
 *
 * Only flat string scalars are accepted — no nesting, duplicates, or flow
 * collections — so prose cards cannot smuggle structure past review.
 *
 * @param content - Full markdown file content.
 * @param card_path - Path used only for error messages.
 * @returns Raw key/value frontmatter map.
 * @throws ToolGovernanceError CARD_INVALID on any structural violation.
 */
function parse_frontmatter(
  content: string,
  card_path: string,
): Record<string, string> {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new ToolGovernanceError(
      "CARD_INVALID",
      `Capability card ${card_path} must start with a --- frontmatter block.`,
    );
  }
  const closing_index = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (closing_index === -1) {
    throw new ToolGovernanceError(
      "CARD_INVALID",
      `Capability card ${card_path} frontmatter is not closed with ---.`,
    );
  }
  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, closing_index)) {
    if (line.trim() === "") continue;
    const separator_index = line.indexOf(":");
    if (separator_index === -1) {
      throw new ToolGovernanceError(
        "CARD_INVALID",
        `Capability card ${card_path} has a frontmatter line without "key: value".`,
      );
    }
    const key = line.slice(0, separator_index).trim();
    const value = line.slice(separator_index + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      throw new ToolGovernanceError(
        "CARD_INVALID",
        `Capability card ${card_path} has an empty or duplicate frontmatter key.`,
      );
    }
    frontmatter[key] = value;
  }
  return frontmatter;
}

/**
 * Load, validate, hash, and cache one capability card.
 *
 * @param card_path - Absolute path, or path relative to the cards root.
 * @param cards_root - Optional cards root override; defaults to
 *                     resolve_cards_root() for relative paths.
 * @returns Parsed CapabilityCard; identical content returns the cached object.
 * @throws ToolGovernanceError TOOL_CARD_MISSING when the file is absent,
 *         CARD_INVALID when frontmatter is malformed or fails the schema.
 */
export function load_capability_card(
  card_path: string,
  cards_root?: string,
): CapabilityCard {
  const absolute_path = isAbsolute(card_path)
    ? card_path
    : join(cards_root ?? resolve_cards_root(), card_path);
  if (!existsSync(absolute_path)) {
    throw new ToolGovernanceError(
      "TOOL_CARD_MISSING",
      `Capability card not found: ${card_path}`,
    );
  }
  const markdown = readFileSync(absolute_path, "utf8");
  const sha256 = sha256_hex(markdown);
  const cached = card_cache.get(sha256);
  if (cached) return cached;

  const raw_frontmatter = parse_frontmatter(markdown, card_path);
  const parsed = capability_card_frontmatter_schema.safeParse(raw_frontmatter);
  if (!parsed.success) {
    throw new ToolGovernanceError(
      "CARD_INVALID",
      `Capability card ${card_path} frontmatter is invalid: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  const card: CapabilityCard = {
    name: parsed.data.name,
    version: parsed.data.version,
    kind: parsed.data.kind,
    side_effect: parsed.data.side_effect ?? null,
    required_permission: parsed.data.required_permission ?? null,
    markdown,
    sha256,
  };
  card_cache.set(sha256, card);
  log_info(MODULE, "card loaded", {
    card: card.name,
    kind: card.kind,
    version: card.version,
    sha256: sha256.slice(0, 12),
  });
  return card;
}
