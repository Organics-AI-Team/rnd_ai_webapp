/**
 * POST /api/knowledge/uploads — authorize a quarantined tenant upload (G3.5).
 *
 * The route verifies tenant:knowledge:manage, derives tenant and actor from the
 * verified principal, and accepts only a source id. It never accepts an object
 * key, byte ceiling, MIME allowlist, tenant id, or actor id from the caller.
 */

import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import client_promise from "@rnd-ai/shared-database";
import { ObjectId, type Db } from "mongodb";

import { with_request_principal } from "@/lib/server/with-request-principal";
import { resolve_tenant_context } from "@/lib/server/tenant-context-route";
import { create_knowledge_source_repository } from "@/server/repositories/knowledge-source-repository";
import {
  UploadAuthorizationError,
  create_hmac_upload_authorization_signer,
  issue_upload_authorization,
  parse_upload_authorization_request,
  type KnowledgeUploadPolicyPort,
} from "@/server/services/knowledge/upload-authorization";

/** Node runtime is required for MongoDB and HMAC signing. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAXIMUM_BYTES = 25 * 1024 * 1024;
const DEFAULT_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ALLOWED_MIME_TYPES = Object.freeze([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** Convert a Mongo numeric value into a safe positive JavaScript number. */
function safe_number(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (
    typeof value === "bigint" &&
    value > BigInt(0) &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(value);
  }
  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  ) {
    const converted = value.toNumber();
    return Number.isSafeInteger(converted) && converted > 0 ? converted : null;
  }
  return null;
}

/** Read a positive integer environment setting with a safe server default. */
function positive_env(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Build the tenant AI profile-backed upload policy port. */
function upload_policy_port(db: Db): KnowledgeUploadPolicyPort {
  return {
    async get_upload_policy(tenant_id) {
      const tenant_values: Array<string | ObjectId> = [tenant_id];
      if (ObjectId.isValid(tenant_id)) tenant_values.push(new ObjectId(tenant_id));
      const profile = await db.collection("tenant_ai_profiles").findOne({
        tenantId: { $in: tenant_values },
        status: "active",
      });
      const storage_limit = safe_number(profile?.knowledgeStorageLimitBytes);
      if (!storage_limit) {
        throw new UploadAuthorizationError(
          "KNOWLEDGE_UPLOAD_POLICY_INVALID",
          "The tenant knowledge upload policy is unavailable.",
        );
      }
      const configured_maximum = positive_env(
        "KNOWLEDGE_UPLOAD_MAX_BYTES",
        DEFAULT_MAXIMUM_BYTES,
      );
      const configured_mime_types = (
        process.env.KNOWLEDGE_UPLOAD_ALLOWED_MIME_TYPES ?? ""
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      return {
        maximum_bytes: Math.min(configured_maximum, storage_limit),
        allowed_detected_mime_types:
          configured_mime_types.length > 0
            ? configured_mime_types
            : DEFAULT_ALLOWED_MIME_TYPES,
      };
    },
  };
}

/** Map a safe upload service failure to an HTTP response. */
function upload_error_response(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "UPLOAD_REQUEST_INVALID", message: "A valid source_id is required." },
      { status: 400 },
    );
  }
  if (error instanceof UploadAuthorizationError) {
    const status =
      error.code === "KNOWLEDGE_SOURCE_NOT_FOUND"
        ? 404
        : error.code === "KNOWLEDGE_SOURCE_NOT_QUARANTINED"
          ? 409
          : 503;
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status },
    );
  }
  console.error("[knowledge-upload] authorization failed safely");
  return NextResponse.json(
    {
      error: "KNOWLEDGE_UPLOAD_UNAVAILABLE",
      message: "Knowledge upload authorization is temporarily unavailable.",
    },
    { status: 503 },
  );
}

/**
 * Issue a tenant knowledge upload authorization.
 *
 * @param request - Authenticated request carrying only source_id.
 * @returns 201 with signed upload claims, or a safe 4xx/5xx response.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return with_request_principal(
    request,
    "tenant:knowledge:manage",
    async (principal, body) => {
      const scope = resolve_tenant_context(principal);
      if (scope.status === "error") return scope.response;
      try {
        const secret = process.env.KNOWLEDGE_UPLOAD_AUTH_SECRET ?? "";
        const db = (await client_promise).db();
        const authorization = await issue_upload_authorization(
          {
            tenant_id: scope.tenant.tenant_id,
            actor_profile_id: scope.tenant.actor_profile_id,
          },
          parse_upload_authorization_request(body),
          {
            source_port: create_knowledge_source_repository(db),
            policy_port: upload_policy_port(db),
            signer: create_hmac_upload_authorization_signer({ secret }),
            authorization_ttl_ms: positive_env(
              "KNOWLEDGE_UPLOAD_AUTH_TTL_MS",
              DEFAULT_AUTHORIZATION_TTL_MS,
            ),
          },
        );
        return NextResponse.json(authorization, { status: 201 });
      } catch (error) {
        return upload_error_response(error);
      }
    },
  );
}
