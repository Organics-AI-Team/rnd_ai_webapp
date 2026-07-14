import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { Providers } from "./providers";
import { ConditionalLayout } from "@/components/conditional-layout";
import { is_clerk_enabled } from "@/lib/server/clerk-config";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "R&D AI",
  description: "Research & Development AI",
  icons: {
    icon: [
      {
        url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='0.9em' font-size='90'>🤖</text></svg>",
        type: "image/svg+xml",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const app_tree = (
    <Providers>
      <ConditionalLayout>{children}</ConditionalLayout>
    </Providers>
  );
  return (
    <html lang="th">
      <body className={inter.className}>
        {/* ClerkProvider sits inside body (G1.1) and activates only when the
            deployment configures Clerk; the legacy flow renders otherwise
            until the G1.7 cutover. */}
        {is_clerk_enabled() ? <ClerkProvider>{app_tree}</ClerkProvider> : app_tree}
      </body>
    </html>
  );
}
