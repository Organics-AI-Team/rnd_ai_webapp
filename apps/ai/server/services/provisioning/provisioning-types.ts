import { z } from "zod";

/**
 * Regions where tenant data may reside. Expansion requires a deliberate
 * platform decision, so the allowlist is code-reviewed configuration.
 */
export const ALLOWED_DATA_RESIDENCY_REGIONS = ["sgp", "bkk"] as const;

/**
 * Validated platform input for creating a university. The slug is normalized
 * to lower case; the idempotency key is a client-generated UUID that makes
 * provisioning replay-safe end to end.
 */
export const create_university_input_schema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, "invalid slug"),
    region: z.enum(ALLOWED_DATA_RESIDENCY_REGIONS, {
      errorMap: () => ({ message: "region is not allowlisted" }),
    }),
    plan_key: z.string().trim().min(1).max(64),
    initial_manager_email: z.string().trim().toLowerCase().email(),
    idempotency_key: z.string().uuid(),
  })
  .strict();

export type CreateUniversityInput = z.infer<typeof create_university_input_schema>;

/**
 * Tenant record view used by the provisioning state machine.
 */
export interface TenantProvisioningRecord {
  readonly id: string;
  slug: string;
  name: string;
  status: "provisioning" | "active" | "suspended" | "repair_required" | "deleted";
  provisioning_key: string;
  clerk_organization_id: string | null;
  created_by_profile_id: string;
}

/** Result of a completed provisioning run. */
export interface ProvisionUniversityResult {
  readonly tenant_id: string;
  readonly status: "active";
  readonly clerk_organization_id: string;
}

/** Clerk invitation view returned by the Clerk port. */
export interface ManagerInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: string;
}

/**
 * Injected ports for the provisioning state machine. Production adapters
 * wrap MongoDB and @clerk/backend; tests inject in-memory fakes. Every port
 * method checks stored state before creating anything externally.
 */
export interface ProvisioningPorts {
  readonly tenants: {
    begin_or_load(
      input: CreateUniversityInput,
      created_by_profile_id: string,
    ): Promise<TenantProvisioningRecord>;
    attach_clerk_organization(
      tenant_id: string,
      clerk_organization_id: string,
    ): Promise<void>;
    activate(tenant_id: string): Promise<ProvisionUniversityResult>;
    mark_repair_required(tenant_id: string, correlation_id: string): Promise<void>;
  };
  readonly clerk: {
    ensure_organization(
      tenant: TenantProvisioningRecord,
    ): Promise<{ id: string }>;
    ensure_manager_invitation(
      clerk_organization_id: string,
      input: CreateUniversityInput,
    ): Promise<ManagerInvitation>;
  };
  readonly invitations: {
    upsert(
      tenant_id: string,
      invitation: ManagerInvitation,
      invited_by_profile_id: string,
    ): Promise<void>;
  };
  readonly audit: {
    record(event: {
      action: string;
      tenant_id: string;
      actor_profile_id: string;
      occurred_at: Date;
    }): Promise<void>;
  };
}
