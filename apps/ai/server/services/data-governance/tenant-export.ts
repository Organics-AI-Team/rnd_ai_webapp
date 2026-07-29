/** Point-in-time encrypted tenant export with tenant-scoped idempotent receipts. */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  lifecycle_step_receipt_schema,
  stable_lifecycle_json,
  sum_lifecycle_totals,
  type LifecycleReceiptStore,
  type LifecycleReport,
  type LifecycleStepReceipt,
} from "./lifecycle-types";

export const tenant_export_job_schema = z
  .object({
    job_id: z.string().min(1).max(128),
    tenant_id: z.string().min(1).max(128),
    requested_by_profile_id: z.string().min(1).max(128),
    requested_at_iso: z.string().datetime({ offset: true }),
    expires_at_iso: z.string().datetime({ offset: true }),
  })
  .strict();

export type TenantExportJob = z.infer<typeof tenant_export_job_schema>;

const export_collection_schema = z
  .object({
    collection: z.string().min(1).max(128),
    records: z.array(z.unknown()),
  })
  .strict();

const export_manifest_entry_schema = z
  .object({
    collection: z.string().min(1).max(128),
    count: z.number().int().min(0),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const tenant_export_report_schema = z
  .object({
    schema_version: z.literal("1"),
    operation: z.literal("export"),
    tenant_id: z.string().min(1),
    job_id: z.string().min(1),
    verified: z.boolean(),
    completed_at_iso: z.string().datetime({ offset: true }),
    steps: z.array(lifecycle_step_receipt_schema),
    totals: z.object({
      scanned: z.number().int().min(0),
      deleted: z.number().int().min(0),
      skipped: z.number().int().min(0),
      errors: z.number().int().min(0),
    }).strict(),
    point_in_time_iso: z.string().datetime({ offset: true }),
    manifest: z.object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      collections: z.array(export_manifest_entry_schema),
    }).strict(),
    artifact: z.object({
      object_key: z.string().min(1),
      expires_at_iso: z.string().datetime({ offset: true }),
      size_bytes: z.number().int().min(1),
      algorithm: z.string().min(1),
      key_reference: z.string().min(1),
    }).strict(),
  })
  .strict();

export type TenantExportReport = z.infer<typeof tenant_export_report_schema>;

export interface TenantExportPorts {
  readonly receipts: LifecycleReceiptStore;
  readonly business_data: {
    snapshot_tenant(input: {
      tenant_id: string;
      point_in_time_iso: string;
      job_id: string;
    }): Promise<unknown>;
  };
  readonly knowledge: {
    snapshot_tenant(input: {
      tenant_id: string;
      point_in_time_iso: string;
      job_id: string;
    }): Promise<unknown>;
  };
  readonly encryption: {
    encrypt(input: {
      tenant_id: string;
      job_id: string;
      plaintext_utf8: string;
    }): Promise<{
      ciphertext: Uint8Array;
      algorithm: string;
      key_reference: string;
    }>;
  };
  readonly artifacts: {
    put_once(input: {
      tenant_id: string;
      job_id: string;
      object_key: string;
      ciphertext: Uint8Array;
      expires_at_iso: string;
    }): Promise<{ object_key: string; expires_at_iso: string; size_bytes: number }>;
  };
  readonly audit: {
    record_export(event: {
      tenant_id: string;
      actor_profile_id: string;
      job_id: string;
      manifest_sha256: string;
      object_key: string;
    }): Promise<void>;
  };
  readonly now_iso: () => string;
}

/** Build one report-only phase receipt without persisting intermediate export data. */
function export_step(
  job: TenantExportJob,
  step: string,
  completed_at_iso: string,
  scanned: number,
): LifecycleStepReceipt {
  return lifecycle_step_receipt_schema.parse({
    schema_version: "1",
    operation: "export",
    tenant_id: job.tenant_id,
    job_id: job.job_id,
    step,
    completed_at_iso,
    scanned,
    deleted: 0,
    skipped: 0,
    errors: 0,
    metadata: {},
  });
}

/** Reject a snapshot that explicitly carries another tenant's identifier. */
function assert_no_foreign_tenant(value: unknown, tenant_id: string): void {
  if (Array.isArray(value)) {
    for (const nested of value) assert_no_foreign_tenant(nested, tenant_id);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if ((key === "tenant_id" || key === "tenantId") && String(nested) !== tenant_id) {
      throw new Error("tenant export snapshot contains a foreign tenant record");
    }
    assert_no_foreign_tenant(nested, tenant_id);
  }
}

/**
 * Create a tenant-export service over credential-free injected ports.
 *
 * @param ports - Snapshot, encryption, artifact, receipt, audit, and clock ports.
 * @returns Service exposing idempotent export_tenant_data.
 */
export function create_tenant_export_service(ports: TenantExportPorts) {
  return {
    /**
     * Produce an encrypted point-in-time export and collection/hash manifest.
     *
     * @param input - Strict tenant-scoped export job.
     * @returns Existing or newly completed verified export receipt.
     */
    async export_tenant_data(input: TenantExportJob): Promise<TenantExportReport> {
      const job = tenant_export_job_schema.parse(input);
      const existing = await ports.receipts.get_report("export", job.tenant_id, job.job_id);
      if (existing !== null) return tenant_export_report_schema.parse(existing);
      if (Date.parse(job.expires_at_iso) <= Date.parse(job.requested_at_iso)) {
        throw new Error("tenant export expiry must follow its point-in-time timestamp");
      }
      const snapshot_input = {
        tenant_id: job.tenant_id,
        point_in_time_iso: job.requested_at_iso,
        job_id: job.job_id,
      };
      const business = z.array(export_collection_schema).parse(
        await ports.business_data.snapshot_tenant(snapshot_input),
      );
      const knowledge = z.array(export_collection_schema).parse(
        await ports.knowledge.snapshot_tenant(snapshot_input),
      );
      const collections = [...business, ...knowledge].sort((left, right) =>
        left.collection < right.collection ? -1 : left.collection > right.collection ? 1 : 0,
      );
      if (new Set(collections.map(({ collection }) => collection)).size !== collections.length) {
        throw new Error("tenant export collection names must be unique");
      }
      assert_no_foreign_tenant(collections, job.tenant_id);
      const manifest_entries = collections.map(({ collection, records }) => ({
        collection,
        count: records.length,
        sha256: createHash("sha256").update(stable_lifecycle_json(records)).digest("hex"),
      }));
      const manifest = {
        collections: manifest_entries,
        sha256: createHash("sha256").update(stable_lifecycle_json(manifest_entries)).digest("hex"),
      };
      const plaintext_utf8 = stable_lifecycle_json({
        schema_version: "1",
        tenant_id: job.tenant_id,
        job_id: job.job_id,
        point_in_time_iso: job.requested_at_iso,
        manifest,
        collections,
      });
      const encrypted = await ports.encryption.encrypt({
        tenant_id: job.tenant_id,
        job_id: job.job_id,
        plaintext_utf8,
      });
      const artifact = await ports.artifacts.put_once({
        tenant_id: job.tenant_id,
        job_id: job.job_id,
        object_key: `tenants/${job.tenant_id}/exports/${job.job_id}.json.enc`,
        ciphertext: encrypted.ciphertext,
        expires_at_iso: job.expires_at_iso,
      });
      await ports.audit.record_export({
        tenant_id: job.tenant_id,
        actor_profile_id: job.requested_by_profile_id,
        job_id: job.job_id,
        manifest_sha256: manifest.sha256,
        object_key: artifact.object_key,
      });
      const completed_at_iso = ports.now_iso();
      const steps = [
        export_step(job, "business_snapshot", completed_at_iso, business.length),
        export_step(job, "knowledge_snapshot", completed_at_iso, knowledge.length),
        export_step(job, "encrypted_artifact", completed_at_iso, 1),
        export_step(job, "audit", completed_at_iso, 1),
      ];
      const report = tenant_export_report_schema.parse({
        schema_version: "1",
        operation: "export",
        tenant_id: job.tenant_id,
        job_id: job.job_id,
        verified: true,
        completed_at_iso,
        steps,
        totals: sum_lifecycle_totals(steps),
        point_in_time_iso: job.requested_at_iso,
        manifest,
        artifact: {
          ...artifact,
          algorithm: encrypted.algorithm,
          key_reference: encrypted.key_reference,
        },
      });
      await ports.receipts.save_report(report as LifecycleReport);
      return report;
    },
  };
}
