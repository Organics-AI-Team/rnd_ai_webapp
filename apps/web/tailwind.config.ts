import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "var(--ui-canvas)",
        surface: "var(--ui-surface)",
        subtle: "var(--ui-surface-subtle)",
        ink: "var(--ui-ink)",
        muted: "var(--ui-muted)",
        border: "var(--ui-border)",
        "border-strong": "var(--ui-border-strong)",
        brand: "var(--ui-brand)",
        "brand-hover": "var(--ui-brand-hover)",
        "brand-soft": "var(--ui-brand-soft)",
        overlay: "var(--ui-overlay)",
        line: {
          DEFAULT: "var(--ui-brand)",
          dark: "var(--ui-brand-hover)",
          light: "var(--ui-brand-soft)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
        xs: ["0.6875rem", { lineHeight: "1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.375rem" }],
        lg: ["1rem", { lineHeight: "1.5rem" }],
        xl: ["1.125rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.25rem", { lineHeight: "1.75rem" }],
      },
      borderRadius: {
        lg: "0.5rem",
        md: "0.375rem",
        sm: "0.25rem",
      },
      boxShadow: {
        sm: "0 1px 2px rgb(25 31 35 / 0.04)",
        DEFAULT: "0 2px 6px rgb(25 31 35 / 0.05)",
        md: "0 6px 16px rgb(25 31 35 / 0.07)",
        panel: "0 12px 30px rgb(25 31 35 / 0.08)",
        modal: "0 24px 64px rgb(25 31 35 / 0.18)",
      },
    },
  },
  plugins: [],
};
export default config;
