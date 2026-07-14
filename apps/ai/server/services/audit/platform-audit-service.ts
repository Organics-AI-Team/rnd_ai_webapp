import type { Db, Document } from "mongodb";

/**
 * Append-only platform audit trail. Events record who performed a platform
 * operation and when; they never contain secrets or tenant business data.
 */
export interface PlatformAuditService {
  record(event: Document & { action: string; occurred_at: Date }): Promise<void>;
}

/**
 * Create the platform audit service over the platform_audit_events
 * collection.
 *
 * @param db - Connected MongoDB database.
 * @returns Append-only audit service.
 */
export function create_platform_audit_service(db: Db): PlatformAuditService {
  const events = db.collection("platform_audit_events");
  return {
    async record(event) {
      await events.insertOne({ ...event });
    },
  };
}
