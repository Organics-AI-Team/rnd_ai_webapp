/** G5.6 tenant-safe commercial event redaction and export. */

import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";

import {
  create_commercial_event,
  create_hmac_tenant_pseudonymizer,
  export_commercial_event,
  export_commercial_event_to_mongo,
  serialize_commercial_event,
} from "../../apps/ai/server/services/observability/commercial-events";
import {
  REDACTED_VALUE,
  redact_event,
} from "../../apps/ai/server/services/observability/redaction";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const secret_event_fixtures: ReadonlyArray<
  readonly [string, Record<string, unknown>, string]
> = [
  ["Clerk token", { authorization: "Bearer clerk-token-secret" }, "clerk-token-secret"],
  ["provider key", { providerApiKey: "sk-provider-secret" }, "sk-provider-secret"],
  ["cookie", { headers: { cookie: "session=private-cookie" } }, "private-cookie"],
  ["password", { password: "private-password" }, "private-password"],
  ["password digest", { passwordDigest: "digest-secret" }, "digest-secret"],
  ["email", { actor_email: "person@example.test" }, "person@example.test"],
  ["raw tenant identifier", { tenant_id: "tenant-secret-id" }, "tenant-secret-id"],
  ["prompt", { prompt: "system prompt secret" }, "system prompt secret"],
  ["document excerpt", { documentExcerpt: "customer formula secret" }, "customer formula secret"],
  [
    "Mongo URI",
    { database_url: "mongodb+srv://user:pass@private.example/db" },
    "mongodb+srv://user:pass@private.example/db",
  ],
  [
    "raw model payload",
    { rawModelPayload: { text: "private model output" } },
    "private model output",
  ],
  [
    "nested tool arguments",
    { metadata: { tool: { arguments: { query: "private nested query" } } } },
    "private nested query",
  ],
];

describe("commercial event redaction", () => {
  it.each(secret_event_fixtures)("redacts %s", (_name, event, secret) => {
    const serialized = JSON.stringify(redact_event(event));
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain(REDACTED_VALUE);
  });

  it("drops a field whose getter fails and emits REDACTION_FAILURE without the original", () => {
    const secret = "getter-secret-must-never-escape";
    const event: Record<string, unknown> = {
      event_name: "provider.failed",
      correlation_id: "corr-1",
    };
    Object.defineProperty(event, "metadata", {
      enumerable: true,
      get() {
        throw new Error(secret);
      },
    });

    const serialized = JSON.stringify(redact_event(event));

    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("REDACTION_FAILURE");
    expect(serialized).toContain(REDACTED_VALUE);
  });

  it("fails closed when object traversal itself throws", () => {
    const secret = "proxy-traversal-secret";
    const toxic = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(secret);
        },
      },
    );

    const serialized = JSON.stringify(redact_event(toxic));

    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("REDACTION_FAILURE");
  });
});

describe("commercial event construction and export", () => {
  it("emits the required content-free dimensions with a tenant pseudonym", () => {
    const pseudonymizer = create_hmac_tenant_pseudonymizer(
      "test-pseudonym-secret-with-enough-entropy",
    );
    const event = create_commercial_event(
      {
        event_name: "run.completed",
        tenant_id: "tenant-a",
        correlation_id: "corr-1",
        run_id: "run-1",
        deployment_id: "deployment-1",
        orchestrator_version: "ooda-v2",
        policy_version: 7,
        prompt_version: "prompt-v3",
        tool_name: "knowledge.search",
        tool_version: "1.0.0",
        phase: "finalize",
        duration_ms: 450,
        status: "ok",
        error_code: null,
        input_tokens: 100,
        output_tokens: 20,
        cost_microusd: 2_500,
        evidence_count: 3,
        prompt: "must be ignored by the allowlist",
      } as never,
      { pseudonymizer, now: () => NOW },
    );

    expect(event).toMatchObject({
      schema_version: "1",
      event_name: "run.completed",
      occurred_at: NOW.toISOString(),
      correlation_id: "corr-1",
      run_id: "run-1",
      deployment_id: "deployment-1",
      orchestrator_version: "ooda-v2",
      policy_version: 7,
      prompt_version: "prompt-v3",
      tool_name: "knowledge.search",
      tool_version: "1.0.0",
      phase: "finalize",
      duration_ms: 450,
      status: "ok",
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      cost_microusd: 2_500,
      evidence_count: 3,
    });
    expect(event.tenant_pseudonym).toMatch(/^tenant_[a-f0-9]{24}$/);
    expect(event).not.toHaveProperty("tenant_id");
    expect(event).not.toHaveProperty("prompt");
    expect(JSON.parse(serialize_commercial_event(event))).toMatchObject({
      prompt_version: "prompt-v3",
      input_tokens: 100,
      output_tokens: 20,
    });
  });

  it("always redacts before serialization and export", async () => {
    const forged_event = {
      schema_version: "1",
      event_name: "tool.completed",
      occurred_at: NOW.toISOString(),
      correlation_id: "corr-2",
      tenant_pseudonym: "tenant_abc",
      status: "ok",
      prompt: "serialization-secret",
      metadata: { nested: { args: { value: "export-secret" } } },
    } as never;
    let exported = "";

    const serialized = serialize_commercial_event(forged_event);
    await export_commercial_event(forged_event, {
      async write(value) {
        exported = value;
      },
    });

    for (const value of [serialized, exported]) {
      expect(value).not.toContain("serialization-secret");
      expect(value).not.toContain("export-secret");
      expect(value).toContain(REDACTED_VALUE);
    }
  });

  it("persists only the redacted representation to the commercial event collection", async () => {
    let stored: Record<string, unknown> | null = null;
    const db = {
      collection(name: string) {
        expect(name).toBe("ai_commercial_events");
        return {
          async insertOne(document: Record<string, unknown>) {
            stored = document;
            return { acknowledged: true };
          },
        };
      },
    } as unknown as Db;
    const forged_event = {
      schema_version: "1",
      event_name: "provider.failed",
      occurred_at: NOW.toISOString(),
      correlation_id: "corr-3",
      tenant_pseudonym: "tenant_abc",
      status: "error",
      rawModelPayload: { output: "mongo-export-secret" },
    } as never;

    await export_commercial_event_to_mongo(forged_event, db);

    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain("mongo-export-secret");
    expect(serialized).toContain(REDACTED_VALUE);
    expect(stored).toHaveProperty("redaction_metadata");
  });
});
