import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the commercial E2E suite (G1.7+).
 *
 * The Clerk-auth specs require a staged environment with Clerk credentials
 * and seeded test principals; they skip themselves when
 * E2E_CLERK_CONFIGURED is not "true" so local/CI runs without staging
 * secrets stay green while the gate remains executable in staging.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:web",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
