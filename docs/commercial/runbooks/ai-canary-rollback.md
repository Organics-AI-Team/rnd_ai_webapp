# Tenant AI Canary and Rollback Runbook

This runbook changes executor selection only for **new runs**. The canary unit is
an explicit tenant list. Existing runs remain pinned to the executor, deployment,
assignment ID, and assignment version stored when the run was created.

## Preconditions

1. Use an active Clerk user whose internal `UserProfile.platformRole` is
   `super_admin`. The scripts resolve and re-check this role; a platform `admin`
   is insufficient.
2. Confirm the candidate `AgentDeployment` belongs to every target tenant and is
   `active`.
3. Set `DATABASE_URL` and a deployment-held
   `AI_ROLLOUT_MANIFEST_SIGNING_KEY`. Never paste either into evidence.
4. For a cohort, set its explicit tenant list. For example:

   ```bash
   export AI_ROLLOUT_COHORT_INTERNAL_TENANT_IDS='<tenant-id-1>,<tenant-id-2>'
   ```

   Supported cohort names are `internal`, `design_partner`, `5_percent`,
   `25_percent`, `50_percent`, and `all`. Percentage labels are stage names, not
   request-level random sampling.

## Observe before promotion

Record the current assignment version, candidate evaluation hash, error rate,
task-success delta, p95 latency/SLO ratio, budget exceptions, approval bypasses,
unauthorized commits, and isolation incidents for the full monitoring window.
Do not promote while any required source is unavailable.

Use a tenant-scoped read to capture current assignments and recent immutable
events (replace the placeholders in a secured operator shell):

```bash
mongosh "$DATABASE_URL" --quiet --eval '
const tenant = ObjectId("<tenant-id>");
printjson(db.ai_rollout_assignments.findOne({tenantId: tenant}));
printjson(db.ai_rollout_events.find({tenantId: tenant}).sort({occurredAt: -1}).limit(20).toArray());
'
```

## Promote

Initial assignment (`new`) for one tenant:

```bash
npx tsx apps/ai/scripts/set-ai-rollout.ts \
  --tenant='<tenant-id>' \
  --executor=agentic \
  --deployment='<active-deployment-id>' \
  --reason='<approved change record>' \
  --actor-clerk-id='<super-admin-clerk-user-id>' \
  --expected-version=new
```

Compare-and-set promotion for an explicit cohort (replace `3` with the reviewed
current version; cohort members must be at that version for this operation):

```bash
npx tsx apps/ai/scripts/set-ai-rollout.ts \
  --cohort=design_partner \
  --executor=agentic \
  --deployment='<active-deployment-id>' \
  --reason='<approved change record>' \
  --actor-clerk-id='<super-admin-clerk-user-id>' \
  --expected-version=3
```

Store the emitted JSON manifest and `hmac-sha256:` signature in release evidence.
The compatibility spelling `--executor=ooda` is accepted only at this CLI edge;
the persisted and runtime executor is always `agentic`.

## Automatic stop conditions

Pause promotion immediately when any one of these is observed:

- any cross-tenant disclosure;
- any unauthorized commit;
- any approval bypass;
- any hard-budget bypass;
- error rate greater than 3% for 15 continuous minutes;
- measured task success more than 5 percentage points below the approved
  candidate over the monitoring window;
- p95 latency greater than 2x the approved SLO for 30 continuous minutes.

The first four are severity-1 conditions: stop rollout, declare an incident,
preserve evidence, invoke the platform emergency-disable control when containment
requires it, and roll affected tenants back. Do not wait for a time window.

## Pause

Promotion is a manual, compare-and-set command; pausing means cancel the rollout
workflow and do not invoke `set-ai-rollout.ts` again. Pausing does not mutate
existing assignments and therefore cannot switch an in-flight run. Capture the
last signed manifest and current assignment versions before investigating.

## Roll back one tenant

Use the exact current assignment version observed immediately before rollback:

```bash
npx tsx apps/ai/scripts/rollback-ai-rollout.ts \
  --tenant='<tenant-id>' \
  --expected-version=4 \
  --reason='<incident or rollback record>' \
  --actor-clerk-id='<super-admin-clerk-user-id>'
```

Rollback is idempotent for an exact replay by the same actor and reason. A stale
or different mutation fails with `AI_ROLLOUT_VERSION_CONFLICT`; reload state and
investigate rather than overwriting another operator's change.

## Verify new-versus-pinned runs

After rollback, verify the assignment is `legacy` and `rolled_back`, then compare
a run created before rollback with one created after it:

```bash
mongosh "$DATABASE_URL" --quiet --eval '
const tenant = ObjectId("<tenant-id>");
printjson(db.ai_rollout_assignments.findOne({tenantId: tenant}));
printjson(db.ai_runs.find(
  {tenantId: tenant},
  {executor: 1, deploymentId: 1, rolloutAssignmentId: 1, rolloutAssignmentVersion: 1, createdAt: 1}
).sort({createdAt: -1}).limit(10).toArray());
'
```

Expected result: pre-rollback agentic runs remain `agentic`; only newly accepted
runs select `legacy`. Never edit an `AIRun.executor` to force rollback.

## Reconcile usage

Before closing the change, compare each affected run's reservation, actual, and
release entries in `ai_usage_ledger`; active reservation net must match genuinely
active runs, and terminal runs must net to actual usage. Execute the governed
budget reconciliation/expiry maintenance path for discrepancies. There is not
yet a standalone production usage-reconciliation CLI; record this as
`PENDING_G5_OPERATIONS_CLI` rather than performing a direct ledger write.

## Incident declaration and recovery

1. Open the severity-appropriate incident record and capture UTC detection time,
   affected tenant IDs, assignment versions, deployment ID, correlation IDs,
   stable error codes, and the last signed manifest. Do not copy prompts,
   retrieved content, secrets, or tenant business data into the incident record.
2. Pause promotion. For severity-1 signals, activate the existing super-admin
   emergency-disable control if rollback alone is not sufficient containment.
3. Run the rollback command for every affected tenant and preserve its output.
4. Verify pinned and new runs as above, reconcile usage, and confirm no new
   governed-loop runs are accepted for rolled-back tenants.
5. Re-enable promotion only after root-cause review, corrective tests, a passing
   evaluation report, and explicit release-owner approval.

## Evidence to retain

- signed assignment manifests and hashes;
- assignment/event versions before and after each transition;
- UTC command timestamps and non-secret stdout/stderr;
- deployment/evaluation/policy/prompt hashes;
- stop-condition measurements and incident IDs;
- pinned-run and usage-reconciliation verification results.
