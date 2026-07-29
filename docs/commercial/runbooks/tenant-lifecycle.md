# Tenant lifecycle operations

Tenant export, suspension, deletion, and retention are platform operations for
a verified **super administrator**. The router derives the actor profile from
the authenticated server principal; job payloads never accept actor identity,
roles, permissions, credentials, or tenant access grants from a client.

## Shared controls

- Assign a unique job ID. Receipt keys are `operation + tenant + job`, so every
  operation is tenant-scoped and idempotent. Replaying a completed job returns
  the original report. A resumed deletion skips only phases with durable
  receipts; external adapters must also honor the job ID if a crash occurs
  between an external action and its receipt write.
- Every Mongo, vector, object, identity, and projection operation must use a
  mandatory tenant filter. Unscoped `deleteMany`, Qdrant deletion without a
  tenant payload filter, and object deletion outside `tenants/<tenant>/` are
  prohibited.
- Reports contain per-phase scanned, deleted, skipped, and error counts. They
  contain identifiers and hashes, never exported record content or credentials.

## Export

1. Load business data through tenant repositories and knowledge data through
   the governed knowledge boundary at the job's point-in-time timestamp.
2. Reject any record explicitly carrying another tenant ID.
3. Build collection counts and SHA-256 hashes, then hash the complete manifest.
4. Encrypt the complete JSON artifact using the approved envelope-encryption
   adapter. Store only ciphertext below `tenants/<tenant>/exports/<job>` with a
   short expiry.
5. Audit the export actor and tenant. Never log or place exported content in the
   lifecycle receipt.

## Suspension

Suspension is fail-closed and ordered: mark the Tenant suspended first, then
block new sessions, block new AI reservations and writes, and suspend or revoke
memberships according to policy. Existing audit events, approvals, checkpoints,
and usage-ledger evidence are preserved. No suspension phase deletes evidence.

## Deletion

Before an unfinished deletion, verify the Tenant is suspended and check legal
hold. An active **legal hold** stops the job before any destructive phase.
Completed receipts remain replayable even if a hold is applied later.

The required phase order is:

1. `content/artifacts/checkpoints`
2. Qdrant points using an exact tenant filter, followed by a zero-remaining check
3. object storage using the tenant prefix and manifest
4. Clerk memberships and organization
5. internal membership, invitation, identity, policy, and deployment projections
6. immutable tenant tombstone

If a dependency fails, correct it and replay the same job ID. Previously
receipted phases are not repeated. Do not create a tombstone until every prior
system has completed and Qdrant verifies zero remaining tenant points.

## Retention

Retention uses the shorter of the platform and tenant window. It scans only the
target tenant and supplies `preserve_legal_holds=true`; held records are counted
as skipped, never deleted. Review scanned/deleted/skipped/error counts before
accepting the receipt. A non-zero error count makes the report unverified.

## Production integration checklist

- Provide transactional Mongo receipt and tenant-repository adapters.
- Provide Qdrant, object-storage encryption, and Clerk adapters with job-level
  idempotency and tenant-filter assertions.
- Register the independently constructed router in the central application
  router only after those adapters are configured.
- Rehearse export decryption/expiry, partial deletion resume, legal-hold denial,
  and tenant-B non-interference in staging before commercial release.
