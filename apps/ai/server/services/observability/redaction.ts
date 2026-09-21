/**
 * Fail-closed deep redaction for commercial telemetry (G5.6).
 *
 * Redaction is deliberately independent of any logger/exporter. Callers get a
 * newly allocated JSON-safe value; the original object is never mutated or
 * passed through when traversal fails.
 */

export const REDACTED_VALUE = "[REDACTED]";

/** Metadata emitted for a field that could not be inspected safely. */
export interface RedactionFailure {
  readonly code: "REDACTION_FAILURE";
  readonly path: string;
}

/** Result of deep redaction before event metadata is attached. */
export interface DeepRedactionResult {
  readonly value: unknown;
  readonly failures: readonly RedactionFailure[];
}

/** Redaction metadata attached to every serialized commercial event. */
export interface RedactionMetadata {
  readonly status: "applied" | "failure";
  readonly replacement: typeof REDACTED_VALUE;
  readonly failures: readonly RedactionFailure[];
}

/** A JSON-safe event after mandatory redaction. */
export type RedactedCommercialEvent = Readonly<Record<string, unknown>> & {
  readonly redaction_metadata: RedactionMetadata;
};

const SAFE_TOKEN_COUNT_KEYS = new Set([
  "inputtokens",
  "outputtokens",
  "totaltokens",
  "tokencount",
]);

const SAFE_CONTENT_VERSION_KEYS = new Set(["promptversion"]);

const DENIED_KEY_PARTS = Object.freeze([
  "authorization",
  "cookie",
  "password",
  "passwd",
  "digest",
  "email",
  "prompt",
  "document",
  "excerpt",
  "rawpayload",
  "rawmodel",
  "toolargument",
  "arguments",
  "connectionstring",
  "apikey",
  "privatekey",
  "accesskey",
  "secret",
  "payload",
  "content",
]);

const SENSITIVE_STRING_PATTERNS = Object.freeze([
  /mongodb(?:\+srv)?:\/\/[^\s]+/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bsk-[A-Za-z0-9_-]{8,}\b/i,
  /\bAIza[A-Za-z0-9_-]{10,}\b/,
  /\b(?:pk|sk)_(?:live|test)_[A-Za-z0-9]+\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
]);

/** Normalize a field name for separator/case-insensitive policy matching. */
function canonical_key(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Decide whether a field must be dropped without reading its value. */
function denied_key(key: string): boolean {
  const canonical = canonical_key(key);
  if (
    SAFE_TOKEN_COUNT_KEYS.has(canonical) ||
    SAFE_CONTENT_VERSION_KEYS.has(canonical)
  ) {
    return false;
  }
  if (canonical === "tenantid" || canonical.endsWith("tenantid")) return true;
  if (canonical === "args" || canonical.endsWith("args")) return true;
  if (canonical === "input" || canonical === "output" || canonical === "body") {
    return true;
  }
  if (canonical.includes("token")) return true;
  if (canonical === "key" || canonical.endsWith("key")) return true;
  return DENIED_KEY_PARTS.some((part) => canonical.includes(part));
}

/** Determine whether a string contains a credential or direct identifier. */
function sensitive_string(value: string): boolean {
  return SENSITIVE_STRING_PATTERNS.some((pattern) => pattern.test(value));
}

/** Add one path-only failure without retaining an exception or original value. */
function record_failure(
  failures: RedactionFailure[],
  path: string,
): typeof REDACTED_VALUE {
  failures.push({ code: "REDACTION_FAILURE", path });
  return REDACTED_VALUE;
}

/** Traverse one value into a newly allocated, JSON-safe representation. */
function visit(
  value: unknown,
  path: string,
  failures: RedactionFailure[],
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return typeof value === "number" && !Number.isFinite(value) ? null : value;
  }
  if (typeof value === "string") {
    return sensitive_string(value) ? REDACTED_VALUE : value;
  }
  if (typeof value === "bigint") return value.toString(10);
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return record_failure(failures, path);
  }
  if (typeof value !== "object") {
    return record_failure(failures, path);
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? value.toISOString()
      : record_failure(failures, path);
  }
  if (seen.has(value)) return record_failure(failures, path);
  seen.add(value);

  if (Array.isArray(value)) {
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const child_path = `${path}[${index}]`;
      try {
        output.push(visit(value[index], child_path, failures, seen));
      } catch {
        output.push(record_failure(failures, child_path));
      }
    }
    return output;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return record_failure(failures, path);
  }

  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return record_failure(failures, path);
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") {
      record_failure(failures, `${path}.[symbol]`);
      continue;
    }
    const child_path = path ? `${path}.${key}` : key;
    if (denied_key(key)) {
      output[key] = REDACTED_VALUE;
      continue;
    }
    try {
      output[key] = visit(
        Reflect.get(value, key),
        child_path,
        failures,
        seen,
      );
    } catch {
      output[key] = record_failure(failures, child_path);
    }
  }
  return output;
}

/**
 * Deeply redact an arbitrary value into a new JSON-safe tree.
 *
 * @param value - Untrusted event-like value.
 * @returns Redacted value plus path-only traversal failures.
 */
export function deep_redact(value: unknown): DeepRedactionResult {
  const failures: RedactionFailure[] = [];
  try {
    return {
      value: visit(value, "$", failures, new WeakSet<object>()),
      failures: Object.freeze(failures),
    };
  } catch {
    return {
      value: REDACTED_VALUE,
      failures: Object.freeze([
        { code: "REDACTION_FAILURE" as const, path: "$" },
      ]),
    };
  }
}

/**
 * Redact an event and attach mandatory redaction metadata.
 *
 * @param event - Event or event-like value from an internal caller.
 * @returns Newly allocated event safe for serialization/export.
 */
export function redact_event(event: unknown): RedactedCommercialEvent {
  const result = deep_redact(event);
  const redaction_metadata: RedactionMetadata = Object.freeze({
    status: result.failures.length > 0 ? "failure" : "applied",
    replacement: REDACTED_VALUE,
    failures: result.failures,
  });
  if (
    !result.value ||
    typeof result.value !== "object" ||
    Array.isArray(result.value)
  ) {
    return Object.freeze({
      event_name: "REDACTION_FAILURE",
      redaction_metadata,
    });
  }
  return Object.freeze({
    ...(result.value as Record<string, unknown>),
    redaction_metadata,
  });
}
