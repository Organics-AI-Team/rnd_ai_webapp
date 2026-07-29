// apps/ai/server/services/provisioning/apply-clerk-event.ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Clerk webhook synchronization (G1.5, multi-org semantics from Plan 3).
 *
 * Verifies the svix signature before parsing business fields, claims an
 * idempotency receipt per event ID, and applies projection updates with
 * monotonic occurredAt checks so an older event can never overwrite newer
 * state. Deletions mark records revoked/deleted — business identity is never
 * hard-deleted. A failed apply marks the receipt failed and answers 5xx so
 * the svix retry reapplies (receipts complete only after a successful apply).
 */

/** Result of applying one projection change. */
export type ApplyOutcome = "applied" | "stale";

/** Normalized membership change consumed by the projection port. */
export interface MembershipChange {
  readonly clerk_membership_id: string;
  readonly tenant_id: string;
  readonly user_profile_id: string;
  readonly tenant_role: "manager" | "user";
  readonly status: "active";
}

/** Ports the webhook handler depends on; fakes in tests, MongoDB in production. */
export interface ClerkWebhookDependencies {
  readonly receipts: {
    claim(event_id: string, event_type: string): Promise<{ already_processed: boolean }>;
    complete(event_id: string): Promise<void>;
    /** Mark a claimed receipt failed so a redelivery of the same event id reclaims it. */
    fail(event_id: string): Promise<void>;
  };
  readonly projections: {
    upsert_user_profile(
      clerk_user: { id: string; primary_email: string; display_name: string },
      occurred_at: Date,
    ): Promise<ApplyOutcome>;
    mark_user_deleted(clerk_user_id: string, occurred_at: Date): Promise<ApplyOutcome>;
    find_tenant_id_by_clerk_org(clerk_org_id: string): Promise<string | null>;
    find_profile_id_by_clerk_user(clerk_user_id: string): Promise<string | null>;
    /**
     * Upsert keyed by (tenant_id, user_profile_id) — NOT clerk_membership_id.
     * Remove→re-invite mints a NEW Clerk membership id for the same pair and
     * the projection carries a unique (tenantId, userProfileId) index, so
     * the implementation must revive the existing row: set the new
     * clerkMembershipId, role, and status under the monotonic clock guard.
     */
    upsert_membership(
      membership: MembershipChange,
      occurred_at: Date,
    ): Promise<ApplyOutcome>;
    revoke_membership(
      clerk_membership_id: string,
      occurred_at: Date,
    ): Promise<ApplyOutcome>;
    update_invitation_status(
      clerk_invitation_id: string,
      status: "active" | "revoked",
      occurred_at: Date,
    ): Promise<ApplyOutcome>;
    /** Active memberships across ALL tenants for one profile (multi-org audit). */
    count_active_memberships(user_profile_id: string): Promise<number>;
    /** Tenant of a projected membership, by Clerk membership id (deleted events carry only the id). */
    find_membership_tenant_id(clerk_membership_id: string): Promise<string | null>;
    /** Active managers within one tenant (zero-manager detector). */
    count_active_managers(tenant_id: string): Promise<number>;
  };
  readonly audit: {
    record(event: Record<string, unknown> & { action: string }): Promise<void>;
  };
}

const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verify a Clerk (svix v1) webhook signature and return the parsed event.
 * The signed content is `${svix-id}.${svix-timestamp}.${body}` HMAC-SHA256
 * keyed with the base64 secret after the whsec_ prefix.
 *
 * @param request - Incoming webhook request.
 * @param signing_secret - CLERK_WEBHOOK_SIGNING_SECRET value.
 * @returns Parsed event payload plus the svix message ID.
 * @throws Error when headers, timestamp tolerance, or signature fail.
 */
export async function verify_clerk_webhook_request(
  request: Request,
  signing_secret: string,
): Promise<{ event_id: string; payload: any }> {
  const svix_id = request.headers.get("svix-id");
  const svix_timestamp = request.headers.get("svix-timestamp");
  const svix_signature = request.headers.get("svix-signature");
  if (!svix_id || !svix_timestamp || !svix_signature) {
    throw new Error("missing svix headers");
  }

  const timestamp_seconds = Number(svix_timestamp);
  const now_seconds = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(timestamp_seconds) ||
    Math.abs(now_seconds - timestamp_seconds) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw new Error("webhook timestamp outside tolerance");
  }

  const body = await request.text();
  const secret_bytes = Buffer.from(
    signing_secret.replace(/^whsec_/, ""),
    "base64",
  );
  const expected = createHmac("sha256", secret_bytes)
    .update(`${svix_id}.${svix_timestamp}.${body}`)
    .digest();

  const provided_signatures = svix_signature
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .filter(Boolean);
  const valid = provided_signatures.some((candidate) => {
    const candidate_bytes = Buffer.from(candidate, "base64");
    return (
      candidate_bytes.length === expected.length &&
      timingSafeEqual(candidate_bytes, expected)
    );
  });
  if (!valid) {
    throw new Error("invalid webhook signature");
  }

  return { event_id: svix_id, payload: JSON.parse(body) };
}

/**
 * Extract the event occurrence time with a fallback to now.
 *
 * @param data - Clerk event data object.
 * @returns Occurrence timestamp.
 */
function occurred_at_of(data: any): Date {
  const millis = data?.updated_at ?? data?.created_at;
  return typeof millis === "number" ? new Date(millis) : new Date();
}

/**
 * Map a Clerk organization role string to the internal tenant role.
 *
 * @param role - Clerk role string.
 * @returns Internal tenant role (defaults to user for unknown labels).
 */
function role_of(role: unknown): "manager" | "user" {
  return role === "org:manager" || role === "org:admin" ? "manager" : "user";
}

/**
 * Apply one verified Clerk event to the internal projections.
 *
 * @param payload - Verified Clerk event payload ({ type, data }).
 * @param deps - Projection and audit ports.
 */
export async function apply_clerk_event(
  payload: { type: string; data: any },
  deps: ClerkWebhookDependencies,
): Promise<void> {
  const { type, data } = payload;
  const occurred_at = occurred_at_of(data);

  switch (type) {
    case "user.created":
    case "user.updated": {
      await deps.projections.upsert_user_profile(
        {
          id: String(data.id),
          primary_email: String(
            data.email_addresses?.[0]?.email_address ?? "",
          ).toLowerCase(),
          display_name: [data.first_name, data.last_name]
            .filter(Boolean)
            .join(" "),
        },
        occurred_at,
      );
      return;
    }
    case "user.deleted": {
      await deps.projections.mark_user_deleted(String(data.id), occurred_at);
      return;
    }
    case "organizationInvitation.accepted": {
      await deps.projections.update_invitation_status(
        String(data.id),
        "active",
        occurred_at,
      );
      return;
    }
    case "organizationInvitation.revoked": {
      await deps.projections.update_invitation_status(
        String(data.id),
        "revoked",
        occurred_at,
      );
      return;
    }
    case "organizationMembership.created":
    case "organizationMembership.updated": {
      const clerk_org_id = String(data.organization?.id ?? "");
      const clerk_user_id = String(data.public_user_data?.user_id ?? "");
      const tenant_id =
        await deps.projections.find_tenant_id_by_clerk_org(clerk_org_id);
      const user_profile_id =
        await deps.projections.find_profile_id_by_clerk_user(clerk_user_id);
      if (!tenant_id || !user_profile_id) {
        await deps.audit.record({
          action: "membership_projection_deferred",
          clerkMembershipId: String(data.id),
          clerkOrganizationId: clerk_org_id,
          clerkUserId: clerk_user_id,
          occurred_at,
        });
        return;
      }
      const outcome = await deps.projections.upsert_membership(
        {
          clerk_membership_id: String(data.id),
          tenant_id,
          user_profile_id,
          tenant_role: role_of(data.role),
          status: "active",
        },
        occurred_at,
      );
      if (outcome === "applied") {
        const active_memberships =
          await deps.projections.count_active_memberships(user_profile_id);
        if (active_memberships > 1) {
          // Multi-org membership is permitted (Plan 3). Record an
          // informational audit; user_profiles.status is NEVER mutated here.
          await deps.audit.record({
            action: "membership_multi_org",
            userProfileId: user_profile_id,
            clerkMembershipId: String(data.id),
            activeMembershipCount: active_memberships,
            occurred_at,
          });
        }
        // Zero-manager detector: a dashboard-side demotion cannot be
        // blocked — detect and alert for platform repair instead.
        if (
          role_of(data.role) === "user" &&
          (await deps.projections.count_active_managers(tenant_id)) === 0
        ) {
          await deps.audit.record({
            action: "tenant_zero_managers",
            tenantId: tenant_id,
            trigger: "membership_role_change",
            clerkMembershipId: String(data.id),
            occurred_at,
          });
        }
      }
      return;
    }
    case "organizationMembership.deleted": {
      // Resolve the tenant BEFORE revoking (the payload carries only the
      // Clerk membership id, and the row still exists at this point).
      const tenant_id = await deps.projections.find_membership_tenant_id(
        String(data.id),
      );
      const outcome = await deps.projections.revoke_membership(
        String(data.id),
        occurred_at,
      );
      if (outcome === "applied" && tenant_id) {
        const managers = await deps.projections.count_active_managers(tenant_id);
        if (managers === 0) {
          // Clerk-originated removals cannot be blocked; detect and alert
          // for platform repair instead of silently absorbing (spec §4.3).
          await deps.audit.record({
            action: "tenant_zero_managers",
            tenantId: tenant_id,
            trigger: "membership_deleted",
            clerkMembershipId: String(data.id),
            occurred_at,
          });
        }
      }
      return;
    }
    default: {
      await deps.audit.record({
        action: "clerk_event_ignored",
        eventType: type,
        occurred_at,
      });
    }
  }
}

/**
 * Framework-neutral webhook entry: verify, claim the idempotency receipt,
 * apply, complete. A duplicate event returns 200 without reapplying; a
 * FAILED apply releases the claim (receipt marked failed) and answers 5xx so
 * svix retries reapply the event instead of losing it forever.
 *
 * @param request - Incoming webhook request.
 * @param deps - Receipt/projection/audit ports.
 * @returns 200 on success or duplicate; 400 on verification failure; 500 on
 *          a failed apply (retryable).
 */
export async function handle_clerk_webhook(
  request: Request,
  deps: ClerkWebhookDependencies,
): Promise<Response> {
  const signing_secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim();
  if (!signing_secret) {
    return new Response("webhook signing secret is not configured", {
      status: 503,
    });
  }

  let event_id: string;
  let payload: any;
  try {
    ({ event_id, payload } = await verify_clerk_webhook_request(
      request,
      signing_secret,
    ));
  } catch {
    return new Response("invalid webhook", { status: 400 });
  }

  const receipt = await deps.receipts.claim(event_id, String(payload?.type ?? ""));
  if (receipt.already_processed) {
    return new Response(null, { status: 200 });
  }
  try {
    await apply_clerk_event(payload, deps);
  } catch (error) {
    console.error({
      boundary: "clerk-webhook",
      event: "apply.failed",
      event_id,
      event_type: String(payload?.type ?? ""),
      error: error instanceof Error ? error.message : String(error),
    });
    await deps.receipts.fail(event_id);
    return new Response("event apply failed", { status: 500 });
  }
  await deps.receipts.complete(event_id);
  return new Response(null, { status: 200 });
}
