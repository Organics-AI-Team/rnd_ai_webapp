/**
 * Short-lived, tenant-bound authorization for knowledge uploads (G3.5).
 *
 * Public input contains only a source id. Every security-sensitive claim is
 * derived from a verified principal/context and server-side source/policy data,
 * then integrity-protected so ingestion can re-verify it after object upload.
 */

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

/** Stable upload authorization failure codes. */
export type UploadAuthorizationErrorCode =
  | "UPLOAD_AUTHORIZATION_INVALID"
  | "UPLOAD_AUTHORIZATION_EXPIRED"
  | "KNOWLEDGE_SOURCE_NOT_FOUND"
  | "KNOWLEDGE_SOURCE_NOT_QUARANTINED"
  | "KNOWLEDGE_UPLOAD_POLICY_INVALID";

/** Safe upload authorization error. */
export class UploadAuthorizationError extends Error {
  readonly code: UploadAuthorizationErrorCode;

  /**
   * Create a typed upload error.
   *
   * @param code - Stable safe error code.
   * @param message - Non-sensitive explanation.
   */
  constructor(code: UploadAuthorizationErrorCode, message: string) {
    super(message);
    this.name = "UploadAuthorizationError";
    this.code = code;
  }
}

const upload_request_schema = z
  .object({
    source_id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

const upload_claims_schema = z
  .object({
    tenant_id: z.string().min(1).max(128),
    actor_profile_id: z.string().min(1).max(128),
    source_id: z.string().min(1).max(128),
    object_key: z.string().min(1).max(1_024),
    maximum_bytes: z.number().int().positive(),
    allowed_detected_mime_types: z.array(z.string().min(1).max(200)).min(1).max(50),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();

/** Public request for a tenant knowledge upload authorization. */
export interface UploadAuthorizationRequest {
  readonly source_id: string;
}

/** Trusted identity claims used to issue an upload authorization. */
export interface UploadActorContext {
  readonly tenant_id: string;
  readonly actor_profile_id: string;
}

/** Signed claims re-verified by the ingestion service. */
export type UploadAuthorizationClaims = z.infer<typeof upload_claims_schema>;

/** Upload authorization returned to the authenticated caller. */
export interface IssuedUploadAuthorization extends UploadAuthorizationClaims {
  readonly token: string;
}

/** Integrity protection seam for upload claims. */
export interface UploadAuthorizationSigner {
  sign(claims: UploadAuthorizationClaims): Promise<string>;
  verify(token: string): Promise<UploadAuthorizationClaims>;
}

/** Minimal tenant source needed before authorizing an upload. */
export interface UploadAuthorizationSource {
  readonly source_id: string;
  readonly tenant_id: string;
  readonly status: string;
}

/** Tenant-scoped source persistence for upload authorization. */
export interface UploadAuthorizationSourcePort {
  get_tenant_source(
    tenant_id: string,
    source_id: string,
  ): Promise<UploadAuthorizationSource | null>;
  bind_upload(
    context: UploadActorContext,
    source_id: string,
    object_key: string,
  ): Promise<void>;
}

/** Server-side upload constraints for one tenant. */
export interface KnowledgeUploadPolicy {
  readonly maximum_bytes: number;
  readonly allowed_detected_mime_types: readonly string[];
}

/** Policy source for tenant upload constraints. */
export interface KnowledgeUploadPolicyPort {
  get_upload_policy(tenant_id: string): Promise<KnowledgeUploadPolicy>;
}

/** Dependencies for issuing an upload authorization. */
export interface UploadAuthorizationDeps {
  readonly source_port: UploadAuthorizationSourcePort;
  readonly policy_port: KnowledgeUploadPolicyPort;
  readonly signer: UploadAuthorizationSigner;
  readonly authorization_ttl_ms: number;
  readonly now?: () => Date;
}

/** Configuration for the HMAC signer. */
export interface HmacUploadAuthorizationOptions {
  readonly secret: string;
  readonly now?: () => Date;
}

/**
 * Parse the strict public upload authorization request.
 *
 * @param value - Untrusted JSON body.
 * @returns Valid request containing only source_id.
 */
export function parse_upload_authorization_request(
  value: unknown,
): UploadAuthorizationRequest {
  const parsed = upload_request_schema.parse(value);
  return { source_id: parsed.source_id };
}

/** Compute the URL-safe HMAC signature for a claims payload. */
function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Create a compact HMAC signer for upload claims.
 *
 * @param options - Secret and injectable clock.
 * @returns Sign/verify port with expiry enforcement.
 */
export function create_hmac_upload_authorization_signer(
  options: HmacUploadAuthorizationOptions,
): UploadAuthorizationSigner {
  const { secret } = options;
  const now = options.now ?? (() => new Date());
  if (secret.length < 24) {
    throw new UploadAuthorizationError(
      "UPLOAD_AUTHORIZATION_INVALID",
      "The upload authorization signing secret is not configured safely.",
    );
  }

  return {
    async sign(claims) {
      const valid_claims = upload_claims_schema.parse(claims);
      const payload = Buffer.from(JSON.stringify(valid_claims)).toString("base64url");
      return `${payload}.${signature(payload, secret)}`;
    },

    async verify(token) {
      try {
        const parts = token.split(".");
        if (parts.length !== 2) throw new Error("invalid token shape");
        const [payload, supplied_signature] = parts as [string, string];
        const expected_signature = signature(payload, secret);
        const supplied = Buffer.from(supplied_signature, "utf8");
        const expected = Buffer.from(expected_signature, "utf8");
        if (
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        ) {
          throw new Error("signature mismatch");
        }
        const claims = upload_claims_schema.parse(
          JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        );
        if (new Date(claims.expires_at).getTime() <= now().getTime()) {
          throw new UploadAuthorizationError(
            "UPLOAD_AUTHORIZATION_EXPIRED",
            "The upload authorization has expired.",
          );
        }
        return claims;
      } catch (error) {
        if (error instanceof UploadAuthorizationError) throw error;
        throw new UploadAuthorizationError(
          "UPLOAD_AUTHORIZATION_INVALID",
          "The upload authorization is invalid.",
        );
      }
    },
  };
}

/**
 * Issue a tenant- and actor-bound upload authorization.
 *
 * @param context - Identity derived from the verified request principal.
 * @param request - Strict request containing only the tracked source id.
 * @param deps - Tenant source, policy, signer, TTL, and clock.
 * @returns Signed claims safe to pass to the object-upload boundary.
 */
export async function issue_upload_authorization(
  context: UploadActorContext,
  request: UploadAuthorizationRequest,
  deps: UploadAuthorizationDeps,
): Promise<IssuedUploadAuthorization> {
  const input = parse_upload_authorization_request(request);
  const source = await deps.source_port.get_tenant_source(
    context.tenant_id,
    input.source_id,
  );
  if (!source || source.tenant_id !== context.tenant_id) {
    throw new UploadAuthorizationError(
      "KNOWLEDGE_SOURCE_NOT_FOUND",
      "The knowledge source was not found.",
    );
  }
  if (!new Set(["pending", "quarantined"]).has(source.status)) {
    throw new UploadAuthorizationError(
      "KNOWLEDGE_SOURCE_NOT_QUARANTINED",
      "The knowledge source is not accepting an upload.",
    );
  }
  const policy = await deps.policy_port.get_upload_policy(context.tenant_id);
  const allowed_mime_types = [...new Set(policy.allowed_detected_mime_types)];
  if (
    !Number.isSafeInteger(policy.maximum_bytes) ||
    policy.maximum_bytes <= 0 ||
    allowed_mime_types.length === 0 ||
    deps.authorization_ttl_ms <= 0
  ) {
    throw new UploadAuthorizationError(
      "KNOWLEDGE_UPLOAD_POLICY_INVALID",
      "The tenant upload policy is invalid.",
    );
  }
  const now = deps.now?.() ?? new Date();
  const object_key = `tenants/${context.tenant_id}/knowledge/${source.source_id}/source`;
  const claims: UploadAuthorizationClaims = {
    tenant_id: context.tenant_id,
    actor_profile_id: context.actor_profile_id,
    source_id: source.source_id,
    object_key,
    maximum_bytes: policy.maximum_bytes,
    allowed_detected_mime_types: allowed_mime_types,
    expires_at: new Date(now.getTime() + deps.authorization_ttl_ms).toISOString(),
  };
  const token = await deps.signer.sign(claims);
  await deps.source_port.bind_upload(context, source.source_id, object_key);
  return { ...claims, token };
}
