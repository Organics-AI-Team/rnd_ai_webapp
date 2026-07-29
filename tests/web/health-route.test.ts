import { describe, expect, it } from "vitest";

import { GET } from "../../apps/web/app/api/health/route";

describe("public deployment health route", () => {
  it("returns a cache-free 200 response without credentials or tenant data", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
