import type { Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  list_scoped_documents,
  update_scoped_document,
} from "./tenant-repository-base";

const NOT_FOUND = "FEEDBACK_NOT_FOUND";

/**
 * Tenant-scoped repository over the feedback collection. Every method takes
 * a TenantExecutionContext — never a tenant ID.
 */
export interface FeedbackRepository {
  create_feedback(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  get_feedback(context: TenantExecutionContext, feedback_id: string): Promise<WithId<Document>>;
  list_feedback(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  update_feedback(
    context: TenantExecutionContext,
    feedback_id: string,
    patch: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  delete_feedback(context: TenantExecutionContext, feedback_id: string): Promise<void>;
}

/**
 * Create the feedback repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance; all failures use code "FEEDBACK_NOT_FOUND".
 */
export function create_feedback_repository(db: Db): FeedbackRepository {
  const feedback = db.collection("feedback");
  return {
    async create_feedback(context, input) {
      return insert_scoped_document(feedback, context, input, "actor");
    },
    async get_feedback(context, feedback_id) {
      return get_scoped_document(feedback, context, feedback_id, NOT_FOUND);
    },
    async list_feedback(context) {
      return list_scoped_documents(feedback, context);
    },
    async update_feedback(context, feedback_id, patch) {
      return update_scoped_document(feedback, context, feedback_id, NOT_FOUND, patch);
    },
    async delete_feedback(context, feedback_id) {
      return delete_scoped_document(feedback, context, feedback_id, NOT_FOUND);
    },
  };
}
