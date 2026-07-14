"use client";

import { useState } from "react";

import { trpc } from "@/lib/trpc-client";

/**
 * University member administration for managers: list members, invite a
 * student, suspend a user. Role promotion is deliberately absent — manager
 * appointment is a platform operation and the server rejects it anyway.
 *
 * @returns Member management page.
 */
export default function MembersPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const members = trpc.tenantMembers.list.useQuery();
  const invite = trpc.tenantMembers.inviteUser.useMutation({
    onSuccess: () => {
      setMessage("Invitation sent.");
      setEmail("");
      void utils.tenantMembers.list.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });
  const suspend = trpc.tenantMembers.suspendUser.useMutation({
    onSuccess: () => void utils.tenantMembers.list.invalidate(),
    onError: (error) => setMessage(error.message),
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
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
                {member.status === "active" && member.tenantRole === "user" && (
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() =>
                      suspend.mutate({ user_profile_id: member.userProfileId })
                    }
                  >
                    Suspend
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
    </main>
  );
}
