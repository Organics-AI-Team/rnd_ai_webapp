/**
 * Promote or explicitly assign tenant AI executors with a signed manifest.
 *
 * Required CLI arguments:
 *   --tenant=<tenant ObjectId> OR --cohort=<named cohort>
 *   --executor=<agentic|legacy|ooda>
 *   --deployment=<deployment ObjectId>
 *   --reason=<operator reason>
 *   --actor-clerk-id=<Clerk user id>
 *   --expected-version=<new|positive integer>
 */

import { createHmac } from "node:crypto";

import {
  AI_ROLLOUT_COHORTS,
  AIRolloutAuthorizationError,
  create_ai_rollout_repository,
  type AIRolloutCohort,
  type AIRolloutExecutor,
  type AIRolloutMutationResult,
  type AssignAIRolloutInput,
} from "../server/repositories/ai-rollout-repository";
import { create_user_profile_repository } from "../server/repositories/user-profile-repository";

/** Parsed operator request independent of process globals. */
export interface SetAIRolloutRequest {
  readonly tenant_id?: string;
  readonly cohort?: AIRolloutCohort;
  readonly executor: AIRolloutExecutor;
  readonly deployment_id: string;
  readonly reason: string;
  readonly actor_clerk_user_id: string;
  readonly expected_version: number | null;
}

/** Testable side-effect boundary for assignment and manifest signing. */
export interface SetAIRolloutPorts {
  readonly resolve_super_admin: (
    clerk_user_id: string,
  ) => Promise<{ profile_id: string } | null>;
  readonly resolve_cohort_tenant_ids: (
    cohort: AIRolloutCohort,
  ) => Promise<readonly string[]>;
  readonly assign: (
    input: AssignAIRolloutInput,
    now: Date,
  ) => Promise<AIRolloutMutationResult>;
  readonly sign_manifest: (canonical_payload: string) => Promise<string>;
  readonly now: () => Date;
}

/** Signed manifest content; tenant IDs, never request-level percentages, define the cohort. */
export interface AIRolloutAssignmentManifest {
  readonly schema_version: "1";
  readonly cohort: AIRolloutCohort;
  readonly tenant_ids: readonly string[];
  readonly executor: AIRolloutExecutor;
  readonly deployment_id: string;
  readonly assignment_versions: Readonly<Record<string, number>>;
  readonly reason: string;
  readonly generated_at: string;
}

/** Read one required `--name=value` argument from an explicit argv list. */
function required_argument(args: readonly string[], name: string): string {
  const prefix = `--${name}=`;
  const value = args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim();
  if (!value) throw new Error(`Missing required argument ${prefix}<value>`);
  return value;
}

/** Read one optional `--name=value` argument from an explicit argv list. */
function optional_argument(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim();
  return value || undefined;
}

/** Translate only the historical operator spelling `ooda` to canonical `agentic`. */
function parse_executor(value: string): AIRolloutExecutor {
  if (value === "ooda") return "agentic";
  if (value === "agentic" || value === "legacy") return value;
  throw new Error("--executor must be agentic, legacy, or the compatibility alias ooda");
}

/** Parse the compare-and-set version (`new` is the initial insert sentinel). */
function parse_expected_version(value: string): number | null {
  if (value === "new") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--expected-version must be new or a positive integer");
  }
  return parsed;
}

/** Parse and validate the set-rollout command without accessing the database. */
export function parse_set_ai_rollout_args(args: readonly string[]): SetAIRolloutRequest {
  const tenant_id = optional_argument(args, "tenant");
  const cohort_value = optional_argument(args, "cohort");
  if (Boolean(tenant_id) === Boolean(cohort_value)) {
    throw new Error("Provide exactly one of --tenant=<id> or --cohort=<name>");
  }
  if (cohort_value && !AI_ROLLOUT_COHORTS.includes(cohort_value as AIRolloutCohort)) {
    throw new Error(`--cohort must be one of ${AI_ROLLOUT_COHORTS.join(", ")}`);
  }
  return {
    ...(tenant_id ? { tenant_id } : {}),
    ...(cohort_value ? { cohort: cohort_value as AIRolloutCohort } : {}),
    executor: parse_executor(required_argument(args, "executor")),
    deployment_id: required_argument(args, "deployment"),
    reason: required_argument(args, "reason"),
    actor_clerk_user_id: required_argument(args, "actor-clerk-id"),
    expected_version: parse_expected_version(required_argument(args, "expected-version")),
  };
}

/** Serialize a manifest deterministically for signing and later verification. */
function canonical_manifest_payload(manifest: AIRolloutAssignmentManifest): string {
  return JSON.stringify({
    schema_version: manifest.schema_version,
    cohort: manifest.cohort,
    tenant_ids: [...manifest.tenant_ids],
    executor: manifest.executor,
    deployment_id: manifest.deployment_id,
    assignment_versions: Object.fromEntries(
      Object.entries(manifest.assignment_versions).sort(([left], [right]) => left.localeCompare(right)),
    ),
    reason: manifest.reason,
    generated_at: manifest.generated_at,
  });
}

/** Resolve, assign, and sign a tenant-list-based rollout request. */
export async function set_ai_rollout(
  request: SetAIRolloutRequest,
  ports: SetAIRolloutPorts,
): Promise<{ manifest: AIRolloutAssignmentManifest; signature: string }> {
  console.info("set_ai_rollout:start", { target: request.tenant_id ? "tenant" : request.cohort });
  const actor = await ports.resolve_super_admin(request.actor_clerk_user_id);
  if (!actor) throw new AIRolloutAuthorizationError();

  const resolved_tenants = request.tenant_id
    ? [request.tenant_id]
    : await ports.resolve_cohort_tenant_ids(request.cohort!);
  const tenant_ids = [...new Set(resolved_tenants)].sort();
  if (tenant_ids.length === 0) throw new Error("The rollout target resolves to no tenants");

  const now = ports.now();
  const assignment_versions: Record<string, number> = {};
  for (const tenant_id of tenant_ids) {
    const result = await ports.assign(
      {
        tenant_id,
        executor: request.executor,
        deployment_id: request.deployment_id,
        cohort: request.cohort ?? "internal",
        actor_profile_id: actor.profile_id,
        reason: request.reason,
        expected_version: request.expected_version,
      },
      now,
    );
    assignment_versions[tenant_id] = result.assignment.version;
  }

  const manifest: AIRolloutAssignmentManifest = Object.freeze({
    schema_version: "1",
    cohort: request.cohort ?? "internal",
    tenant_ids,
    executor: request.executor,
    deployment_id: request.deployment_id,
    assignment_versions: Object.freeze(assignment_versions),
    reason: request.reason.trim(),
    generated_at: now.toISOString(),
  });
  const signature = await ports.sign_manifest(canonical_manifest_payload(manifest));
  console.info("set_ai_rollout:success", { tenant_count: tenant_ids.length, executor: request.executor });
  return { manifest, signature };
}

/** Load an explicit tenant list for a named cohort from deployment configuration. */
function cohort_tenant_ids_from_environment(cohort: AIRolloutCohort): readonly string[] {
  const variable = `AI_ROLLOUT_COHORT_${cohort.toUpperCase()}_TENANT_IDS`;
  const value = process.env[variable];
  if (!value) throw new Error(`${variable} must contain the explicit comma-separated tenant list`);
  return value.split(",").map((tenant_id) => tenant_id.trim()).filter(Boolean);
}

/** Sign a canonical manifest with the deployment-held HMAC key. */
function sign_manifest_with_environment(canonical_payload: string): string {
  const key = process.env.AI_ROLLOUT_MANIFEST_SIGNING_KEY;
  if (!key) throw new Error("AI_ROLLOUT_MANIFEST_SIGNING_KEY is required");
  return `hmac-sha256:${createHmac("sha256", key).update(canonical_payload).digest("hex")}`;
}

/** Production CLI adapter; identity is resolved from Clerk ID to the internal profile. */
async function run_cli(): Promise<void> {
  const request = parse_set_ai_rollout_args(process.argv.slice(2));
  const { get_main_client_promise } = await import("@rnd-ai/shared-database");
  const client = await get_main_client_promise();
  try {
    const db = client.db();
    const repository = create_ai_rollout_repository(db);
    const profiles = create_user_profile_repository(db);
    const result = await set_ai_rollout(request, {
      async resolve_super_admin(clerk_user_id) {
        const profile = await profiles.find_active_by_clerk_user_id(clerk_user_id);
        return profile?.platformRole === "super_admin"
          ? { profile_id: profile._id.toString() }
          : null;
      },
      async resolve_cohort_tenant_ids(cohort) {
        return cohort_tenant_ids_from_environment(cohort);
      },
      assign: (input, now) => repository.assign(input, now),
      async sign_manifest(payload) {
        return sign_manifest_with_environment(payload);
      },
      now: () => new Date(),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await client.close();
  }
}

const invoked_directly = process.argv[1]?.endsWith("set-ai-rollout.ts") ?? false;
if (invoked_directly) {
  run_cli().catch((error) => {
    console.error("set-ai-rollout failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
