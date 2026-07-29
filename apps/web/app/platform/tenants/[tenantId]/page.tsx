"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { trpc } from "@/lib/trpc-client";

/**
 * Platform tenant detail (Plan 3): tenant metadata, member list, appoint-
 * manager form, and per-manager demotion. The surrounding /platform layout
 * gates rendering server-side; every query/mutation here is additionally
 * authorized by platformAdminProcedure. Shows tenant lifecycle metadata and
 * identity rows only — never tenant business data.
 *
 * @returns Tenant detail administration page.
 */
export default function PlatformTenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const tenant_id = params.tenantId;
  const [managerEmail, setManagerEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const tenants = trpc.platformTenants.list.useQuery();
  const members = trpc.platformTenants.listMembers.useQuery({ tenant_id });
  // MongoDB projection includes slug/name/status/planKey/dataResidencyRegion/
  // clerkOrganizationId. The tRPC router spreads the full document; TypeScript
  // can only infer the _id field because MongoDB's with-projection type is
  // opaque. We cast to the known runtime shape.
  const tenant = tenants.data?.find((entry: any) => entry._id === tenant_id) as
    | {
        _id: string;
        name?: string;
        slug?: string;
        status?: string;
        planKey?: string;
        dataResidencyRegion?: string;
        clerkOrganizationId?: string;
      }
    | undefined;

  /** Refresh the member list after any mutation. */
  const refresh = () =>
    void utils.platformTenants.listMembers.invalidate({ tenant_id });

  const appoint = trpc.platformTenants.appointManager.useMutation({
    onSuccess: () => {
      setMessage("Manager invitation sent.");
      setManagerEmail("");
      refresh();
    },
    onError: (error) => setMessage(error.message),
  });
  const demote = trpc.platformTenants.demoteManager.useMutation({
    onSuccess: () => {
      setMessage("Manager demoted to user.");
      refresh();
    },
    onError: (error) => setMessage(error.message),
  });

  /**
   * Demote one manager after explicit confirmation (last-manager demotions
   * are refused server-side with a CONFLICT message).
   *
   * @param user_profile_id - Target profile id.
   * @param display - Name/email shown in the confirmation prompt.
   */
  const confirm_demote = (user_profile_id: string, display: string) => {
    if (window.confirm(`Demote ${display} to user?`)) {
      setMessage(null);
      demote.mutate({ tenant_id, user_profile_id });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm underline" href="/platform/tenants">
          ← Universities
        </Link>
        <h2 className="mt-2 text-base font-semibold">
          {tenant ? tenant.name : "University"}
        </h2>
      </div>

      {tenant && (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Slug</dt>
            <dd className="font-mono">{tenant.slug}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd>{tenant.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Plan</dt>
            <dd>{tenant.planKey}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Region</dt>
            <dd>{tenant.dataResidencyRegion}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Clerk organization</dt>
            <dd className="font-mono">{tenant.clerkOrganizationId ?? "—"}</dd>
          </div>
        </dl>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          appoint.mutate({ tenant_id, email: managerEmail });
        }}
      >
        <label className="block flex-1 text-sm">
          Appoint manager by email
          <input
            type="email"
            className="mt-1 w-full rounded border px-2 py-1"
            value={managerEmail}
            onChange={(event) => setManagerEmail(event.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={appoint.isPending}
          className="rounded border px-4 py-1.5 text-sm"
        >
          {appoint.isPending ? "Appointing…" : "Appoint"}
        </button>
      </form>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Email</th>
            <th className="py-2 pr-4">Role</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4" />
          </tr>
        </thead>
        <tbody>
          {(members.data ?? []).map((member) => (
            <tr key={member._id} className="border-b">
              <td className="py-2 pr-4">{member.displayName}</td>
              <td className="py-2 pr-4">{member.email}</td>
              <td className="py-2 pr-4">{member.tenantRole}</td>
              <td className="py-2 pr-4">{member.status}</td>
              <td className="py-2 pr-4 text-right">
                {member.tenantRole === "manager" && member.status === "active" && (
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() =>
                      confirm_demote(
                        member.userProfileId,
                        member.displayName || member.email,
                      )
                    }
                  >
                    Demote to user
                  </button>
                )}
              </td>
            </tr>
          ))}
          {members.data?.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-muted-foreground">
                No members yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
