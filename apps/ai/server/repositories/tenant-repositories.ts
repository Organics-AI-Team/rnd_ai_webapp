import type { Db } from "mongodb";

import {
  create_audit_log_repository,
  type AuditLogRepository,
} from "./audit-log-repository";
import {
  create_calculation_repository,
  type CalculationRepository,
} from "./calculation-repository";
import {
  create_conversation_repository,
  type ConversationRepository,
} from "./conversation-repository";
import {
  create_feedback_repository,
  type FeedbackRepository,
} from "./feedback-repository";
import {
  create_formula_repository,
  type FormulaRepository,
} from "./formula-repository";
import { create_order_repository, type OrderRepository } from "./order-repository";
import {
  create_product_repository,
  type ProductRepository,
} from "./product-repository";
import { create_stock_repository, type StockRepository } from "./stock-repository";

/**
 * The complete tenant-scoped data-access surface handed to converted tRPC
 * routers (and, in G2.6, to legacy AI tool handlers). Every method requires a
 * TenantExecutionContext; no repository accepts a tenant ID argument.
 */
export interface TenantRepositories {
  readonly products: ProductRepository;
  readonly stock: StockRepository;
  readonly orders: OrderRepository;
  readonly formulas: FormulaRepository;
  readonly calculations: CalculationRepository;
  readonly conversations: ConversationRepository;
  readonly feedback: FeedbackRepository;
  readonly audit_log: AuditLogRepository;
}

/**
 * Build the full set of tenant-scoped domain repositories over one database
 * handle.
 *
 * @param db - Connected MongoDB database handle.
 * @returns Frozen bundle of every G2.4 domain repository.
 */
export function create_tenant_repositories(db: Db): TenantRepositories {
  return Object.freeze({
    products: create_product_repository(db),
    stock: create_stock_repository(db),
    orders: create_order_repository(db),
    formulas: create_formula_repository(db),
    calculations: create_calculation_repository(db),
    conversations: create_conversation_repository(db),
    feedback: create_feedback_repository(db),
    audit_log: create_audit_log_repository(db),
  });
}
