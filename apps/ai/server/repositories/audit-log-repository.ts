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
  /** Optional replay key for an audit record emitted with a durable mutation. */
  readonly idempotency_key?: string;
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
      const idempotency_filter = input.idempotency_key
        ? { ...tenant_scope(context), idempotencyKey: input.idempotency_key }
        : null;
      if (idempotency_filter) {
        const existing = await tenant_audit_events.findOne(idempotency_filter);
        if (existing) return existing;
      }
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
        ...(input.idempotency_key ? { idempotencyKey: input.idempotency_key } : {}),
        createdAt: new Date(),
      };
      try {
        const result = await tenant_audit_events.insertOne(document);
        return { _id: result.insertedId, ...document } as WithId<Document>;
      } catch (error) {
        if (!idempotency_filter || !is_duplicate_key_error(error)) throw error;
        const existing = await tenant_audit_events.findOne(idempotency_filter);
        if (!existing) throw error;
        return existing;
      }
    },

    async list_audit_events(context) {
      return list_scoped_documents(tenant_audit_events, context);
    },
  };
}

function is_duplicate_key_error(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === 11_000;
}
