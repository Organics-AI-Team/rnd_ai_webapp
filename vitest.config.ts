import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror the web runtime's webpack aliases (apps/web/next.config.js):
    // "@/ai" and "@/server" reach the AI workspace; every other "@/" path
    // resolves inside apps/web.
    alias: [
      {
        find: /^@\/ai/,
        replacement: fileURLToPath(new URL("./apps/ai", import.meta.url)),
      },
      {
        find: /^@\/server/,
        replacement: fileURLToPath(new URL("./apps/ai/server", import.meta.url)),
      },
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./apps/web/", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts", "apps/**/__tests__/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
