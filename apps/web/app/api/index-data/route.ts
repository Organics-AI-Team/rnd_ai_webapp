import { NextResponse, type NextRequest } from "next/server";
import { with_request_principal } from "@/lib/server/with-request-principal";

const retired = () => NextResponse.json(
  {
    error: "LEGACY_INDEXING_RETIRED",
    message: "Use the governed Qdrant indexing workflow.",
  },
  { status: 410 },
);

export async function POST(request: NextRequest): Promise<Response> {
  return with_request_principal(request, "tenant:settings:write", async () => retired());
}

export async function GET(request: NextRequest): Promise<Response> {
  return with_request_principal(request, "tenant:settings:write", async () => retired());
}
