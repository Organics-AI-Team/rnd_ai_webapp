# AI Formula Tools Enhancement — Design Spec

## Problem
Sales needs AI to generate unique formula concepts. R&D needs to pick, refine, and create formulas with AI assistance. No comments on formulas. No way for AI to read feedback and revise formulas. No formula-to-formula references.

## Solution: 4 New AI Tools + Comments System + Formula Revision

### New AI ReAct Tools

#### 1. `generate_formula` — AI creates a formula from a concept brief
- Input: product_type, target_benefits, constraints (budget, excluded ingredients), batch_size
- Process: Search existing ingredients in Qdrant → select best matches → calculate percentages → return structured formula
- Output: Complete formula with ingredients, percentages, INCI names, estimated cost, rationale

#### 2. `search_reference_formulas` — Look up existing formulas as references
- Input: query (e.g. "anti-aging serum"), filters (status, client, benefits)
- Process: Search formulas collection by name/benefits/ingredients
- Output: Matching formulas with ingredient breakdowns for inspiration

#### 3. `revise_formula` — AI reads comments and improves a formula
- Input: formula_id
- Process: Load formula + all comments → analyze feedback → generate improved version with changelog
- Output: New formula version with changes explained, referencing which comments drove each change

#### 4. `get_formula_with_comments` — Read a formula and its discussion thread
- Input: formula_id
- Process: Load formula + comments from DB
- Output: Full formula detail + comment thread for AI context

### Database Changes (Prisma)

#### New Model: `FormulaComment`
```
FormulaComment {
  id: ObjectId
  formulaId: String (ref to Formula)
  userId: String
  userName: String
  content: String (the comment text)
  commentType: enum (feedback, suggestion, approval, rejection, revision_note)
  parentCommentId: String? (for threaded replies)
  metadata: Json? (AI-generated revision refs, etc.)
  createdAt: DateTime
  updatedAt: DateTime
}
```

#### Formula Model Updates
- Add `parentFormulaId: String?` — links to the formula this was derived from
- Add `referenceFormulaIds: String[]` — formulas used as reference during creation
- Add `aiGenerated: Boolean` — whether AI created this formula
- Add `generationPrompt: String?` — the original concept brief that generated it

### tRPC Router: `formulaComments`
- `list(formulaId)` — get all comments for a formula
- `create(formulaId, content, commentType)` — add a comment
- `update(commentId, content)` — edit a comment
- `delete(commentId)` — remove a comment

### System Prompt Updates
- Add formula generation capabilities to the ReAct agent persona
- Add tool selection rules for formula-related intents
- Add NPD (New Product Development) domain knowledge

### UI Changes
- Formula detail page: add comments section below ingredients
- Comment input with type selector (feedback/suggestion/approval/rejection)
- "Ask AI to revise" button that triggers `revise_formula` tool
- "AI Generated" badge on formulas created by AI
- "Derived from" link showing parent formula lineage

## Implementation Order
1. Prisma schema changes (FormulaComment model + Formula field additions)
2. tRPC router for formula comments
3. 4 new ReAct tool handlers
4. Update tool-definitions.ts and system prompt
5. Formula comments UI component
6. Formula detail page updates
7. Test on droplet
