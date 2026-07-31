/**
 * Chat Threads tRPC Router
 *
 * Manages persistent conversation threads scoped to the tenant execution
 * context. Each thread belongs to a specific AI agent type and stores
 * messages in a separate chat_messages collection for scalability. All data
 * access goes through the tenant-scoped conversation repository; cross-tenant
 * or missing thread IDs surface as TRPCError NOT_FOUND.
 *
 * Endpoints:
 *   - list      — Get the acting profile's threads for an agent type
 *   - create    — Start a new thread (owner stamped from context)
 *   - getMessages — Paginated messages for a tenant-scoped thread
 *   - addMessage  — Append message to thread (increments count, updates timestamp)
 *   - archive     — Soft delete an owned thread
 *   - updateTitle — Rename an owned thread
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import { z } from "zod";
import { router, tenantProcedure, throw_from_repository_error } from "../trpc";

// ---------------------------------------------------------------------------
// Input Schemas
// ---------------------------------------------------------------------------

const agent_type_enum = z.enum(['rnd_ai', 'raw_materials_ai', 'sales_rnd_ai', 'formulation']);

/**
 * The previous separate workspaces are one R&D AI history now. Keep their
 * threads visible so users do not lose access to their existing work.
 */
const unified_rnd_ai_agent_types = [
  'rnd_ai',
  'raw_materials_ai',
  'sales_rnd_ai',
  'formulation',
] as const;

const list_input = z.object({
  agentType: agent_type_enum.optional(),
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
   * List chat threads owned by the acting profile. The canonical `rnd_ai`
   * workspace includes both its new threads and all legacy specialist threads.
   * Sorted by lastMessageAt descending (most recent first).
   *
   * @param agentType       - Optional scope; `rnd_ai` and omission are unified
   * @param limit           - Max threads to return (default 30)
   * @param includeArchived - Whether to include archived threads
   * @returns Array of thread summaries
   */
  list: tenantProcedure("ai:run")
    .input(list_input)
    .query(async ({ ctx, input }) => {
      const agent_types = input.agentType && input.agentType !== 'rnd_ai'
        ? [input.agentType]
        : unified_rnd_ai_agent_types;
      console.log('[chatThreads] list — start', {
        tenantId: ctx.tenant_context.tenant_id,
        actorProfileId: ctx.tenant_context.actor_profile_id,
        agentTypes: agent_types,
      });

      const threads = await ctx.repositories.conversations.list_own_threads(
        ctx.tenant_context,
        {
          agent_types,
          include_archived: input.includeArchived,
          limit: input.limit,
        },
      );

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
   * Create a new chat thread owned by the acting profile.
   *
   * @param agentType - AI agent type for this thread
   * @param title     - Thread title (usually from first user message)
   * @returns Created thread with id
   */
  create: tenantProcedure("ai:run")
    .input(create_input)
    .mutation(async ({ ctx, input }) => {
      console.log('[chatThreads] create — start', {
        tenantId: ctx.tenant_context.tenant_id,
        actorProfileId: ctx.tenant_context.actor_profile_id,
        agentType: input.agentType,
      });

      try {
        const thread = await ctx.repositories.conversations.create_thread(
          ctx.tenant_context,
          {
            agentType: input.agentType,
            title: input.title,
            messageCount: 0,
            lastMessageAt: new Date(),
            isArchived: false,
          },
        );

        console.log('[chatThreads] create — done', { threadId: thread._id.toString() });

        return {
          id: thread._id.toString(),
          title: thread.title,
          agentType: thread.agentType,
          messageCount: 0,
          lastMessageAt: thread.lastMessageAt,
          isArchived: false,
          createdAt: thread.createdAt,
        };
      } catch (error) {
        throw_from_repository_error(error);
      }
    }),

  /**
   * Get paginated messages for a tenant-scoped thread.
   * Returns messages in chronological order (oldest first).
   *
   * @param threadId - The thread to fetch messages from
   * @param limit    - Max messages to return (default 50)
   * @param before   - Cursor: fetch messages before this message ID
   * @returns Array of messages in chronological order
   */
  getMessages: tenantProcedure("ai:run")
    .input(get_messages_input)
    .query(async ({ ctx, input }) => {
      console.log('[chatThreads] getMessages — start', {
        threadId: input.threadId,
        limit: input.limit,
      });

      try {
        const messages = await ctx.repositories.conversations.list_thread_messages(
          ctx.tenant_context,
          input.threadId,
          { limit: input.limit, before: input.before },
        );

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
      } catch (error) {
        throw_from_repository_error(error);
      }
    }),

  /**
   * Add a message to a tenant-scoped thread.
   * Also increments messageCount and updates lastMessageAt on the thread.
   *
   * @param threadId - Thread to append to
   * @param role     - "user" or "assistant"
   * @param content  - Message content
   * @param metadata - Optional metadata (confidence, tools used, etc.)
   * @returns The created message
   */
  addMessage: tenantProcedure("ai:run")
    .input(add_message_input)
    .mutation(async ({ ctx, input }) => {
      console.log('[chatThreads] addMessage — start', {
        threadId: input.threadId,
        role: input.role,
      });

      try {
        const message = await ctx.repositories.conversations.append_thread_message(
          ctx.tenant_context,
          input.threadId,
          {
            role: input.role,
            content: input.content,
            metadata: input.metadata || null,
          },
        );

        console.log('[chatThreads] addMessage — done', {
          messageId: message._id.toString(),
        });

        return {
          id: message._id.toString(),
          threadId: message.threadId,
          role: message.role,
          content: message.content,
          metadata: message.metadata,
          createdAt: message.createdAt,
        };
      } catch (error) {
        throw_from_repository_error(error);
      }
    }),

  /**
   * Archive (soft delete) a thread owned by the acting profile.
   *
   * @param threadId - Thread to archive
   * @returns Success status
   */
  archive: tenantProcedure("ai:run")
    .input(archive_input)
    .mutation(async ({ ctx, input }) => {
      console.log('[chatThreads] archive — start', { threadId: input.threadId });

      try {
        await ctx.repositories.conversations.update_own_thread(
          ctx.tenant_context,
          input.threadId,
          { isArchived: true },
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      console.log('[chatThreads] archive — done');
      return { success: true };
    }),

  /**
   * Update the title of a thread owned by the acting profile.
   *
   * @param threadId - Thread to rename
   * @param title    - New title
   * @returns Updated thread summary
   */
  updateTitle: tenantProcedure("ai:run")
    .input(update_title_input)
    .mutation(async ({ ctx, input }) => {
      console.log('[chatThreads] updateTitle — start', {
        threadId: input.threadId,
        title: input.title,
      });

      try {
        await ctx.repositories.conversations.update_own_thread(
          ctx.tenant_context,
          input.threadId,
          { title: input.title },
        );
      } catch (error) {
        throw_from_repository_error(error);
      }

      console.log('[chatThreads] updateTitle — done');
      return { success: true, title: input.title };
    }),
});
