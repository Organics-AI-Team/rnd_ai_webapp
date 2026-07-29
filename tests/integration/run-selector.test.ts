/**
 * G4.9c — run executor selection.
 *
 * The selector is a pure decision: an explicit legacy pin wins (rollback),
 * then an explicit agentic pin, then the configured default. This guarantees a
 * tenant can always be pulled back to legacy safely.
 */

import { describe, expect, it } from "vitest";

import {
  select_run_executor,
  type RolloutConfig,
} from "../../apps/ai/server/services/ai-gateway/run-selector";

const TENANT = "tenant_a";

describe("select_run_executor", () => {
  it("uses the default when the tenant is unpinned", () => {
    const config: RolloutConfig = { default_executor: "legacy" };
    expect(select_run_executor(TENANT, config)).toBe("legacy");
    expect(select_run_executor(TENANT, { default_executor: "agentic" })).toBe("agentic");
  });

  it("promotes an explicitly agentic tenant over a legacy default", () => {
    const config: RolloutConfig = { default_executor: "legacy", agentic_tenant_ids: [TENANT] };
    expect(select_run_executor(TENANT, config)).toBe("agentic");
  });

  it("rolls an explicitly legacy tenant back over an agentic default", () => {
    const config: RolloutConfig = { default_executor: "agentic", legacy_tenant_ids: [TENANT] };
    expect(select_run_executor(TENANT, config)).toBe("legacy");
  });

  it("lets a legacy pin win when a tenant is in both lists (rollback precedence)", () => {
    const config: RolloutConfig = {
      default_executor: "agentic",
      agentic_tenant_ids: [TENANT],
      legacy_tenant_ids: [TENANT],
    };
    expect(select_run_executor(TENANT, config)).toBe("legacy");
  });

  it("does not pin an unrelated tenant", () => {
    const config: RolloutConfig = { default_executor: "agentic", legacy_tenant_ids: ["other"] };
    expect(select_run_executor(TENANT, config)).toBe("agentic");
  });
});
