/**
 * Chat Threads tRPC Router
 *
 * Manages persistent conversation threads linked to organizations.
 * Each thread belongs to a specific AI agent type and stores messages
 * in a separate ChatMessage collection for scalability.
 *
 * Endpoints:
 *   - list      — Get threads for org + agent type, sorted by lastMessageAt
 *   - create    — Start a new thread
 *   - getMessages — Paginated messages for a thread
 *   - addMessage  — Append message to thread (increments count, updates timestamp)
 *   - archive     — Soft delete a thread
 *   - updateTitle — Rename a thread
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import client_promise from "@rnd-ai/shared-database";
import { ObjectId } from "mongodb";

// ---------------------------------------------------------------------------
// Input Schemas
// ---------------------------------------------------------------------------

const agent_type_enum = z.enum(['raw_materials_ai', 'sales_rnd_ai']);

const list_input = z.object({
  agentType: agent_type_enum,
  limit: z.number().min(1).max(100).default(30),
  includeArchived: z.boolean().default(false),
});

const create_input = z.object({
  agentType: agent_type_enum,
  title: z.string().min(1).max(200),
});

const get_messages_input = z.object({
  threadId: z.string(),
  limit: z.number().min(1).max(100).default(50),
  before: z.string().optional(),
});

const add_message_input = z.object({
  threadId: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  metadata: z.any().optional(),
});

const archive_input = z.object({
  threadId: z.string(),
});

const update_title_input = z.object({
  threadId: z.string(),
  title: z.string().min(1).max(200),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const chatThreadsRouter = router({
  /**
   * List chat threads for the current user's org + agent type.
   * Sorted by lastMessageAt descending (most recent first).
   *
   * @param agentType       - Filter by AI agent type
   * @param limit           - Max threads to return (default 30)
   * @param includeArchived - Whether to include archived threads
   * @returns Array of thread summaries
   */
  list: protectedProcedure
    .input(list_input)
    .query(async ({ ctx, input }) => {
      console.log('[chatThreads] list — start', {
        userId: ctx.userId,
        orgId: ctx.organizationId,
        agentType: input.agentType,
      });

      const client = await client_promise;
      const db = client.db();

      const filter: Record<string, any> = {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        agentType: input.agentType,
      };
      if (!input.includeArchived) {
        filter.isArchived = { $ne: true };
      }

      const threads = await db.collection("chat_threads")
        .find(filter)
        .sort({ lastMessageAt: -1 })
        .limit(input.limit)
        .project({
          _id: 1,
          title: 1,
          agentType: 1,
          messageCount: 1,
          lastMessageAt: 1,
          isArchived: 1,
          createdAt: 1,
        })
        .toArray();

      console.log('[chatThreads] list — done', { count: threads.length });

      return threads.map((t) => ({
        id: t._id.toString(),
        title: t.title,
        agentType: t.agentType,
        messageCount: t.messageCount || 0,
        lastMessageAt: t.lastMessageAt,
        isArchived: t.isArchived || false,
        createdAt: t.createdAt,
      }));
    }),

  /**
   * Create a new chat thread.
   *
   * @param agentType - AI agent type for this thread
   * @param title     - Thread title (usually from first user message)
   * @returns Created thread with id
   */
  create: protectedProcedure
    .input(create_input)
    .mutation(async ({ ctx, input }) => {
      console.log('[chatThreads] create — start', {
        userId: ctx.userId,
        orgId: ctx.organizationId,
        agentType: input.agentType,
      });

      const client = await client_promise;
      const db = client.db();

      const now = new Date();
      const thread = {
        _id: new ObjectId(),
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        agentType: input.agentType,
        title: input.title,
        messageCount: 0,
        lastMessageAt: now,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      };

      await db.collection("chat_threads").insertOne(thread);

      console.log('[chatThreads] create — done', { threadId: thread._id.toString() });

      return {
        id: thread._id.toString(),
        title: thread.title,
        agentType: thread.agentType,
        messageCount: 0,
        lastMessageAt: now,
        isArchived: false,
        createdAt: now,
      };
    }),

  /**
   * Get paginated messages for a thread.
   * Returns messages in chronological order (oldest first).
   *
   * @param threadId - The thread to fetch messages from
   * @param limit    - Max messages to return (default 50)
   * @param before   - Cursor: fetch messages before this message ID
   * @returns Array of messages in chronological order
   */
  getMessages: protectedProcedure
    .input(get_messages_input)
    .query(async ({ ctx, input }) => {
      console.log('[chatThreads] getMessages — start', {
        threadId: input.threadId,
        limit: input.limit,
      });

      const client = await client_promise;
      const db = client.db();

      // Verify thread belongs to user's org
      const thread = await db.collection("chat_threads").findOne({
        _id: new ObjectId(input.threadId),
        organizationId: ctx.organizationId,
      });

      if (!thread) {
        throw new Error('Thread not found or access denied');
      }

      const filter: Record<string, any> = {
        threadId: input.threadId,
      };
      if (input.before) {
        filter._id = { $lt: new ObjectId(input.before) };
      }

      const messages = await db.collection("chat_messages")
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(input.limit)
        .toArray();

      console.log('[chatThreads] getMessages — done', { count: messages.length });

      // Return in chronological order (oldest first)
      return messages.reverse().map((m) => ({
        id: m._id.toString(),
        threadId: m.threadId,
        role: m.role,
        content: m.content,
        metadata: m.metadata || null,
        createdAt: m.createdAt,
      }));
    }),

  /**
   * Add a message to a thread.
   * Also increments messageCount and updates lastMessageAt on the thread.
   *
   * @param threadId - Thread to append to
   * @param role     - "user" or "assistant"
   * @param content  - Message content
   * @param metadata - Optional metadata (confidence, tools used, etc.)
   * @returns The created message
   */
  addMessage: protectedProcedure
    .input(add_message_input)
    .mutation(async ({ ctx, input }) => {
      console.log('[chatThreads] addMessage — start', {
        threadId: input.threadId,
        role: input.role,
      });

      const client = await client_promise;
      const db = client.db();

      // Verify thread belongs to user's org
      const thread = await db.collection("chat_threads").findOne({
        _id: new ObjectId(input.threadId),
        organizationId: ctx.organizationId,
      });

      if (!thread) {
        throw new Error('Thread not found or access denied');
      }

      const now = new Date();
      const message = {
        _id: new ObjectId(),
        threadId: input.threadId,
        role: input.role,
        content: input.content,
        metadata: input.metadata || null,
        createdAt: now,
      };

      // Insert message and update thread atomically
      await Promise.all([
        db.collection("chat_messages").insertOne(message),
        db.collection("chat_threads").updateOne(
          { _id: new ObjectId(input.threadId) },
          {
            $inc: { messageCount: 1 },
            $set: { lastMessageAt: now, updatedAt: now },
          },
        ),
      ]);

      console.log('[chatThreads] addMessage — done', { messageId: message._id.toString() });

      return {
        id: message._id.toString(),
        threadId: message.threadId,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
        createdAt: now,
      };
    }),

  /**
   * Archive (soft delete) a thread.
   *
   * @param threadId - Thread to archive
   * @returns Success status
   */
  archive: protectedProcedure
    .input(archive_input)
    .mutation(async ({ ctx, input }) => {
      console.log('[chatThreads] archive — start', { threadId: input.threadId });

      const client = await client_promise;
      const db = client.db();

      const result = await db.collection("chat_threads").updateOne(
        {
          _id: new ObjectId(input.threadId),
          organizationId: ctx.organizationId,
        },
        {
          $set: { isArchived: true, updatedAt: new Date() },
        },
      );

      if (result.matchedCount === 0) {
        throw new Error('Thread not found or access denied');
      }

      console.log('[chatThreads] archive — done');
      return { success: true };
    }),

  /**
   * Update thread title.
   *
   * @param threadId - Thread to rename
   * @param title    - New title
   * @returns Updated thread summary
   */
  updateTitle: protectedProcedure
    .input(update_title_input)
    .mutation(async ({ ctx, input }) => {
      console.log('[chatThreads] updateTitle — start', {
        threadId: input.threadId,
        title: input.title,
      });

      const client = await client_promise;
      const db = client.db();

      const result = await db.collection("chat_threads").updateOne(
        {
          _id: new ObjectId(input.threadId),
          organizationId: ctx.organizationId,
        },
        {
          $set: { title: input.title, updatedAt: new Date() },
        },
      );

      if (result.matchedCount === 0) {
        throw new Error('Thread not found or access denied');
      }

      console.log('[chatThreads] updateTitle — done');
      return { success: true, title: input.title };
    }),
});
