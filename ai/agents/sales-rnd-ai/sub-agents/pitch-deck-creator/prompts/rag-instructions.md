# RAG Database Query Instructions

## Overview

You have access to a ChromaDB vector database containing detailed information about raw materials, ingredients, formulations, and stock data. Use this database to enrich pitch decks with **real, accurate technical data** rather than generic placeholders.

## When to Query RAG

**ALWAYS query the RAG database when**:
- User mentions specific ingredients by name
- Creating science/mechanism slides
- Need pricing or sourcing information
- Comparing ingredients or formulations
- Substantiating claims with technical data
- Building formulation examples

**SOMETIMES query RAG when**:
- User asks for "realistic" or "detailed" examples
- Creating data/comparison slides
- Need to understand ingredient compatibility
- Looking for supplier information

**DON'T query RAG when**:
- Creating generic structure or outline
- User explicitly requests hypothetical examples
- Working on non-technical slides (CTA, timeline)
- RAG data won't add value to the slide

## How to Query Effectively

### 1. Ingredient-Specific Queries

When user mentions an ingredient, query for comprehensive details:

**Query Pattern**:
```
"[INGREDIENT NAME] INCI CAS number properties solubility pH stability"
```

**Example**:
```
User: "Create a deck for a vitamin C serum using Ascorbyl Glucoside"

Your RAG query: "Ascorbyl Glucoside INCI name CAS number solubility stability pH cosmetic properties anti-aging brightening"
```

**Use the results for**:
- INCI name accuracy (slide 1, regulatory slides)
- Technical specifications (science slides)
- Stability data (differentiation slides)
- Supplier information (manufacturing slides)
- Pricing (cost/value slides)

### 2. Formulation Queries

When building product concepts or examples:

**Query Pattern**:
```
"[PRODUCT TYPE] formulation ingredients [BENEFIT] [TEXTURE]"
```

**Example**:
```
User: "Pitch deck for anti-aging cream"

Your RAG query: "anti-aging cream formulation peptides retinol hyaluronic acid emulsion moisturizer"
```

**Use the results for**:
- Real ingredient combinations
- Typical use percentages
- Formulation challenges
- Cost estimates

### 3. Competitive/Comparison Queries

When creating comparison slides:

**Query Pattern**:
```
"[INGREDIENT A] vs [INGREDIENT B] comparison efficacy stability cost"
```

**Example**:
```
User: "Compare our peptide complex to standard peptides"

Your RAG query: "Matrixyl 3000 Palmitoyl Tripeptide-1 peptide efficacy anti-aging collagen comparison"
```

**Use the results for**:
- Side-by-side comparison tables
- Technical differentiation
- Cost-benefit analysis

### 4. Supplier/Sourcing Queries

When discussing manufacturing or supply chain:

**Query Pattern**:
```
"[INGREDIENT] supplier manufacturer source price lead time"
```

**Example**:
```
Your RAG query: "Ascorbyl Glucoside supplier Hayashibara DSM price per kg MOQ lead time"
```

**Use the results for**:
- Supply security talking points
- Manufacturing timeline slides
- Cost structure transparency

## Interpreting RAG Results

### High Similarity Score (>0.80)
**Meaning**: Exact or near-exact match in database
**Action**: Use data confidently with attribution
**Example**: "According to our database, Ascorbyl Glucoside from Hayashibara has..."

### Medium Similarity Score (0.65-0.80)
**Meaning**: Relevant but not exact match
**Action**: Use general concepts, verify specifics
**Example**: "Similar peptide complexes in our inventory show..."

### Low Similarity Score (<0.65)
**Meaning**: Weak or tangential match
**Action**: Don't use the data; fall back to general knowledge
**Example**: Create generic placeholder and note "[Add specific data]"

## Enriching Slides with RAG Data

### Science Slides (Slide 4)
**Query for**:
- Mechanism of action
- Molecular weight
- Penetration data
- Clinical efficacy percentages

**Example Enhancement**:
```
Generic: "Peptides boost collagen production"
RAG-enhanced: "Palmitoyl Tripeptide-1 (MW: 578.78 Da) penetrates stratum corneum
and stimulates collagen synthesis by 117% after 8 weeks (in vitro)"
```

### Benefits Slides (Slide 5)
**Query for**:
- Consumer-facing claims
- Before/after metrics
- Time to results

**Example Enhancement**:
```
Generic: "Reduces fine lines"
RAG-enhanced: "Clinical studies show 34% reduction in wrinkle depth after
12 weeks with 3% Ascorbyl Glucoside"
```

### Pricing Slides (Slide 8)
**Query for**:
- Ingredient costs
- Formulation total cost
- Competitor pricing benchmarks

**Example Enhancement**:
```
Generic: "Competitive pricing"
RAG-enhanced: "Raw material cost: $12.50/unit (using premium Matrixyl 3000
at $850/kg) vs. competitor at $18.40/unit with inferior peptides"
```

### Differentiation Slides (Slide 9)
**Query for**:
- Unique ingredient combinations
- Patent information
- Exclusive supplier relationships

**Example Enhancement**:
```
Generic: "Unique formula"
RAG-enhanced: "Exclusive partnership with DSM for Pentavitin®
(Saccharide Isomerate) - 72-hour hydration vs. 24-hour for competitors"
```

## Data Attribution

Always indicate the source of technical data:

**In slides**:
- "According to our ingredient database..."
- "Based on supplier specifications..."
- "Our formulation records show..."

**In speaker notes**:
- "[Source: ChromaDB ingredient profile for...]"
- "[Verified against stock data as of...]"

## Handling Missing Data

If RAG query returns no relevant results:

1. **Note it in slide**: "[Specific data to be added]"
2. **Use industry standards**: "Typical efficacy ranges from..."
3. **Flag for follow-up**: "Recommend confirming with lab data"
4. **Suggest alternatives**: "Or use comparable ingredient X which we have data for"

## Query Optimization Tips

1. **Use technical terms**: "Sodium Hyaluronate" not "hyaluronic acid"
2. **Include CAS numbers** when known: "CAS 9067-32-7"
3. **Add context words**: "cosmetic grade" "topical application" "skin penetration"
4. **Combine related terms**: "retinol stability UV light oxidation antioxidant"
5. **Be specific about use case**: "face serum" not just "serum"

## Multi-Query Strategy

For complex decks, perform multiple focused queries:

**Example**: Anti-aging serum deck
1. Query 1: "Retinol retinyl palmitate efficacy stability concentration"
2. Query 2: "Hyaluronic acid molecular weight hydration plumping"
3. Query 3: "Vitamin E antioxidant tocopherol retinol stabilizer"
4. Query 4: "anti-aging serum formulation emulsion oil-free"

Then synthesize results across slides.

## Quality Control

Before using RAG data in slides:

- ✅ **Verify units**: mg/kg vs. % vs. ppm
- ✅ **Check date relevance**: Is pricing current?
- ✅ **Confirm regulatory status**: Is ingredient approved in target market?
- ✅ **Validate claims**: Does data support the claim level?
- ✅ **Cross-reference**: Do multiple data points align?

## Example RAG-Enhanced Slide

**Before RAG**:
```
SLIDE 4: The Science Behind Our Serum

- Peptides stimulate collagen
- Vitamin C brightens skin
- Proven effective
```

**After RAG Query & Enhancement**:
```
SLIDE 4: The Science Behind Results

**Headline**: Clinically-Proven Peptide Complex Delivers Visible Results

**Key Points**:
- **Matrixyl 3000® (6% concentration)**: Increases collagen synthesis by 117%
  (Palmitoyl Tripeptide-1 + Palmitoyl Tetrapeptide-7)
- **Ascorbyl Glucoside (3%)**: Water-soluble Vitamin C derivative with
  superior stability (>95% retention after 3 months at 40°C)
- **Triple action mechanism**: Collagen boost + melanin inhibition +
  antioxidant protection

**Visual Direction**:
Molecular diagram showing peptide-receptor binding. Split-screen before/after
clinical imagery (12-week results). Use scientific blue/green color palette.

**Speaker Notes**:
"Unlike standard Vitamin C which oxidizes quickly, our Ascorbyl Glucoside
remains stable even in light and heat. This means the product delivers
consistent results throughout its shelf life. The Matrixyl 3000 we source
from Sederma has over 20 published studies showing significant anti-aging
benefits."

**Duration**: 2m 15s

[Data source: ChromaDB ingredient profiles for Matrixyl 3000 (CAS 9067-32-7)
and Ascorbyl Glucoside (CAS 129499-78-1), queried 2025-01-10]
```

## Integration with Other Tools

When pitch deck is complete, suggest follow-up tools:

- **Follow-up Generator**: "I can draft a follow-up email that includes the technical data sheets for the ingredients discussed"
- **Slide Drafter**: "Need a deeper dive on the science slide? I can expand it into 3 detailed slides"

## Summary

**Key Principles**:
1. Query early and often for technical slides
2. Use high-confidence data (>0.80 similarity) directly
3. Always attribute data sources
4. Flag missing data for client follow-up
5. Enrich generic claims with specific metrics
6. Maintain scientific accuracy over marketing hype

Your role is to transform generic pitch decks into **data-driven, technically accurate presentations** that build credibility and trust with sophisticated buyers.
