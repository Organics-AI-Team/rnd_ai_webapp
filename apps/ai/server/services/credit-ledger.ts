import { ObjectId, type ClientSession, type Document, type MongoClient } from "mongodb";

export class CreditAccountNotFoundError extends Error {}
export class InsufficientCreditsError extends Error {}

export interface CreditMutation {
  readonly tenant_id: string;
  readonly type: "add" | "deduct" | "adjust";
  readonly amount?: number;
  readonly new_balance?: number;
  readonly transaction: Record<string, unknown>;
}

export interface CreditMutationResult {
  readonly balance_before: number;
  readonly balance_after: number;
}

export async function mutate_credit_balance(
  client: MongoClient,
  input: CreditMutation,
  existing_session?: ClientSession,
): Promise<CreditMutationResult> {
  if (!ObjectId.isValid(input.tenant_id)) throw new CreditAccountNotFoundError();
  const tenant_object_id = new ObjectId(input.tenant_id);
  const apply = async (session: ClientSession): Promise<CreditMutationResult> => {
    const db = client.db();
    const tenant = await db.collection("tenants").findOne(
      { _id: tenant_object_id },
      { session },
    );
    const collection_name = tenant ? "tenants" : "organizations";
    const balance_field = tenant ? "creditBalance" : "credits";
    const account = tenant ?? await db.collection("organizations").findOne(
      { _id: tenant_object_id },
      { session },
    );
    if (!account) throw new CreditAccountNotFoundError();

    const balance_before = Number(account[balance_field] ?? account.credits ?? 0);
    if (tenant && account.creditBalance === undefined) {
      await db.collection("tenants").updateOne(
        { _id: tenant_object_id, creditBalance: { $exists: false } },
        { $set: { creditBalance: balance_before, updatedAt: new Date() } },
        { session },
      );
    }
    const balance_after = input.type === "adjust"
      ? Number(input.new_balance)
      : balance_before + (input.type === "add" ? 1 : -1) * Number(input.amount);
    if (!Number.isFinite(balance_after) || balance_after < 0) {
      throw new InsufficientCreditsError();
    }

    const update_filter: Document = { _id: tenant_object_id };
    if (input.type === "deduct") {
      update_filter[balance_field] = { $gte: Number(input.amount) };
    }
    const update = input.type === "adjust"
      ? { $set: { [balance_field]: balance_after, updatedAt: new Date() } }
      : { $inc: { [balance_field]: input.type === "add" ? Number(input.amount) : -Number(input.amount) }, $set: { updatedAt: new Date() } };
    const result = await db.collection(collection_name).updateOne(
      update_filter,
      update,
      { session },
    );
    if (result.matchedCount !== 1) {
      if (input.type === "deduct") throw new InsufficientCreditsError();
      throw new CreditAccountNotFoundError();
    }

    await db.collection("credit_transactions").insertOne({
      ...input.transaction,
      organizationId: input.tenant_id,
      type: input.type,
      amount: input.type === "adjust" ? balance_after - balance_before : Number(input.amount),
      balanceBefore: balance_before,
      balanceAfter: balance_after,
      createdAt: new Date(),
    }, { session });
    return { balance_before, balance_after };
  };

  if (existing_session) return apply(existing_session);
  const session = client.startSession();
  try {
    return await session.withTransaction(() => apply(session));
  } finally {
    await session.endSession();
  }
}
