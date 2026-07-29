import type { Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  ResourceNotFoundError,
  assert_no_security_fields,
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  list_scoped_documents,
  require_permission,
  scoped_id_filter,
  tenant_scope,
  update_scoped_document,
} from "./tenant-repository-base";

const NOT_FOUND = "FORMULA_NOT_FOUND";
const COMMENT_NOT_FOUND = "FORMULA_COMMENT_NOT_FOUND";

/** Statuses a manager review queue surfaces (plan: "testing"/review). */
const REVIEW_STATUSES = ["testing", "review"] as const;

/**
 * Optional enrichment applied atomically during confirm_formula. Lets the
 * router record the legacy display fields (version, changeType, snapshot,
 * remarks) on the single idempotent confirm log instead of a second write.
 */
export interface ConfirmFormulaOptions {
  /** Confirmed version number $set on the formula (bump computed by caller). */
  readonly confirmed_version?: number;
  /**
   * Display/business fields merged into the confirm version-log document.
   * Security fields are rejected; bookkeeping identity fields always win.
   */
  readonly log_fields?: Record<string, unknown>;
}

/** One commentType bucket produced by count_comments_by_type. */
export interface CommentTypeCount {
  readonly commentType: string | null;
  readonly count: number;
}

/**
 * Tenant-scoped repository over formulas plus their nested formula_comments
 * and formula_version_logs. Nested reads/writes always filter by BOTH
 * tenantId and the parent formula ID — a parent relation alone is never
 * trusted. Every method takes a TenantExecutionContext, never a tenant ID.
 */
export interface FormulaRepository {
  create_formula(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  get_formula(context: TenantExecutionContext, formula_id: string): Promise<WithId<Document>>;
  list_formulas(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  update_own_draft(
    context: TenantExecutionContext,
    formula_id: string,
    patch: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  delete_formula(context: TenantExecutionContext, formula_id: string): Promise<void>;
  add_comment(
    context: TenantExecutionContext,
    formula_id: string,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  list_comments(
    context: TenantExecutionContext,
    formula_id: string,
  ): Promise<WithId<Document>[]>;
  count_comments_by_type(
    context: TenantExecutionContext,
    formula_id: string,
    version?: number,
  ): Promise<CommentTypeCount[]>;
  update_own_comment(
    context: TenantExecutionContext,
    comment_id: string,
    patch: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  delete_own_comment(
    context: TenantExecutionContext,
    comment_id: string,
  ): Promise<void>;
  get_max_formula_code_number(context: TenantExecutionContext): Promise<number>;
  add_version_log(
    context: TenantExecutionContext,
    formula_id: string,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  list_version_logs(
    context: TenantExecutionContext,
    formula_id: string,
  ): Promise<WithId<Document>[]>;
  list_review_queue(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  confirm_formula(
    context: TenantExecutionContext,
    formula_id: string,
    idempotency_key: string,
    options?: ConfirmFormulaOptions,
  ): Promise<WithId<Document>>;
}

/**
 * Create the formula repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance; all not-found failures use "FORMULA_NOT_FOUND"
 *   and permission failures use code "FORBIDDEN".
 */
export function create_formula_repository(db: Db): FormulaRepository {
  const formulas = db.collection("formulas");
  const formula_comments = db.collection("formula_comments");
  const formula_version_logs = db.collection("formula_version_logs");

  /**
   * Resolve a parent formula inside the tenant scope or fail with the
   * canonical not-found shape, so nested access can never confirm a foreign
   * formula's existence.
   *
   * @param context - Verified tenant execution context.
   * @param formula_id - Caller-supplied parent formula ID.
   * @returns The scoped parent formula.
   * @throws ResourceNotFoundError with code "FORMULA_NOT_FOUND".
   */
  async function get_scoped_parent(
    context: TenantExecutionContext,
    formula_id: string,
  ): Promise<WithId<Document>> {
    return get_scoped_document(formulas, context, formula_id, NOT_FOUND);
  }

  return {
    async create_formula(context, input) {
      const document = await insert_scoped_document(
        formulas,
        context,
        { status: "draft", ...input },
        "owner",
      );
      return document;
    },

    async get_formula(context, formula_id) {
      return get_scoped_document(formulas, context, formula_id, NOT_FOUND);
    },

    async list_formulas(context) {
      return list_scoped_documents(formulas, context);
    },

    async update_own_draft(context, formula_id, patch) {
      return update_scoped_document(formulas, context, formula_id, NOT_FOUND, patch, {
        status: "draft",
        ownerProfileId: context.actor_profile_id,
      });
    },

    async delete_formula(context, formula_id) {
      return delete_scoped_document(formulas, context, formula_id, NOT_FOUND);
    },

    async add_comment(context, formula_id, input) {
      const parent = await get_scoped_parent(context, formula_id);
      return insert_scoped_document(
        formula_comments,
        context,
        { ...input, formulaId: String(parent._id) },
        "actor",
      );
    },

    async list_comments(context, formula_id) {
      const parent = await get_scoped_parent(context, formula_id);
      return list_scoped_documents(formula_comments, context, {
        formulaId: String(parent._id),
      });
    },

    /**
     * Group the tenant's comments on one formula by commentType. Matches on
     * BOTH tenantId and the resolved parent formula ID, optionally narrowed
     * to one version.
     *
     * @param context - Verified tenant execution context.
     * @param formula_id - Parent formula ID (must be tenant-scoped).
     * @param version - Optional formula version to count within.
     * @returns One bucket per commentType with its count.
     * @throws ResourceNotFoundError ("FORMULA_NOT_FOUND") for a foreign or
     *   missing parent formula.
     */
    async count_comments_by_type(context, formula_id, version) {
      const parent = await get_scoped_parent(context, formula_id);
      const match: Document = {
        ...tenant_scope(context),
        formulaId: String(parent._id),
        ...(version !== undefined ? { version } : {}),
      };
      const grouped = await formula_comments
        .aggregate([
          { $match: match },
          { $group: { _id: "$commentType", count: { $sum: 1 } } },
        ])
        .toArray();
      return grouped.map((bucket) => ({
        commentType: (bucket._id as string | null) ?? null,
        count: Number(bucket.count),
      }));
    },

    /**
     * Patch a comment the acting profile authored. The filter binds tenantId,
     * the comment ID, and actorProfileId, so foreign-tenant and foreign-author
     * comments fail with the identical not-found shape.
     *
     * @param context - Verified tenant execution context.
     * @param comment_id - Caller-supplied comment ID.
     * @param patch - Business fields to set (security fields rejected).
     * @returns The updated comment document.
     * @throws ResourceNotFoundError ("FORMULA_COMMENT_NOT_FOUND") for missing,
     *   cross-tenant, malformed, or non-authored comments.
     */
    async update_own_comment(context, comment_id, patch) {
      return update_scoped_document(
        formula_comments,
        context,
        comment_id,
        COMMENT_NOT_FOUND,
        patch,
        { actorProfileId: context.actor_profile_id },
      );
    },

    /**
     * Delete a comment the acting profile authored, under the same combined
     * tenant + author filter as update_own_comment.
     *
     * @param context - Verified tenant execution context.
     * @param comment_id - Caller-supplied comment ID.
     * @throws ResourceNotFoundError ("FORMULA_COMMENT_NOT_FOUND") for missing,
     *   cross-tenant, malformed, or non-authored comments.
     */
    async delete_own_comment(context, comment_id) {
      const result = await formula_comments.deleteOne({
        ...scoped_id_filter(context, comment_id, COMMENT_NOT_FOUND),
        actorProfileId: context.actor_profile_id,
      });
      if (result.deletedCount === 0) {
        throw new ResourceNotFoundError(COMMENT_NOT_FOUND);
      }
    },

    /**
     * Compute the highest formula-code number within the tenant, used to
     * derive the next auto-generated code. Mirrors the legacy heuristic
     * (max of document count and the newest document's numeric code suffix)
     * but scoped to the context tenant only.
     *
     * @param context - Verified tenant execution context.
     * @returns Highest known formula-code number for the tenant (0 when none).
     */
    async get_max_formula_code_number(context) {
      const scope = tenant_scope(context);
      const total_count = await formulas.countDocuments(scope);
      const latest = await formulas.find(scope).sort({ _id: -1 }).limit(1).toArray();
      let max_number = total_count;
      if (latest.length > 0 && latest[0].formulaCode) {
        const match = String(latest[0].formulaCode).match(/(\d+)/);
        if (match) {
          max_number = Math.max(max_number, parseInt(match[1], 10));
        }
      }
      return max_number;
    },

    async add_version_log(context, formula_id, input) {
      const parent = await get_scoped_parent(context, formula_id);
      return insert_scoped_document(
        formula_version_logs,
        context,
        { ...input, formulaId: String(parent._id) },
        "actor",
      );
    },

    async list_version_logs(context, formula_id) {
      const parent = await get_scoped_parent(context, formula_id);
      return list_scoped_documents(formula_version_logs, context, {
        formulaId: String(parent._id),
      });
    },

    async list_review_queue(context) {
      require_permission(context, "formula:confirm");
      return list_scoped_documents(formulas, context, {
        status: { $in: [...REVIEW_STATUSES] },
      });
    },

    async confirm_formula(context, formula_id, idempotency_key, options) {
      require_permission(context, "formula:confirm");
      const filter = scoped_id_filter(context, formula_id, NOT_FOUND);
      const formula = await formulas.findOne(filter);
      if (!formula) throw new ResourceNotFoundError(NOT_FOUND);

      // MongoMemoryServer (and standalone deployments) run without a replica
      // set, so multi-document transactions are unavailable. Instead the
      // confirm is made replayable: the version log is keyed by an
      // idempotency key and carries a compensating writeState field that
      // starts "pending" and flips to "complete" only after the formula
      // status write succeeds. A crash between the two writes leaves a
      // visible "pending" log that any retry (same key) repairs.
      const log_identity = {
        ...tenant_scope(context),
        formulaId: String(formula._id),
        action: "confirm",
        idempotencyKey: idempotency_key,
      };
      const existing_log = await formula_version_logs.findOne(log_identity);
      if (existing_log && existing_log.writeState === "complete") {
        return formula;
      }
      if (!existing_log) {
        if (options?.log_fields) assert_no_security_fields(options.log_fields);
        // Caller display fields are spread FIRST so the identity/bookkeeping
        // fields below can never be overridden by router-supplied values.
        await formula_version_logs.insertOne({
          ...(options?.log_fields ?? {}),
          ...log_identity,
          actorProfileId: context.actor_profile_id,
          previousStatus: formula.status ?? null,
          writeState: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const confirmed = await formulas.findOneAndUpdate(
        filter,
        {
          $set: {
            status: "confirmed",
            confirmedByProfileId: context.actor_profile_id,
            ...(options?.confirmed_version !== undefined
              ? { version: options.confirmed_version }
              : {}),
            updatedAt: new Date(),
          },
        },
        { returnDocument: "after" },
      );
      if (!confirmed) throw new ResourceNotFoundError(NOT_FOUND);

      await formula_version_logs.updateOne(log_identity, {
        $set: { writeState: "complete", updatedAt: new Date() },
      });
      return confirmed;
    },
  };
}
