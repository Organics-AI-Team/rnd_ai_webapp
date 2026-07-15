/**
 * Run executor selection (G4.9).
 *
 * Decides ONCE, before an AIRun is created, whether a tenant's run is driven by
 * the governed agentic loop or the legacy executor. The choice is stored on the
 * AIRun so an agentic-selected run never falls back to legacy mid-flight and a
 * legacy-selected run never invokes the loop. An explicit legacy pin always wins
 * (a rollback kill-switch), then an explicit agentic pin, then the configured
 * default — so a tenant can always be pulled back to legacy safely. The rollout
 * configuration is injected (env/tenant-sourced), never hard-coded; G5's canary
 * assignment extends this.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

/** Which executor drives a run. */
export type RunExecutor = "agentic" | "legacy";

/** Deterministic rollout configuration resolved by the gateway. */
export interface RolloutConfig {
  /** Executor used when a tenant is neither explicitly pinned agentic nor legacy. */
  readonly default_executor: RunExecutor;
  /** Tenants explicitly on the governed agentic loop. */
  readonly agentic_tenant_ids?: readonly string[];
  /** Tenants explicitly rolled back to legacy (takes precedence over agentic). */
  readonly legacy_tenant_ids?: readonly string[];
}

/**
 * Select the executor for one tenant's run.
 *
 * @param tenant_id - Verified internal tenant ID.
 * @param config - Resolved rollout configuration.
 * @returns "legacy" when explicitly rolled back, else "agentic" when explicitly
 *          enabled, else the configured default.
 */
export function select_run_executor(
  tenant_id: string,
  config: RolloutConfig,
): RunExecutor {
  if (config.legacy_tenant_ids?.includes(tenant_id)) return "legacy";
  if (config.agentic_tenant_ids?.includes(tenant_id)) return "agentic";
  return config.default_executor;
}
