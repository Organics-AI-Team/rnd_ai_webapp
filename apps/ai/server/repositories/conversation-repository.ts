import type { Collection, Db, Document, WithId } from "mongodb";
import { raw_materials_client_promise } from "@rnd-ai/shared-database";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  list_scoped_documents,
  object_id_or_not_found,
  tenant_scope,
  update_scoped_document,
} from "./tenant-repository-base";

const CONVERSATION_NOT_FOUND = "CONVERSATION_NOT_FOUND";
const THREAD_NOT_FOUND = "THREAD_NOT_FOUND";
const MESSAGE_NOT_FOUND = "MESSAGE_NOT_FOUND";

/**
 * Collection names owned by this repository. They are private constants on
 * purpose: routers can never supply a collection name.
 */
const RAW_MATERIALS_CONVERSATIONS_COLLECTION = "raw_materials_conversations";
const MAIN_FEEDBACK_LOOKUP_COLLECTION = "feedback";
const RAW_MATERIALS_FEEDBACK_LOOKUP_COLLECTION = "raw_materials_feedback";

/**
 * Resolve the raw-materials database handle lazily. The raw-materials AI
 * data lives in a separate MongoDB deployment behind
 * raw_materials_client_promise, so it cannot be derived from the main db
 * handle the repository factory receives. The promise is lazy: no connection
 * is opened until a raw-material method actually runs.
 *
 * @returns The raw-materials database handle.
 */
export async function resolve_raw_materials_db(): Promise<Db> {
  const client = await raw_materials_client_promise;
  return client.db();
}

/** Pagination window for message-log reads (offset-based, newest first). */
export interface MessageLogPage {
  /** Maximum documents to return. */
  readonly limit: number;
  /** Documents to skip from the newest end. */
  readonly offset: number;
}

/** Per-actor aggregate snapshot of one message log. */
export interface MessageLogStats {
  readonly total_messages: number;
  readonly user_messages: number;
  readonly assistant_messages: number;
  readonly first_message_at: Date | null;
  readonly last_message_at: Date | null;
}

/** Options for listing the actor's chat threads. */
export interface ListOwnThreadsOptions {
  /** Business agent type discriminators included in the history. */
  readonly agent_types: readonly string[];
  /** Whether soft-deleted (archived) threads are included. */
  readonly include_archived: boolean;
  /** Maximum threads to return. */
  readonly limit: number;
}

/** Cursor options for paginated thread-message reads (newest first). */
export interface ListThreadMessagesOptions {
  /** Maximum messages to return. */
  readonly limit: number;
  /** Exclusive upper-bound message ID cursor. */
  readonly before?: string;
}

/**
 * The flat per-actor message-log operations shared by the sales conversation
 * log and the raw-materials conversation log. Every operation filters by
 * BOTH the tenant scope and the acting profile, so one member can never read
 * or clear another member's history.
 */
interface MessageLogOperations {
  save_message(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  list_own_messages(
    context: TenantExecutionContext,
    page: MessageLogPage,
  ): Promise<WithId<Document>[]>;
  clear_own_messages(context: TenantExecutionContext): Promise<number>;
  get_own_message_stats(context: TenantExecutionContext): Promise<MessageLogStats>;
  list_own_messages_with_feedback(
    context: TenantExecutionContext,
    limit: number,
  ): Promise<Document[]>;
}

/**
 * Build the tenant+actor filter every "own message" operation uses.
 *
 * @param context - Verified tenant execution context.
 * @returns Filter fragment `{ tenantId, actorProfileId }`.
 */
function own_message_filter(context: TenantExecutionContext): Document {
  return { ...tenant_scope(context), actorProfileId: context.actor_profile_id };
}

/**
 * Create the per-actor message-log operations over one lazily resolved
 * collection. Instantiated twice: for the main `conversations` collection
 * and for the raw-materials `raw_materials_conversations` collection.
 *
 * @param resolve_collection - Lazy accessor for the target collection.
 * @param feedback_lookup_collection - Sibling feedback collection joined by
 *   list_own_messages_with_feedback (same database as the message log).
 * @returns Message-log operations bound to that collection.
 */
function create_message_log_operations(
  resolve_collection: () => Promise<Collection<Document>>,
  feedback_lookup_collection: string,
): MessageLogOperations {
  return {
    async save_message(context, input) {
      const collection = await resolve_collection();
      return insert_scoped_document(collection, context, input, "actor");
    },

    async list_own_messages(context, page) {
      const collection = await resolve_collection();
      return collection
        .find(own_message_filter(context))
        .sort({ timestamp: -1 })
        .skip(page.offset)
        .limit(page.limit)
        .toArray();
    },

    async clear_own_messages(context) {
      const collection = await resolve_collection();
      const result = await collection.deleteMany(own_message_filter(context));
      return result.deletedCount;
    },

    async get_own_message_stats(context) {
      const collection = await resolve_collection();
      const own = own_message_filter(context);
      const [total, user, assistant, oldest, newest] = await Promise.all([
        collection.countDocuments(own),
        collection.countDocuments({ ...own, role: "user" }),
        collection.countDocuments({ ...own, role: "assistant" }),
        collection.find(own).sort({ timestamp: 1 }).limit(1).toArray(),
        collection.find(own).sort({ timestamp: -1 }).limit(1).toArray(),
      ]);
      return {
        total_messages: total,
        user_messages: user,
        assistant_messages: assistant,
        first_message_at: (oldest[0]?.timestamp as Date | undefined) ?? null,
        last_message_at: (newest[0]?.timestamp as Date | undefined) ?? null,
      };
    },

    async list_own_messages_with_feedback(context, limit) {
      const collection = await resolve_collection();
      return collection
        .aggregate([
          {
            $match: {
              ...own_message_filter(context),
              role: "assistant",
              responseId: { $exists: true },
            },
          },
          {
            // Pipeline form so the joined feedback rows are ALSO pinned to
            // the tenant, never matched by responseId alone.
            $lookup: {
              from: feedback_lookup_collection,
              let: { response_id: "$responseId" },
              pipeline: [
                { $match: { $expr: { $eq: ["$responseId", "$$response_id"] } } },
                { $match: tenant_scope(context) },
              ],
              as: "feedback",
            },
          },
          { $sort: { timestamp: -1 } },
          { $limit: limit },
          {
            $project: {
              id: 1,
              content: 1,
              role: 1,
              timestamp: 1,
              responseId: 1,
              feedbackSubmitted: 1,
              feedbackCount: { $size: "$feedback" },
              averageScore: { $avg: "$feedback.score" },
            },
          },
        ])
        .toArray();
    },
  };
}

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

  /** Actor-scoped thread listing (newest activity first). */
  list_own_threads(
    context: TenantExecutionContext,
    options: ListOwnThreadsOptions,
  ): Promise<WithId<Document>[]>;
  /** Paginated messages of one tenant-scoped thread (newest first). */
  list_thread_messages(
    context: TenantExecutionContext,
    thread_id: string,
    options: ListThreadMessagesOptions,
  ): Promise<WithId<Document>[]>;
  /** Append a message and bump the parent thread's counters atomically. */
  append_thread_message(
    context: TenantExecutionContext,
    thread_id: string,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;

  /** Per-actor message log over the main `conversations` collection. */
  list_own_conversation_messages(
    context: TenantExecutionContext,
    page: MessageLogPage,
  ): Promise<WithId<Document>[]>;
  clear_own_conversation_messages(context: TenantExecutionContext): Promise<number>;
  get_own_conversation_stats(context: TenantExecutionContext): Promise<MessageLogStats>;
  list_own_conversation_messages_with_feedback(
    context: TenantExecutionContext,
    limit: number,
  ): Promise<Document[]>;

  /** Per-actor message log over `raw_materials_conversations` (raw-materials db). */
  save_raw_material_message(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  list_own_raw_material_messages(
    context: TenantExecutionContext,
    page: MessageLogPage,
  ): Promise<WithId<Document>[]>;
  clear_own_raw_material_messages(context: TenantExecutionContext): Promise<number>;
  get_own_raw_material_message_stats(
    context: TenantExecutionContext,
  ): Promise<MessageLogStats>;
  list_own_raw_material_messages_with_feedback(
    context: TenantExecutionContext,
    limit: number,
  ): Promise<Document[]>;
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

  const main_message_log = create_message_log_operations(
    async () => conversations,
    MAIN_FEEDBACK_LOOKUP_COLLECTION,
  );
  const raw_material_message_log = create_message_log_operations(
    async () =>
      (await resolve_raw_materials_db()).collection(
        RAW_MATERIALS_CONVERSATIONS_COLLECTION,
      ),
    RAW_MATERIALS_FEEDBACK_LOOKUP_COLLECTION,
  );

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

    async list_own_threads(context, options) {
      const filter: Document = {
        ...tenant_scope(context),
        ownerProfileId: context.actor_profile_id,
        agentType: { $in: [...options.agent_types] },
      };
      if (!options.include_archived) {
        filter.isArchived = { $ne: true };
      }
      return chat_threads
        .find(filter)
        .sort({ lastMessageAt: -1 })
        .limit(options.limit)
        .toArray();
    },

    async list_thread_messages(context, thread_id, options) {
      const thread = await get_scoped_thread(context, thread_id);
      const filter: Document = {
        ...tenant_scope(context),
        threadId: String(thread._id),
      };
      if (options.before) {
        filter._id = { $lt: object_id_or_not_found(options.before, MESSAGE_NOT_FOUND) };
      }
      return chat_messages
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(options.limit)
        .toArray();
    },

    async append_thread_message(context, thread_id, input) {
      const thread = await get_scoped_thread(context, thread_id);
      const now = new Date();
      const message = await insert_scoped_document(
        chat_messages,
        context,
        { ...input, threadId: String(thread._id) },
        "actor",
      );
      await chat_threads.updateOne(
        { _id: thread._id, ...tenant_scope(context) },
        { $inc: { messageCount: 1 }, $set: { lastMessageAt: now, updatedAt: now } },
      );
      return message;
    },

    list_own_conversation_messages: main_message_log.list_own_messages,
    clear_own_conversation_messages: main_message_log.clear_own_messages,
    get_own_conversation_stats: main_message_log.get_own_message_stats,
    list_own_conversation_messages_with_feedback:
      main_message_log.list_own_messages_with_feedback,

    save_raw_material_message: raw_material_message_log.save_message,
    list_own_raw_material_messages: raw_material_message_log.list_own_messages,
    clear_own_raw_material_messages: raw_material_message_log.clear_own_messages,
    get_own_raw_material_message_stats: raw_material_message_log.get_own_message_stats,
    list_own_raw_material_messages_with_feedback:
      raw_material_message_log.list_own_messages_with_feedback,
  };
}
