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
 */
export interface ToolHandlerContext {
  user_id: string;
  organization_id?: string;
  session_id?: string;
  /**
   * Verified tenant ID injected by trusted server code (from the request's
   * TenantExecutionContext). When present, handlers MUST pin every tenant
   * record lookup/mutation to it and never trust a model-supplied ID alone
   * (G2.6). Absent only on legacy call sites still being converted.
   */
  tenant_id?: string;
}
