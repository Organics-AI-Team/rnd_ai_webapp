import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/sign-in", "/sign-up"];

/**
 * Check whether a pathname is intentionally public.
 *
 * @param pathname - Request pathname to classify.
 * @returns True when the path is a public sign-in or sign-up route.
 */
function is_public_path(pathname: string): boolean {
  return PUBLIC_PATHS.some((public_path) => pathname.startsWith(public_path));
}

/**
 * Redirect anonymous page requests to the sign-in route.
 *
 * This is traffic guidance only. Server handlers remain responsible for
 * authenticating and authorizing every protected operation.
 *
 * @param request - Incoming Next.js request.
 * @returns A redirect for anonymous protected-page requests, otherwise pass-through.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get("auth_token")?.value;
  if (!token && !is_public_path(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
