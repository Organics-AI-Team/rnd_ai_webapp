/**
 * G3.5 — quarantined knowledge ingestion.
 *
 * Every external operation is an injected port. The tests exercise the real
 * orchestration and payload construction without Qdrant, object storage,
 * malware-service, parser, or embedding credentials.
 */

import { describe, expect, it } from "vitest";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  create_ingestion_service,
  type IngestionServiceDeps,
  type IngestionSource,
} from "../../apps/ai/server/services/knowledge/ingestion-service";

const TENANT_A = "507f1f77bcf86cd7994390a1";
const ACTOR_A = "507f191e810c19729de860ea";
const SOURCE_A = "507f1f77bcf86cd7994390c1";
const CONTENT_HASH = "a".repeat(64);
const OBJECT_KEY = `tenants/${TENANT_A}/knowledge/${SOURCE_A}/source`;
const IDEMPOTENCY_KEY = "ingestion-request-0001";

/** Build the verified context consumed by ingestion. */
function context(): TenantExecutionContext {
  return {
    tenant_id: TENANT_A,
    actor_profile_id: ACTOR_A,
  } as unknown as TenantExecutionContext;
}

/** Complete quarantined source fixture. */
function source(overrides: Partial<IngestionSource> = {}): IngestionSource {
  return {
    source_id: SOURCE_A,
    tenant_id: TENANT_A,
    status: "quarantined",
    object_key: OBJECT_KEY,
    content_hash: CONTENT_HASH,
    visibility: "managers",
    provenance: { origin: "tenant upload", acquired_at: "2026-07-15" },
    consent_basis: "tenant-owned",
    ingestion_idempotency_key: null,
    ...overrides,
  };
}

interface HarnessOptions {
  readonly source?: IngestionSource;
  readonly detected_mime?: string;
  readonly byte_size?: number;
  readonly content_hash?: string;
  readonly within_allowance?: boolean;
  readonly malware_result?: "clean" | "infected" | "error";
  readonly parser_error?: Error;
  readonly upsert_error?: Error;
  readonly versions?: {
    parser_version: string;
    chunker_version: string;
    embedding_version: string;
  };
  readonly claim_result?: "claimed" | "already_ready" | "conflict";
}

/** Build stateful fakes around the real ingestion service. */
function make_harness(options: HarnessOptions = {}) {
  const current_source = options.source ?? source();
  const events: string[] = [];
  const failures: string[] = [];
  const upserts: Array<readonly Record<string, unknown>[]> = [];
  const cleanups: Array<{ tenant_id: string; source_id: string }> = [];

  const deps: IngestionServiceDeps = {
    source_port: {
      async get_tenant_source() {
        return current_source;
      },
      async claim_ingestion() {
        events.push("claimed");
        return options.claim_result ?? "claimed";
      },
      async mark_indexing() {
        events.push("indexing");
      },
      async mark_ready(_context, _source_id, result) {
        events.push(`ready:${result.indexed_points}`);
      },
      async mark_failed(_context, _source_id, safe_error_code) {
        events.push("failed");
        failures.push(safe_error_code);
      },
    },
    upload_authorization_port: {
      async verify() {
        return {
          tenant_id: TENANT_A,
          actor_profile_id: ACTOR_A,
          source_id: SOURCE_A,
          object_key: OBJECT_KEY,
          maximum_bytes: 1_000,
          allowed_detected_mime_types: ["application/pdf"],
          expires_at: "2026-07-15T01:00:00.000Z",
        };
      },
    },
    object_port: {
      async inspect() {
        events.push("inspected");
        return {
          detected_mime: options.detected_mime ?? "application/pdf",
          byte_size: options.byte_size ?? 500,
          content_hash: options.content_hash ?? CONTENT_HASH,
        };
      },
    },
    storage_allowance_port: {
      async can_store() {
        events.push("allowance");
        return options.within_allowance ?? true;
      },
    },
    malware_port: {
      async scan() {
        events.push("malware");
        return options.malware_result ?? "clean";
      },
    },
    parser_port: {
      async parse() {
        events.push("parsed");
        if (options.parser_error) throw options.parser_error;
        return { text: "first knowledge chunk\nsecond knowledge chunk" };
      },
    },
    chunker_port: {
      async chunk() {
        events.push("chunked");
        return [
          { content: "first knowledge chunk", locator: "page:1" },
          { content: "second knowledge chunk", locator: "page:2" },
        ];
      },
    },
    embedding_port: {
      async embed_many(chunks) {
        events.push("embedded");
        return chunks.map((_chunk, index) => [index, 0.2, 0.3]);
      },
    },
    vector_port: {
      async upsert_tenant(_context, points) {
        events.push("upserted");
        upserts.push(points as unknown as readonly Record<string, unknown>[]);
        if (options.upsert_error) throw options.upsert_error;
      },
      async delete_tenant_source(tenant_context, source_id) {
        events.push("cleaned");
        cleanups.push({ tenant_id: tenant_context.tenant_id, source_id });
      },
    },
    versions: options.versions ?? {
      parser_version: "pdf-parser-v2",
      chunker_version: "semantic-chunker-v3",
      embedding_version: "v1",
    },
  };

  return {
    service: create_ingestion_service(deps),
    events,
    failures,
    upserts,
    cleanups,
  };
}

const request = {
  source_id: SOURCE_A,
  upload_authorization: "signed-upload-token",
  idempotency_key: IDEMPOTENCY_KEY,
};

describe("tenant knowledge ingestion", () => {
  it("keeps the source quarantined until every check and versioned transform passes", async () => {
    const harness = make_harness();

    await expect(
      harness.service.ingest_tenant_source(context(), request),
    ).resolves.toEqual({
      source_id: SOURCE_A,
      status: "ready",
      indexed_points: 2,
      idempotent: false,
    });

    expect(harness.events).toEqual([
      "claimed",
      "inspected",
      "allowance",
      "malware",
      "parsed",
      "chunked",
      "embedded",
      "indexing",
      "upserted",
      "ready:2",
    ]);
    expect(harness.upserts[0]).toHaveLength(2);
    expect(harness.upserts[0]?.[0]).toMatchObject({
      payload: {
        tenant_id: TENANT_A,
        is_tenant: true,
        source_id: SOURCE_A,
        content_hash: CONTENT_HASH,
        visibility: "managers",
        content: "first knowledge chunk",
        locator: "page:1",
        parser_version: "pdf-parser-v2",
        chunker_version: "semantic-chunker-v3",
        embedding_version: "v1",
      },
    });
  });

  it.each([
    {
      name: "detected MIME",
      options: { detected_mime: "application/x-msdownload" },
      code: "KNOWLEDGE_MIME_NOT_ALLOWED",
    },
    {
      name: "maximum size",
      options: { byte_size: 1_001 },
      code: "KNOWLEDGE_FILE_TOO_LARGE",
    },
    {
      name: "content hash",
      options: { content_hash: "b".repeat(64) },
      code: "KNOWLEDGE_CONTENT_HASH_MISMATCH",
    },
    {
      name: "tenant storage allowance",
      options: { within_allowance: false },
      code: "KNOWLEDGE_STORAGE_LIMIT_EXCEEDED",
    },
    {
      name: "malware result",
      options: { malware_result: "infected" as const },
      code: "KNOWLEDGE_MALWARE_DETECTED",
    },
    {
      name: "parser/chunker/embedding versions",
      options: {
        versions: {
          parser_version: "",
          chunker_version: "semantic-chunker-v3",
          embedding_version: "v1",
        },
      },
      code: "KNOWLEDGE_VERSION_INVALID",
    },
    {
      name: "provenance",
      options: { source: source({ provenance: null }) },
      code: "KNOWLEDGE_PROVENANCE_REQUIRED",
    },
    {
      name: "consent",
      options: { source: source({ consent_basis: null }) },
      code: "KNOWLEDGE_CONSENT_REQUIRED",
    },
    {
      name: "idempotency",
      options: { claim_result: "conflict" as const },
      code: "KNOWLEDGE_IDEMPOTENCY_CONFLICT",
    },
  ])("fails closed before indexing when $name verification fails", async ({ options, code }) => {
    const harness = make_harness(options);

    await expect(
      harness.service.ingest_tenant_source(context(), request),
    ).rejects.toMatchObject({ code });
    expect(harness.failures).toEqual([code]);
    expect(harness.events).not.toContain("indexing");
    expect(harness.events).not.toContain("upserted");
  });

  it("records only a safe parser failure and cleans points by source plus tenant", async () => {
    const harness = make_harness({
      parser_error: new Error("secret parser stack and object contents"),
    });

    await expect(
      harness.service.ingest_tenant_source(context(), request),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_INGESTION_FAILED" });
    expect(harness.failures).toEqual(["KNOWLEDGE_INGESTION_FAILED"]);
    expect(harness.cleanups).toEqual([
      { tenant_id: TENANT_A, source_id: SOURCE_A },
    ]);
  });

  it("cleans partially written tenant points when Qdrant upsert fails", async () => {
    const harness = make_harness({
      upsert_error: new Error("qdrant partial write details"),
    });

    await expect(
      harness.service.ingest_tenant_source(context(), request),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_INGESTION_FAILED" });
    expect(harness.events).toContain("upserted");
    expect(harness.cleanups).toEqual([
      { tenant_id: TENANT_A, source_id: SOURCE_A },
    ]);
    expect(harness.failures).toEqual(["KNOWLEDGE_INGESTION_FAILED"]);
  });

  it("returns an already-ready source idempotently without repeating work", async () => {
    const harness = make_harness({
      source: source({
        status: "ready",
        ingestion_idempotency_key: IDEMPOTENCY_KEY,
      }),
    });

    await expect(
      harness.service.ingest_tenant_source(context(), request),
    ).resolves.toEqual({
      source_id: SOURCE_A,
      status: "ready",
      indexed_points: 0,
      idempotent: true,
    });
    expect(harness.events).toEqual([]);
  });

  it("rejects a missing ingestion idempotency key before claiming the source", async () => {
    const harness = make_harness();

    await expect(
      harness.service.ingest_tenant_source(context(), {
        ...request,
        idempotency_key: "",
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_IDEMPOTENCY_CONFLICT" });
    expect(harness.events).toEqual([]);
  });
});
