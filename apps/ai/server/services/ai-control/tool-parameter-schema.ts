/**
 * Provider-facing tool parameter schemas.
 *
 * Converts a tool's Zod input schema into the OpenAPI-style JSON schema
 * subset Gemini function declarations accept, whitelisting keys recursively
 * (Gemini 400s on JSON-Schema keywords like additionalProperties, and arrays
 * without `items`). Assembled once at ingress and pinned inside the context
 * pack so the model finally sees real argument shapes — with empty
 * parameters, models never attempted complex-argument tools.
 */
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** Keys Gemini's FunctionDeclaration schema subset understands. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

/**
 * Recursively keep only provider-supported schema keys.
 *
 * @param node - JSON-schema fragment produced by zod-to-json-schema.
 * @returns The sanitized fragment (arrays always retain an `items`).
 */
function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      const properties: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        properties[name] = sanitize(child);
      }
      out.properties = properties;
      continue;
    }
    out[key] = sanitize(value);
  }
  if (out.type === "array" && !out.items) out.items = { type: "string" };
  return out;
}

/**
 * Convert a tool's Zod input schema to a Gemini-safe JSON parameter schema.
 *
 * @param input_schema - The tool definition's Zod input schema.
 * @returns Sanitized JSON schema object rooted at type "object".
 */
export function tool_parameters_json_schema(
  input_schema: ZodTypeAny,
): Record<string, unknown> {
  const raw = zodToJsonSchema(input_schema, {
    target: "openApi3",
    $refStrategy: "none",
  });
  const sanitized = sanitize(raw) as Record<string, unknown>;
  return sanitized.type === "object"
    ? sanitized
    : { type: "object", properties: {} };
}
