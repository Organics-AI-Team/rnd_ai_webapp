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
 * Build an in-memory webhook world (receipts + projections + audit).
 */
function fake_world() {
  const receipts = new Map<string, { completed: boolean }>();
  const profiles = new Map<string, any>();
  const memberships = new Map<string, StoredMembership>();
  const invitations = new Map<string, any>();
  const audit_events: any[] = [];
  const suspended_profiles: string[] = [];

  const deps: ClerkWebhookDependencies = {
    receipts: {
      async claim(event_id, event_type) {
        if (receipts.has(event_id)) return { already_processed: true };
        receipts.set(event_id, { completed: false });
        return { already_processed: false };
      },
      async complete(event_id) {
        receipts.set(event_id, { completed: true });
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
        const existing = memberships.get(membership.clerk_membership_id);
        if (existing && existing.clerkSyncedAt > occurred_at) return "stale";
        memberships.set(membership.clerk_membership_id, {
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
        const existing = memberships.get(clerk_membership_id);
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
      async count_other_active_memberships(user_profile_id, clerk_membership_id) {
        return [...memberships.values()].filter(
          (m) =>
            m.userProfileId === user_profile_id &&
            m.clerkMembershipId !== clerk_membership_id &&
            m.status === "active",
        ).length;
      },
      async suspend_profile_authorization(user_profile_id) {
        suspended_profiles.push(user_profile_id);
      },
    },
    audit: {
      async record(event) {
        audit_events.push(event);
      },
    },
  };

  return {
    deps,
    receipts,
    profiles,
    memberships,
    invitations,
    audit_events,
    suspended_profiles,
  };
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
    expect(world.memberships.get("orgmem_1")?.status).toBe("revoked");
  });

  it("suspends authorization and preserves both projections on multiple active memberships", async () => {
    const world = fake_world();
    world.profiles.set("user_multi", {
      clerkUserId: "user_multi",
      status: "active",
      clerkSyncedAt: new Date(0),
    });
    world.memberships.set("orgmem_existing", {
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
    expect(world.suspended_profiles).toContain("profile_user_multi");
    expect(world.memberships.get("orgmem_existing")?.status).toBe("active");
    expect(world.memberships.get("orgmem_second")).toBeTruthy();
    expect(
      world.audit_events.some((e) => e.action === "membership_reconciliation_required"),
    ).toBe(true);
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
