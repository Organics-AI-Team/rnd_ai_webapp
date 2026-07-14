import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup"];

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
 * Check whether a pathname is intentionally public.
 *
 * @param pathname - Request pathname to classify.
 * @returns True when the path is a public G0 login or signup route.
 */
function is_public_path(pathname: string): boolean {
  return PUBLIC_PATHS.some((public_path) => (
    pathname === public_path || pathname.startsWith(`${public_path}/`)
  ));
}

/**
 * Redirect anonymous page requests to the G0 login route.
 *
 * This is traffic guidance only. Server handlers remain responsible for
 * authenticating and authorizing every protected operation.
 *
 * @param request - Incoming Next.js request.
 * @returns A redirect for anonymous protected-page requests, otherwise pass-through.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const classification: ProxyClassification = is_public_path(request.nextUrl.pathname)
    ? "public"
    : "protected";
  log_proxy_event("entry", "evaluate", classification);

  const token = request.cookies.get("auth_token")?.value;
  if (!token && classification === "protected") {
    log_proxy_event("decision", "redirect", classification);
    const response = NextResponse.redirect(new URL("/login", request.url));
    log_proxy_event("exit", "redirect", classification);
    return response;
  }

  log_proxy_event("decision", "allow", classification);
  const response = NextResponse.next();
  log_proxy_event("exit", "allow", classification);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
