import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

import { is_clerk_cutover, is_clerk_enabled } from "./lib/server/clerk-config";

const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/onboarding"];

type ProxyClassification = "public" | "protected";
type ProxyPhase = "entry" | "decision" | "exit";

/**
 * Emit a minimal structured event at the request-guidance boundary.
 *
 * URL, query, cookie, token, body, and identity data are deliberately excluded.
 *
 * @param phase - Boundary lifecycle phase.
 * @param action - Safe routing decision label.
 * @param classification - Whether the requested route is public or protected.
 */
function log_proxy_event(
  phase: ProxyPhase,
  action: "evaluate" | "allow" | "redirect",
  classification: ProxyClassification,
): void {
  console.info({
    boundary: "proxy",
    phase,
    action,
    classification,
  });
}

/**
 * Check whether a pathname is intentionally public in the legacy flow.
 *
 * @param pathname - Request pathname to classify.
 * @returns True when the path is a public authentication route.
 */
function is_public_path(pathname: string): boolean {
  return PUBLIC_PATHS.some((public_path) => (
    pathname === public_path || pathname.startsWith(`${public_path}/`)
  ));
}

/**
 * Legacy request guidance (rollback window only): redirect anonymous
 * protected pages to the sign-in surface; pass API traffic through because
 * server handlers authorize every operation themselves (G0.5/G0.6).
 *
 * @param request - Incoming Next.js request.
 * @returns Redirect for anonymous protected pages, otherwise pass-through.
 */
async function legacy_guidance(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const is_api_path = pathname.startsWith("/api") || pathname.startsWith("/trpc");
  const classification: ProxyClassification =
    is_public_path(pathname) || is_api_path ? "public" : "protected";
  log_proxy_event("entry", "evaluate", classification);

  const token = request.cookies.get("auth_token")?.value;
  if (!token && classification === "protected") {
    log_proxy_event("decision", "redirect", classification);
    const response = NextResponse.redirect(new URL("/sign-in", request.url));
    log_proxy_event("exit", "redirect", classification);
    return response;
  }

  log_proxy_event("decision", "allow", classification);
  const response = NextResponse.next();
  log_proxy_event("exit", "allow", classification);
  return response;
}

/**
 * Public routes under the Clerk surface. The legacy /login and /signup pages
 * were deleted at the G1.7 cutover.
 */
const is_public = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/onboarding",
  "/api/webhooks/clerk",
  "/api/health",
]);

/**
 * Clerk-enabled guidance. After cutover, auth.protect() enforces a Clerk
 * session for every application, API, and tRPC path (redirecting browsers to
 * /sign-in). Before cutover, Clerk observes the request while the legacy
 * cookie flow keeps guarding pages — CLERK_CUTOVER=false is the documented
 * rollback lever.
 */
const clerk_proxy = clerkMiddleware(
  async (auth, request) => {
    if (is_public(request)) {
      log_proxy_event("decision", "allow", "public");
      return;
    }
    if (is_clerk_cutover()) {
      await auth.protect();
      log_proxy_event("decision", "allow", "protected");
      return;
    }
    return legacy_guidance(request);
  },
  { frontendApiProxy: { enabled: true } },
);

/**
 * Request-guidance entry point. Selects the Clerk surface when configured,
 * otherwise the legacy G0 flow. This is traffic guidance only: server
 * handlers remain responsible for authenticating and authorizing every
 * protected operation.
 *
 * @param request - Incoming Next.js request.
 * @param event - Next fetch event (required by Clerk's middleware).
 * @returns Routing decision response.
 */
export async function proxy(
  request: NextRequest,
  event?: NextFetchEvent,
): Promise<Response> {
  if (is_clerk_enabled()) {
    const response = await clerk_proxy(request, event as NextFetchEvent);
    return response instanceof Response ? response : NextResponse.next();
  }
  return legacy_guidance(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
    "/(api|trpc)(.*)",
  ],
};
