/**
 * Pinned orchestrator implementation version recorded on every AIRun.
 *
 * A run is executed and resumed only by an orchestrator whose version is in
 * the supported set; this prevents a checkpointed run from silently resuming
 * under an incompatible loop implementation (program invariant 10: a run is
 * one executor from ingress through completion).
 */
export const ORCHESTRATOR_VERSION = "agentic-1.0.0";

/**
 * Orchestrator versions this build can safely resume.
 * Grows only when a newer build remains checkpoint-compatible with an older pin.
 */
export const SUPPORTED_ORCHESTRATOR_VERSIONS: readonly string[] = [
  ORCHESTRATOR_VERSION,
];

/**
 * Reject resuming or executing a run pinned to an unknown orchestrator version.
 *
 * @param pinned_version - Orchestrator version recorded on the AIRun at ingress.
 * @returns Nothing on success.
 * @throws Error when the pinned version is not supported by this build; the
 *         caller must fail the resume safely instead of falling back to any
 *         other executor.
 */
export function assert_supported_orchestrator_version(
  pinned_version: string,
): void {
  if (!SUPPORTED_ORCHESTRATOR_VERSIONS.includes(pinned_version)) {
    throw new Error(
      `Unsupported orchestrator version "${pinned_version}"; this build supports: ${SUPPORTED_ORCHESTRATOR_VERSIONS.join(", ")}`,
    );
  }
}
