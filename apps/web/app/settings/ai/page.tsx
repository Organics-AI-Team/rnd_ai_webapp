import { appRouter } from "@/server/index";
import { createCallerFactory, createTRPCContext } from "@/server/trpc";

export const dynamic = "force-dynamic";

/**
 * Tenant AI settings (manager). Server-rendered from the tenant AI settings
 * router; the caller enforces tenant:ai:read, so a non-manager sees the
 * access-denied fallback. Locked (plan/platform-constrained) ceilings are shown
 * beside the stored values.
 *
 * @returns The tenant AI settings surface.
 */
export default async function TenantAiSettingsPage() {
  const caller = createCallerFactory(appRouter)(await createTRPCContext());
  let view: Awaited<ReturnType<typeof caller.tenantAiSettings.read>> | null = null;
  try {
    view = await caller.tenantAiSettings.read();
  } catch {
    return (
      <div className="space-y-2">
        <h2 className="text-base font-semibold">AI settings</h2>
        <p className="text-sm text-neutral-500">
          You do not have permission to view AI settings. Ask a workspace manager.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">AI settings</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">Status</dt>
        <dd>{view.status}</dd>
        <dt className="text-neutral-500">Plan</dt>
        <dd>{view.plan_key ?? "—"}</dd>
        <dt className="text-neutral-500">Policy version</dt>
        <dd>{view.policy_version ?? "—"}</dd>
        <dt className="text-neutral-500">Max iterations</dt>
        <dd>
          {view.max_iterations ?? "—"}{" "}
          <span className="text-neutral-400">
            (platform max {view.platform_ceilings.max_iterations})
          </span>
        </dd>
        <dt className="text-neutral-500">Allowed models</dt>
        <dd>{(view.allowed_models as string[]).join(", ") || "—"}</dd>
        <dt className="text-neutral-500">Default locale</dt>
        <dd>{view.default_locale ?? "—"}</dd>
      </dl>
      <p className="text-xs text-neutral-400">
        Values are capped by your plan and the platform hard limits; requests
        above a cap are rejected.
      </p>
    </div>
  );
}
