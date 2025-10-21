import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const authToken = request.cookies.get("auth_token");
  const { pathname } = request.nextUrl;

  // Public routes that don't require authentication
  const publicRoutes = ["/login", "/signup"];
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));

  // Check if user is authenticated (has auth token)
  const isAuthenticated = !!authToken?.value;

  // If user is not authenticated and trying to access protected route
  if (!isAuthenticated && !isPublicRoute) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // If user is authenticated and trying to access login or signup page
  if (isAuthenticated && (pathname === "/login" || pathname === "/signup")) {
    const homeUrl = new URL("/", request.url);
    return NextResponse.redirect(homeUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - login or signup (public routes)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|login|signup).*)",
  ],
};
