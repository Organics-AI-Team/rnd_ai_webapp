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
        return { already_processed: result.upsertedCount === 0 };
      },
      async complete(event_id) {
        await db.collection("clerk_webhook_receipts").updateOne(
          { eventId: event_id },
          { $set: { processedAt: new Date(), result: "processed" } },
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
        const existing = await db
          .collection("tenant_membership_projections")
          .findOne({ clerkMembershipId: membership.clerk_membership_id });
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
          { clerkMembershipId: membership.clerk_membership_id },
          { tenantRole: membership.tenant_role, status: membership.status },
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
      async count_other_active_memberships(user_profile_id, clerk_membership_id) {
        return db.collection("tenant_membership_projections").countDocuments({
          userProfileId: user_profile_id,
          clerkMembershipId: { $ne: clerk_membership_id },
          status: "active",
        });
      },
      async suspend_profile_authorization(user_profile_id) {
        const { ObjectId } = await import("mongodb");
        if (!ObjectId.isValid(user_profile_id)) return;
        await db.collection("user_profiles").updateOne(
          { _id: new ObjectId(user_profile_id) },
          { $set: { status: "suspended", updatedAt: new Date() } },
        );
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
 * events acknowledge 200 without reapplying (svix retries are expected).
 *
 * @param request - Incoming webhook request.
 * @returns 200 on success/duplicate, 400 on invalid signature.
 */
export async function POST(request: Request): Promise<Response> {
  const client = await client_promise;
  return handle_clerk_webhook(request, production_deps(client.db()));
}
