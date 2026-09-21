import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge auth gate.
 *
 * Pages and API routes are both guarded here. Until 2026-09-21 the matcher
 * excluded `/api` wholesale, so every route handler under app/api ran with no
 * credential check at all — nine of them were reachable from the public
 * internet, and the agent routes additionally took the acting `userId`
 * straight from the request body. Guarding at the edge fixes the whole class
 * in one place instead of adding a check to each handler and relying on every
 * future handler to remember one.
 */

/** Pages reachable without a session. */
const PUBLIC_PAGE_ROUTES = ["/login", "/signup"] as const;

/**
 * API prefixes that must stay reachable without the cookie.
 *
 * `/api/trpc` carries login and signup themselves, so it cannot require a
 * session to reach; it authorizes per procedure instead — publicProcedure for
 * the auth mutations, protectedProcedure (which resolves the session from this
 * same cookie) for everything else. Keep this list minimal: an entry here is
 * an endpoint the edge gate will not protect.
 */
const PUBLIC_API_PREFIXES = ["/api/trpc"] as const;

/**
 * Decide whether a request may proceed.
 *
 * @param request - Incoming edge request; the `auth_token` cookie is the session.
 * @returns Redirect for unauthenticated pages, 401 JSON for unauthenticated
 *          API calls, else pass-through.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const is_authenticated = Boolean(request.cookies.get("auth_token")?.value);

  const is_api_route = pathname.startsWith("/api");
  const is_public_api = PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const is_public_page = PUBLIC_PAGE_ROUTES.some((route) => pathname.startsWith(route));

  if (is_api_route) {
    if (is_public_api || is_authenticated) {
      return NextResponse.next();
    }
    // JSON, not a redirect: an API caller following a 307 to the login HTML
    // would read it as a malformed success rather than an auth failure.
    console.warn("[middleware] unauthenticated API request rejected", {
      pathname,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: "Unauthorized", success: false },
      { status: 401 },
    );
  }

  if (!is_authenticated && !is_public_page) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (is_authenticated && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // `/api` is deliberately NOT excluded here — see PUBLIC_API_PREFIXES for the
  // only endpoints that opt out. Static assets and the favicon carry no data
  // and are left unguarded so the login page can render.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
