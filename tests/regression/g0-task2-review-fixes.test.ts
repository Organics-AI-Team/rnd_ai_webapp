import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { proxy } from "../../apps/web/proxy";
import * as web_types from "../../apps/web/lib/types";

const order_page_path = fileURLToPath(
  new URL("../../apps/web/app/order/page.tsx", import.meta.url),
);
const formula_form_path = fileURLToPath(
  new URL("../../apps/web/components/formula-form.tsx", import.meta.url),
);

/**
 * Load a TypeScript helper only after asserting that its production module exists.
 *
 * The existence assertion provides a clean RED failure before the helper is added.
 *
 * @param module_url - Production module URL.
 * @returns Imported module namespace.
 */
async function import_production_helper<T>(module_url: URL): Promise<T> {
  const module_path = fileURLToPath(module_url);
  expect(existsSync(module_path), `expected production helper ${module_path}`).toBe(true);
  return import(module_url.href) as Promise<T>;
}

/**
 * Silence expected structured proxy logs while retaining calls for assertions.
 *
 * @returns Console info spy.
 */
function capture_proxy_logs() {
  return vi.spyOn(console, "info").mockImplementation(() => undefined);
}

describe("G0 Task 2 review fixes", () => {
  it.each(["/sign-in", "/sign-up", "/onboarding"])("keeps %s public after the Clerk cutover (G1.7)", async (pathname) => {
    capture_proxy_logs();
    const response = await proxy(new NextRequest(`http://localhost${pathname}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects anonymous protected traffic to the sign-in surface", async () => {
    capture_proxy_logs();
    const response = await proxy(new NextRequest("http://localhost/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/sign-in");
  });

  it("logs only safe structured proxy boundary decisions", async () => {
    const log_spy = capture_proxy_logs();
    const request = new NextRequest("http://localhost/dashboard?secret=query-value", {
      headers: { cookie: "auth_token=cookie-secret" },
    });

    await proxy(request);

    const events = log_spy.mock.calls.map(([event]) => event as Record<string, unknown>);
    expect(events.map((event) => event.phase)).toEqual(["entry", "decision", "exit"]);
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual([
        "action",
        "boundary",
        "classification",
        "phase",
      ]);
      expect(event.boundary).toBe("proxy");
      expect(event.classification).toBe("protected");
    }

    const serialized_events = JSON.stringify(events);
    expect(serialized_events).not.toContain("dashboard");
    expect(serialized_events).not.toContain("query-value");
    expect(serialized_events).not.toContain("cookie-secret");
    expect(serialized_events).not.toContain("auth_token");
  });

  it("uses hydration-safe search params for the order organization", () => {
    const order_page_source = readFileSync(order_page_path, "utf8");

    expect(order_page_source).not.toContain("window.location.search");
    expect(order_page_source).toContain("useSearchParams");
    expect(order_page_source).toContain("<Suspense");
  });

  it("parses the order organization through a pure query helper", async () => {
    const helper = await import_production_helper<{
      get_order_organization_id(search_params: Pick<URLSearchParams, "get">): string;
    }>(new URL("../../apps/web/lib/order-query.ts", import.meta.url));

    expect(helper.get_order_organization_id(new URLSearchParams("org=university-1")))
      .toBe("university-1");
    expect(helper.get_order_organization_id(new URLSearchParams("other=value")))
      .toBe("");
  });

  it("pins the first default chat thread across later query reordering", async () => {
    const helper = await import_production_helper<{
      select_default_thread_once(
        pinned_thread_id: string | null | undefined,
        is_new_chat: boolean,
        threads: ReadonlyArray<{ id: string }>,
      ): string | null | undefined;
    }>(new URL("../../apps/web/lib/chat-thread-selection.ts", import.meta.url));

    const first_selection = helper.select_default_thread_once(
      undefined,
      false,
      [{ id: "thread-a" }, { id: "thread-b" }],
    );
    const after_reorder = helper.select_default_thread_once(
      first_selection,
      false,
      [{ id: "thread-b" }, { id: "thread-a" }],
    );

    expect(first_selection).toBe("thread-a");
    expect(after_reorder).toBe("thread-a");
    expect(helper.select_default_thread_once(first_selection, true, [])).toBeNull();
  });

  it("narrows formula status values without an any assertion", () => {
    const formula_form_source = readFileSync(formula_form_path, "utf8");
    expect(formula_form_source).not.toContain("setStatus(e.target.value as any)");

    expect(web_types).toHaveProperty("is_formula_status");
    const is_formula_status = (
      web_types as typeof web_types & { is_formula_status(value: string): boolean }
    ).is_formula_status;
    expect(is_formula_status("confirmed")).toBe(true);
    expect(is_formula_status("not-a-status")).toBe(false);
  });
});
