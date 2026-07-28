"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { AppAuthProvider } from "@/lib/app-auth";
import { route_membership_error } from "@/lib/membership_error_routing";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Mid-session membership loss (suspended / removed / tenant
        // deactivated) routes to /onboarding, which explains the state.
        queryCache: new QueryCache({
          onError: (error) => route_membership_error(error),
        }),
        mutationCache: new MutationCache({
          onError: (error) => route_membership_error(error),
        }),
        defaultOptions: {
          queries: {
            // Serve cached data for a minute before background refresh —
            // console data does not change second-to-second, and staleTime 0
            // was refetching every query on each navigation/focus.
            staleTime: 60_000,
            // Keep unused query caches for 10 minutes so back-navigation
            // renders instantly from cache instead of a cross-region fetch.
            gcTime: 10 * 60_000,
            // Focus-driven refetches caused visible reload flashes on tab
            // switches; explicit invalidation covers mutations instead.
            refetchOnWindowFocus: false,
            // One retry keeps transient network blips invisible without
            // tripling the latency of genuine failures.
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AppAuthProvider>{children}</AppAuthProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
