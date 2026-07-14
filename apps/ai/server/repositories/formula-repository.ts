import type { Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  ResourceNotFoundError,
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

/** Statuses a manager review queue surfaces (plan: "testing"/review). */
const REVIEW_STATUSES = ["testing", "review"] as const;

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

    async confirm_formula(context, formula_id, idempotency_key) {
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
        await formula_version_logs.insertOne({
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
