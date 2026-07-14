# Tenant Ownership Map (G2.2)

Scope of every collection, its tenant-provenance source, conflict rule, owner
rule, and enforcement status. `tenantId` stays nullable until the G2.3
backfill verifies zero orphans; enforcement flips in G2.4/G2.7.

| Collection | Scope | tenantId source | Conflict rule | Owner rule | Enforcement status |
|---|---|---|---|---|---|
| products | tenant | organizationId → Tenant.legacyOrganizationId | organizationId wins; mismatched tenantId → quarantine | actorProfileId from createdBy | expansion (nullable) |
| stock_entries | tenant | organizationId mapping | same as products | actorProfileId from createdBy | expansion (nullable) |
| formulas | tenant | organizationId mapping | same | ownerProfileId = draft creator; managers confirm | expansion (nullable) |
| formula_version_logs | tenant | parent formula's tenant | parent formula wins | actorProfileId from createdBy | expansion (nullable) |
| formula_comments | tenant | parent formula's tenant | parent formula wins | actorProfileId from author userId | expansion (nullable) |
| orders | tenant | organizationId mapping | organizationId wins | actorProfileId from createdBy; client orders have none | expansion (nullable) |
| credit_transactions | tenant | organizationId mapping | organizationId wins | actorProfileId from performedBy | expansion (nullable) |
| product_logs | tenant | organizationId mapping | organizationId wins | actorProfileId from userId | expansion (nullable) |
| conversations | tenant | owner user's organization | owner's org wins | ownerProfileId from userId | expansion (nullable) |
| feedback | tenant | owner user's organization | owner's org wins | ownerProfileId from userId | expansion (nullable) |
| ai_responses | tenant | conversation's tenant | conversation wins | ownerProfileId from userId | expansion (nullable) |
| chat_threads | tenant | owner user's organization | owner's org wins | ownerProfileId from userId | expansion (nullable) |
| chat_messages | tenant | parent thread's tenant | parent thread wins | none (thread-owned) | expansion (nullable) |
| price_calculations | tenant | organizationId mapping | organizationId wins | actorProfileId from userId | expansion (nullable) |
| user_logs | platform or tenant (scope field) | organizationId when tenant event | tenant events require tenantId; platform events forbid it | actorProfileId from userId | expansion (nullable) |
| raw_materials (+_console/_fda/_stock sources) | platform-global | none | n/a | none | resolved: never tenant-scoped |
| user_profiles / tenants / *_projections / support_access_grants | commercial identity (G1/G2.1) | native | native | native | enforced by design |
| accounts / sessions / users / organizations | legacy-only (read-only after G1.7; retired in G5) | n/a | n/a | n/a | frozen |
