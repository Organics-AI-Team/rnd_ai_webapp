/**
 * Shared types for the ReAct agent system.
 * Extracted to avoid circular imports between react-agent-service and handlers.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

/**
 * Context passed from the agent service to each tool handler.
 * Provides user/org identity needed for DB persistence operations.
 *
 * @property user_id         - Authenticated user identifier.
 * @property organization_id - User's organization for scoping DB writes.
 * @property session_id      - Optional chat session ID for context_memory lookups.
 * @property persist_formula - Whether generated formula drafts should be saved immediately.
 *                             Chat uses false so the user explicitly chooses to save the draft.
 */
export interface ToolHandlerContext {
  user_id: string;
  organization_id?: string;
  session_id?: string;
  persist_formula?: boolean;
}
