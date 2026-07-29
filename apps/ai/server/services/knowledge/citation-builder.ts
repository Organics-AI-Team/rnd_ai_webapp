/**
 * Citation builder (G3.5).
 *
 * Turns retrieved KnowledgeEvidence into auditable citations. A citation is
 * produced only when the evidence is traceable to a ready tenant KnowledgeSource
 * or an approved platform source; anything else is rejected fail-closed so a
 * poisoned or orphaned point can never appear as a cited source. Excerpts are
 * capped to a policy length so retrieved content cannot bloat the context.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { ToolGovernanceError } from "../ai-control/errors";
import type { KnowledgeEvidence } from "./knowledge-gateway";

/** Source statuses that make a knowledge source citable. */
export const CITABLE_SOURCE_STATUSES: readonly string[] = Object.freeze([
  "ready",
  "active",
]);

/** Minimal source record needed to authorise and label a citation. */
export interface CitationSource {
  readonly source_id: string;
  readonly source_name: string;
  readonly status: string;
  readonly scope: "platform" | "tenant";
  readonly tenant_id: string | null;
}

/** Port resolving a source record for a piece of evidence (tenant-scoped). */
export interface CitationSourceLookup {
  get_source(
    source_id: string,
    scope: "platform" | "tenant",
    tenant_id: string | null,
  ): Promise<CitationSource | null>;
}

/** A finished, auditable citation. */
export interface Citation {
  readonly source_id: string;
  readonly source_name: string;
  readonly content_hash: string;
  readonly locator: string;
  readonly excerpt: string;
  readonly retrieved_at: string;
  readonly scope: "platform" | "tenant";
  readonly relevance_score: number;
}

/** Options controlling citation construction. */
export interface CitationOptions {
  /** Maximum excerpt length in characters (policy-driven). */
  readonly excerpt_max_chars?: number;
  /** Deterministic retrieval timestamp (defaults to now). */
  readonly retrieved_at?: Date;
}

/** Default excerpt cap when the policy does not specify one. */
const DEFAULT_EXCERPT_MAX_CHARS = 500;

/**
 * Cap an excerpt to a maximum length without splitting a surrogate pair.
 *
 * @param content - The full content.
 * @param max_chars - Maximum characters.
 * @returns The capped excerpt (with an ellipsis when truncated).
 */
function cap_excerpt(content: string, max_chars: number): string {
  if (content.length <= max_chars) return content;
  return `${content.slice(0, Math.max(0, max_chars - 1))}…`;
}

/**
 * Build citations for retrieved evidence, rejecting any untraceable result.
 *
 * @param evidence - Retrieved evidence rows.
 * @param lookup - Source lookup port (tenant-scoped).
 * @param options - Excerpt cap and deterministic timestamp.
 * @returns The list of citations, one per evidence row, in input order.
 * @throws ToolGovernanceError CARD_INVALID when a result is not traceable to a
 *         citable source (reused stable governance code for "untrusted result").
 */
export async function build_citations(
  evidence: readonly KnowledgeEvidence[],
  lookup: CitationSourceLookup,
  options: CitationOptions = {},
): Promise<readonly Citation[]> {
  const excerpt_max = options.excerpt_max_chars ?? DEFAULT_EXCERPT_MAX_CHARS;
  const retrieved_at = (options.retrieved_at ?? new Date()).toISOString();

  const citations: Citation[] = [];
  for (const item of evidence) {
    const source = await lookup.get_source(
      item.source_id,
      item.scope,
      item.tenant_id,
    );
    if (!source || !CITABLE_SOURCE_STATUSES.includes(source.status)) {
      throw new ToolGovernanceError(
        "CARD_INVALID",
        `Evidence ${item.point_id} is not traceable to a citable ${item.scope} source.`,
      );
    }
    if (source.scope !== item.scope) {
      throw new ToolGovernanceError(
        "CARD_INVALID",
        `Evidence ${item.point_id} source scope does not match.`,
      );
    }
    // A tenant citation's source must belong to the same tenant as the evidence.
    if (item.scope === "tenant" && source.tenant_id !== item.tenant_id) {
      throw new ToolGovernanceError(
        "CARD_INVALID",
        `Evidence ${item.point_id} source tenant does not match.`,
      );
    }
    citations.push({
      source_id: source.source_id,
      source_name: source.source_name,
      content_hash: item.content_hash,
      locator: item.locator,
      excerpt: cap_excerpt(item.content, excerpt_max),
      retrieved_at,
      scope: item.scope,
      relevance_score: item.score,
    });
  }
  return citations;
}
