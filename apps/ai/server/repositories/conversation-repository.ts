import type { Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  list_scoped_documents,
  update_scoped_document,
} from "./tenant-repository-base";

const CONVERSATION_NOT_FOUND = "CONVERSATION_NOT_FOUND";
const THREAD_NOT_FOUND = "THREAD_NOT_FOUND";

/**
 * Tenant-scoped repository over conversations, chat_threads, and
 * chat_messages. Messages are nested under threads: every message
 * read/write filters by BOTH tenantId and the parent thread ID, and thread
 * updates are additionally restricted to the owning profile. Every method
 * takes a TenantExecutionContext, never a tenant ID.
 */
export interface ConversationRepository {
  create_conversation(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  get_conversation(
    context: TenantExecutionContext,
    conversation_id: string,
  ): Promise<WithId<Document>>;
  list_conversations(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  update_conversation(
    context: TenantExecutionContext,
    conversation_id: string,
    patch: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  delete_conversation(context: TenantExecutionContext, conversation_id: string): Promise<void>;
  create_thread(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  get_thread(context: TenantExecutionContext, thread_id: string): Promise<WithId<Document>>;
  list_threads(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  update_own_thread(
    context: TenantExecutionContext,
    thread_id: string,
    patch: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  add_chat_message(
    context: TenantExecutionContext,
    thread_id: string,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  list_chat_messages(
    context: TenantExecutionContext,
    thread_id: string,
  ): Promise<WithId<Document>[]>;
}

/**
 * Create the conversation repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance; failures use "CONVERSATION_NOT_FOUND" or
 *   "THREAD_NOT_FOUND" depending on the resource.
 */
export function create_conversation_repository(db: Db): ConversationRepository {
  const conversations = db.collection("conversations");
  const chat_threads = db.collection("chat_threads");
  const chat_messages = db.collection("chat_messages");

  /**
   * Resolve a parent thread inside the tenant scope or fail with the
   * canonical not-found shape, so message access can never confirm a
   * foreign thread's existence.
   *
   * @param context - Verified tenant execution context.
   * @param thread_id - Caller-supplied parent thread ID.
   * @returns The scoped parent thread.
   * @throws ResourceNotFoundError with code "THREAD_NOT_FOUND".
   */
  async function get_scoped_thread(
    context: TenantExecutionContext,
    thread_id: string,
  ): Promise<WithId<Document>> {
    return get_scoped_document(chat_threads, context, thread_id, THREAD_NOT_FOUND);
  }

  return {
    async create_conversation(context, input) {
      return insert_scoped_document(conversations, context, input, "actor");
    },
    async get_conversation(context, conversation_id) {
      return get_scoped_document(conversations, context, conversation_id, CONVERSATION_NOT_FOUND);
    },
    async list_conversations(context) {
      return list_scoped_documents(conversations, context);
    },
    async update_conversation(context, conversation_id, patch) {
      return update_scoped_document(
        conversations,
        context,
        conversation_id,
        CONVERSATION_NOT_FOUND,
        patch,
      );
    },
    async delete_conversation(context, conversation_id) {
      return delete_scoped_document(
        conversations,
        context,
        conversation_id,
        CONVERSATION_NOT_FOUND,
      );
    },

    async create_thread(context, input) {
      return insert_scoped_document(chat_threads, context, input, "owner");
    },
    async get_thread(context, thread_id) {
      return get_scoped_thread(context, thread_id);
    },
    async list_threads(context) {
      return list_scoped_documents(chat_threads, context);
    },
    async update_own_thread(context, thread_id, patch) {
      return update_scoped_document(chat_threads, context, thread_id, THREAD_NOT_FOUND, patch, {
        ownerProfileId: context.actor_profile_id,
      });
    },

    async add_chat_message(context, thread_id, input) {
      const thread = await get_scoped_thread(context, thread_id);
      return insert_scoped_document(
        chat_messages,
        context,
        { ...input, threadId: String(thread._id) },
        "actor",
      );
    },
    async list_chat_messages(context, thread_id) {
      const thread = await get_scoped_thread(context, thread_id);
      return list_scoped_documents(chat_messages, context, {
        threadId: String(thread._id),
      });
    },
  };
}
