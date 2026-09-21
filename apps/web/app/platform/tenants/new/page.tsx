"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc-client";

/**
 * Create-university form. Submits the exact CreateUniversityInput contract;
 * the idempotency key is generated once per form instance so a retried
 * submission can never provision a second university.
 *
 * @returns University creation form.
 */
export default function NewTenantPage() {
  const router = useRouter();
  const idempotency_key = useMemo(() => crypto.randomUUID(), []);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [region, setRegion] = useState("sgp");
  const [planKey, setPlanKey] = useState("standard");
  const [managerEmail, setManagerEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.platformTenants.create.useMutation({
    onSuccess: () => router.push("/platform/tenants"),
    onError: (mutation_error) => setError(mutation_error.message),
  });

  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        create.mutate({
          name,
          slug,
          region: region as "sgp" | "bkk",
          plan_key: planKey,
          initial_manager_email: managerEmail,
          idempotency_key,
        });
      }}
    >
      <h2 className="text-base font-semibold">Create university</h2>
      <label className="block text-sm">
        Name
        <input
          className="mt-1 w-full rounded border px-2 py-1"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        Slug
        <input
          className="mt-1 w-full rounded border px-2 py-1 font-mono"
          value={slug}
          onChange={(event) => setSlug(event.target.value.toLowerCase())}
          pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]"
          required
        />
      </label>
      <label className="block text-sm">
        Data residency region
        <select
          className="mt-1 w-full rounded border px-2 py-1"
          value={region}
          onChange={(event) => setRegion(event.target.value)}
        >
          <option value="sgp">Singapore (sgp)</option>
          <option value="bkk">Bangkok (bkk)</option>
        </select>
      </label>
      <label className="block text-sm">
        Plan
        <input
          className="mt-1 w-full rounded border px-2 py-1"
          value={planKey}
          onChange={(event) => setPlanKey(event.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        Initial manager email
        <input
          type="email"
          className="mt-1 w-full rounded border px-2 py-1"
          value={managerEmail}
          onChange={(event) => setManagerEmail(event.target.value)}
          required
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded border px-4 py-2 text-sm"
      >
        {create.isPending ? "Provisioning…" : "Provision university"}
      </button>
    </form>
  );
}
