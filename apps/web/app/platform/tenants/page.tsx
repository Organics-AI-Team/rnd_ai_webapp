import Link from "next/link";

import { appRouter } from "@/server/index";
import { createCallerFactory, createTRPCContext } from "@/server/trpc";

export const dynamic = "force-dynamic";

/**
 * Platform tenant table. Server-rendered from the platform router; shows
 * lifecycle metadata only — never tenant business data.
 *
 * @returns Tenant administration table.
 */
export default async function PlatformTenantsPage() {
  const caller = createCallerFactory(appRouter)(await createTRPCContext());
  const tenants = await caller.platformTenants.list();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Universities</h2>
        <Link
          href="/platform/tenants/new"
          className="rounded border px-3 py-1 text-sm underline"
        >
          Create university
        </Link>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">Slug</th>
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Plan</th>
            <th className="py-2 pr-4">Region</th>
            <th className="py-2 pr-4">Created</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((tenant: any) => (
            <tr key={tenant._id} className="border-b">
              <td className="py-2 pr-4 font-mono">{tenant.slug}</td>
              <td className="py-2 pr-4">{tenant.name}</td>
              <td className="py-2 pr-4">{tenant.status}</td>
              <td className="py-2 pr-4">{tenant.planKey}</td>
              <td className="py-2 pr-4">{tenant.dataResidencyRegion}</td>
              <td className="py-2 pr-4">
                {tenant.createdAt ? new Date(tenant.createdAt).toISOString().slice(0, 10) : ""}
              </td>
            </tr>
          ))}
          {tenants.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-muted-foreground">
                No universities provisioned yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
