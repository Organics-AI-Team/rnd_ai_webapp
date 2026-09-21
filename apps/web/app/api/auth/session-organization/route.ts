import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Report the organization carried by the server-visible Clerk session.
 *
 * The organization switcher polls this boundary before clearing and
 * refetching tenant queries, preventing client-context/cookie timing races.
 */
export async function GET(request: NextRequest): Promise<Response> {
  void request;
  const session = await auth();
  if (!session.userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  return NextResponse.json(
    { organization_id: session.orgId ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
