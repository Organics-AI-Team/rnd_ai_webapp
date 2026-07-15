/**
 * Shared tenant-context resolution for direct API routes (G4.9g).
 *
 * The run routes each need the same step after with_request_principal: turn the
 * verified principal into a frozen TenantExecutionContext, or fail closed with a
 * 403 when the membership cannot scope a tenant. Factored here so the three run
 * routes stay thin and identical.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import { NextResponse } from "next/server";
import type { RequestPrincipal, TenantExecutionContext } from "@rnd-ai/shared-types";

import { TenantContextError } from "@/server/auth/tenant-execution-context";
import { tenant_context_from_principal } from "@/server/services/ai-gateway/run-api-runtime";

/** Either a resolved tenant context or a ready-to-return error response. */
export type TenantContextResolution =
  | { readonly status: "ok"; readonly tenant: TenantExecutionContext }
  | { readonly status: "error"; readonly response: NextResponse };

/**
 * Resolve the tenant execution context for a verified principal.
 *
 * @param principal - Principal produced by with_request_principal.
 * @returns The frozen tenant context, or a 403 response when membership cannot
 *          scope a tenant.
 */
export function resolve_tenant_context(
  principal: RequestPrincipal,
): TenantContextResolution {
  try {
    return { status: "ok", tenant: tenant_context_from_principal(principal) };
  } catch (error) {
    if (error instanceof TenantContextError) {
      return {
        status: "error",
        response: NextResponse.json(
          { error: "FORBIDDEN", message: error.message },
          { status: 403 },
        ),
      };
    }
    throw error;
  }
}
