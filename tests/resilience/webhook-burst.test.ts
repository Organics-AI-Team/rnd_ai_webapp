/** Signed duplicate/out-of-order Clerk webhook burst verification (G5.8). */

import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  handle_clerk_webhook,
  type ClerkWebhookDependencies,
} from "../../apps/ai/server/services/provisioning/apply-clerk-event";

const SECRET_BYTES = Buffer.from("synthetic-clerk-signing-secret-32b");
const SIGNING_SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
const previous_secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;

/** Sign one synthetic Clerk request using the handler's documented Svix scheme. */
function signed_request(message_id: string, payload: unknown): Request {
  const timestamp = Math.floor(Date.now() / 1_000);
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", SECRET_BYTES)
    .update(`${message_id}.${timestamp}.${body}`)
    .digest("base64");
  return new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": message_id,
      "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${signature}`,
    },
    body,
  });
}

/** Build atomic in-process receipt and monotonic projection seams. */
function webhook_world() {
  const receipts = new Map<string, boolean>();
  let applied = 0;
  let current: { primary_email: string; occurred_at: Date } | null = null;
  const deps: ClerkWebhookDependencies = {
    receipts: {
      async claim(event_id) {
        if (receipts.has(event_id)) return { already_processed: true };
        receipts.set(event_id, false);
        return { already_processed: false };
      },
      async complete(event_id) {
        receipts.set(event_id, true);
      },
      async fail(event_id) {
        receipts.delete(event_id);
      },
    },
    projections: {
      async upsert_user_profile(user, occurred_at) {
        applied += 1;
        if (current && current.occurred_at > occurred_at) return "stale";
        current = { primary_email: user.primary_email, occurred_at };
        return "applied";
      },
      async mark_user_deleted() {
        return "applied";
      },
      async find_tenant_id_by_clerk_org() {
        return null;
      },
      async find_profile_id_by_clerk_user() {
        return null;
      },
      async upsert_membership() {
        return "applied";
      },
      async revoke_membership() {
        return "applied";
      },
      async update_invitation_status() {
        return "applied";
      },
      async count_active_memberships() {
        return 0;
      },
      async find_membership_tenant_id() {
        return null;
      },
      async count_active_managers() {
        return 1;
      },
    },
    audit: {
      async record() {},
    },
  };
  return {
    deps,
    receipts,
    applied: () => applied,
    current: () => current,
  };
}

beforeAll(() => {
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET;
});

afterAll(() => {
  if (previous_secret === undefined) {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  } else {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = previous_secret;
  }
});

describe("Clerk webhook burst", () => {
  it("acknowledges 50 duplicate/out-of-order deliveries and applies each event ID once", async () => {
    const world = webhook_world();
    const base_time = Date.parse("2026-07-15T00:00:00.000Z");
    const deliveries = Array.from({ length: 10 }, (_unused, revision) => {
      const payload = {
        type: "user.updated",
        data: {
          id: "user_synthetic_burst",
          email_addresses: [
            { email_address: `synthetic-revision-${revision}@example.invalid` },
          ],
          first_name: "Synthetic",
          last_name: `Revision ${revision}`,
          updated_at: base_time + revision * 1_000,
        },
      };
      return Array.from({ length: 5 }, () =>
        signed_request(`msg-synthetic-${revision}`, payload),
      );
    }).flat().reverse();

    const responses = await Promise.all(
      deliveries.map((request) => handle_clerk_webhook(request, world.deps)),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(world.receipts.size).toBe(10);
    expect([...world.receipts.values()].every(Boolean)).toBe(true);
    expect(world.applied()).toBe(10);
    expect(world.current()).toEqual({
      primary_email: "synthetic-revision-9@example.invalid",
      occurred_at: new Date(base_time + 9_000),
    });
  });
});
