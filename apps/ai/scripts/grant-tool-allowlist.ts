/**
 * Idempotent ops script: append one governed tool to a tenant's stored
 * allowlists — TenantAIProfile.allowedTools plus the toolAllowlist of the
 * tenant's ACTIVE agent deployments for the named agent keys. Required
 * after adding a tool to the code-side policy layers, because the policy
 * compiler intersects the stored documents (spec §6.2).
 *
 * Env: MONGODB_URI (or DATABASE_URL), IMPORT_TENANT_ID,
 *      GRANT_TOOL_NAME, GRANT_AGENT_KEYS (csv, default "formulation").
 * Usage: GRANT_TOOL_NAME=material.search IMPORT_TENANT_ID=<tenant> \
 *          npm run grant:tool -w apps/ai
 */

import { ObjectId, type Db, type Document } from "mongodb";
import { mongo_uri } from "./import/import.config";

/** Result counters of one grant operation. */
export interface GrantToolResult {
  readonly profiles_matched: number;
  readonly deployments_updated: number;
}

/** Tenant filter spanning both stored ObjectId/string encodings. */
function tenant_filter(tenant_id: string): Document {
  const values: (string | ObjectId)[] = [tenant_id];
  if (ObjectId.isValid(tenant_id)) values.push(new ObjectId(tenant_id));
  return { tenantId: { $in: values } };
}

/**
 * Append a tool to the tenant profile allowlist and the active deployments'
 * tool allowlists ($addToSet — safe to re-run).
 *
 * @param db - Connected Mongo database.
 * @param tenant_id - Target tenant id (hex string).
 * @param tool_name - Governed tool name, e.g. "material.search".
 * @param agent_keys - Deployment agentKey values to update.
 * @returns Matched/updated counters for the operator log.
 */
export async function grant_tool_to_tenant(
  db: Db,
  tenant_id: string,
  tool_name: string,
  agent_keys: readonly string[],
): Promise<GrantToolResult> {
  console.log("[grant:tool] start", { tenant_id, tool_name, agent_keys });
  const profile = await db
    .collection("tenant_ai_profiles")
    .updateOne(tenant_filter(tenant_id), { $addToSet: { allowedTools: tool_name } });
  const deployments = await db.collection("agent_deployments").updateMany(
    { ...tenant_filter(tenant_id), agentKey: { $in: [...agent_keys] }, status: "active" },
    { $addToSet: { toolAllowlist: tool_name } },
  );
  const result = {
    profiles_matched: profile.matchedCount,
    deployments_updated: deployments.modifiedCount,
  };
  console.log("[grant:tool] done", result);
  return result;
}

/** CLI entry. */
async function run_cli(): Promise<void> {
  void mongo_uri();
  const tenant_id = process.env.IMPORT_TENANT_ID?.trim();
  const tool_name = process.env.GRANT_TOOL_NAME?.trim();
  if (!tenant_id || !tool_name) {
    throw new Error("IMPORT_TENANT_ID and GRANT_TOOL_NAME must be set");
  }
  const agent_keys = (process.env.GRANT_AGENT_KEYS?.trim() || "formulation")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const { default: client_promise } = await import("@rnd-ai/shared-database");
  const client = await client_promise;
  try {
    const result = await grant_tool_to_tenant(client.db(), tenant_id, tool_name, agent_keys);
    if (result.profiles_matched === 0) {
      throw new Error(`No tenant_ai_profiles document matched tenant ${tenant_id}`);
    }
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("grant-tool-allowlist")) {
  run_cli().catch((e) => {
    console.error("[grant:tool] failed:", e?.message ?? e);
    process.exitCode = 1;
  });
}
