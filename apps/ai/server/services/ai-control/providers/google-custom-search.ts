/** Governed server-only adapter for the Google Custom Search JSON API. */

import { z } from "zod";

import { ToolGovernanceError } from "../errors";
import type { WebSearchPort } from "../tools/web-search-tools";

const GOOGLE_CUSTOM_SEARCH_ENDPOINT =
  "https://customsearch.googleapis.com/customsearch/v1";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESPONSE_BYTES = 512 * 1024;

const provider_response_schema = z
  .object({
    items: z
      .array(
        z
          .object({
            title: z.string().min(1),
            link: z.string().min(1),
            snippet: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

/** Private provider configuration supplied only by the worker boundary. */
export interface GoogleCustomSearchOptions {
  readonly api_key: string;
  readonly cse_id: string;
  readonly fetch_impl?: typeof fetch;
}

function unavailable(retryable: boolean): ToolGovernanceError {
  return new ToolGovernanceError(
    retryable ? "TOOL_EXECUTION_FAILED" : "NOT_WIRED",
    retryable
      ? "The approved external web search provider is unavailable."
      : "The approved external web search provider is not configured.",
    retryable,
  );
}

function bounded_text(value: string, max_length: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max_length);
}

function public_http_url(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw unavailable(true);
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof ToolGovernanceError) throw error;
    throw unavailable(true);
  }
}

/** Create a bounded, fail-closed implementation of the governed web-search port. */
export function create_google_custom_search_port(
  options: GoogleCustomSearchOptions,
): WebSearchPort {
  const api_key = options.api_key.trim();
  const cse_id = options.cse_id.trim();
  if (!api_key || !cse_id) throw unavailable(false);
  const fetch_impl = options.fetch_impl ?? globalThis.fetch;
  if (typeof fetch_impl !== "function") throw unavailable(false);

  return {
    async search_web(args, context) {
      try {
        const url = new URL(GOOGLE_CUSTOM_SEARCH_ENDPOINT);
        url.searchParams.set("key", api_key);
        url.searchParams.set("cx", cse_id);
        url.searchParams.set("q", args.query);
        url.searchParams.set("num", String(args.max_results ?? DEFAULT_MAX_RESULTS));

        const response = await fetch_impl(url, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: context.signal,
        });
        if (!response.ok) throw unavailable(true);
        const declared_length = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared_length) && declared_length > MAX_RESPONSE_BYTES) {
          throw unavailable(true);
        }
        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
          throw unavailable(true);
        }
        const parsed = provider_response_schema.safeParse(JSON.parse(body));
        if (!parsed.success) throw unavailable(true);

        const sources = (parsed.data.items ?? []).map((item) => ({
          title: bounded_text(item.title, 300),
          url: public_http_url(item.link),
          snippet: bounded_text(item.snippet ?? "", 1_200),
        }));
        const answer =
          sources.length === 0
            ? "No public web results were returned."
            : sources
                .map((source) =>
                  source.snippet
                    ? `${source.title}: ${source.snippet}`
                    : source.title,
                )
                .join("\n\n");
        return { answer, sources };
      } catch (error) {
        if (error instanceof ToolGovernanceError) throw error;
        throw unavailable(true);
      }
    },
  };
}
