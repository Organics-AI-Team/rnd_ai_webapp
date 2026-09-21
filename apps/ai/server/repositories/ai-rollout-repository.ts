/**
 * Tenant-stable AI rollout assignments and append-only rollout audit events.
 *
 * Mutations require an active platform super admin, use optimistic versions,
 * and write the assignment plus its audit event in one Mongo transaction.
 * Run selection is tenant-scoped and re-checks an agentic deployment is active.
 */

import {
  ObjectId,
  type ClientSession,
  type Db,
  type Document,
  type WithId,
} from "mongodb";

/** Canonical executors persisted by the v2 run gateway. */
export type AIRolloutExecutor = "agentic" | "legacy";

/** Operator-visible, tenant-list-based rollout stages. */
export const AI_ROLLOUT_COHORTS = [
  "internal",
  "design_partner",
  "5_percent",
  "25_percent",
  "50_percent",
  "all",
] as const;

/** Valid rollout cohort name. */
export type AIRolloutCohort = (typeof AI_ROLLOUT_COHORTS)[number];

/** Stored mutable assignment; every mutation has a matching immutable event. */
export interface AIRolloutAssignmentDocument extends Document {
  readonly tenantId: ObjectId;
  readonly executor: AIRolloutExecutor;
  readonly deploymentId: ObjectId;
  readonly cohort: AIRolloutCohort;
  readonly status: "active" | "rolled_back";
  readonly assignedByProfileId: ObjectId;
  readonly reason: string;
  readonly activatedAt: Date;
  readonly rolledBackAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Input shared by initial assignment and compare-and-set promotion/update. */
export interface AssignAIRolloutInput {
  readonly tenant_id: string;
  readonly executor: AIRolloutExecutor;
  readonly deployment_id: string;
  readonly cohort: AIRolloutCohort;
  readonly actor_profile_id: string;
  readonly reason: string;
  readonly expected_version: number | null;
}

/** Compare-and-set rollback input. */
export interface RollbackAIRolloutInput {
  readonly tenant_id: string;
  readonly expected_version: number;
  readonly actor_profile_id: string;
  readonly reason: string;
}

/** Assignment mutation result, including whether the operation was replayed. */
export interface AIRolloutMutationResult {
  readonly assignment: WithId<AIRolloutAssignmentDocument>;
  readonly replayed: boolean;
}

/** Rollout persistence and selection boundary. */
export interface AIRolloutRepository {
  assign(input: AssignAIRolloutInput, now: Date): Promise<AIRolloutMutationResult>;
  rollback(input: RollbackAIRolloutInput, now: Date): Promise<AIRolloutMutationResult>;
  select_for_run(tenant_id: string): Promise<WithId<AIRolloutAssignmentDocument>>;
}

/** Base class for rollout failures with a stable machine code. */
class AIRolloutError extends Error {
  constructor(
    readonly code: string,
    safe_message: string,
  ) {
    super(safe_message);
    this.name = new.target.name;
  }
}

/** The actor is not an active super admin. */
export class AIRolloutAuthorizationError extends AIRolloutError {
  constructor() {
    super("AI_ROLLOUT_FORBIDDEN", "An active super administrator is required.");
  }
}

/** An assignment is absent or not selectable. */
export class AIRolloutAssignmentNotFoundError extends AIRolloutError {
  constructor() {
    super("AI_ROLLOUT_ASSIGNMENT_NOT_FOUND", "No selectable rollout assignment exists for this tenant.");
  }
}

/** The expected assignment version does not match current state. */
export class AIRolloutConflictError extends AIRolloutError {
  constructor() {
    super("AI_ROLLOUT_VERSION_CONFLICT", "The rollout assignment changed; reload it before retrying.");
  }
}

/** An agentic assignment references a missing, cross-tenant, or inactive deployment. */
export class AIRolloutDeploymentUnavailableError extends AIRolloutError {
  constructor() {
    super("AI_ROLLOUT_DEPLOYMENT_UNAVAILABLE", "The selected agent deployment is not active for this tenant.");
  }
}

/** Rollout input contains a malformed identifier, cohort, version, or reason. */
export class AIRolloutInputError extends AIRolloutError {
  constructor() {
    super("AI_ROLLOUT_INPUT_INVALID", "The rollout operation input is invalid.");
  }
}

/** Parse an external identifier and fail before any datastore access. */
function required_object_id(value: string): ObjectId {
  if (!ObjectId.isValid(value)) throw new AIRolloutInputError();
  return new ObjectId(value);
}

/** Normalize and bound an operator reason recorded in the audit log. */
function required_reason(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 3 || normalized.length > 500) throw new AIRolloutInputError();
  return normalized;
}

/** Verify an actor is currently an active platform super admin. */
async function require_super_admin(
  db: Db,
  actor_profile_id: ObjectId,
  session: ClientSession,
): Promise<void> {
  const actor = await db.collection("user_profiles").findOne(
    {
      _id: actor_profile_id,
      status: "active",
      platformRole: "super_admin",
    },
    { session, projection: { _id: 1 } },
  );
  if (!actor) throw new AIRolloutAuthorizationError();
}

/** Verify an agentic deployment is active and belongs to the selected tenant. */
async function require_active_deployment(
  db: Db,
  tenant_id: ObjectId,
  deployment_id: ObjectId,
  session?: ClientSession,
): Promise<void> {
  const deployment = await db.collection("agent_deployments").findOne(
    { _id: deployment_id, tenantId: tenant_id, status: "active" },
    { session, projection: { _id: 1 } },
  );
  if (!deployment) throw new AIRolloutDeploymentUnavailableError();
}

/** Run a write operation in a Mongo transaction and always close its session. */
async function in_transaction<T>(
  db: Db,
  operation: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = db.client.startSession();
  try {
    let value: T | undefined;
    await session.withTransaction(async () => {
      value = await operation(session);
    });
    return value as T;
  } finally {
    await session.endSession();
  }
}

/** Create a deterministic event idempotency key from one assignment transition. */
function event_idempotency_key(
  tenant_id: ObjectId,
  event_type: "assigned" | "updated" | "rolled_back",
  to_version: number,
): string {
  return `ai-rollout:${tenant_id.toHexString()}:${event_type}:v${to_version}`;
}

/** Convert a Mongo document into the typed assignment representation. */
function typed_assignment(value: WithId<Document>): WithId<AIRolloutAssignmentDocument> {
  return value as WithId<AIRolloutAssignmentDocument>;
}

/**
 * Create the tenant rollout repository bound to one database.
 *
 * @param db - Connected Mongo database whose client supports transactions.
 * @returns Tenant-scoped rollout repository.
 */
export function create_ai_rollout_repository(db: Db): AIRolloutRepository {
  const assignments = db.collection("ai_rollout_assignments");
  const events = db.collection("ai_rollout_events");

  return {
    async assign(input, now) {
      const tenant_id = required_object_id(input.tenant_id);
      const deployment_id = required_object_id(input.deployment_id);
      const actor_profile_id = required_object_id(input.actor_profile_id);
      const reason = required_reason(input.reason);
      if (!AI_ROLLOUT_COHORTS.includes(input.cohort)) throw new AIRolloutInputError();
      if (input.expected_version !== null && (!Number.isInteger(input.expected_version) || input.expected_version < 1)) {
        throw new AIRolloutInputError();
      }

      return in_transaction(db, async (session) => {
        await require_super_admin(db, actor_profile_id, session);
        if (input.executor === "agentic") {
          await require_active_deployment(db, tenant_id, deployment_id, session);
        }

        const current = await assignments.findOne({ tenantId: tenant_id }, { session });
        if (input.expected_version === null ? Boolean(current) : current?.version !== input.expected_version) {
          throw new AIRolloutConflictError();
        }

        const from_version = current?.version ?? 0;
        const to_version = from_version + 1;
        const stored = {
          tenantId: tenant_id,
          executor: input.executor,
          deploymentId: deployment_id,
          cohort: input.cohort,
          status: "active",
          assignedByProfileId: actor_profile_id,
          reason,
          activatedAt: now,
          rolledBackAt: null,
          version: to_version,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        };

        let assignment: WithId<Document> | null;
        if (!current) {
          const inserted = await assignments.insertOne(stored, { session });
          assignment = { _id: inserted.insertedId, ...stored };
        } else {
          assignment = await assignments.findOneAndUpdate(
            { _id: current._id, tenantId: tenant_id, version: from_version },
            { $set: stored },
            { session, returnDocument: "after" },
          );
          if (!assignment) throw new AIRolloutConflictError();
        }

        const event_type = current ? "updated" : "assigned";
        await events.insertOne(
          {
            tenantId: tenant_id,
            assignmentId: assignment._id,
            eventType: event_type,
            executor: input.executor,
            deploymentId: deployment_id,
            cohort: input.cohort,
            actorProfileId: actor_profile_id,
            reason,
            fromVersion: from_version,
            toVersion: to_version,
            occurredAt: now,
            idempotencyKey: event_idempotency_key(tenant_id, event_type, to_version),
          },
          { session },
        );

        return { assignment: typed_assignment(assignment), replayed: false };
      });
    },

    async rollback(input, now) {
      const tenant_id = required_object_id(input.tenant_id);
      const actor_profile_id = required_object_id(input.actor_profile_id);
      const reason = required_reason(input.reason);
      if (!Number.isInteger(input.expected_version) || input.expected_version < 1) {
        throw new AIRolloutInputError();
      }

      return in_transaction(db, async (session) => {
        await require_super_admin(db, actor_profile_id, session);
        const current = await assignments.findOne({ tenantId: tenant_id }, { session });
        if (!current) throw new AIRolloutAssignmentNotFoundError();

        if (
          current.executor === "legacy" &&
          current.status === "rolled_back" &&
          current.version === input.expected_version + 1
        ) {
          const prior_event = await events.findOne(
            {
              tenantId: tenant_id,
              eventType: "rolled_back",
              fromVersion: input.expected_version,
              toVersion: current.version,
              actorProfileId: actor_profile_id,
              reason,
            },
            { session },
          );
          if (prior_event) {
            return { assignment: typed_assignment(current), replayed: true };
          }
        }

        if (current.version !== input.expected_version) throw new AIRolloutConflictError();
        const to_version = input.expected_version + 1;
        const assignment = await assignments.findOneAndUpdate(
          { _id: current._id, tenantId: tenant_id, version: input.expected_version },
          {
            $set: {
              executor: "legacy",
              status: "rolled_back",
              reason,
              rolledBackAt: now,
              version: to_version,
              updatedAt: now,
            },
          },
          { session, returnDocument: "after" },
        );
        if (!assignment) throw new AIRolloutConflictError();

        await events.insertOne(
          {
            tenantId: tenant_id,
            assignmentId: assignment._id,
            eventType: "rolled_back",
            executor: "legacy",
            deploymentId: assignment.deploymentId,
            cohort: assignment.cohort,
            actorProfileId: actor_profile_id,
            reason,
            fromVersion: input.expected_version,
            toVersion: to_version,
            occurredAt: now,
            idempotencyKey: event_idempotency_key(tenant_id, "rolled_back", to_version),
          },
          { session },
        );
        return { assignment: typed_assignment(assignment), replayed: false };
      });
    },

    async select_for_run(tenant_id_value) {
      const tenant_id = required_object_id(tenant_id_value);
      const assignment = await assignments.findOne({ tenantId: tenant_id });
      if (!assignment || !["active", "rolled_back"].includes(String(assignment.status))) {
        throw new AIRolloutAssignmentNotFoundError();
      }
      if (assignment.executor === "agentic") {
        if (assignment.status !== "active") throw new AIRolloutAssignmentNotFoundError();
        await require_active_deployment(db, tenant_id, assignment.deploymentId as ObjectId);
      } else if (assignment.executor !== "legacy") {
        throw new AIRolloutAssignmentNotFoundError();
      }
      return typed_assignment(assignment);
    },
  };
}
