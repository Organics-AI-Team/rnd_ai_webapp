import { ObjectId, type Db, type Document, type WithId } from "mongodb";

/**
 * Input for creating a tenant record in provisioning state. Clerk linkage
 * (clerkOrganizationId) is attached later by the provisioning workflow.
 */
export interface CreateTenantInput {
  readonly slug: string;
  readonly name: string;
  readonly plan_key: string;
  readonly data_residency_region: string;
  readonly provisioning_key: string;
  readonly created_by_profile_id: string;
  readonly legacy_organization_id?: string;
}

/**
 * Repository over the tenants collection. Exposes explicit active-record
 * lookups only — no generic findOne filter reaches routers.
 */
export interface TenantRepository {
  create_tenant(input: CreateTenantInput): Promise<WithId<Document>>;
  find_active_by_clerk_organization_id(
    clerk_organization_id: string,
  ): Promise<WithId<Document> | null>;
  find_active_by_id(tenant_id: string): Promise<WithId<Document> | null>;
  find_by_provisioning_key(provisioning_key: string): Promise<WithId<Document> | null>;
}

/**
 * Create the tenant repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance.
 */
export function create_tenant_repository(db: Db): TenantRepository {
  const tenants = db.collection("tenants");
  return {
    async create_tenant(input) {
      const now = new Date();
      const document: Document = {
        clerkOrganizationId: null,
        legacyOrganizationId: input.legacy_organization_id ?? null,
        slug: input.slug,
        name: input.name,
        type: "university",
        status: "provisioning",
        planKey: input.plan_key,
        dataResidencyRegion: input.data_residency_region,
        provisioningKey: input.provisioning_key,
        createdByProfileId: input.created_by_profile_id,
        activatedAt: null,
        suspendedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const result = await tenants.insertOne(document);
      return { _id: result.insertedId, ...document } as WithId<Document>;
    },

    async find_active_by_clerk_organization_id(clerk_organization_id) {
      return tenants.findOne({
        clerkOrganizationId: clerk_organization_id,
        status: "active",
      });
    },

    async find_active_by_id(tenant_id) {
      if (!ObjectId.isValid(tenant_id)) return null;
      return tenants.findOne({ _id: new ObjectId(tenant_id), status: "active" });
    },

    async find_by_provisioning_key(provisioning_key) {
      return tenants.findOne({ provisioningKey: provisioning_key });
    },
  };
}
