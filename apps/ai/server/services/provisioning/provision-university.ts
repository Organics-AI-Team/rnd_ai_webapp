import { randomUUID } from "node:crypto";
import type { RequestPrincipal } from "@rnd-ai/shared-types";

import { require_permission } from "../../auth/authorize";
import {
  create_university_input_schema,
  type CreateUniversityInput,
  type ProvisioningPorts,
  type ProvisionUniversityResult,
} from "./provisioning-types";

/**
 * Raised by a Clerk port when it cannot prove whether an external object
 * exists (for example an ambiguous network failure during creation). The
 * state machine then parks the tenant in repair_required instead of risking
 * a duplicate organization.
 */
export class ClerkStateUnprovableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClerkStateUnprovableError";
  }
}

/**
 * Raised when a slug is already taken by another tenant.
 */
export class DuplicateSlugError extends Error {
  constructor(slug: string) {
    super(`The slug is already in use: ${slug}`);
    this.name = "DuplicateSlugError";
  }
}

/**
 * Provision one university idempotently: one Clerk organization, one Tenant,
 * and one manager invitation per idempotency key.
 *
 * State machine (each step checks stored state before calling Clerk again):
 * 1. begin_or_load Tenant(provisioning) keyed by the idempotency key.
 * 2. ensure the Clerk organization (create-or-get; never a second one).
 * 3. persist clerkOrganizationId.
 * 4. ensure the initial manager invitation (create-or-get by email).
 * 5. persist the TenantInvitationProjection.
 * 6. activate the tenant and append a platform audit event.
 *
 * A TenantMembershipProjection is created only later, when Clerk reports an
 * accepted organization membership (G1.5 webhooks).
 *
 * @param actor - Verified platform principal (requires platform:tenants:create).
 * @param raw_input - Unvalidated creation input.
 * @param ports - Injected provisioning ports.
 * @returns Activation result with the Clerk organization ID.
 * @throws AuthorizationError, DuplicateSlugError, or a repair-required error
 *         carrying a correlation ID when external state is unprovable.
 */
export async function provision_university(
  actor: RequestPrincipal,
  raw_input: CreateUniversityInput,
  ports: ProvisioningPorts,
): Promise<ProvisionUniversityResult> {
  require_permission(actor, "platform:tenants:create");
  const input = create_university_input_schema.parse(raw_input);

  let tenant;
  try {
    tenant = await ports.tenants.begin_or_load(input, actor.internal_user_id);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new DuplicateSlugError(input.slug);
    }
    throw error;
  }

  try {
    const organization = await ports.clerk.ensure_organization(tenant);
    await ports.tenants.attach_clerk_organization(tenant.id, organization.id);
    const invitation = await ports.clerk.ensure_manager_invitation(
      organization.id,
      input,
    );
    await ports.invitations.upsert(tenant.id, invitation, actor.internal_user_id);
  } catch (error) {
    if (error instanceof ClerkStateUnprovableError) {
      const correlation_id = randomUUID();
      await ports.tenants.mark_repair_required(tenant.id, correlation_id);
      throw new Error(
        `Provisioning requires repair; external state is unprovable. Correlation: ${correlation_id}`,
      );
    }
    throw error;
  }

  const result = await ports.tenants.activate(tenant.id);
  await ports.audit.record({
    action: "provision_university",
    tenant_id: tenant.id,
    actor_profile_id: actor.internal_user_id,
    occurred_at: new Date(),
  });
  return result;
}
