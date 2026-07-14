# G0 AI Credential Rotation Evidence

## Current gate status

Local source containment is implemented, but provider-console rotation and old-key
revocation have not been performed or verified in this workspace. Every row below
therefore remains a release-blocking `PENDING_EXTERNAL_ROTATION` item. No credential
value, fingerprint, digest, or derived identifier belongs in this document.

## Rotation ledger

| Provider | Environment | Exposure basis | Status | Rotation timestamp | Verifier | Old-key revocation |
| --- | --- | --- | --- | --- | --- | --- |
| Google Gemini | Production deployments | Public build/runtime variable was present in tracked deployment configuration | `PENDING_EXTERNAL_ROTATION` | Not performed | Provider-console access not verified | `PENDING_EXTERNAL_ROTATION` |
| Google Gemini | Staging/preview deployments, if provisioned | Deployment inventory is pending | `PENDING_EXTERNAL_ROTATION` | Not performed | Provider-console access not verified | `PENDING_EXTERNAL_ROTATION` |
| Google Gemini | Developer/local environments | Previously documented public variable may have been copied locally | `PENDING_EXTERNAL_ROTATION` | Not performed | Environment-owner verification pending | `PENDING_EXTERNAL_ROTATION` |
| OpenAI | Production deployments | Public build/runtime variable was present in tracked deployment configuration | `PENDING_EXTERNAL_ROTATION` | Not performed | Provider-console access not verified | `PENDING_EXTERNAL_ROTATION` |
| OpenAI | Staging/preview deployments, if provisioned | Deployment inventory is pending | `PENDING_EXTERNAL_ROTATION` | Not performed | Provider-console access not verified | `PENDING_EXTERNAL_ROTATION` |
| OpenAI | Developer/local environments | Previously documented public variable may have been copied locally | `PENDING_EXTERNAL_ROTATION` | Not performed | Environment-owner verification pending | `PENDING_EXTERNAL_ROTATION` |
| Qdrant | Production deployments | Task gate requires rotation of the server credential used by deployed vector search | `PENDING_EXTERNAL_ROTATION` | Not performed | Provider-console access not verified | `PENDING_EXTERNAL_ROTATION` |
| Qdrant | Staging/preview deployments, if provisioned | Deployment inventory is pending | `PENDING_EXTERNAL_ROTATION` | Not performed | Provider-console access not verified | `PENDING_EXTERNAL_ROTATION` |
| Qdrant | Developer/local environments | Local authenticated-cluster copies require owner inventory | `PENDING_EXTERNAL_ROTATION` | Not performed | Environment-owner verification pending | `PENDING_EXTERNAL_ROTATION` |
| Google web search | Production deployments | Server web-search configuration is deployed alongside previously public AI credentials | `PENDING_EXTERNAL_ROTATION` | Not performed | Provider-console access not verified | `PENDING_EXTERNAL_ROTATION` |
| Google web search | Staging/preview deployments, if provisioned | Deployment inventory is pending | `PENDING_EXTERNAL_ROTATION` | Not performed | Provider-console access not verified | `PENDING_EXTERNAL_ROTATION` |
| Google web search | Developer/local environments | Local web-search credential copies require owner inventory | `PENDING_EXTERNAL_ROTATION` | Not performed | Environment-owner verification pending | `PENDING_EXTERNAL_ROTATION` |
| Pinecone (legacy) | Production deployments | A deprecated public Pinecone credential name was referenced by client components | `PENDING_EXTERNAL_ROTATION` | Not performed | Provider-console access not verified | `PENDING_EXTERNAL_ROTATION` |
| Pinecone (legacy) | Staging/preview deployments, if provisioned | Deployment inventory is pending | `PENDING_EXTERNAL_ROTATION` | Not performed | Provider-console access not verified | `PENDING_EXTERNAL_ROTATION` |
| Pinecone (legacy) | Developer/local environments | Deprecated credential copies require owner inventory and removal | `PENDING_EXTERNAL_ROTATION` | Not performed | Environment-owner verification pending | `PENDING_EXTERNAL_ROTATION` |

## External rotation runbook

1. Inventory every production, staging, preview, CI, and developer-owned environment
   that ever received one of the provider credentials. Record environment names only.
2. In each provider console, create a replacement credential with the minimum required
   scopes and restrictions. Do not paste the value into tickets, logs, chat, or evidence.
3. Set the replacement only in the deployment platform's server-runtime secret store
   under the private environment name, then redeploy the affected service.
4. Verify a server-side health check and one non-destructive provider request. The
   verifier records their identity and the actual UTC completion timestamp in this ledger.
5. Revoke the superseded credential in the provider console and verify that it no longer
   authenticates. Record only the revocation outcome, never the old credential or digest.
6. For an environment that never existed or never received a provider credential, replace
   its pending row only after an accountable owner verifies that fact.

## Release rule

G0 remains blocked while any row is `PENDING_EXTERNAL_ROTATION`. A row may be closed only
with a real UTC rotation timestamp, an identified verifier, and a verified old-key
revocation result (or an accountable verification that the credential was never deployed).
