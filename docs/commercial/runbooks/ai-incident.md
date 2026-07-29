# Commercial AI Incident Runbook

Use this runbook for production incidents involving the commercial AI control
plane, governed run loop, providers, Clerk identity/webhooks, Qdrant retrieval,
usage metering, approvals, or tenant isolation. The platform operations page is
`/platform/operations/ai`; it contains aggregate metadata only and requires a
platform role.

## Severity and declaration

| Severity | Declare when | Initial response |
| --- | --- | --- |
| P0 | Cross-tenant disclosure, unauthorized commit, approval bypass, hard-budget bypass, active credential exposure, or uncontrolled writes | Stop rollout immediately, page incident commander and security, contain globally when scope is unknown |
| P1 | Error rate above 3% for 15 minutes, task success more than 5 percentage points below the approved candidate over 30 minutes, p95 latency above 2x SLO for 30 minutes, or a contained provider/Clerk/Qdrant outage | Pause promotion, assign incident commander and service owner, contain affected tenants/providers |
| P2 | Degraded non-critical telemetry, reconciliation drift without a hard-budget bypass, or an isolated recoverable dependency fault | Assign service owner, prevent promotion if monitoring is incomplete, remediate in business hours unless impact rises |

The first four P0 signals have no observation window. Treat a missing or stale
operations data source as monitoring unavailable: pause rollout changes until it
is restored. Record UTC detection time, incident ID, signal code, deployment and
version hashes, affected tenant IDs in the restricted incident system, and the
operator who declared the incident. Do not put tenant content or secrets in chat,
tickets, dashboards, or general incident notes.

## First 15 minutes

1. Name the incident commander, operations lead, communications lead, and
   scribe. Open a restricted incident record.
2. Stop the promotion workflow. Do not run `set-ai-rollout.ts` while the
   incident is active.
3. Review `/platform/operations/ai` for automatic stop signals, source
   freshness, aggregate error/task-success/latency health, and active incident
   metadata. Never request tenant content merely to confirm an aggregate signal.
4. For a P0 or unknown blast radius, have a `super_admin` invoke the authenticated
   `platformAiSettings.emergencyDisable({ disabled: true })` control. Do not edit
   `platform_ai_state` directly. Confirm `getConstraints()` reports
   `emergency_disabled: true` and that new governed runs fail closed.
5. Preserve immutable evidence before changing assignments or dependency
   configuration. Record who collected it and a SHA-256 hash for exported files.
6. Scope by content-free fields: incident/signal code, correlation ID, tenant
   pseudonym, run/deployment IDs, policy/prompt/tool versions, phase, stable error
   code, timing, token/cost counters, and evidence count.

## Tenant rollback

Use the exact current assignment version from the restricted operator view. A
stale compare-and-set failure is evidence of concurrent change; reload and
investigate it rather than overwriting it.

```bash
npx tsx apps/ai/scripts/rollback-ai-rollout.ts \
  --tenant='<tenant-id>' \
  --expected-version='<current-positive-version>' \
  --reason='<incident-id and approved rollback reason>' \
  --actor-clerk-id='<super-admin-clerk-user-id>'
```

Repeat for every affected tenant. Existing runs stay pinned to their accepted
executor; do not edit `AIRun.executor`. Verify new runs select the rolled-back
executor using the procedure in
[`ai-canary-rollback.md`](./ai-canary-rollback.md), then reconcile usage. If the
blast radius is unknown, keep the platform emergency disable active while
scoping and rolling back.

## Dependency containment

### Model provider or tool provider

- Keep the platform emergency disable active for uncontrolled provider writes,
  credential exposure, or unknown scope.
- Disable the affected provider/tool in the governed platform configuration and
  revoke exposed credentials in the provider control plane. Never paste the old
  or replacement credential into an incident record.
- Do not route to an unapproved fallback. Re-enable only a provider and model
  present in the approved platform/plan/tenant policy intersection.
- Preserve request IDs, response status, model/tool version, latency, token and
  cost counters, and stable error codes. Do not preserve raw prompts, documents,
  tool arguments, or model payloads in general telemetry.

### Clerk identity or webhook failure

- Do not bypass Clerk, mint substitute identities, or grant roles by direct
  database edit. Fail closed when identity freshness or signature validation is
  uncertain.
- Preserve webhook event IDs, event types, received/processed timestamps,
  delivery attempts, and stable errors. Do not retain session tokens, cookies,
  signing secrets, email addresses, or raw webhook bodies in incident notes.
- Repair signature verification or endpoint availability, then replay affected
  deliveries from Clerk's authenticated delivery tooling. Confirm idempotent
  processing and membership projection freshness before reopening traffic.

### Qdrant retrieval or isolation failure

- Disable the affected retrieval path. If cross-tenant retrieval is possible,
  classify as P0 and keep the global emergency disable active.
- Preserve collection/alias name, point IDs only when approved as restricted
  evidence, tenant-filter policy version, query timing, result count, and stable
  error. Never copy vectors, query text, payload content, or document excerpts
  into the operations dashboard or general incident record.
- Verify tenant filters against synthetic canaries and the approved isolation
  test suite before reconnecting. Re-index only from the authoritative governed
  source; do not copy suspect Qdrant payloads into a replacement collection.

## Tenant-content access

Aggregate operations do not authorize tenant-content access. If content is
strictly necessary for diagnosis:

1. A platform admin requests a grant through `platformSupportAccess.request`
   with the tenant, specific diagnostic reason, and `tenant:ai:read` only.
2. A different `super_admin` approves the shortest necessary duration through
   `platformSupportAccess.approve`; self-approval is prohibited.
3. Use only the granted tenant and permission, keep exports in the restricted
   evidence store, and audit every access.
4. Revoke through `platformSupportAccess.revoke` as soon as diagnosis ends; do
   not wait for expiry.

## Evidence preservation

Retain in the restricted incident store:

- signed rollout manifests, assignment/event versions, and evaluation hashes;
- deployment, orchestrator, policy, prompt, tool, and schema versions;
- immutable audit/usage ledger records and redacted commercial events;
- UTC command history and non-secret stdout/stderr;
- aggregate stop-signal measurements and source-freshness timestamps;
- dependency request/event IDs and credential-revocation audit records;
- hashes, collectors, collection times, access grants, and chain of custody for
  any separately authorized tenant-content evidence.

If redaction fails, discard the original field/event representation and retain
only `REDACTION_FAILURE` metadata with the field path. Never log the exception
message when it could contain the original value.

## Communications

- P0: notify security, privacy/legal, platform engineering, AI service owner,
  executive incident lead, and affected-tenant communications owner immediately.
- P1: notify platform engineering, AI service owner, support lead, and release
  owner; add security/privacy if isolation, identity, or credential scope changes.
- P2: notify the owning team and release owner. Escalate when impact or duration
  crosses a P1/P0 definition.
- External statements must be approved by the communications and privacy/legal
  owners. Share confirmed scope and actions; do not speculate or include another
  tenant's identifiers or content.

Post status at declaration, after containment, whenever scope/severity changes,
and at least every 30 minutes for P0 or 60 minutes for P1.

## Recovery and closure

Recovery requires all of the following:

1. Root cause is contained and regression/security tests pass.
2. The approved evaluation suite passes with evidence coverage and task success
   gates met; usage reconciliation has no unexplained reservation or actual drift.
3. Clerk projections/webhooks, provider/tool policy, Qdrant tenant filters, and
   audit/event pipelines are healthy for the full required monitoring window.
4. No automatic stop signal remains, operations sources are fresh, and a release
   owner plus security owner (for P0) approve recovery.
5. The `super_admin` invokes
   `platformAiSettings.emergencyDisable({ disabled: false })` only after those
   approvals. Resume with an explicit canary; never jump directly to full rollout.
6. Verify newly accepted runs, approval enforcement, tenant isolation, ledger
   settlement, and content-free event export. Revoke any support grants.

Within two business days for P0/P1, publish a blameless restricted postmortem
covering timeline, impact, detection gaps, root cause, containment, data-handling
assessment, corrective owners/dates, and tests/controls that prevent recurrence.
Link only redacted evidence references from broadly visible tracking systems.
