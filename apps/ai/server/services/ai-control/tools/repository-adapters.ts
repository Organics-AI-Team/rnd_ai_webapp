/**
 * Repository-backed governed tool adapters (G3.4).
 *
 * Wires the repository-backed governed tool ports (formula search, comment, and
 * confirm) to the tenant-scoped FormulaRepository. Each adapter is built per run
 * over a resolved, frozen TenantExecutionContext; the model-visible tool schema
 * never carries identity, and every call re-asserts that the executor's trusted
 * tenant matches the bound run context (defence in depth).
 *
 * The draft/revise, knowledge, and web-search ports remain fail-closed
 * NOT_WIRED here: they depend on the Qdrant formulation/knowledge gateway
 * (G3.5) and the approved external web-search adapter, which land with those
 * tasks. This module never falls back to a legacy handler.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";
import type { FormulaRepository } from "../../../repositories/formula-repository";
import type { ProductRepository } from "../../../repositories/product-repository";
import { ResourceNotFoundError } from "../../../repositories/tenant-repository-base";
import type {
  FormulaApprovalGate,
  FormulaArtifactService,
} from "../formula-artifact-service";
import { hash_canonical } from "../hashing";
import { ToolGovernanceError } from "../errors";
import type { TrustedToolContext } from "../tool-definition";
import type { GovernedToolPorts } from "./index";
import type {
  FormulaCommentInput,
  FormulaCommentOutput,
  FormulaConfirmInput,
  FormulaConfirmOutput,
  FormulaDraftInput,
  FormulaDraftOutput,
  FormulaReviseInput,
  FormulaReviseOutput,
  FormulaSearchInput,
  FormulaSearchOutput,
} from "./formula-tools";
import type {
  MaterialSearchInput,
  MaterialSearchOutput,
} from "./material-tools";

/** Dependencies for the repository-backed governed tool ports. */
export interface RepositoryToolPortDeps {
  /** Frozen tenant execution context resolved once at run start. */
  readonly tenant_context: TenantExecutionContext;
  /** Tenant-scoped formula repository. */
  readonly formula_repository: FormulaRepository;
  /** Validated artifact commit path. Omission keeps formula.confirm fail-closed. */
  readonly formula_commit?: {
    readonly service: Pick<FormulaArtifactService, "commit_confirmed">;
    readonly approval_gate: FormulaApprovalGate;
  };
  /** Tenant-scoped product repository. Omission keeps material.search fail-closed. */
  readonly product_repository?: ProductRepository;
}

/** Default number of search results when the caller does not specify a limit. */
const DEFAULT_SEARCH_LIMIT = 10;

/**
 * Assert the executor's trusted tenant matches the bound run context. The
 * governed executor already injects a trusted context, but re-checking here
 * makes a wiring mistake fail closed rather than crossing tenants.
 *
 * @param trusted - Trusted context injected by the tool executor.
 * @param context - The bound run tenant context.
 * @throws ToolGovernanceError TOOL_INPUT_INVALID on mismatch.
 */
function assert_same_tenant(
  trusted: TrustedToolContext,
  context: TenantExecutionContext,
): void {
  if (trusted.tenant_id !== context.tenant_id) {
    throw new ToolGovernanceError(
      "TOOL_INPUT_INVALID",
      "The tool call tenant does not match the run tenant context.",
    );
  }
}

/**
 * Build a fail-closed rejection for a port that depends on a gateway not yet
 * wired here (Qdrant formulation/knowledge — G3.5 — or external web search).
 *
 * @param port_name - Name of the port method.
 * @returns Function that always rejects with NOT_WIRED.
 */
function not_wired(port_name: string): () => Promise<never> {
  return async () => {
    throw new ToolGovernanceError(
      "NOT_WIRED",
      `Adapter ${port_name} depends on the Qdrant formulation/knowledge gateway (G3.5) or the external web-search adapter; not wired here.`,
    );
  };
}

/**
 * Extract a lowercased searchable blob for a formula document.
 *
 * @param formula - Formula document.
 * @returns Concatenated lowercase text over name, benefits, and ingredients.
 */
function searchable_text(formula: Document): string {
  const benefits = Array.isArray(formula.targetBenefits)
    ? formula.targetBenefits.join(" ")
    : "";
  const ingredients = Array.isArray(formula.ingredients)
    ? formula.ingredients
        .map((ing: Record<string, unknown>) =>
          [ing.inci_name, ing.productName, ing.rm_code].filter(Boolean).join(" "),
        )
        .join(" ")
    : "";
  return [formula.formulaName, formula.client, formula.remarks, benefits, ingredients]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Map a formula document to one FormulaSearch result row.
 *
 * @param formula - Formula document.
 * @returns The strict search-result row.
 */
function to_search_row(
  formula: WithId<Document>,
): FormulaSearchOutput["formulas"][number] {
  return {
    formula_id: String(formula._id),
    formula_code: formula.formulaCode ?? null,
    formula_name: String(formula.formulaName ?? ""),
    version: typeof formula.version === "number" ? formula.version : 0,
    status: String(formula.status ?? "draft"),
    client_name: formula.client ?? null,
    target_benefits: Array.isArray(formula.targetBenefits)
      ? formula.targetBenefits.map(String)
      : [],
    ingredient_count: Array.isArray(formula.ingredients)
      ? formula.ingredients.length
      : 0,
    total_amount_grams:
      typeof formula.totalAmount === "number" ? formula.totalAmount : null,
    updated_at:
      formula.updatedAt instanceof Date
        ? formula.updatedAt.toISOString()
        : formula.updatedAt
          ? String(formula.updatedAt)
          : null,
  };
}

/**
 * Map one product document to a material.search result row.
 *
 * @param doc - Tenant product document (canonical + legacy alias fields).
 * @returns The strict material row.
 */
function to_material_row(doc: Document): MaterialSearchOutput["materials"][number] {
  return {
    material_id: String(doc._id),
    rm_code: String(doc.productCode ?? doc.rm_code ?? ""),
    name: String(doc.productName ?? doc.trade_name ?? ""),
    inci_name: String(doc.INCI_name ?? doc.inci_name ?? ""),
    cas_no: String(doc.cas_no ?? ""),
    supplier: String(doc.supplier ?? ""),
    price_thb_per_kg: typeof doc.price === "number" ? doc.price : null,
    benefits: Array.isArray(doc.benefits) ? doc.benefits.map(String) : [],
    functions: Array.isArray(doc.functions) ? doc.functions.map(String) : [],
    in_stock: typeof doc.stockQuantity === "number" ? doc.stockQuantity > 0 : false,
  };
}

/**
 * Build the repository-backed governed tool ports for one run.
 *
 * @param deps - The bound tenant context, formula repository, and optional product repository.
 * @returns GovernedToolPorts with search/comment/confirm wired to the
 *          repository and the remaining ports fail-closed NOT_WIRED.
 */
export function create_repository_backed_tool_ports(
  deps: RepositoryToolPortDeps,
): GovernedToolPorts {
  const { tenant_context, formula_repository, formula_commit, product_repository } = deps;

  return {
    formula_search: {
      /**
       * Tenant-scoped formula search: list the caller's formulas (never another
       * tenant's) and filter deterministically by query/status/client/benefits.
       */
      async search_formulas(
        args: FormulaSearchInput,
        trusted: TrustedToolContext,
      ): Promise<FormulaSearchOutput> {
        assert_same_tenant(trusted, tenant_context);
        const all = await formula_repository.list_formulas(tenant_context);
        const needle = args.query.toLowerCase();
        const benefit_needles = (args.benefits ?? []).map((benefit) =>
          benefit.toLowerCase(),
        );
        const matched = all.filter((formula) => {
          if (!searchable_text(formula).includes(needle)) return false;
          if (args.status && String(formula.status ?? "draft") !== args.status) {
            return false;
          }
          if (
            args.client_name &&
            !String(formula.client ?? "")
              .toLowerCase()
              .includes(args.client_name.toLowerCase())
          ) {
            return false;
          }
          if (benefit_needles.length > 0) {
            const formula_benefits = (
              Array.isArray(formula.targetBenefits) ? formula.targetBenefits : []
            )
              .map((benefit: unknown) => String(benefit).toLowerCase())
              .join(" ");
            if (!benefit_needles.some((benefit) => formula_benefits.includes(benefit))) {
              return false;
            }
          }
          return true;
        });
        const limited = matched.slice(0, args.limit ?? DEFAULT_SEARCH_LIMIT);
        return {
          result_count: limited.length,
          formulas: limited.map(to_search_row),
        };
      },
    },

    formula_comment: {
      /**
       * Append a comment to a tenant-owned formula. A cross-tenant/absent
       * formula_id surfaces as the repository's FORMULA_NOT_FOUND.
       */
      async add_formula_comment(
        args: FormulaCommentInput,
        trusted: TrustedToolContext,
      ): Promise<FormulaCommentOutput> {
        assert_same_tenant(trusted, tenant_context);
        const comment_type = args.comment_type ?? "feedback";
        const doc = await formula_repository.add_comment(
          tenant_context,
          args.formula_id,
          { content: args.content, commentType: comment_type },
        );
        return {
          comment_id: String(doc._id),
          formula_id: args.formula_id,
          comment_type: String(doc.commentType ?? comment_type),
          created_at:
            doc.createdAt instanceof Date
              ? doc.createdAt.toISOString()
              : new Date().toISOString(),
        };
      },
    },

    formula_confirm: {
      /**
       * Confirm a tenant-owned draft, bumping its version. The executor's
       * deterministic idempotency key makes the commit replay-safe.
       */
      async confirm_formula(
        args: FormulaConfirmInput,
        trusted: TrustedToolContext,
      ): Promise<FormulaConfirmOutput> {
        assert_same_tenant(trusted, tenant_context);
        if (!formula_commit) {
          throw new ToolGovernanceError(
            "NOT_WIRED",
            "The validated formula artifact commit adapter is unavailable.",
          );
        }
        const arguments_hash = hash_canonical(args);
        const confirmed = await formula_commit.service.commit_confirmed(
          tenant_context,
          {
            artifact_id: args.artifact_id,
            run_id: trusted.run_id,
            idempotency_key: trusted.idempotency_key,
            approval_checkpoint_id:
              `${trusted.run_id}:approval:formula.confirm:${arguments_hash}`,
          },
          formula_commit.approval_gate,
        );
        return {
          artifact_id: args.artifact_id,
          formula_id: confirmed.formula_id,
          status: "confirmed",
          already_committed: confirmed.already_committed,
        };
      },
    },

    formula_draft: {
      async create_draft_formula(
        args: FormulaDraftInput,
        trusted: TrustedToolContext,
      ): Promise<FormulaDraftOutput> {
        assert_same_tenant(trusted, tenant_context);
        // The model proposes the candidate, but cannot certify it. The
        // orchestration artifact service deterministically validates this
        // canonical shape before finalization and durable persistence.
        return args.artifact;
      },
    },

    formula_revise: {
      async revise_formula(
        args: FormulaReviseInput,
        trusted: TrustedToolContext,
      ): Promise<FormulaReviseOutput> {
        assert_same_tenant(trusted, tenant_context);
        const parent = await formula_repository.get_formula(
          tenant_context,
          args.formula_id,
        );
        if (String(parent.ownerProfileId ?? "") !== tenant_context.actor_profile_id) {
          // `formula:draft:update_own` must not disclose that another user's
          // formula exists, even within the same tenant.
          throw new ResourceNotFoundError("FORMULA_NOT_FOUND");
        }
        return args.artifact;
      },
    },

    material_search: product_repository
      ? {
          /**
           * Tenant-scoped structured material search over the product
           * repository; the trusted tenant is re-asserted on every call.
           */
          async search_materials(
            args: MaterialSearchInput,
            trusted: TrustedToolContext,
          ): Promise<MaterialSearchOutput> {
            assert_same_tenant(trusted, tenant_context);
            const { documents, total_count } = await product_repository.search_products(
              tenant_context,
              {
                ...(args.query ? { search_term: args.query } : {}),
                ...(typeof args.max_price === "number" ? { max_price: args.max_price } : {}),
                ...(args.in_stock_only ? { in_stock_only: true } : {}),
                ...(args.exclude_inci && args.exclude_inci.length > 0
                  ? { exclude_terms: args.exclude_inci }
                  : {}),
                active_only: true,
                sort_field: "price",
                sort_direction: "asc",
                limit: args.limit ?? DEFAULT_SEARCH_LIMIT,
              },
            );
            const empty_hint =
              documents.length === 0
                ? "0 matches. This catalog matches lexically on ingredient names, INCI, CAS, codes, and CosIng function terms — marketing concepts are not in the data. Do NOT re-query variations: use knowledge.search to translate the concept into ingredient names, or proceed to formula.draft with materials already found (common bases go in by INCI name)."
                : undefined;
            return {
              result_count: documents.length,
              total_count,
              materials: documents.map(to_material_row),
              ...(empty_hint ? { hint: empty_hint } : {}),
            };
          },
        }
      : { search_materials: not_wired("material.search") },

    // Knowledge and provisioned web search are overridden by the production
    // runtime. The repository layer itself keeps both external ports closed.
    knowledge_search: { search_knowledge: not_wired("knowledge.search") },
    web_search: { search_web: not_wired("web.search") },
  };
}
