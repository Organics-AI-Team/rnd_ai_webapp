import { describe, expect, it, vi } from "vitest";

import { ToolGovernanceError } from "../../apps/ai/server/services/ai-control/errors";
import {
  create_google_custom_search_port,
} from "../../apps/ai/server/services/ai-control/providers/google-custom-search";
import type { TrustedToolContext } from "../../apps/ai/server/services/ai-control/tool-definition";

const trusted_context: TrustedToolContext = {
  tenant_id: "507f1f77bcf86cd7994390a1",
  actor_profile_id: "507f1f77bcf86cd7994390b1",
  run_id: "507f1f77bcf86cd7994390c1",
  correlation_id: "corr-search",
  idempotency_key: "idem-search",
  signal: new AbortController().signal,
};

describe("Google Custom Search governed adapter", () => {
  it("sends only the bounded provider contract and normalizes cited results", async () => {
    const fetch_impl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              title: "EU Cosmetics Regulation",
              link: "https://eur-lex.europa.eu/example",
              snippet: "Official consolidated regulation excerpt.",
            },
            {
              title: "FDA Cosmetics",
              link: "https://www.fda.gov/cosmetics",
              snippet: "US cosmetics information.",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const port = create_google_custom_search_port({
      api_key: "private-search-key",
      cse_id: "approved-cse",
      fetch_impl,
    });

    const result = await port.search_web(
      { query: "retinol cosmetic regulation", max_results: 2 },
      trusted_context,
    );

    expect(fetch_impl).toHaveBeenCalledTimes(1);
    const [request, init] = fetch_impl.mock.calls[0]!;
    const url = new URL(String(request));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://customsearch.googleapis.com/customsearch/v1",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      key: "private-search-key",
      cx: "approved-cse",
      q: "retinol cosmetic regulation",
      num: "2",
    });
    expect(init).toMatchObject({ method: "GET", signal: trusted_context.signal });
    expect(result).toEqual({
      answer:
        "EU Cosmetics Regulation: Official consolidated regulation excerpt.\n\n" +
        "FDA Cosmetics: US cosmetics information.",
      sources: [
        {
          title: "EU Cosmetics Regulation",
          url: "https://eur-lex.europa.eu/example",
          snippet: "Official consolidated regulation excerpt.",
        },
        {
          title: "FDA Cosmetics",
          url: "https://www.fda.gov/cosmetics",
          snippet: "US cosmetics information.",
        },
      ],
    });
  });

  it("defaults to five results and rejects malformed provider data", async () => {
    const fetch_impl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ items: [{ title: "missing link" }] }), {
        status: 200,
      }),
    );
    const port = create_google_custom_search_port({
      api_key: "private-search-key",
      cse_id: "approved-cse",
      fetch_impl,
    });

    const failure = await port
      .search_web({ query: "public query" }, trusted_context)
      .catch((error) => error);

    const called_url = new URL(String(fetch_impl.mock.calls[0]?.[0]));
    expect(called_url.searchParams.get("num")).toBe("5");
    expect(failure).toBeInstanceOf(ToolGovernanceError);
    expect(failure).toMatchObject({ code: "TOOL_EXECUTION_FAILED", retryable: true });
  });

  it("surfaces a safe retryable error for provider failures", async () => {
    const secret = "private-search-key-that-must-not-leak";
    const fetch_impl = vi.fn<typeof fetch>(async () =>
      new Response(`${secret} quota body`, { status: 429 }),
    );
    const port = create_google_custom_search_port({
      api_key: secret,
      cse_id: "approved-cse",
      fetch_impl,
    });

    const failure = await port
      .search_web({ query: "public query" }, trusted_context)
      .catch((error) => error);

    expect(failure).toMatchObject({ code: "TOOL_EXECUTION_FAILED", retryable: true });
    expect(String(failure)).not.toContain(secret);
    expect(String(failure)).not.toContain("quota body");
  });

  it("fails closed without a complete provider configuration", () => {
    for (const options of [
      { api_key: "", cse_id: "approved-cse" },
      { api_key: "private-search-key", cse_id: "" },
    ]) {
      expect(() => create_google_custom_search_port(options)).toThrowError(
        expect.objectContaining({ code: "NOT_WIRED", retryable: false }),
      );
    }
  });
});
