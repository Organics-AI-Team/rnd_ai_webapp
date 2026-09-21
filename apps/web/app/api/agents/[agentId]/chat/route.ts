import { NextResponse, type NextRequest } from "next/server";
import { with_request_principal } from "@/lib/server/with-request-principal";

const retired = () => NextResponse.json(
  { error: "LEGACY_AGENT_CHAT_RETIRED", message: "Use POST /api/ai/runs." },
  { status: 410 },
);

export async function POST(
  request: NextRequest,
  _context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  return with_request_principal(request, "ai:run", async () => retired());
}

export async function GET(
  request: NextRequest,
  _context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  return with_request_principal(request, "ai:run", async () => retired());
}
