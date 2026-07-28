import { ObjectId, type Db } from "mongodb";

import { create_platform_audit_service } from "../audit/platform-audit-service";
import { ClerkStateUnprovableError } from "./provision-university";
import type {
  CreateUniversityInput,
  ManagerInvitation,
  ProvisioningPorts,
  TenantProvisioningRecord,
} from "./provisioning-types";

/**
 * Narrow structural view of the @clerk/backend client used by provisioning.
 * Typed structurally so tests and version upgrades never depend on the full
 * SDK surface.
 */
export interface ClerkBackendLike {
  organizations: {
    createOrganization(params: {
      name: string;
      slug: string;
      privateMetadata: Record<string, string>;
    }): Promise<{ id: string }>;
    getOrganization(params: { slug: string }): Promise<{ id: string }>;
    createOrganizationInvitation(params: {
      organizationId: string;
      emailAddress: string;
      role: string;
      redirectUrl?: string;
    }): Promise<{ id: string; emailAddress: string; role: string }>;
    getOrganizationInvitationList(params: {
      organizationId: string;
      status?: string[];
    }): Promise<{ data: Array<{ id: string; emailAddress: string; role: string; status: string }> }>;
    getOrganizationMembershipList(params: {
      organizationId: string;
    }): Promise<{
      data: Array<{
        role: string;
        publicUserData?: { identifier?: string | null } | null;
      }>;
    }>;
  };
}

/**
 * Resolve the initial-manager Clerk role from the configured role mode:
 * custom plans use org:manager, built-in plans use org:admin. The internal
 * permission model is identical either way.
 *
 * @returns Clerk role string for the initial manager invitation.
 */
export function manager_clerk_role(): "org:manager" | "org:admin" {
  return process.env.CLERK_ORG_ROLE_MODE === "built_in" ? "org:admin" : "org:manager";
}

/**
 * Clerk role string for a plain university user under the configured role
 * mode (org:user custom, org:member built-in). Counterpart of
 * manager_clerk_role — new code must never hardcode org:* literals.
 *
 * @returns Clerk role string for tenant users.
 */
export function user_clerk_role(): "org:user" | "org:member" {
  return process.env.CLERK_ORG_ROLE_MODE === "built_in" ? "org:member" : "org:user";
}

/**
 * Map a tenants collection document onto the provisioning record view.
 *
 * @param document - Raw tenant document.
 * @returns Provisioning record view.
 */
function to_provisioning_record(document: any): TenantProvisioningRecord {
  return {
    id: document._id.toString(),
    slug: document.slug,
    name: document.name,
    status: document.status,
    provisioning_key: document.provisioningKey,
    clerk_organization_id: document.clerkOrganizationId ?? null,
    created_by_profile_id: String(document.createdByProfileId),
  };
}

/**
 * Build the production provisioning ports over MongoDB and Clerk.
 *
 * @param db - Connected MongoDB database.
 * @param clerk - Clerk backend client (narrow structural view).
 * @returns Ports consumed by provision_university.
 */
export function create_production_provisioning_ports(
  db: Db,
  clerk: ClerkBackendLike,
): ProvisioningPorts {
  const tenants = db.collection("tenants");
  const invitations = db.collection("tenant_invitation_projections");
  const audit = create_platform_audit_service(db);

  return {
    tenants: {
      async begin_or_load(input: CreateUniversityInput, created_by_profile_id) {
        const existing = await tenants.findOne({
          provisioningKey: input.idempotency_key,
        });
        if (existing) return to_provisioning_record(existing);
        const now = new Date();
        const result = await tenants.insertOne({
          clerkOrganizationId: null,
          legacyOrganizationId: null,
          slug: input.slug,
          name: input.name,
          type: "university",
          status: "provisioning",
          planKey: input.plan_key,
          dataResidencyRegion: input.region,
          provisioningKey: input.idempotency_key,
          createdByProfileId: created_by_profile_id,
          activatedAt: null,
          suspendedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        const created = await tenants.findOne({ _id: result.insertedId });
        return to_provisioning_record(created);
      },

      async attach_clerk_organization(tenant_id, clerk_organization_id) {
        await tenants.updateOne(
          { _id: new ObjectId(tenant_id), clerkOrganizationId: null },
          { $set: { clerkOrganizationId: clerk_organization_id, updatedAt: new Date() } },
        );
      },

      async activate(tenant_id) {
        const now = new Date();
        await tenants.updateOne(
          { _id: new ObjectId(tenant_id) },
          { $set: { status: "active", activatedAt: now, updatedAt: now } },
        );
        const record = await tenants.findOne({ _id: new ObjectId(tenant_id) });
        return {
          tenant_id,
          status: "active" as const,
          clerk_organization_id: String(record?.clerkOrganizationId),
        };
      },

      async mark_repair_required(tenant_id, correlation_id) {
        await tenants.updateOne(
          { _id: new ObjectId(tenant_id) },
          {
            $set: {
              status: "repair_required",
              repairCorrelationId: correlation_id,
              updatedAt: new Date(),
            },
          },
        );
      },
    },

    clerk: {
      async ensure_organization(tenant) {
        if (tenant.clerk_organization_id) {
          return { id: tenant.clerk_organization_id };
        }
        try {
          const existing = await clerk.organizations
            .getOrganization({ slug: tenant.slug })
            .catch(() => null);
          if (existing) return { id: existing.id };
          const created = await clerk.organizations.createOrganization({
            name: tenant.name,
            slug: tenant.slug,
            privateMetadata: { internal_tenant_id: tenant.id },
          });
          return { id: created.id };
        } catch (error) {
          // Creation failed after the lookup found nothing; whether Clerk
          // persisted the organization is unprovable from here.
          throw new ClerkStateUnprovableError(
            error instanceof Error ? error.message : "clerk organization state unknown",
          );
        }
      },

      async ensure_manager_invitation(clerk_organization_id, input) {
        // If the manager is already an active member of the organization,
        // there is nothing to invite (fresh internal DB against an existing
        // Clerk org, or a re-run after the invitation was accepted). Clerk
        // rejects inviting an existing member with a 400; treat it as
        // satisfied and let membership reconciliation project the record.
        const members = await clerk.organizations.getOrganizationMembershipList({
          organizationId: clerk_organization_id,
        });
        const alreadyMember = members.data.some(
          (member) =>
            member.publicUserData?.identifier?.toLowerCase() ===
            input.initial_manager_email,
        );
        if (alreadyMember) {
          return {
            id: `existing-member:${input.initial_manager_email}`,
            email: input.initial_manager_email,
            role: manager_clerk_role(),
          } satisfies ManagerInvitation;
        }
        const pending = await clerk.organizations.getOrganizationInvitationList({
          organizationId: clerk_organization_id,
          status: ["pending"],
        });
        const existing = pending.data.find(
          (invitation) =>
            invitation.emailAddress.toLowerCase() === input.initial_manager_email,
        );
        if (existing) {
          return {
            id: existing.id,
            email: existing.emailAddress.toLowerCase(),
            role: existing.role,
          } satisfies ManagerInvitation;
        }
        const created = await clerk.organizations.createOrganizationInvitation({
          organizationId: clerk_organization_id,
          emailAddress: input.initial_manager_email,
          role: manager_clerk_role(),
          redirectUrl: process.env.NEXT_PUBLIC_APP_URL
            ? `${process.env.NEXT_PUBLIC_APP_URL}/onboarding`
            : undefined,
        });
        return {
          id: created.id,
          email: created.emailAddress.toLowerCase(),
          role: created.role,
        } satisfies ManagerInvitation;
      },
    },

    invitations: {
      async upsert(tenant_id, invitation, invited_by_profile_id) {
        // No invitation projection for an already-active member: the
        // membership itself is the source of truth (projected by webhook or
        // reconcile), so an "invited" row would be a false pending state.
        if (invitation.id.startsWith("existing-member:")) {
          return;
        }
        const now = new Date();
        await invitations.updateOne(
          { clerkInvitationId: invitation.id },
          {
            $setOnInsert: {
              clerkInvitationId: invitation.id,
              tenantId: tenant_id,
              emailNormalized: invitation.email,
              tenantRole: "manager",
              status: "invited",
              invitedByProfileId: invited_by_profile_id,
              expiresAt: null,
              clerkSyncedAt: null,
              createdAt: now,
            },
            $set: { updatedAt: now },
          },
          { upsert: true },
        );
      },
    },

    audit: {
      async record(event) {
        await audit.record({
          action: event.action,
          tenantId: event.tenant_id,
          actorProfileId: event.actor_profile_id,
          occurred_at: event.occurred_at,
        });
      },
    },
  };
}
