/**
 * Durable orchestration ApprovalService over the `ai_approvals` collection.
 *
 * The adapter is bound to one tenant because ApprovalService.count_for_run has
 * no context parameter. Every context-bearing operation re-checks that binding.
 * Reads accept both historical string identifiers and schema-native ObjectIds;
 * new records prefer ObjectIds whenever the identifier is a valid hex value.
 */

import { createHash } from "node:crypto";
import { ObjectId, type Db, type Document, type WithId } from "mongodb";
import {
  approval_resume_v1_schema,
  type ApprovalResultV1,
} from "../../../../packages/ai-orchestration/src/contracts";
import type {
  ApprovalService,
  TrustedRuntimeContext,
} from "../../../../packages/ai-orchestration/src/ports";

const DEFAULT_PENDING_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_ACTION_KEY_CHARS = 512;

/** Stable, client-safe approval adapter failure codes. */
export type ApprovalServiceErrorCode =
  | "APPROVAL_INPUT_INVALID"
  | "APPROVAL_CONTEXT_MISMATCH"
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_DECIDER_FORBIDDEN"
  | "APPROVAL_STATE_CONFLICT"
  | "APPROVAL_DECISION_CONFLICT"
  | "APPROVAL_RESUME_INVALID";

/** Approval adapter error whose message never includes untrusted identifiers. */
export class ApprovalServiceError extends Error {
  constructor(
    readonly code: ApprovalServiceErrorCode,
    safe_message: string,
  ) {
    super(safe_message);
    this.name = "ApprovalServiceError";
  }
}

/** Deterministic clock and expiry options for one tenant-bound adapter. */
export interface AIApprovalServiceOptions {
  readonly now?: () => Date;
  readonly pending_ttl_ms?: number;
}

/** Return every safe storage representation for one trusted identifier. */
function identifier_values(value: string): Array<string | ObjectId> {
  return ObjectId.isValid(value) ? [value, new ObjectId(value)] : [value];
}

/** Prefer schema-native ObjectId storage while retaining non-hex compatibility. */
function storage_identifier(value: string): string | ObjectId {
  return ObjectId.isValid(value) ? new ObjectId(value) : value;
}

/** Compare stored string/ObjectId identifiers without coercing other values. */
function identifier_equals(stored: unknown, expected: string): boolean {
  return (typeof stored === "string" || stored instanceof ObjectId) && stored.toString() === expected;
}

/** Validate a run/action identifier without exposing it in errors. */
function required_key(value: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new ApprovalServiceError("APPROVAL_INPUT_INVALID", "The approval request is invalid.");
  }
  return value;
}

/** Remove control characters, collapse whitespace, and cap the human summary. */
function safe_summary(value: string): string {
  if (typeof value !== "string") {
    throw new ApprovalServiceError("APPROVAL_INPUT_INVALID", "The approval request is invalid.");
  }
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SUMMARY_CHARS);
  if (!normalized) {
    throw new ApprovalServiceError("APPROVAL_INPUT_INVALID", "The approval request is invalid.");
  }
  return normalized;
}

/** Hash tenant/run/action as a length-safe globally unique persistence key. */
function approval_idempotency_key(
  tenant_id: string,
  run_id: string,
  action_idempotency_key: string,
): string {
  return `approval:${createHash("sha256")
    .update(JSON.stringify([tenant_id, run_id, action_idempotency_key]))
    .digest("hex")}`;
}

/** Confirm a context belongs to this adapter and the method's run. */
function require_context(
  bound_tenant_id: string,
  run_id: string,
  context: TrustedRuntimeContext,
): void {
  if (context.tenant_id !== bound_tenant_id || context.run_id !== run_id) {
    throw new ApprovalServiceError(
      "APPROVAL_CONTEXT_MISMATCH",
      "The approval context does not match the requested run.",
    );
  }
}

/** Whether an unknown Mongo failure is a unique-key collision. */
function is_duplicate_key(error: unknown): boolean {
  return Boolean(error) && (error as { code?: number }).code === 11000;
}

/** Whether a pending approval is still inside its explicit expiry window. */
function is_unexpired_pending(approval: WithId<Document>, now: Date): boolean {
  return (
    approval.status === "pending" &&
    approval.expiresAt instanceof Date &&
    approval.expiresAt.getTime() > now.getTime()
  );
}

/** Ensure an idempotency-key match is also the exact tenant/run/action scope. */
function matches_scope(
  approval: WithId<Document>,
  tenant_id: string,
  run_id: string,
  action_idempotency_key: string,
): boolean {
  return (
    identifier_equals(approval.tenantId, tenant_id) &&
    identifier_equals(approval.runId, run_id) &&
    approval.checkpointId === action_idempotency_key
  );
}

/** Convert a stored approval identifier to its public stable string. */
function public_approval_id(approval: WithId<Document>): string {
  return approval._id.toString();
}

/** Map the stored Prisma-compatible terminal state to orchestration language. */
function stored_result(approval: WithId<Document>): ApprovalResultV1 | null {
  if (approval.status === "approved") {
    return { approval_id: public_approval_id(approval), status: "approved" };
  }
  if (approval.status === "rejected" || approval.status === "denied") {
    return { approval_id: public_approval_id(approval), status: "denied" };
  }
  return null;
}

/** Verify a terminal decision exactly matches a replayed resume. */
function exact_terminal_replay(
  approval: WithId<Document>,
  decision: "approve" | "deny",
  decided_by_profile_id: string,
): ApprovalResultV1 {
  const result = stored_result(approval);
  const expected_status = decision === "approve" ? "approved" : "denied";
  if (
    result &&
    result.status === expected_status &&
    identifier_equals(approval.decidedByProfileId, decided_by_profile_id)
  ) {
    return result;
  }
  throw new ApprovalServiceError(
    "APPROVAL_DECISION_CONFLICT",
    "The approval was already decided differently.",
  );
}

/**
 * Build a durable ApprovalService for one trusted tenant.
 *
 * @param db - Connected Mongo database.
 * @param tenant_id - Internal tenant identifier bound to this runtime.
 * @param options - Deterministic clock and pending lifetime.
 * @returns Orchestration ApprovalService backed by Mongo.
 */
export function create_ai_approval_service(
  db: Db,
  tenant_id: string,
  options: AIApprovalServiceOptions = {},
): ApprovalService {
  required_key(tenant_id, 128);
  const now = options.now ?? (() => new Date());
  const pending_ttl_ms = options.pending_ttl_ms ?? DEFAULT_PENDING_TTL_MS;
  if (!Number.isSafeInteger(pending_ttl_ms) || pending_ttl_ms <= 0) {
    throw new ApprovalServiceError("APPROVAL_INPUT_INVALID", "The approval configuration is invalid.");
  }

  const approvals = db.collection("ai_approvals");
  const memberships = db.collection("tenant_membership_projections");

  /** Resolve an existing idempotent ensure, rejecting inactive state. */
  async function existing_pending(
    approval: WithId<Document>,
    run_id: string,
    action_idempotency_key: string,
    at: Date,
  ): Promise<{ approval_id: string }> {
    if (!matches_scope(approval, tenant_id, run_id, action_idempotency_key)) {
      throw new ApprovalServiceError(
        "APPROVAL_STATE_CONFLICT",
        "The approval request conflicts with existing state.",
      );
    }
    if (is_unexpired_pending(approval, at)) {
      return { approval_id: public_approval_id(approval) };
    }
    if (approval.status === "pending") {
      await approvals.updateOne(
        { _id: approval._id, status: "pending", expiresAt: { $lte: at } },
        { $set: { status: "expired", updatedAt: at } },
      );
      throw new ApprovalServiceError("APPROVAL_EXPIRED", "The approval request has expired.");
    }
    throw new ApprovalServiceError(
      "APPROVAL_STATE_CONFLICT",
      "The approval request is no longer pending.",
    );
  }

  /** Load the exact approval scope for resume classification. */
  async function load_exact_approval(
    approval_id: string,
    run_id: string,
    action_idempotency_key: string,
  ): Promise<WithId<Document> | null> {
    return approvals.findOne({
      // Mongo's default Document generic assumes ObjectId `_id`; production
      // data also contains historical string IDs, so this one heterogeneous
      // condition is deliberately widened while all values stay scalar-safe.
      _id: { $in: identifier_values(approval_id) } as never,
      tenantId: { $in: identifier_values(tenant_id) },
      runId: { $in: identifier_values(run_id) },
      checkpointId: action_idempotency_key,
      idempotencyKey: approval_idempotency_key(tenant_id, run_id, action_idempotency_key),
    });
  }

  /** Require a currently active manager membership for the resume decider. */
  async function require_manager(decided_by_profile_id: string): Promise<void> {
    const membership = await memberships.findOne({
      tenantId: { $in: identifier_values(tenant_id) },
      userProfileId: { $in: identifier_values(decided_by_profile_id) },
      tenantRole: "manager",
      status: "active",
    });
    if (!membership) {
      throw new ApprovalServiceError(
        "APPROVAL_DECIDER_FORBIDDEN",
        "An active tenant manager must decide this approval.",
      );
    }
  }

  return {
    async ensure_pending(run_id, action_idempotency_key_value, summary, context) {
      required_key(run_id, 128);
      const action_idempotency_key = required_key(
        action_idempotency_key_value,
        MAX_ACTION_KEY_CHARS,
      );
      require_context(tenant_id, run_id, context);
      const normalized_summary = safe_summary(summary);
      const at = now();
      const idempotency_key = approval_idempotency_key(
        tenant_id,
        run_id,
        action_idempotency_key,
      );
      const current = await approvals.findOne({ idempotencyKey: idempotency_key });
      if (current) return existing_pending(current, run_id, action_idempotency_key, at);

      const document = {
        tenantId: storage_identifier(tenant_id),
        runId: storage_identifier(run_id),
        artifactId: null,
        checkpointId: action_idempotency_key,
        requestedByProfileId: storage_identifier(context.actor_profile_id),
        requiredPermission: "formula:confirm",
        summary: normalized_summary,
        status: "pending",
        decidedByProfileId: null,
        decisionEdits: null,
        decisionReason: null,
        requestedAt: at,
        expiresAt: new Date(at.getTime() + pending_ttl_ms),
        decidedAt: null,
        idempotencyKey: idempotency_key,
        createdAt: at,
        updatedAt: at,
      };
      try {
        const inserted = await approvals.insertOne(document);
        return { approval_id: inserted.insertedId.toString() };
      } catch (error) {
        if (!is_duplicate_key(error)) throw error;
        const raced = await approvals.findOne({ idempotencyKey: idempotency_key });
        if (!raced) {
          throw new ApprovalServiceError(
            "APPROVAL_STATE_CONFLICT",
            "The approval request conflicts with existing state.",
          );
        }
        return existing_pending(raced, run_id, action_idempotency_key, at);
      }
    },

    async verify_resume(args, context) {
      required_key(args.run_id, 128);
      const action_idempotency_key = required_key(
        args.action_idempotency_key,
        MAX_ACTION_KEY_CHARS,
      );
      require_context(tenant_id, args.run_id, context);
      const parsed = approval_resume_v1_schema.safeParse(args.resume);
      if (!parsed.success) {
        throw new ApprovalServiceError(
          "APPROVAL_RESUME_INVALID",
          "The approval decision payload is invalid.",
        );
      }

      const approval = await load_exact_approval(
        parsed.data.approval_id,
        args.run_id,
        action_idempotency_key,
      );
      if (!approval) {
        throw new ApprovalServiceError("APPROVAL_NOT_FOUND", "The approval request was not found.");
      }
      await require_manager(parsed.data.decided_by_profile_id);

      const terminal = stored_result(approval);
      if (terminal) {
        return exact_terminal_replay(
          approval,
          parsed.data.decision,
          parsed.data.decided_by_profile_id,
        );
      }

      const at = now();
      if (!(approval.expiresAt instanceof Date) || approval.expiresAt.getTime() <= at.getTime()) {
        await approvals.updateOne(
          { _id: approval._id, status: "pending", expiresAt: { $lte: at } },
          { $set: { status: "expired", updatedAt: at } },
        );
        throw new ApprovalServiceError("APPROVAL_EXPIRED", "The approval request has expired.");
      }
      if (approval.status !== "pending") {
        throw new ApprovalServiceError(
          "APPROVAL_STATE_CONFLICT",
          "The approval request is no longer pending.",
        );
      }

      const stored_status = parsed.data.decision === "approve" ? "approved" : "rejected";
      const updated = await approvals.findOneAndUpdate(
        {
          _id: approval._id,
          tenantId: { $in: identifier_values(tenant_id) },
          runId: { $in: identifier_values(args.run_id) },
          checkpointId: action_idempotency_key,
          idempotencyKey: approval_idempotency_key(
            tenant_id,
            args.run_id,
            action_idempotency_key,
          ),
          status: "pending",
          expiresAt: { $gt: at },
        },
        {
          $set: {
            status: stored_status,
            decidedByProfileId: storage_identifier(parsed.data.decided_by_profile_id),
            decidedAt: at,
            updatedAt: at,
          },
        },
        { returnDocument: "after" },
      );
      if (updated) {
        return {
          approval_id: public_approval_id(updated),
          status: parsed.data.decision === "approve" ? "approved" : "denied",
        };
      }

      const settled = await load_exact_approval(
        parsed.data.approval_id,
        args.run_id,
        action_idempotency_key,
      );
      if (!settled) {
        throw new ApprovalServiceError("APPROVAL_NOT_FOUND", "The approval request was not found.");
      }
      if (stored_result(settled)) {
        return exact_terminal_replay(
          settled,
          parsed.data.decision,
          parsed.data.decided_by_profile_id,
        );
      }
      if (settled.status === "expired") {
        throw new ApprovalServiceError("APPROVAL_EXPIRED", "The approval request has expired.");
      }
      throw new ApprovalServiceError(
        "APPROVAL_STATE_CONFLICT",
        "The approval request is no longer pending.",
      );
    },

    async count_for_run(run_id) {
      required_key(run_id, 128);
      return approvals.countDocuments({
        tenantId: { $in: identifier_values(tenant_id) },
        runId: { $in: identifier_values(run_id) },
      });
    },
  };
}
