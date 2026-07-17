import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import client_promise from "@rnd-ai/shared-database";
import type { Permission, RequestPrincipal } from "@rnd-ai/shared-types";

import { AuthorizationError } from "@/server/auth/errors";
import { require_permission } from "@/server/auth/authorize";
import {
  resolve_legacy_principal,
  type LegacyIdentityStore,
} from "@/server/auth/legacy-principal-resolver";
import { create_legacy_identity_store } from "@/server/auth/mongo-legacy-identity-store";
import { resolve_clerk_principal } from "@/server/auth/clerk-principal-resolver";
import { create_identity_projection_repositories } from "@/server/auth/identity-repositories";
import { is_clerk_cutover } from "./clerk-config";

/**
 * Handler signature for guarded direct API routes. The body has already been
 * parsed and screened for identity fields; identity comes only from the
 * verified principal.
 */
export type GuardedRouteHandler = (
  principal: RequestPrincipal,
  body: unknown,
) => Promise<Response>;

/**
 * JSON keys that may never appear in a request body: identity is derived from
 * the verified session, never from client input. Compared case-insensitively
 * and without separators so variants like user_id/userId/USERID all match.
 */
const FORBIDDEN_IDENTITY_KEYS = new Set([
  "userid",
  "orgid",
  "organizationid",
  "tenantid",
  "actorid",
  "accountid",
]);

/**
 * Normalize a JSON key for identity screening (lowercase, no separators).
 *
 * @param key - Raw object key from the request body.
 * @returns Canonical key used against FORBIDDEN_IDENTITY_KEYS.
 */
function canonical_key(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

/**
 * Recursively locate the first forbidden identity field in a JSON value.
 *
 * @param value - Parsed request body value.
 * @param path - Accumulated object path for error reporting.
 * @returns Dotted path of the offending key, or null when clean.
 */
export function find_identity_field(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = find_identity_field(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const key_path = path ? `${path}.${key}` : key;
      if (FORBIDDEN_IDENTITY_KEYS.has(canonical_key(key))) {
        return key_path;
      }
      const found = find_identity_field(child, key_path);
      if (found) return found;
    }
  }
  return null;
}

let identity_store_override: LegacyIdentityStore | null = null;

/**
 * Inject a fake identity store for tests. Never call from production code;
 * the default store is created lazily from the shared MongoDB client.
 *
 * @param store - In-memory store fake, or null to restore the default.
 */
export function set_identity_store_for_testing(
  store: LegacyIdentityStore | null,
): void {
  identity_store_override = store;
}

/**
 * Resolve the verified request principal. After the Clerk cutover only the
 * Clerk resolver runs (session values from await auth(), projections from
 * the internal repositories); before it, only the G0 legacy cookie resolver
 * runs. The chosen resolver is logged for request audit.
 *
 * @param request - Incoming route request.
 * @returns The verified principal.
 * @throws AuthorizationError when the session is absent, invalid, or the
 *         membership is inactive.
 */
export async function resolve_request_principal(
  request: NextRequest,
): Promise<RequestPrincipal> {
  if (is_clerk_cutover()) {
    const auth_state = await auth();
    const repositories = create_identity_projection_repositories(
      (await client_promise).db(),
    );
    console.info({ boundary: "route-guard", resolver_used: "clerk" });
    return resolve_clerk_principal(
      {
        userId: auth_state.userId,
        orgId: auth_state.orgId ?? null,
        orgRole: auth_state.orgRole ?? null,
        sessionId: auth_state.sessionId ?? null,
      },
      repositories,
    );
  }
  const token = request.cookies.get("auth_token")?.value ?? "";
  const store =
    identity_store_override ??
    create_legacy_identity_store((await client_promise).db());
  console.info({ boundary: "route-guard", resolver_used: "legacy" });
  return resolve_legacy_principal(token, store);
}

/**
 * Build a stable JSON error response for the route guard.
 *
 * @param status - HTTP status code.
 * @param code - Stable machine-readable error code.
 * @param message - Safe human-readable message.
 * @returns JSON NextResponse.
 */
function error_response(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
}

/**
 * Guard a direct API route handler: verify the legacy session, assert one
 * named permission, reject client-supplied identity fields anywhere in the
 * JSON body, and invoke the handler with the verified principal.
 *
 * @param request - Incoming route request.
 * @param permission - Named permission this route requires.
 * @param handler - Business handler receiving (principal, parsed body).
 * @returns Handler response, or 401/403/400 when the guard rejects.
 */
export async function with_request_principal(
  request: NextRequest,
  permission: Permission,
  handler: GuardedRouteHandler,
): Promise<Response> {
  let principal: RequestPrincipal;
  try {
    principal = await resolve_request_principal(request);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      // Typed rejections were previously silent and FORBIDDEN collapsed to a
      // generic 401, hiding authorization causes (e.g. an unprovisioned
      // organization) behind "Authentication is required.".
      console.warn({
        boundary: "route-guard",
        auth_error: error.code,
        message: error.message,
      });
      if (error.code === "MEMBERSHIP_INACTIVE") {
        return error_response(403, "MEMBERSHIP_INACTIVE", "Membership is not active.");
      }
      if (error.code === "FORBIDDEN") {
        return error_response(
          403,
          "FORBIDDEN",
          error.message || "Access to this resource is forbidden.",
        );
      }
      return error_response(401, "UNAUTHENTICATED", "Authentication is required.");
    }
    console.error("[route-guard] principal resolution failed:", error);
    return error_response(401, "UNAUTHENTICATED", "Authentication is required.");
  }

  try {
    require_permission(principal, permission);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error_response(403, "FORBIDDEN", error.message);
    }
    throw error;
  }

  let body: unknown = null;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const identity_field = find_identity_field(body);
    if (identity_field) {
      return error_response(
        400,
        "IDENTITY_FIELD_NOT_ALLOWED",
        `Client-supplied identity field is not allowed: ${identity_field}`,
      );
    }
  }

  return handler(principal, body);
}
