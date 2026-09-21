import { NextResponse, type NextRequest } from "next/server";
import { with_request_principal } from "@/lib/server/with-request-principal";

export async function POST(request: NextRequest): Promise<Response> {
  return with_request_principal(request, "ai:run", async () =>
    NextResponse.json(
      { error: "LEGACY_AI_REFRESH_RETIRED", message: "Use the governed run resume endpoint." },
      { status: 410 },
    ));
}
