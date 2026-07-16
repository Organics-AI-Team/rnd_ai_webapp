import { NextResponse } from "next/server";

/** Public liveness probe used only by the deployment platform. */
export async function GET(): Promise<NextResponse<{ status: "ok" }>> {
  return NextResponse.json(
    { status: "ok" },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
