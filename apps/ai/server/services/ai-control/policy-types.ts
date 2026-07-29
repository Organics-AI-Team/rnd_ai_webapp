/**
 * Effective tenant AI policy contract consumed by the tool catalogue,
 * tool executor, context assembler, and policy compiler.
 *
 * G3.1 landed the canonical contract in packages/shared-types/src/ai/policy.ts.
 * As of G3.2 this module RE-EXPORTS that canonical contract instead of
 * declaring its own copy, so every ai-control consumer and the shared public
 * contract are the same type (the earlier "tracked integration TODO" is now
 * resolved). `ApprovalRule` is kept as a local alias for the canonical
 * `AIApprovalRequirement` for backward compatibility with existing imports.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

export type {
  EffectiveAIPolicy,
  AIApprovalRequirement,
  AIApprovalRuleMap,
  AIProviderModelMap,
  AIApprovalRequirement as ApprovalRule,
} from "@rnd-ai/shared-types";
export { MICROUSD_PER_USD } from "@rnd-ai/shared-types";
