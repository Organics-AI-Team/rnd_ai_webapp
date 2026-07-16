import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  // apps/ai is deployed as a backend/worker package. Its old browser demo
  // components are not part of that artifact and remain isolated until G5.10
  // legacy retirement; the production Next.js UI is linted in apps/web.
  globalIgnores([
    "dist/**",
    "node_modules/**",
    "__tests__/examples/**",
    "components/**",
    "hooks/**",
  ]),
]);
