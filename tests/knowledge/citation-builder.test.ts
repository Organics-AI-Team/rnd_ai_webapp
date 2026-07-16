/**
 * G3.5 — citation builder traceability.
 *
 * A citation is produced only for evidence traceable to a ready/active source;
 * an orphaned or non-ready result is rejected fail-closed, a tenant/source
 * tenant mismatch is rejected, and excerpts are capped to the policy length.
 */

import { describe, expect, it } from "vitest";

import {
  build_citations,
  type CitationSource,
  type CitationSourceLookup,
} from "../../apps/ai/server/services/knowledge/citation-builder";
import type { KnowledgeEvidence } from "../../apps/ai/server/services/knowledge/knowledge-gateway";

const TENANT_A = "507f1f77bcf86cd7994390a1";
const RETRIEVED_AT = new Date("2026-07-15T00:00:00Z");

/**
 * Build a lookup over a fixed source table.
 *
 * @param table - Map of source_id to its record.
 * @returns A CitationSourceLookup.
 */
function make_lookup(
  table: Record<string, CitationSource>,
): CitationSourceLookup {
  return {
    async get_source(source_id) {
      return table[source_id] ?? null;
    },
  };
}

/**
 * Build a tenant evidence row.
 *
 * @param source_id - Source id.
 * @param content - Evidence content.
 * @returns A KnowledgeEvidence fixture.
 */
function tenant_evidence(source_id: string, content: string): KnowledgeEvidence {
  return {
    point_id: `pt-${source_id}`,
    source_id,
    scope: "tenant",
    tenant_id: TENANT_A,
    content,
    content_hash: `h-${source_id}`,
    locator: "page:4",
    score: 0.8,
    embedding_version: "v1",
  };
}

/** Build a shared platform evidence row. */
function platform_evidence(source_id: string): KnowledgeEvidence {
  return {
    point_id: `pt-${source_id}`,
    source_id,
    scope: "platform",
    tenant_id: null,
    content: "platform content",
    content_hash: `h-${source_id}`,
    locator: "section:2",
    score: 0.9,
    embedding_version: "v1",
  };
}

describe("build_citations", () => {
  it("builds a citation for a ready source with a capped excerpt", async () => {
    const lookup = make_lookup({
      s1: { source_id: "s1", source_name: "A doc", status: "ready", scope: "tenant", tenant_id: TENANT_A },
    });
    const long = "x".repeat(1000);
    const [citation] = await build_citations(
      [tenant_evidence("s1", long)],
      lookup,
      { excerpt_max_chars: 100, retrieved_at: RETRIEVED_AT },
    );
    expect(citation.source_name).toBe("A doc");
    expect(citation.scope).toBe("tenant");
    expect(citation.excerpt.length).toBe(100);
    expect(citation.retrieved_at).toBe(RETRIEVED_AT.toISOString());
    expect(citation.locator).toBe("page:4");
  });

  it("rejects evidence not traceable to a citable source", async () => {
    const lookup = make_lookup({}); // no sources
    await expect(
      build_citations([tenant_evidence("orphan", "content")], lookup),
    ).rejects.toMatchObject({ code: "CARD_INVALID" });
  });

  it("rejects a source that is not ready/active", async () => {
    const lookup = make_lookup({
      s1: { source_id: "s1", source_name: "pending doc", status: "pending", scope: "tenant", tenant_id: TENANT_A },
    });
    await expect(
      build_citations([tenant_evidence("s1", "content")], lookup),
    ).rejects.toMatchObject({ code: "CARD_INVALID" });
  });

  it("rejects a tenant/source tenant mismatch", async () => {
    const lookup = make_lookup({
      s1: { source_id: "s1", source_name: "other tenant", status: "ready", scope: "tenant", tenant_id: "other" },
    });
    await expect(
      build_citations([tenant_evidence("s1", "content")], lookup),
    ).rejects.toMatchObject({ code: "CARD_INVALID" });
  });

  it("rejects a source whose stored scope does not match the evidence scope", async () => {
    const lookup = make_lookup({
      s1: {
        source_id: "s1",
        source_name: "mislabeled tenant source",
        status: "ready",
        scope: "tenant",
        tenant_id: TENANT_A,
      },
    });
    await expect(
      build_citations([platform_evidence("s1")], lookup),
    ).rejects.toMatchObject({ code: "CARD_INVALID" });
  });
});
