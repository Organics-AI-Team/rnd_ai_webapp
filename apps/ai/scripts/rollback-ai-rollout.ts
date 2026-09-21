/** Compare-and-set rollback of one tenant's AI rollout assignment. */

import {
  AIRolloutAuthorizationError,
  create_ai_rollout_repository,
  type AIRolloutMutationResult,
  type RollbackAIRolloutInput,
} from "../server/repositories/ai-rollout-repository";
import { create_user_profile_repository } from "../server/repositories/user-profile-repository";

/** Parsed rollback operator request. */
export interface RollbackAIRolloutRequest {
  readonly tenant_id: string;
  readonly expected_version: number;
  readonly reason: string;
  readonly actor_clerk_user_id: string;
}

/** Testable side-effect boundary for identity resolution and rollback. */
export interface RollbackAIRolloutPorts {
  readonly resolve_super_admin: (
    clerk_user_id: string,
  ) => Promise<{ profile_id: string } | null>;
  readonly rollback: (
    input: RollbackAIRolloutInput,
    now: Date,
  ) => Promise<AIRolloutMutationResult>;
  readonly now: () => Date;
}

/** Read one required CLI argument from an explicit argv list. */
function required_argument(args: readonly string[], name: string): string {
  const prefix = `--${name}=`;
  const value = args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim();
  if (!value) throw new Error(`Missing required argument ${prefix}<value>`);
  return value;
}

/** Parse rollback args, requiring an optimistic current version. */
export function parse_rollback_ai_rollout_args(args: readonly string[]): RollbackAIRolloutRequest {
  const expected_version = Number(required_argument(args, "expected-version"));
  if (!Number.isInteger(expected_version) || expected_version < 1) {
    throw new Error("--expected-version must be a positive integer");
  }
  return {
    tenant_id: required_argument(args, "tenant"),
    expected_version,
    reason: required_argument(args, "reason"),
    actor_clerk_user_id: required_argument(args, "actor-clerk-id"),
  };
}

/** Resolve the operator as super admin and execute one idempotent rollback. */
export async function rollback_ai_rollout(
  request: RollbackAIRolloutRequest,
  ports: RollbackAIRolloutPorts,
): Promise<AIRolloutMutationResult> {
  console.info("rollback_ai_rollout:start", { tenant_id: request.tenant_id, expected_version: request.expected_version });
  const actor = await ports.resolve_super_admin(request.actor_clerk_user_id);
  if (!actor) throw new AIRolloutAuthorizationError();
  const result = await ports.rollback(
    {
      tenant_id: request.tenant_id,
      expected_version: request.expected_version,
      actor_profile_id: actor.profile_id,
      reason: request.reason,
    },
    ports.now(),
  );
  console.info("rollback_ai_rollout:success", {
    tenant_id: request.tenant_id,
    assignment_version: result.assignment.version,
    replayed: result.replayed,
  });
  return result;
}

/** Production CLI adapter resolving the Clerk actor against internal state. */
async function run_cli(): Promise<void> {
  const request = parse_rollback_ai_rollout_args(process.argv.slice(2));
  const { get_main_client_promise } = await import("@rnd-ai/shared-database");
  const client = await get_main_client_promise();
  try {
    const db = client.db();
    const repository = create_ai_rollout_repository(db);
    const profiles = create_user_profile_repository(db);
    const result = await rollback_ai_rollout(request, {
      async resolve_super_admin(clerk_user_id) {
        const profile = await profiles.find_active_by_clerk_user_id(clerk_user_id);
        return profile?.platformRole === "super_admin"
          ? { profile_id: profile._id.toString() }
          : null;
      },
      rollback: (input, now) => repository.rollback(input, now),
      now: () => new Date(),
    });
    process.stdout.write(`${JSON.stringify({
      assignment_id: result.assignment._id.toString(),
      version: result.assignment.version,
      executor: result.assignment.executor,
      replayed: result.replayed,
    })}\n`);
  } finally {
    await client.close();
  }
}

const invoked_directly = process.argv[1]?.endsWith("rollback-ai-rollout.ts") ?? false;
if (invoked_directly) {
  run_cli().catch((error) => {
    console.error("rollback-ai-rollout failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
