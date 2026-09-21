import type { Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import {
  ResourceNotFoundError,
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  list_scoped_documents,
  scoped_id_filter,
  update_scoped_document,
} from "./tenant-repository-base";

const NOT_FOUND = "CALCULATION_NOT_FOUND";

/**
 * Tenant-scoped repository over the price_calculations collection. Every
 * method takes a TenantExecutionContext — never a tenant ID.
 */
export interface CalculationRepository {
  create_calculation(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  get_calculation(
    context: TenantExecutionContext,
    calculation_id: string,
  ): Promise<WithId<Document>>;
  list_calculations(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  update_calculation(
    context: TenantExecutionContext,
    calculation_id: string,
    patch: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  delete_calculation(context: TenantExecutionContext, calculation_id: string): Promise<void>;
}

/**
 * Create the price-calculation repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance; all failures use code "CALCULATION_NOT_FOUND".
 */
export function create_calculation_repository(db: Db): CalculationRepository {
  const price_calculations = db.collection("price_calculations");
  return {
    async create_calculation(context, input) {
      return insert_scoped_document(price_calculations, context, input, "actor");
    },
    async get_calculation(context, calculation_id) {
      return get_scoped_document(price_calculations, context, calculation_id, NOT_FOUND);
    },
    async list_calculations(context) {
      return list_scoped_documents(price_calculations, context);
    },
    async update_calculation(context, calculation_id, patch) {
      return update_scoped_document(price_calculations, context, calculation_id, NOT_FOUND, patch, {
        actorProfileId: context.actor_profile_id,
      });
    },
    async delete_calculation(context, calculation_id) {
      const result = await price_calculations.deleteOne({
        ...scoped_id_filter(context, calculation_id, NOT_FOUND),
        actorProfileId: context.actor_profile_id,
      });
      if (result.deletedCount === 0) throw new ResourceNotFoundError(NOT_FOUND);
    },
  };
}
