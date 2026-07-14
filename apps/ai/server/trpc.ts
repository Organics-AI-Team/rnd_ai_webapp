import { TRPCError, initTRPC } from "@trpc/server";
import { cache } from "react";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import client_promise from "@rnd-ai/shared-database";
import type { Permission, RequestPrincipal } from "@rnd-ai/shared-types";

import { AuthorizationError } from "./auth/errors";
import { require_active_tenant, require_permission } from "./auth/authorize";
import {
  resolve_legacy_principal,
  type LegacyUserRecord,
} from "./auth/legacy-principal-resolver";
import { create_legacy_identity_store } from "./auth/mongo-legacy-identity-store";

/**
 * Request context resolved once per request from verified server state. No
 * field originates from a request body, query string, or client-writable
 * storage; the only input is the httpOnly session cookie.
 */
export interface TRPCContext {
  principal: RequestPrincipal | null;
  auth_error: "UNAUTHENTICATED" | "MEMBERSHIP_INACTIVE" | null;
  legacy_user: LegacyUserRecord | null;
}

const unauthenticated_context: TRPCContext = {
  principal: null,
  auth_error: "UNAUTHENTICATED",
  legacy_user: null,
};

/**
 * Resolve the legacy session cookie into a verified principal exactly once
 * per request. Resolution failures fail closed: the context carries a stable
 * failure code and no identity fields.
 *
 * @returns Context with the verified principal or a typed resolution failure.
 */
export const createTRPCContext = cache(async (): Promise<TRPCContext> => {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) {
    return unauthenticated_context;
  }

  try {
    const client = await client_promise;
    const store = create_legacy_identity_store(client.db());
    const principal = await resolve_legacy_principal(token, store);
    const legacy_user = await store.find_user_by_account_id(
      principal.provider_user_id,
    );
    return { principal, auth_error: null, legacy_user };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        principal: null,
        auth_error:
          error.code === "MEMBERSHIP_INACTIVE"
            ? "MEMBERSHIP_INACTIVE"
            : "UNAUTHENTICATED",
        legacy_user: null,
      };
    }
    console.error("[trpc] principal resolution failed:", error);
    return unauthenticated_context;
  }
});

const t = initTRPC.context<TRPCContext>().create();

export const createCallerFactory = t.createCallerFactory;
export const router = t.router;

/**
 * Anonymous procedure. Reserved for the auth router (login/logout/me until
 * the Clerk cutover); business routers are forbidden from importing it by
 * tests/auth/trpc-procedures.test.ts.
 */
export const publicProcedure = t.procedure;

/**
 * Deliberate anonymous ingress for the public client order form only. Kept
 * distinct from publicProcedure so the architecture test can pin its single
 * permitted usage in the orders router.
 */
export const publicClientOrderProcedure = t.procedure;

/**
 * Translate a typed AuthorizationError into the equivalent transport error.
 *
 * @param error - Authorization failure raised by an auth assertion.
 * @returns TRPCError with a stable UNAUTHORIZED or FORBIDDEN code.
 */
function to_trpc_error(error: AuthorizationError): TRPCError {
  return new TRPCError({
    code: error.code === "UNAUTHENTICATED" ? "UNAUTHORIZED" : "FORBIDDEN",
    message: error.message,
  });
}

const authenticated_middleware = t.middleware(({ ctx, next }) => {
  if (!ctx.principal) {
    throw new TRPCError({
      code: ctx.auth_error === "MEMBERSHIP_INACTIVE" ? "FORBIDDEN" : "UNAUTHORIZED",
      message:
        ctx.auth_error === "MEMBERSHIP_INACTIVE"
          ? "Membership is not active."
          : "Authentication is required.",
    });
  }
  const principal = ctx.principal;
  return next({
    ctx: {
      ...ctx,
      principal,
      // Temporary G0 compatibility view for legacy router bodies. These
      // values derive ONLY from the verified principal; G2 replaces them
      // with tenant-scoped repositories.
      userId: principal.internal_user_id,
      organizationId: principal.active_tenant_id,
      user: build_legacy_compat_user(principal, ctx.legacy_user),
    },
  });
});

/**
 * Legacy raw-document view consumed by unconverted router bodies. `_id` and
 * `organizationId` stay ObjectId-shaped at runtime — matching the raw Mongo
 * documents the previous untyped context exposed — and are typed `any` on
 * purpose so legacy assignments keep compiling until the G2 repository
 * conversion deletes this view entirely.
 */
export interface LegacyCompatUser {
  _id: any;
  id: string;
  email: string;
  name: string;
  role: "admin" | "shipper" | "shopper";
  organizationId: any;
}

/**
 * Build the legacy compatibility user view from verified principal state.
 *
 * @param principal - Verified request principal.
 * @param legacy_user - User record loaded during principal resolution.
 * @returns Raw-document-shaped user view for unconverted routers.
 */
function build_legacy_compat_user(
  principal: RequestPrincipal,
  legacy_user: LegacyUserRecord | null,
): LegacyCompatUser {
  return {
    _id: new ObjectId(principal.internal_user_id),
    id: principal.internal_user_id,
    email: legacy_user?.email ?? "",
    name: legacy_user?.name ?? "",
    role: legacy_user?.role ?? "shopper",
    organizationId: principal.active_tenant_id
      ? new ObjectId(principal.active_tenant_id)
      : null,
  };
}

/**
 * Procedure requiring a verified principal. Suspended memberships map to
 * FORBIDDEN; anonymous callers map to UNAUTHORIZED.
 */
export const authenticatedProcedure = t.procedure.use(authenticated_middleware);

/**
 * Procedure requiring an active tenant membership plus one named permission.
 *
 * @param permission - Named permission the operation requires.
 * @returns Procedure whose context carries a non-null tenant scope.
 */
export const tenantProcedure = (permission: Permission) =>
  authenticatedProcedure.use(({ ctx, next }) => {
    try {
      require_active_tenant(ctx.principal);
      require_permission(ctx.principal, permission);
    } catch (error) {
      if (error instanceof AuthorizationError) throw to_trpc_error(error);
      throw error;
    }
    return next({
      ctx: { ...ctx, organizationId: ctx.principal.active_tenant_id as string },
    });
  });

/**
 * Procedure requiring an active tenant manager. Used for university
 * administration surfaces (member management, credits) until platform
 * roles arrive with Clerk in G1.
 */
export const managerProcedure = authenticatedProcedure.use(({ ctx, next }) => {
  try {
    require_active_tenant(ctx.principal);
  } catch (error) {
    if (error instanceof AuthorizationError) throw to_trpc_error(error);
    throw error;
  }
  if (ctx.principal.tenant_role !== "manager") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Manager role is required.",
    });
  }
  return next({
    ctx: { ...ctx, organizationId: ctx.principal.active_tenant_id as string },
  });
});
