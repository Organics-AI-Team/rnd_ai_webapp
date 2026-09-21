import { NextResponse, type NextRequest } from "next/server";
import { with_request_principal } from "@/lib/server/with-request-principal";

const retired = () => NextResponse.json(
  { error: "LEGACY_AI_ENDPOINT_RETIRED", message: "Use the governed run API." },
  { status: 410 },
);

export async function GET(request: NextRequest): Promise<Response> {
  return with_request_principal(request, "ai:run", async () => retired());
}

export async function POST(request: NextRequest): Promise<Response> {
  return with_request_principal(request, "ai:run", async () => retired());
}

export async function PUT(request: NextRequest): Promise<Response> {
  return with_request_principal(request, "ai:run", async () => retired());
}
