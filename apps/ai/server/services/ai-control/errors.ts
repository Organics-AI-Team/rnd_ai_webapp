/**
 * Typed governance errors for the AI control plane.
 *
 * Every rejection travelling out of the tool catalogue, card loader,
 * executor, or context assembler carries a stable machine-readable code and
 * a safe message that never embeds provider payloads, prompts, or secrets.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

/** Stable error codes emitted by the AI control-plane governance layer. */
export type ToolGovernanceErrorCode =
  | "TOOL_UNKNOWN"
  | "TOOL_NOT_ALLOWED"
  | "POLICY_DISABLED"
  | "TOOL_PERMISSION_DENIED"
  | "TOOL_INPUT_INVALID"
  | "TOOL_APPROVAL_REQUIRED"
  | "TOOL_TIMEOUT"
  | "TOOL_OUTPUT_INVALID"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_ALREADY_REGISTERED"
  | "TOOL_SCHEMA_NOT_STRICT"
  | "TOOL_SCHEMA_FORBIDDEN_FIELD"
  | "TOOL_CARD_MISSING"
  | "TOOL_CARD_DRIFT"
  | "CARD_INVALID"
  | "CARDS_ROOT_NOT_FOUND"
  | "CONTEXT_CARD_MISSING"
  | "CONTEXT_CARD_DRIFT"
  | "NOT_WIRED"
  // Policy compilation (G3.2)
  | "POLICY_INPUT_INVALID"
  | "POLICY_NO_PROVIDER"
  | "POLICY_UNKNOWN_PLAN"
  // Usage ledger (G3.3)
  | "BUDGET_EXCEEDED"
  | "BUDGET_RECONCILIATION_REQUIRED";

/**
 * Error raised by the governed tool catalogue, executor, card loader, and
 * context assembler. Carries a stable `code` for programmatic handling.
 */
export class ToolGovernanceError extends Error {
  /** Stable machine-readable error code. */
  public readonly code: ToolGovernanceErrorCode;
  /** Whether a caller may safely retry the same action. */
  public readonly retryable: boolean;

  /**
   * Create a typed governance error.
   *
   * @param code - Stable machine-readable error code.
   * @param safe_message - Human-readable message safe for logs and clients.
   * @param retryable - Whether the same action may be retried; defaults false.
   */
  constructor(
    code: ToolGovernanceErrorCode,
    safe_message: string,
    retryable = false,
  ) {
    super(safe_message);
    this.name = "ToolGovernanceError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Narrow an unknown thrown value to ToolGovernanceError when possible.
 *
 * @param value - Any thrown value.
 * @returns The value typed as ToolGovernanceError, or null when it is not one.
 */
export function as_tool_governance_error(
  value: unknown,
): ToolGovernanceError | null {
  return value instanceof ToolGovernanceError ? value : null;
}
