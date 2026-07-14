import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Clerk webhook synchronization (G1.5).
 *
 * Verifies the svix signature before parsing business fields, claims an
 * idempotency receipt per event ID, and applies projection updates with
 * monotonic occurredAt checks so an older event can never overwrite newer
 * state. Deletions mark records revoked/deleted — business identity is never
 * hard-deleted.
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
  };
  readonly projections: {
    upsert_user_profile(
      clerk_user: { id: string; primary_email: string; display_name: string },
      occurred_at: Date,
    ): Promise<ApplyOutcome>;
    mark_user_deleted(clerk_user_id: string, occurred_at: Date): Promise<ApplyOutcome>;
    find_tenant_id_by_clerk_org(clerk_org_id: string): Promise<string | null>;
    find_profile_id_by_clerk_user(clerk_user_id: string): Promise<string | null>;
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
    count_other_active_memberships(
      user_profile_id: string,
      clerk_membership_id: string,
    ): Promise<number>;
    suspend_profile_authorization(user_profile_id: string): Promise<void>;
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
        const others = await deps.projections.count_other_active_memberships(
          user_profile_id,
          String(data.id),
        );
        if (others > 0) {
          // First release permits one active university membership. Preserve
          // both projections for repair and suspend authorization instead of
          // choosing one.
          await deps.projections.suspend_profile_authorization(user_profile_id);
          await deps.audit.record({
            action: "membership_reconciliation_required",
            userProfileId: user_profile_id,
            clerkMembershipId: String(data.id),
            occurred_at,
          });
        }
      }
      return;
    }
    case "organizationMembership.deleted": {
      await deps.projections.revoke_membership(String(data.id), occurred_at);
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
 * apply, complete. A duplicate event returns 200 without reapplying.
 *
 * @param request - Incoming webhook request.
 * @param deps - Receipt/projection/audit ports.
 * @returns 200 on success or duplicate; 400 on verification failure.
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
  await apply_clerk_event(payload, deps);
  await deps.receipts.complete(event_id);
  return new Response(null, { status: 200 });
}
