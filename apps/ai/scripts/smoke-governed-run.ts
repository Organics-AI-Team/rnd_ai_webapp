/**
 * Server-side E2E smoke of the governed run pipeline (operator tool).
 *
 * Creates a REAL run through the production gateway (admission, policy,
 * rollout, budget, context pack) as a synthetic manager principal, then
 * tails `ai_run_events` until the run completes or fails — exercising the
 * live worker, model provider, tools, knowledge corpus, and durable chat
 * persistence end to end without a browser session. Run ON the droplet (DBs
 * are firewalled). Its temporary archived chat thread is removed by default.
 *
 * Usage:
 *   SMOKE_AGENT_KEY=sales_rnd SMOKE_MESSAGE="..." \
 *   IMPORT_TENANT_ID=<tenant> IMPORT_ACTOR_PROFILE_ID=<profile> \
 *     npm run smoke:run -w apps/ai
 *
 * Exits 0 on run.completed, 1 on run.failed/timeout (prints the event log).
 */
import { randomUUID } from "node:crypto";

import { ObjectId } from "mongodb";
import { TENANT_ROLE_PERMISSIONS } from "@rnd-ai/shared-types";

/** Read a required env var or throw with its name. */
function required_env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

/** Poll interval and overall timeout for event tailing (ms). */
const POLL_MS = 3_000;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 240_000);

/** CLI entry: create one governed run and tail its events to completion. */
async function run_cli(): Promise<void> {
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const { create_production_run_gateway } = await import(
    "../server/services/ai-gateway/run-api-runtime"
  );
  const { create_conversation_repository } = await import(
    "../server/repositories/conversation-repository"
  );

  const tenant_id = required_env("IMPORT_TENANT_ID");
  const actor_profile_id = required_env("IMPORT_ACTOR_PROFILE_ID");
  const agent_key = process.env.SMOKE_AGENT_KEY ?? "sales_rnd";
  const message =
    process.env.SMOKE_MESSAGE ??
    "แนะนำ active สำหรับ brightening serum งบไม่เกิน 500 บาทต่อกิโล ไม่เอา paraben";

  const client = await client_promise;
  const db = client.db();
  let smoke_thread_id: string | null = null;
  try {
    const profile = await db
      .collection("user_profiles")
      .findOne({ _id: new ObjectId(actor_profile_id) }, { projection: { clerkUserId: 1 } });
    const tenant_doc = await db
      .collection("tenants")
      .findOne({ _id: new ObjectId(tenant_id) }, { projection: { clerkOrganizationId: 1 } });
    const membership = await db
      .collection("tenant_membership_projections")
      .findOne({ tenantId: tenant_id, userProfileId: actor_profile_id }, { projection: { _id: 1 } });

    const tenant = Object.freeze({
      tenant_id,
      actor_profile_id,
      clerk_user_id: String(profile?.clerkUserId ?? ""),
      clerk_organization_id: String(tenant_doc?.clerkOrganizationId ?? ""),
      membership_id: String(membership?._id ?? ""),
      tenant_role: "manager" as const,
      permissions: [...TENANT_ROLE_PERMISSIONS.manager, "ai:run"],
      access_mode: "member" as const,
      support_grant_id: null,
      correlation_id: `smoke-${randomUUID()}`,
      request_started_at: new Date().toISOString(),
    });

    const gateway = create_production_run_gateway(client, db, {
      now: () => new Date(),
      correlation_id: () => `smoke-${randomUUID()}`,
    });
    const conversations = create_conversation_repository(db);
    const thread = await conversations.create_thread(tenant, {
      title: `[Smoke QA] ${agent_key}`,
      agentType: "smoke_qa",
      isArchived: true,
      messageCount: 1,
    });
    smoke_thread_id = String(thread._id);
    await conversations.add_chat_message(tenant, smoke_thread_id, {
      role: "user",
      content: message,
      metadata: { smoke: true },
    });

    console.log(`[smoke:run] creating run { agent_key: ${agent_key} }`);
    const accepted = await gateway.create_run(tenant, {
      schema_version: "1",
      thread_id: smoke_thread_id,
      agent_key,
      message,
      attachment_source_ids: [],
      response_preferences: { language: "th", detail: "standard" },
      idempotency_key: `smoke-${randomUUID()}`,
    });
    console.log(`[smoke:run] accepted { run_id: ${accepted.run_id}, executor: ${accepted.executor} }`);

    const events = db.collection("ai_run_events");
    const started = Date.now();
    let last_seq = -1;
    for (;;) {
      const batch = await events
        .find({ runId: accepted.run_id, sequence: { $gt: last_seq } })
        .sort({ sequence: 1 })
        .toArray();
      for (const event of batch) {
        last_seq = Number(event.sequence);
        const stored_event = event.event as { type?: unknown; payload?: unknown } | undefined;
        const type = typeof stored_event?.type === "string" ? stored_event.type : String(event.type);
        const payload = stored_event?.payload ?? event.payload ?? {};
        const brief =
          type === "run.failed"
            ? JSON.stringify(payload)
            : type === "action.started" || type === "action.completed"
              ? String((payload as { tool_name?: string }).tool_name ?? "")
              : "";
        console.log(`[smoke:run] #${event.sequence} ${type} ${brief}`);
        if (type === "run.completed") {
          const assistant = await db.collection("chat_messages").findOne({
            tenantId: tenant_id,
            runId: accepted.run_id,
            role: "assistant",
          });
          if (!assistant) throw new Error("Completed run did not persist an assistant message.");
          console.log("[smoke:run] assistant message persisted");
          console.log("[smoke:run] SUCCESS");
          return;
        }
        if (type === "run.failed") {
          console.error("[smoke:run] FAILED", JSON.stringify(payload));
          process.exitCode = 1;
          return;
        }
      }
      if (Date.now() - started > TIMEOUT_MS) {
        console.error(`[smoke:run] TIMEOUT after ${TIMEOUT_MS}ms at sequence ${last_seq}`);
        process.exitCode = 1;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } finally {
    try {
      if (smoke_thread_id && process.env.SMOKE_KEEP_DATA !== "true") {
        await Promise.all([
          db.collection("chat_messages").deleteMany({
            tenantId: tenant_id,
            actorProfileId: actor_profile_id,
            threadId: smoke_thread_id,
          }),
          db.collection("chat_threads").deleteOne({
            _id: new ObjectId(smoke_thread_id),
            tenantId: tenant_id,
            ownerProfileId: actor_profile_id,
            agentType: "smoke_qa",
          }),
        ]);
        console.log("[smoke:run] temporary chat data removed");
      }
    } finally {
      await client.close();
    }
  }
}

if (process.argv[1]?.includes("smoke-governed-run")) {
  run_cli().catch((e) => {
    console.error("[smoke:run] failed:", e?.message ?? e);
    process.exitCode = 1;
  });
}
