import type { Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  assert_no_security_fields,
  list_scoped_documents,
  tenant_scope,
} from "./tenant-repository-base";

/** Business fields for one tenant-scoped audit event. */
export interface AuditEventInput {
  readonly action: string;
  readonly resource_type?: string;
  readonly resource_id?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Tenant-scoped, append-only repository over the tenant_audit_events
 * collection. Actor, tenant, access mode, and correlation ID are stamped
 * from the TenantExecutionContext only — callers cannot supply them.
 */
export interface AuditLogRepository {
  append_audit_event(
    context: TenantExecutionContext,
    input: AuditEventInput,
  ): Promise<WithId<Document>>;
  list_audit_events(context: TenantExecutionContext): Promise<WithId<Document>[]>;
}

/**
 * Create the audit-log repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance (append + tenant-scoped list; no update or
 *   delete surface — audit events are immutable).
 */
export function create_audit_log_repository(db: Db): AuditLogRepository {
  const tenant_audit_events = db.collection("tenant_audit_events");
  return {
    async append_audit_event(context, input) {
      assert_no_security_fields({ ...input });
      const document: Document = {
        ...tenant_scope(context),
        actorProfileId: context.actor_profile_id,
        accessMode: context.access_mode,
        supportGrantId: context.support_grant_id,
        correlationId: context.correlation_id,
        action: input.action,
        resourceType: input.resource_type ?? null,
        resourceId: input.resource_id ?? null,
        metadata: input.metadata ?? null,
        createdAt: new Date(),
      };
      const result = await tenant_audit_events.insertOne(document);
      return { _id: result.insertedId, ...document } as WithId<Document>;
    },

    async list_audit_events(context) {
      return list_scoped_documents(tenant_audit_events, context);
    },
  };
}
