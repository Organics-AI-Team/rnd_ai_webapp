// apps/web/app/api/webhooks/clerk/route.ts
import type { Db } from "mongodb";
import client_promise from "@rnd-ai/shared-database";

import {
  handle_clerk_webhook,
  type ApplyOutcome,
  type ClerkWebhookDependencies,
} from "@/server/services/provisioning/apply-clerk-event";

export const dynamic = "force-dynamic";

/**
 * Monotonic guarded update: applies only when the stored clerkSyncedAt is
 * absent or older than the event occurrence.
 *
 * @param db - Database handle.
 * @param collection - Target collection name.
 * @param filter - Record selector.
 * @param set - Fields to apply.
 * @param occurred_at - Event occurrence time.
 * @returns applied when the write matched; stale otherwise.
 */
async function monotonic_update(
  db: Db,
  collection: string,
  filter: Record<string, unknown>,
  set: Record<string, unknown>,
  occurred_at: Date,
): Promise<ApplyOutcome> {
  const result = await db.collection(collection).updateOne(
    {
      ...filter,
      $or: [
        { clerkSyncedAt: null },
        { clerkSyncedAt: { $exists: false } },
        { clerkSyncedAt: { $lt: occurred_at } },
      ],
    },
    { $set: { ...set, clerkSyncedAt: occurred_at, updatedAt: new Date() } },
  );
  return result.matchedCount > 0 ? "applied" : "stale";
}

/**
 * Build the production webhook dependencies over MongoDB projections.
 *
 * @param db - Connected database handle.
 * @returns Dependencies for handle_clerk_webhook.
 */
function production_deps(db: Db): ClerkWebhookDependencies {
  return {
    receipts: {
      async claim(event_id, event_type) {
        const result = await db.collection("clerk_webhook_receipts").updateOne(
          { eventId: event_id },
          {
            $setOnInsert: {
              eventId: event_id,
              type: event_type,
              occurredAt: new Date(),
              processedAt: null,
              result: "claimed",
            },
          },
          { upsert: true },
        );
        if (result.upsertedCount > 0) return { already_processed: false };
        // A previously FAILED apply is reclaimable: the svix retry must
        // reapply instead of no-opping against a dead claim.
        const reclaimed = await db
          .collection("clerk_webhook_receipts")
          .findOneAndUpdate(
            { eventId: event_id, result: "failed" },
            { $set: { result: "claimed", occurredAt: new Date() } },
          );
        return { already_processed: reclaimed === null };
      },
      async complete(event_id) {
        await db.collection("clerk_webhook_receipts").updateOne(
          { eventId: event_id },
          { $set: { processedAt: new Date(), result: "processed" } },
        );
      },
      async fail(event_id) {
        console.error({
          boundary: "clerk-webhook",
          event: "receipt.failed",
          event_id,
        });
        await db.collection("clerk_webhook_receipts").updateOne(
          { eventId: event_id },
          { $set: { result: "failed", processedAt: new Date() } },
        );
      },
    },
    projections: {
      async upsert_user_profile(clerk_user, occurred_at) {
        const existing = await db
          .collection("user_profiles")
          .findOne({ clerkUserId: clerk_user.id });
        if (!existing) {
          await db.collection("user_profiles").insertOne({
            clerkUserId: clerk_user.id,
            legacyAccountId: null,
            primaryEmail: clerk_user.primary_email,
            displayName: clerk_user.display_name,
            platformRole: null,
            status: "active",
            clerkSyncVersion: 0,
            clerkSyncedAt: occurred_at,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          return "applied";
        }
        return monotonic_update(
          db,
          "user_profiles",
          { clerkUserId: clerk_user.id },
          {
            primaryEmail: clerk_user.primary_email,
            displayName: clerk_user.display_name,
          },
          occurred_at,
        );
      },
      async mark_user_deleted(clerk_user_id, occurred_at) {
        return monotonic_update(
          db,
          "user_profiles",
          { clerkUserId: clerk_user_id },
          { status: "deleted" },
          occurred_at,
        );
      },
      async find_tenant_id_by_clerk_org(clerk_org_id) {
        const tenant = await db
          .collection("tenants")
          .findOne({ clerkOrganizationId: clerk_org_id });
        return tenant ? tenant._id.toString() : null;
      },
      async find_profile_id_by_clerk_user(clerk_user_id) {
        const profile = await db
          .collection("user_profiles")
          .findOne({ clerkUserId: clerk_user_id });
        return profile ? profile._id.toString() : null;
      },
      async upsert_membership(membership, occurred_at) {
        // Revive keying (Plan 3 BLOCKING fix): one projection row per
        // (tenantId, userProfileId) — the unique index forbids a second row,
        // and remove→re-invite mints a NEW clerkMembershipId for the SAME
        // pair. Insert when absent; otherwise revive/update the existing row
        // under the monotonic clock guard, adopting the new Clerk id.
        const existing = await db
          .collection("tenant_membership_projections")
          .findOne({
            tenantId: membership.tenant_id,
            userProfileId: membership.user_profile_id,
          });
        if (!existing) {
          await db.collection("tenant_membership_projections").insertOne({
            clerkMembershipId: membership.clerk_membership_id,
            tenantId: membership.tenant_id,
            userProfileId: membership.user_profile_id,
            tenantRole: membership.tenant_role,
            status: membership.status,
            clerkSyncVersion: 0,
            clerkSyncedAt: occurred_at,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          return "applied";
        }
        return monotonic_update(
          db,
          "tenant_membership_projections",
          {
            tenantId: membership.tenant_id,
            userProfileId: membership.user_profile_id,
          },
          {
            clerkMembershipId: membership.clerk_membership_id,
            tenantRole: membership.tenant_role,
            status: membership.status,
          },
          occurred_at,
        );
      },
      async revoke_membership(clerk_membership_id, occurred_at) {
        return monotonic_update(
          db,
          "tenant_membership_projections",
          { clerkMembershipId: clerk_membership_id },
          { status: "revoked" },
          occurred_at,
        );
      },
      async update_invitation_status(clerk_invitation_id, status, occurred_at) {
        return monotonic_update(
          db,
          "tenant_invitation_projections",
          { clerkInvitationId: clerk_invitation_id },
          { status },
          occurred_at,
        );
      },
      async count_active_memberships(user_profile_id) {
        return db.collection("tenant_membership_projections").countDocuments({
          userProfileId: user_profile_id,
          status: "active",
        });
      },
    },
    audit: {
      async record(event) {
        await db.collection("platform_audit_events").insertOne({ ...event });
      },
    },
  };
}

/**
 * Clerk webhook ingress. Signature-verified before any parsing; duplicate
 * events acknowledge 200 without reapplying; failed applies answer 500 so
 * svix retries (receipts complete only after a successful apply).
 *
 * @param request - Incoming webhook request.
 * @returns 200 on success/duplicate, 400 on invalid signature, 500 retryable.
 */
export async function POST(request: Request): Promise<Response> {
  const client = await client_promise;
  return handle_clerk_webhook(request, production_deps(client.db()));
}
