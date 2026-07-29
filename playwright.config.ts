import { defineConfig } from "@playwright/test";

const hosted_base_url = process.env.E2E_BASE_URL;

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
  workers: hosted_base_url ? undefined : 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: hosted_base_url ?? "http://localhost:3000",
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: hosted_base_url
    ? undefined
    : {
        command: "npm run dev:web",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          ...process.env,
          COMMERCIAL_TEST_ADAPTER_MODE: "credential_free",
        },
      },
});
