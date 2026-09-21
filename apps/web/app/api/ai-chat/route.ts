import { NextResponse, type NextRequest } from "next/server";
import { with_request_principal } from "@/lib/server/with-request-principal";

export async function POST(request: NextRequest): Promise<Response> {
  return with_request_principal(request, "ai:run", async () =>
    NextResponse.json(
      { error: "LEGACY_AI_CHAT_RETIRED", message: "Use POST /api/ai/runs." },
      { status: 410 },
    ));
}
