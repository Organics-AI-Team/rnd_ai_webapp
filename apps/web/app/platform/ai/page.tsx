import { appRouter } from "@/server/index";
import { createCallerFactory, createTRPCContext } from "@/server/trpc";

export const dynamic = "force-dynamic";

/**
 * Platform AI constraints console. Server-rendered from the platform AI settings
 * router; the caller enforces a platform role. Shows hard limits, the provider/
 * tool universe, plans, and the emergency-disable state — never tenant
 * conversations or artifacts.
 *
 * @returns The platform AI constraints surface.
 */
export default async function PlatformAiPage() {
  const caller = createCallerFactory(appRouter)(await createTRPCContext());
  let constraints: Awaited<ReturnType<typeof caller.platformAiSettings.getConstraints>> | null =
    null;
  try {
    constraints = await caller.platformAiSettings.getConstraints();
  } catch {
    return (
      <div className="space-y-2">
        <h2 className="text-base font-semibold">Platform AI constraints</h2>
        <p className="text-sm text-neutral-500">A platform role is required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Platform AI constraints</h2>
        {constraints.emergency_disabled ? (
          <span className="rounded bg-red-100 px-2 py-1 text-xs text-red-700">
            AI emergency-disabled
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">Max iterations (hard)</dt>
        <dd>{constraints.hard_limits.max_iterations}</dd>
        <dt className="text-neutral-500">Max concurrent runs (hard)</dt>
        <dd>{constraints.hard_limits.max_concurrent_runs}</dd>
        <dt className="text-neutral-500">Plans</dt>
        <dd>{constraints.plans.join(", ")}</dd>
        <dt className="text-neutral-500">Tools</dt>
        <dd className="font-mono text-xs">{constraints.tool_universe.join(", ")}</dd>
      </dl>
    </div>
  );
}
