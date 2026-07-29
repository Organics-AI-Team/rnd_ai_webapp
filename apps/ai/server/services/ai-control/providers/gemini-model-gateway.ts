/** Governed Google Gemini adapter for the orchestration ModelGateway port. */

import { createHash } from "node:crypto";
import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  type GenerateContentRequest,
} from "@google/generative-ai";
import type {
  ModelGateway,
  ModelTurnRequestV1,
  ModelTurnV1,
  TrustedRuntimeContext,
} from "@rnd-ai/ai-orchestration";

/** Provider-neutral request used to test the SDK boundary without network. */
export interface GeminiGenerationRequest {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly { role: "user" | "model"; text: string }[];
  readonly tools: readonly {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
  readonly signal?: AbortSignal;
}

/** Provider-neutral response normalized from the Google SDK. */
export interface GeminiGenerationResponse {
  readonly text: string | null;
  readonly function_calls: readonly { name: string; args: unknown }[];
  readonly usage: { input_tokens: number; output_tokens: number };
}

/** Narrow Google SDK port. */
export interface GeminiGenerationClient {
  generate(request: GeminiGenerationRequest): Promise<GeminiGenerationResponse>;
}

/** Model gateway construction options. Pricing is pinned outside provider IO. */
export interface GeminiModelGatewayOptions {
  readonly api_key: string;
  readonly model: string;
  readonly input_price_microusd_per_million_tokens: bigint;
  readonly output_price_microusd_per_million_tokens: bigint;
  readonly signal?: AbortSignal;
  readonly client?: GeminiGenerationClient;
}

/** Safe error used for all provider/response failures. */
export class ModelProviderRequestError extends Error {
  readonly code = "MODEL_PROVIDER_ERROR";
  readonly retryable = true;
  constructor() {
    super("The configured AI model provider request failed.");
    this.name = "ModelProviderRequestError";
  }
}

function assert_options(options: GeminiModelGatewayOptions): void {
  if (
    options.api_key.trim().length === 0 ||
    options.model.trim().length === 0 ||
    options.input_price_microusd_per_million_tokens < 0n ||
    options.output_price_microusd_per_million_tokens < 0n
  ) {
    throw new ModelProviderRequestError();
  }
}

/** Convert a dotted catalogue name into a reversible Gemini function name. */
function provider_tool_name(name: string): string {
  const encoded = `tool_${name.replace(/_/g, "_u_").replace(/\./g, "__")}`;
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(encoded)) {
    throw new ModelProviderRequestError();
  }
  return encoded;
}

function stable_json(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable_json).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stable_json(nested)}`)
    .join(",")}}`;
}

function call_id(
  context: TrustedRuntimeContext,
  tool_name: string,
  args: unknown,
  index: number,
): string {
  const digest = createHash("sha256")
    .update(`${context.run_id}\n${index}\n${tool_name}\n${stable_json(args)}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `gemini_${digest}`;
}

/** Format a non-negative rational whose fixed denominator is 10^12. */
function cost_numerator_to_usd(numerator: bigint): string {
  const denominator = 1_000_000_000_000n;
  const whole = numerator / denominator;
  const fraction = (numerator % denominator)
    .toString()
    .padStart(12, "0")
    .replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

function sdk_client(api_key: string): GeminiGenerationClient {
  const sdk = new GoogleGenerativeAI(api_key);
  return {
    async generate(request) {
      const model = sdk.getGenerativeModel({ model: request.model });
      const body: GenerateContentRequest = {
        systemInstruction: request.system,
        contents: request.messages.map((message) => ({
          role: message.role,
          parts: [{ text: message.text }],
        })),
        tools: [{
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: {
              type: "object",
              properties: {},
              ...tool.parameters,
            },
          })) as FunctionDeclaration[],
        }],
      };
      const result = await model.generateContent(body, { signal: request.signal });
      let text: string | null = null;
      try {
        text = result.response.text() || null;
      } catch {
        text = null;
      }
      const usage = result.response.usageMetadata;
      return {
        text,
        function_calls: (result.response.functionCalls() ?? []).map((call) => ({
          name: call.name,
          args: call.args,
        })),
        usage: {
          input_tokens: usage?.promptTokenCount ?? 0,
          output_tokens: usage?.candidatesTokenCount ?? 0,
        },
      };
    },
  };
}

/** Create a Gemini-backed model port bound to one pinned provider/model/rate card. */
export function create_gemini_model_gateway(
  options: GeminiModelGatewayOptions,
): ModelGateway {
  assert_options(options);
  const client = options.client ?? sdk_client(options.api_key);

  return {
    async complete_turn(
      request: ModelTurnRequestV1,
      context: TrustedRuntimeContext,
    ): Promise<ModelTurnV1> {
      const reverse_names = new Map<string, string>();
      const tools = request.tools.map((tool) => {
        const name = provider_tool_name(tool.name);
        if (reverse_names.has(name)) throw new ModelProviderRequestError();
        reverse_names.set(name, tool.name);
        return {
          name,
          description: tool.description,
          parameters: tool.parameters,
        };
      });

      try {
        const response = await client.generate({
          model: options.model,
          system: request.system,
          messages: request.messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            text:
              message.role === "tool"
                ? `[tool observation]\n${message.content}`
                : message.content,
          })),
          tools,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        if (
          !Number.isSafeInteger(response.usage.input_tokens) ||
          response.usage.input_tokens < 0 ||
          !Number.isSafeInteger(response.usage.output_tokens) ||
          response.usage.output_tokens < 0
        ) {
          throw new ModelProviderRequestError();
        }
        const normalized_calls = response.function_calls.map((call, index) => {
          const tool_name = reverse_names.get(call.name);
          if (!tool_name) {
            // Name the unmapped function: models sometimes emit the dotted
            // card name instead of the declared transformed name.
            console.error("[gemini-model-gateway] unknown function name", {
              returned: String(call.name).slice(0, 120),
              declared: [...reverse_names.keys()],
            });
            throw new ModelProviderRequestError();
          }
          return {
            call_id: call_id(context, tool_name, call.args, index),
            tool_name,
            arguments: call.args,
          };
        });
        const cost_numerator =
          BigInt(response.usage.input_tokens) *
            options.input_price_microusd_per_million_tokens +
          BigInt(response.usage.output_tokens) *
            options.output_price_microusd_per_million_tokens;
        return {
          content: response.text,
          tool_calls: normalized_calls,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
            cost_usd: cost_numerator_to_usd(cost_numerator),
          },
        };
      } catch (error) {
        // Surface the provider's real failure before mapping to the stable
        // code — API error messages name models/fields, never secrets. An
        // opaque MODEL_PROVIDER_ERROR was undiagnosable from container logs.
        console.error("[gemini-model-gateway] complete_turn failed", {
          model: options.model,
          status: (error as { status?: number }).status ?? null,
          reason:
            error instanceof Error ? error.message.slice(0, 600) : String(error),
        });
        throw new ModelProviderRequestError();
      }
    },
  };
}
