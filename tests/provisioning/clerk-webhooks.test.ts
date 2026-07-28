// tests/provisioning/clerk-webhooks.test.ts
import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  handle_clerk_webhook,
  type ClerkWebhookDependencies,
} from "../../apps/ai/server/services/provisioning/apply-clerk-event";

const SIGNING_SECRET = `whsec_${Buffer.from("test-signing-secret-32-bytes!!").toString("base64")}`;
process.env.CLERK_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET;

/**
 * Sign a webhook payload with the documented svix v1 scheme.
 *
 * @param options - Message ID, timestamp, and payload to sign.
 * @returns Signed Request ready for the handler.
 */
function signed_request(options: {
  payload: unknown;
  message_id?: string;
  timestamp?: Date;
  corrupt_signature?: boolean;
}): Request {
  const message_id = options.message_id ?? `msg_${randomUUID()}`;
  const timestamp = Math.floor((options.timestamp ?? new Date()).getTime() / 1000);
  const body = JSON.stringify(options.payload);
  const secret_bytes = Buffer.from(SIGNING_SECRET.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", secret_bytes)
    .update(`${message_id}.${timestamp}.${body}`)
    .digest("base64");
  return new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": message_id,
      "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${options.corrupt_signature ? "AAAA" : signature}`,
    },
    body,
  });
}

interface StoredMembership {
  clerkMembershipId: string;
  tenantId: string;
  userProfileId: string;
  tenantRole: string;
  status: string;
  clerkSyncedAt: Date;
}

/**
 * In-memory membership map key mirroring the production revive keying:
 * one row per (tenant, profile) pair — NEVER per Clerk membership id.
 */
function pair_key(tenant_id: string, user_profile_id: string): string {
  return `${tenant_id}:${user_profile_id}`;
}

/**
 * Build an in-memory webhook world (receipts + projections + audit) with the
 * Plan 3 dependency surface: retryable receipts, revive-keyed memberships,
 * count_active_memberships (no profile suspension port exists any more).
 */
function fake_world() {
  const receipts = new Map<string, { completed: boolean; failed: boolean }>();
  const profiles = new Map<string, any>();
  const memberships = new Map<string, StoredMembership>();
  const invitations = new Map<string, any>();
  const audit_events: any[] = [];

  const deps: ClerkWebhookDependencies = {
    receipts: {
      async claim(event_id, _event_type) {
        const existing = receipts.get(event_id);
        if (existing && !existing.failed) return { already_processed: true };
        receipts.set(event_id, { completed: false, failed: false });
        return { already_processed: false };
      },
      async complete(event_id) {
        receipts.set(event_id, { completed: true, failed: false });
      },
      async fail(event_id) {
        receipts.set(event_id, { completed: false, failed: true });
      },
    },
    projections: {
      async upsert_user_profile(clerk_user, occurred_at) {
        const existing = profiles.get(clerk_user.id);
        if (existing && existing.clerkSyncedAt > occurred_at) return "stale";
        profiles.set(clerk_user.id, {
          clerkUserId: clerk_user.id,
          primaryEmail: clerk_user.primary_email,
          displayName: clerk_user.display_name,
          status: existing?.status ?? "active",
          clerkSyncedAt: occurred_at,
        });
        return "applied";
      },
      async mark_user_deleted(clerk_user_id, occurred_at) {
        const existing = profiles.get(clerk_user_id);
        if (existing && existing.clerkSyncedAt > occurred_at) return "stale";
        if (existing) {
          existing.status = "deleted";
          existing.clerkSyncedAt = occurred_at;
        }
        return "applied";
      },
      async find_tenant_id_by_clerk_org(clerk_org_id) {
        return clerk_org_id === "org_known" ? "tenant_1" : null;
      },
      async find_profile_id_by_clerk_user(clerk_user_id) {
        return profiles.has(clerk_user_id) ? `profile_${clerk_user_id}` : null;
      },
      async upsert_membership(membership, occurred_at) {
        const key = pair_key(membership.tenant_id, membership.user_profile_id);
        const existing = memberships.get(key);
        if (existing && existing.clerkSyncedAt > occurred_at) return "stale";
        memberships.set(key, {
          clerkMembershipId: membership.clerk_membership_id,
          tenantId: membership.tenant_id,
          userProfileId: membership.user_profile_id,
          tenantRole: membership.tenant_role,
          status: membership.status,
          clerkSyncedAt: occurred_at,
        });
        return "applied";
      },
      async revoke_membership(clerk_membership_id, occurred_at) {
        const existing = [...memberships.values()].find(
          (m) => m.clerkMembershipId === clerk_membership_id,
        );
        if (existing && existing.clerkSyncedAt > occurred_at) return "stale";
        if (existing) {
          existing.status = "revoked";
          existing.clerkSyncedAt = occurred_at;
        }
        return "applied";
      },
      async update_invitation_status(clerk_invitation_id, status, occurred_at) {
        invitations.set(clerk_invitation_id, { status, clerkSyncedAt: occurred_at });
        return "applied";
      },
      async count_active_memberships(user_profile_id) {
        return [...memberships.values()].filter(
          (m) => m.userProfileId === user_profile_id && m.status === "active",
        ).length;
      },
    },
    audit: {
      async record(event) {
        audit_events.push(event);
      },
    },
  };

  return { deps, receipts, profiles, memberships, invitations, audit_events };
}

const membership_created_payload = (overrides: Record<string, unknown> = {}) => ({
  type: "organizationMembership.created",
  data: {
    id: "orgmem_1",
    organization: { id: "org_known" },
    public_user_data: { user_id: "user_1" },
    role: "org:member",
    created_at: Date.parse("2026-07-15T00:00:00Z"),
    updated_at: Date.parse("2026-07-15T00:00:00Z"),
    ...overrides,
  },
});

describe("handle_clerk_webhook", () => {
  it("rejects an invalid signature without touching projections", async () => {
    const world = fake_world();
    const response = await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload(), corrupt_signature: true }),
      world.deps,
    );
    expect(response.status).toBe(400);
    expect(world.memberships.size).toBe(0);
    expect(world.receipts.size).toBe(0);
  });

  it("acknowledges a duplicate webhook without applying it twice", async () => {
    const world = fake_world();
    world.profiles.set("user_1", {
      clerkUserId: "user_1",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    const message_id = "msg_dup_1";
    const first = await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload(), message_id }),
      world.deps,
    );
    const second = await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload(), message_id }),
      world.deps,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(world.memberships.size).toBe(1);
  });

  it("applies user create then ignores an out-of-order older update", async () => {
    const world = fake_world();
    const newer = {
      type: "user.updated",
      data: {
        id: "user_2",
        email_addresses: [{ email_address: "new@x.ac.th" }],
        first_name: "New",
        last_name: "Name",
        updated_at: Date.parse("2026-07-15T10:00:00Z"),
      },
    };
    const older = {
      ...newer,
      data: {
        ...newer.data,
        email_addresses: [{ email_address: "old@x.ac.th" }],
        updated_at: Date.parse("2026-07-15T09:00:00Z"),
      },
    };
    await handle_clerk_webhook(signed_request({ payload: newer }), world.deps);
    const response = await handle_clerk_webhook(
      signed_request({ payload: older }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(world.profiles.get("user_2")?.primaryEmail).toBe("new@x.ac.th");
  });

  it("soft-deletes on user.deleted instead of removing identity", async () => {
    const world = fake_world();
    world.profiles.set("user_3", {
      clerkUserId: "user_3",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    const response = await handle_clerk_webhook(
      signed_request({
        payload: { type: "user.deleted", data: { id: "user_3", deleted: true } },
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(world.profiles.get("user_3")?.status).toBe("deleted");
    expect(world.profiles.has("user_3")).toBe(true);
  });

  it("revokes membership on organizationMembership.deleted", async () => {
    const world = fake_world();
    world.profiles.set("user_1", {
      clerkUserId: "user_1",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload() }),
      world.deps,
    );
    const response = await handle_clerk_webhook(
      signed_request({
        payload: {
          type: "organizationMembership.deleted",
          data: {
            id: "orgmem_1",
            organization: { id: "org_known" },
            public_user_data: { user_id: "user_1" },
            updated_at: Date.parse("2026-07-15T01:00:00Z"),
          },
        },
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(world.memberships.get("tenant_1:profile_user_1")?.status).toBe("revoked");
  });

  it("keeps both memberships active and records membership_multi_org — never mutating the profile", async () => {
    const world = fake_world();
    world.profiles.set("user_multi", {
      clerkUserId: "user_multi",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    world.memberships.set("tenant_other:profile_user_multi", {
      clerkMembershipId: "orgmem_existing",
      tenantId: "tenant_other",
      userProfileId: "profile_user_multi",
      tenantRole: "user",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    const response = await handle_clerk_webhook(
      signed_request({
        payload: membership_created_payload({
          id: "orgmem_second",
          public_user_data: { user_id: "user_multi" },
        }),
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(world.profiles.get("user_multi")?.status).toBe("active");
    expect(world.memberships.get("tenant_other:profile_user_multi")?.status).toBe("active");
    expect(world.memberships.get("tenant_1:profile_user_multi")?.status).toBe("active");
    const multi_audit = world.audit_events.find((e) => e.action === "membership_multi_org");
    expect(multi_audit).toMatchObject({
      userProfileId: "profile_user_multi",
      clerkMembershipId: "orgmem_second",
      activeMembershipCount: 2,
    });
    expect(
      world.audit_events.some((e) => e.action === "membership_reconciliation_required"),
    ).toBe(false);
  });

  it("revives the same (tenant, profile) projection under a NEW clerkMembershipId after remove→re-invite", async () => {
    const world = fake_world();
    world.profiles.set("user_1", {
      clerkUserId: "user_1",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload() }),
      world.deps,
    );
    await handle_clerk_webhook(
      signed_request({
        payload: {
          type: "organizationMembership.deleted",
          data: {
            id: "orgmem_1",
            organization: { id: "org_known" },
            public_user_data: { user_id: "user_1" },
            updated_at: Date.parse("2026-07-15T01:00:00Z"),
          },
        },
      }),
      world.deps,
    );
    const response = await handle_clerk_webhook(
      signed_request({
        payload: membership_created_payload({
          id: "orgmem_2",
          created_at: Date.parse("2026-07-15T02:00:00Z"),
          updated_at: Date.parse("2026-07-15T02:00:00Z"),
        }),
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    // The blocking-fix regression: ONE row per pair, revived active under
    // the new Clerk membership id — no second insert, no lost event.
    expect(world.memberships.size).toBe(1);
    const revived = world.memberships.get("tenant_1:profile_user_1");
    expect(revived).toMatchObject({
      clerkMembershipId: "orgmem_2",
      status: "active",
    });
  });

  it("returns 5xx on a failed apply and reapplies on the svix retry", async () => {
    const world = fake_world();
    world.profiles.set("user_1", {
      clerkUserId: "user_1",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    let failures_remaining = 1;
    const flaky_deps: ClerkWebhookDependencies = {
      ...world.deps,
      projections: {
        ...world.deps.projections,
        async upsert_membership(membership, occurred_at) {
          if (failures_remaining > 0) {
            failures_remaining -= 1;
            throw new Error("transient projection outage");
          }
          return world.deps.projections.upsert_membership(membership, occurred_at);
        },
      },
    };
    const message_id = "msg_retry_1";
    const first = await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload(), message_id }),
      flaky_deps,
    );
    expect(first.status).toBe(500);
    expect(world.memberships.size).toBe(0);
    expect(world.receipts.get(message_id)).toEqual({ completed: false, failed: true });
    const second = await handle_clerk_webhook(
      signed_request({ payload: membership_created_payload(), message_id }),
      flaky_deps,
    );
    expect(second.status).toBe(200);
    expect(world.memberships.size).toBe(1);
    expect(world.receipts.get(message_id)).toEqual({ completed: true, failed: false });
  });

  it("marks invitation accepted on organizationInvitation.accepted", async () => {
    const world = fake_world();
    const response = await handle_clerk_webhook(
      signed_request({
        payload: {
          type: "organizationInvitation.accepted",
          data: {
            id: "inv_1",
            organization_id: "org_known",
            updated_at: Date.parse("2026-07-15T02:00:00Z"),
          },
        },
      }),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(world.invitations.get("inv_1")?.status).toBe("active");
  });
});
