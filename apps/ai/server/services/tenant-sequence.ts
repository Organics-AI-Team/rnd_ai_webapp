import type { Db } from "mongodb";

export async function allocate_tenant_sequence(
  db: Db,
  tenant_id: string,
  sequence: string,
  minimum: number,
): Promise<number> {
  const counters = db.collection("tenant_sequences");
  await counters.updateOne(
    { tenantId: tenant_id, sequence },
    { $max: { value: minimum }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  const allocated = await counters.findOneAndUpdate(
    { tenantId: tenant_id, sequence },
    { $inc: { value: 1 }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!allocated) throw new Error(`Failed to allocate tenant sequence ${sequence}.`);
  return Number(allocated.value);
}
