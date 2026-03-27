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
        /* Cloudflare-inspired palette */
        line: {
          DEFAULT: "#06C755",
          dark: "#00B900",
          light: "#52D681",
        },
        sidebar: {
          bg: "var(--sidebar-bg)",
          fg: "var(--sidebar-fg)",
          muted: "var(--sidebar-muted)",
          accent: "var(--sidebar-accent)",
          border: "var(--sidebar-border)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],  /* 10px */
        xs: ["0.6875rem", { lineHeight: "1rem" }],         /* 11px */
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],      /* 13px */
        base: ["0.875rem", { lineHeight: "1.375rem" }],    /* 14px */
        lg: ["1rem", { lineHeight: "1.5rem" }],             /* 16px */
        xl: ["1.125rem", { lineHeight: "1.75rem" }],        /* 18px */
        "2xl": ["1.25rem", { lineHeight: "1.75rem" }],      /* 20px */
      },
      borderRadius: {
        lg: "0.5rem",
        md: "0.375rem",
        sm: "0.25rem",
      },
      boxShadow: {
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.04)",
        DEFAULT: "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
        md: "0 2px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
      },
    },
  },
  plugins: [],
};
export default config;
