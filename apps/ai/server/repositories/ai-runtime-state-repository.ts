/** Persistence reads used to rebuild and continuously authorize one AI run. */

import { ObjectId, type Db, type Document, type WithId } from "mongodb";
import { TENANT_ROLE_PERMISSIONS, type Permission, type TenantRole } from "@rnd-ai/shared-types";
import type { CurrentRunAuthorizationState } from "../services/ai-control/runtime-policy-engine";

function identifier_values(value: string): Array<string | ObjectId> {
  return ObjectId.isValid(value) ? [value, new ObjectId(value)] : [value];
}

function identifier_filter(field: string, value: string): Document {
  return { [field]: { $in: identifier_values(value) } };
}

/** Current member identity projected from trusted server collections. */
export interface RuntimeMemberIdentity {
  readonly clerk_user_id: string;
  readonly membership_id: string;
  readonly tenant_role: TenantRole;
  readonly permissions: readonly Permission[];
}

/** Exact active deployment record used to validate every stored run pin. */
export interface RuntimeDeploymentRecord {
  readonly document: WithId<Document>;
  readonly deployment_id: string;
  readonly revision: number;
  readonly agent_definition_version: string;
  readonly orchestrator_version: string;
  readonly prompt_version_id: string;
  readonly input_schema_version: string;
  readonly output_schema_version: string;
}

export interface CurrentAuthorizationQuery {
  readonly tenant_id: string;
  readonly actor_profile_id: string;
  readonly run_id: string;
  readonly deployment_id: string;
  readonly agent_key: string;
  readonly reservation_id: string;
}

export interface AIRuntimeStateRepository {
  load_member_identity(
    tenant_id: string,
    actor_profile_id: string,
  ): Promise<RuntimeMemberIdentity | null>;
  load_active_deployment(
    tenant_id: string,
    deployment_id: string,
    agent_key: string,
  ): Promise<RuntimeDeploymentRecord | null>;
  load_current_authorization(
    query: CurrentAuthorizationQuery,
  ): Promise<CurrentRunAuthorizationState>;
}

function role(value: unknown): TenantRole | null {
  return value === "manager" || value === "user" ? value : null;
}

/** Create the sanctioned runtime-state reader over control-plane collections. */
export function create_ai_runtime_state_repository(db: Db): AIRuntimeStateRepository {
  const profiles = db.collection("user_profiles");
  const memberships = db.collection("tenant_membership_projections");
  const tenant_ai_profiles = db.collection("tenant_ai_profiles");
  const deployments = db.collection("agent_deployments");
  const platform_state = db.collection("platform_ai_state");
  const usage = db.collection("ai_usage_ledger");

  async function load_member_identity(
    tenant_id: string,
    actor_profile_id: string,
  ): Promise<RuntimeMemberIdentity | null> {
    const [profile, membership] = await Promise.all([
      profiles.findOne({
        ...identifier_filter("_id", actor_profile_id),
        status: "active",
      }),
      memberships.findOne({
        ...identifier_filter("tenantId", tenant_id),
        ...identifier_filter("userProfileId", actor_profile_id),
        status: "active",
      }),
    ]);
    const tenant_role = role(membership?.tenantRole);
    if (!profile || !membership || !tenant_role) return null;
    return {
      clerk_user_id: String(profile.clerkUserId ?? ""),
      membership_id: String(membership._id),
      tenant_role,
      permissions: TENANT_ROLE_PERMISSIONS[tenant_role],
    };
  }

  async function load_active_deployment(
    tenant_id: string,
    deployment_id: string,
    agent_key: string,
  ): Promise<RuntimeDeploymentRecord | null> {
    const document = await deployments.findOne({
      ...identifier_filter("_id", deployment_id),
      ...identifier_filter("tenantId", tenant_id),
      agentKey: agent_key,
      status: "active",
    });
    if (!document) return null;
    return {
      document,
      deployment_id: String(document._id),
      revision: Number(document.revision),
      agent_definition_version: String(document.agentDefinitionVersion ?? ""),
      orchestrator_version: String(document.orchestratorVersion ?? ""),
      prompt_version_id: String(document.promptVersionId ?? ""),
      input_schema_version: String(document.inputSchemaVersion ?? ""),
      output_schema_version: String(document.outputSchemaVersion ?? ""),
    };
  }

  return {
    load_member_identity,
    load_active_deployment,

    async load_current_authorization(query) {
      const [state, tenant_profile, member, deployment, reservation, release] =
        await Promise.all([
          platform_state.findOne({ key: "singleton" }),
          tenant_ai_profiles.findOne({
            ...identifier_filter("tenantId", query.tenant_id),
            status: "active",
          }),
          load_member_identity(query.tenant_id, query.actor_profile_id),
          load_active_deployment(
            query.tenant_id,
            query.deployment_id,
            query.agent_key,
          ),
          usage.findOne({
            ...identifier_filter("_id", query.reservation_id),
            ...identifier_filter("tenantId", query.tenant_id),
            ...identifier_filter("runId", query.run_id),
            kind: "reservation",
          }),
          usage.findOne({
            ...identifier_filter("tenantId", query.tenant_id),
            ...identifier_filter("runId", query.run_id),
            ...identifier_filter("reservationId", query.reservation_id),
            kind: "release",
          }),
        ]);
      return {
        emergency_disabled: Boolean(state?.emergencyDisabled),
        tenant_ai_active: tenant_profile !== null,
        deployment_active: deployment !== null,
        membership_active: member !== null,
        reservation_open: reservation !== null && release === null,
        permissions: member?.permissions ?? [],
      };
    },
  };
}
