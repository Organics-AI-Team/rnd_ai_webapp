/**
 * Context Memory Tool Handler
 * Handles the `context_memory` ReAct tool by querying conversation history
 * from MongoDB for a given session_id and returning the last N turns in a
 * readable format.
 *
 * Data sources (both queried, results merged chronologically):
 *   1. rnd_ai.conversations          — MONGODB_URI
 *   2. rnd_ai.raw_materials_conversations — MONGODB_URI
 *
 * This allows the ReAct agent to recall earlier user preferences, mentioned
 * ingredients, or formulation context without re-asking the user.
 *
 * @author AI Management System
 * @date 2026-03-27
 */

import { MongoClient, Document } from 'mongodb';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default number of past messages to retrieve when caller omits lookback */
const DEFAULT_LOOKBACK = 10;

/** Hard cap on lookback to prevent oversized context windows */
const MAX_LOOKBACK = 50;

/** Database name where conversation collections are stored */
const CONVERSATIONS_DATABASE = 'rnd_ai';

/** Primary conversation collection name */
const PRIMARY_COLLECTION = 'conversations';

/** Secondary conversation collection for raw-materials-specific chat history */
const SECONDARY_COLLECTION = 'raw_materials_conversations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input parameters for the context_memory tool handler.
 *
 * @param session_id - Active chat session identifier used to filter messages
 * @param lookback   - Number of past messages to retrieve (default: 10, capped at 50)
 */
interface ContextMemoryParams {
  session_id: string;
  lookback?: number;
}

/**
 * Normalized conversation message shape extracted from MongoDB documents.
 *
 * @param role      - Speaker role: 'user' | 'assistant' | 'system'
 * @param content   - Message text content
 * @param timestamp - ISO timestamp string; used for chronological sorting
 * @param source    - Collection name where this message originated
 */
interface ConversationMessage {
  role: string;
  content: string;
  timestamp: string;
  source: string;
}

// ---------------------------------------------------------------------------
// MongoDB Client Cache (reuse pattern from mongo-query-handler)
// ---------------------------------------------------------------------------

/** Module-level cache to avoid reconnecting on each tool call */
const client_cache = new Map<string, MongoClient>();

/**
 * Retrieve or create a cached MongoClient for the given URI.
 *
 * @param uri - MongoDB connection string
 * @returns Connected MongoClient
 * @throws Error if URI is empty or connection fails
 */
async function get_or_create_client(uri: string): Promise<MongoClient> {
  console.log('[context-memory-handler] get_or_create_client — start');

  if (!uri) {
    throw new Error('MONGODB_URI is not set. Cannot connect for context memory.');
  }

  if (client_cache.has(uri)) {
    console.log('[context-memory-handler] get_or_create_client — cache hit');
    return client_cache.get(uri)!;
  }

  const client = new MongoClient(uri, {
    maxPoolSize: 5,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
  });

  await client.connect();
  client_cache.set(uri, client);

  console.log('[context-memory-handler] get_or_create_client — connected and cached');
  return client;
}

// ---------------------------------------------------------------------------
// Document Normalizer
// ---------------------------------------------------------------------------

/**
 * Extract and normalise conversation messages from a raw MongoDB document.
 *
 * Handles multiple document shapes:
 *   - documents with a top-level `messages` array (array of {role, content})
 *   - documents with a top-level `role` + `content` (single message shape)
 *   - documents with a `conversation` array field
 *
 * @param doc    - Raw MongoDB document
 * @param source - Source collection name for provenance tagging
 * @returns Array of normalised ConversationMessage objects
 */
function extract_messages_from_doc(doc: Document, source: string): ConversationMessage[] {
  const ts = doc.createdAt
    ? new Date(doc.createdAt).toISOString()
    : doc.timestamp
    ? new Date(doc.timestamp).toISOString()
    : doc.updatedAt
    ? new Date(doc.updatedAt).toISOString()
    : new Date(0).toISOString();

  // Shape 1: document has a `messages` array
  if (Array.isArray(doc.messages)) {
    return doc.messages
      .filter((m: Record<string, unknown>) => m && m.role && m.content)
      .map((m: Record<string, unknown>) => ({
        role: String(m.role),
        content: String(m.content),
        timestamp: ts,
        source,
      }));
  }

  // Shape 2: document has a `conversation` array
  if (Array.isArray(doc.conversation)) {
    return doc.conversation
      .filter((m: Record<string, unknown>) => m && m.role && m.content)
      .map((m: Record<string, unknown>) => ({
        role: String(m.role),
        content: String(m.content),
        timestamp: ts,
        source,
      }));
  }

  // Shape 3: flat single-message document with role + content
  if (doc.role && doc.content) {
    return [
      {
        role: String(doc.role),
        content: String(doc.content),
        timestamp: ts,
        source,
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Collection Querier
// ---------------------------------------------------------------------------

/**
 * Query a single MongoDB collection for conversation messages matching session_id.
 *
 * @param client          - Active MongoClient
 * @param collection_name - Collection to query
 * @param session_id      - Session identifier to filter by
 * @param lookback        - Maximum messages to retrieve from this collection
 * @returns Array of normalised ConversationMessage objects
 */
async function query_conversation_collection(
  client: MongoClient,
  collection_name: string,
  session_id: string,
  lookback: number,
): Promise<ConversationMessage[]> {
  console.log('[context-memory-handler] query_conversation_collection — start', {
    collection_name,
    session_id,
    lookback,
  });

  try {
    const db = client.db(CONVERSATIONS_DATABASE);
    const col = db.collection(collection_name);

    // Filter by common session_id field names
    const filter = {
      $or: [
        { session_id: session_id },
        { sessionId: session_id },
        { chatId: session_id },
        { chat_id: session_id },
        { conversationId: session_id },
      ],
    };

    const sort = { createdAt: -1 as const };

    // Fetch more than lookback to account for multi-message documents
    const raw_docs = await col
      .find(filter)
      .sort(sort)
      .limit(lookback)
      .toArray();

    const messages: ConversationMessage[] = [];
    for (const doc of raw_docs) {
      const extracted = extract_messages_from_doc(doc, collection_name);
      messages.push(...extracted);
    }

    console.log('[context-memory-handler] query_conversation_collection — done', {
      collection_name,
      doc_count: raw_docs.length,
      message_count: messages.length,
    });

    return messages;
  } catch (error) {
    // Non-fatal: collection may not exist; log and return empty
    const err_msg = error instanceof Error ? error.message : String(error);
    console.log('[context-memory-handler] query_conversation_collection — skipped (error)', {
      collection_name,
      error: err_msg,
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Result Formatter
// ---------------------------------------------------------------------------

/**
 * Format an array of ConversationMessage objects into a readable
 * role-prefixed turn list, trimmed to the requested lookback count.
 *
 * @param messages   - Sorted array of ConversationMessage objects
 * @param session_id - Session ID for the header line
 * @param lookback   - Maximum messages to include in output
 * @returns Formatted multi-line string for LLM consumption
 */
function format_conversation_history(
  messages: ConversationMessage[],
  session_id: string,
  lookback: number,
): string {
  const trimmed = messages.slice(-lookback);

  const header =
    `Conversation history for session "${session_id}" ` +
    `(last ${trimmed.length} message${trimmed.length !== 1 ? 's' : ''})\n` +
    '─'.repeat(60);

  const formatted = trimmed.map((msg) => {
    const role_label = msg.role.toUpperCase().padEnd(10);
    const content_preview =
      msg.content.length > 500 ? msg.content.substring(0, 500) + '...' : msg.content;
    return `[${role_label}]: ${content_preview}`;
  });

  return [header, ...formatted].join('\n');
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `context_memory` ReAct tool call.
 *
 * Workflow:
 * 1. Validate session_id and lookback
 * 2. Connect to MongoDB using MONGODB_URI
 * 3. Query both `conversations` and `raw_materials_conversations` collections
 * 4. Merge results, sort chronologically, trim to lookback limit
 * 5. Return formatted conversation history
 *
 * @param params - ContextMemoryParams with session_id and optional lookback
 * @returns Formatted conversation history string or a descriptive error/empty message
 * @throws Never throws directly — errors are caught and returned as strings
 */
export async function handle_context_memory(params: ContextMemoryParams): Promise<string> {
  const start_ts = Date.now();
  console.log('[context-memory-handler] handle_context_memory — start', {
    session_id: params.session_id,
    lookback: params.lookback,
  });

  // --- Validation ---
  if (!params.session_id || !params.session_id.trim()) {
    console.log('[context-memory-handler] handle_context_memory — error: missing session_id');
    return 'Error: session_id parameter is required and must not be empty.';
  }

  const lookback = Math.min(params.lookback ?? DEFAULT_LOOKBACK, MAX_LOOKBACK);

  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      return 'Error: MONGODB_URI environment variable is not set. Cannot retrieve conversation history.';
    }

    const client = await get_or_create_client(uri);

    // Query both collections in parallel for efficiency
    const [primary_messages, secondary_messages] = await Promise.all([
      query_conversation_collection(client, PRIMARY_COLLECTION, params.session_id, lookback),
      query_conversation_collection(client, SECONDARY_COLLECTION, params.session_id, lookback),
    ]);

    // Merge and sort by timestamp ascending (oldest first, newest last)
    const all_messages: ConversationMessage[] = [
      ...primary_messages,
      ...secondary_messages,
    ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const elapsed = Date.now() - start_ts;

    if (all_messages.length === 0) {
      console.log('[context-memory-handler] handle_context_memory — no history found', {
        session_id: params.session_id,
        elapsed_ms: elapsed,
      });
      return (
        `No conversation history found for session "${params.session_id}". ` +
        `This may be a new session or the session ID may be incorrect.`
      );
    }

    const formatted = format_conversation_history(all_messages, params.session_id, lookback);

    console.log('[context-memory-handler] handle_context_memory — done', {
      session_id: params.session_id,
      total_messages: all_messages.length,
      returned: Math.min(all_messages.length, lookback),
      elapsed_ms: elapsed,
    });

    return formatted;
  } catch (error) {
    const elapsed = Date.now() - start_ts;
    const err_msg = error instanceof Error ? error.message : String(error);
    console.log('[context-memory-handler] handle_context_memory — error', {
      session_id: params.session_id,
      error: err_msg,
      elapsed_ms: elapsed,
    });
    return `Context memory retrieval failed for session "${params.session_id}": ${err_msg}`;
  }
}
