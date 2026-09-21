import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MEMBERSHIP_INACTIVE_MESSAGES,
  is_membership_inactive_error,
} from "../../apps/web/lib/membership_error_routing";

describe("is_membership_inactive_error", () => {
  it("matches FORBIDDEN errors carrying a known membership-loss message", () => {
    expect(
      is_membership_inactive_error({
        message: "Membership is not active.",
        data: { code: "FORBIDDEN" },
      }),
    ).toBe(true);
  });

  it("ignores other FORBIDDEN errors, other codes, and non-errors", () => {
    expect(
      is_membership_inactive_error({
        message: "Missing required permission: formula:confirm.",
        data: { code: "FORBIDDEN" },
      }),
    ).toBe(false);
    expect(
      is_membership_inactive_error({
        message: "Membership is not active.",
        data: { code: "NOT_FOUND" },
      }),
    ).toBe(false);
    expect(is_membership_inactive_error(null)).toBe(false);
    expect(is_membership_inactive_error(undefined)).toBe(false);
  });

  it("covers every message in the closed set", () => {
    for (const message of MEMBERSHIP_INACTIVE_MESSAGES) {
      expect(
        is_membership_inactive_error({
          message: `prefix ${message} suffix`,
          data: { code: "FORBIDDEN" },
        }),
      ).toBe(true);
    }
  });
});

describe("providers wiring", () => {
  it("routes query and mutation cache errors through route_membership_error", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/web/app/providers.tsx"),
      "utf8",
    );
    expect(source).toContain("new QueryCache({");
    expect(source).toContain("new MutationCache({");
    expect(source).toContain("route_membership_error");
  });
});
