import { appRouter } from "@/server/index";
import { createCallerFactory, createTRPCContext } from "@/server/trpc";

export const dynamic = "force-dynamic";

/**
 * Tenant knowledge sources. Server-rendered from the knowledge sources router;
 * the caller enforces tenant:knowledge:read. Shows source metadata and
 * ingestion status only — never content.
 *
 * @returns The tenant knowledge sources surface.
 */
export default async function TenantKnowledgePage() {
  const caller = createCallerFactory(appRouter)(await createTRPCContext());
  let sources: Awaited<ReturnType<typeof caller.knowledgeSources.list>> = [];
  try {
    sources = await caller.knowledgeSources.list();
  } catch {
    return (
      <div className="space-y-2">
        <h2 className="text-base font-semibold">Knowledge sources</h2>
        <p className="text-sm text-neutral-500">
          You do not have permission to view knowledge sources.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Knowledge sources</h2>
      {sources.length === 0 ? (
        <p className="text-sm text-neutral-500">No knowledge sources yet.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Visibility</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.source_id} className="border-b">
                <td className="py-2 pr-4">{source.name}</td>
                <td className="py-2 pr-4">{source.source_type}</td>
                <td className="py-2 pr-4">{source.status}</td>
                <td className="py-2 pr-4">{source.visibility}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
