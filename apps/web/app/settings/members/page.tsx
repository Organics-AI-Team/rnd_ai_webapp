// apps/web/app/settings/members/page.tsx
"use client";

import { useState } from "react";

import { trpc } from "@/lib/trpc-client";

type MembersTab = "members" | "invitations";

/**
 * University member administration for managers (Plan 3): Members tab
 * (suspend / reactivate / remove — users only) and Invitations tab (revoke /
 * resend with the derived expired display state). Manager lifecycle is a
 * platform operation and deliberately absent; the server refuses manager
 * targets anyway.
 *
 * @returns Member management page.
 */
export default function MembersPage() {
  const [tab, setTab] = useState<MembersTab>("members");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const members = trpc.tenantMembers.list.useQuery();
  const invitations = trpc.tenantMembers.listInvitations.useQuery();

  /** Refresh both tabs after any mutation (optimistic refresh via invalidate). */
  const refresh = () => {
    void utils.tenantMembers.list.invalidate();
    void utils.tenantMembers.listInvitations.invalidate();
  };
  /** Surface the server's human-readable error text (CONFLICT messages etc.). */
  const on_error = (error: { message: string }) => setMessage(error.message);

  const invite = trpc.tenantMembers.inviteUser.useMutation({
    onSuccess: () => {
      setMessage("Invitation sent.");
      setEmail("");
      refresh();
    },
    onError: on_error,
  });
  const suspend = trpc.tenantMembers.suspendUser.useMutation({
    onSuccess: refresh,
    onError: on_error,
  });
  const reactivate = trpc.tenantMembers.reactivateUser.useMutation({
    onSuccess: refresh,
    onError: on_error,
  });
  const remove = trpc.tenantMembers.removeUser.useMutation({
    onSuccess: refresh,
    onError: on_error,
  });
  const revoke = trpc.tenantMembers.revokeInvitation.useMutation({
    onSuccess: refresh,
    onError: on_error,
  });
  const resend = trpc.tenantMembers.resendInvitation.useMutation({
    onSuccess: () => {
      setMessage("Invitation resent.");
      refresh();
    },
    onError: on_error,
  });

  /**
   * Remove a member after explicit confirmation (soft revoke; re-inviting
   * later restores the same account).
   *
   * @param user_profile_id - Target profile id.
   * @param display - Name/email shown in the confirmation prompt.
   */
  const confirm_remove = (user_profile_id: string, display: string) => {
    if (window.confirm(`Remove ${display} from this university?`)) {
      setMessage(null);
      remove.mutate({ user_profile_id });
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-lg font-semibold">University members</h1>

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          invite.mutate({ email });
        }}
      >
        <label className="block flex-1 text-sm">
          Invite student by email
          <input
            type="email"
            className="mt-1 w-full rounded border px-2 py-1"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={invite.isPending}
          className="rounded border px-4 py-1.5 text-sm"
        >
          {invite.isPending ? "Inviting…" : "Invite"}
        </button>
      </form>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <div className="flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setTab("members")}
          className={`px-3 py-1.5 text-sm ${tab === "members" ? "border-b-2 border-gray-900 font-medium" : "text-gray-500"}`}
        >
          Members
        </button>
        <button
          type="button"
          onClick={() => setTab("invitations")}
          className={`px-3 py-1.5 text-sm ${tab === "invitations" ? "border-b-2 border-gray-900 font-medium" : "text-gray-500"}`}
        >
          Invitations
        </button>
      </div>

      {tab === "members" && (
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
                <td className="py-2 pr-4">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                    {member.tenantRole}
                  </span>
                </td>
                <td className="py-2 pr-4">{member.status}</td>
                <td className="py-2 pr-4 text-right">
                  {member.tenantRole === "user" && member.status === "active" && (
                    <span className="inline-flex gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => {
                          setMessage(null);
                          suspend.mutate({ user_profile_id: member.userProfileId });
                        }}
                      >
                        Suspend
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs text-red-600"
                        onClick={() =>
                          confirm_remove(
                            member.userProfileId,
                            member.displayName || member.email,
                          )
                        }
                      >
                        Remove
                      </button>
                    </span>
                  )}
                  {member.tenantRole === "user" && member.status === "suspended" && (
                    <span className="inline-flex gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        title={
                          member.profileStatus !== "active"
                            ? "The user's account is not active; reactivation is blocked."
                            : undefined
                        }
                        disabled={member.profileStatus !== "active"}
                        onClick={() => {
                          setMessage(null);
                          reactivate.mutate({ user_profile_id: member.userProfileId });
                        }}
                      >
                        Reactivate
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs text-red-600"
                        onClick={() =>
                          confirm_remove(
                            member.userProfileId,
                            member.displayName || member.email,
                          )
                        }
                      >
                        Remove
                      </button>
                    </span>
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
      )}

      {tab === "invitations" && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Sent</th>
              <th className="py-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {(invitations.data ?? []).map((invitation) => (
              <tr key={invitation._id} className="border-b">
                <td className="py-2 pr-4">{invitation.email}</td>
                <td className="py-2 pr-4">{invitation.tenantRole}</td>
                <td className="py-2 pr-4">
                  {invitation.status}
                  {invitation.isExpired && (
                    <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      expired
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {invitation.createdAt
                    ? new Date(invitation.createdAt).toISOString().slice(0, 10)
                    : ""}
                </td>
                <td className="py-2 pr-4 text-right">
                  {invitation.status === "invited" && invitation.tenantRole === "user" && (
                    <span className="inline-flex gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => {
                          setMessage(null);
                          resend.mutate({
                            clerk_invitation_id: invitation.clerkInvitationId,
                          });
                        }}
                      >
                        Resend
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs text-red-600"
                        onClick={() => {
                          setMessage(null);
                          revoke.mutate({
                            clerk_invitation_id: invitation.clerkInvitationId,
                          });
                        }}
                      >
                        Revoke
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {invitations.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-muted-foreground">
                  No invitations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}
