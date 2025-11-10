# User Interaction Instructions - Market Intelligence Agent

## How to Request an Analysis

When requesting market intelligence, provide as much context as possible for the most accurate analysis. I can work with varying levels of detail, but more information yields better insights.

### Essential Information

**For All Analysis Types**:
- **Analysis type**: SWOT, Competitor, Product, Brand, or Ingredient
- **Subject**: What/who to analyze (product name, brand, ingredient, concept)
- **Objective**: What decision are you trying to make?

**Optional But Helpful**:
- **Specific focus areas**: Price, efficacy, positioning, etc.
- **Depth**: Quick overview vs. comprehensive deep-dive
- **Competitive context**: Who are you competing against?
- **Market/region**: Which geographic market?
- **Target audience**: Who is this for?

---

## Request Examples by Analysis Type

### 1. SWOT Analysis

**Minimal Request**:
```
"SWOT analysis for niacinamide serum"
```

**Good Request**:
```
"Perform a SWOT analysis for our 10% niacinamide + zinc serum
targeting acne-prone millennials at $25/30ml. Main competitors
are The Ordinary and The Inkey List."
```

**Comprehensive Request**:
```
"I need a full SWOT analysis for launching a niacinamide serum in the
US market. Product details:
- 10% Niacinamide + 1% Zinc PCA
- Target: Millennials with oily/acne-prone skin
- Price: $25/30ml (masstige positioning)
- Distribution: Sephora, Ulta, DTC
- Main competitors: The Ordinary ($6), Paula's Choice ($49)
- Key concern: Is the market too saturated?
Focus on market opportunity and competitive differentiation."
```

### 2. Competitor Analysis

**Minimal Request**:
```
"Analyze The Ordinary as a competitor"
```

**Good Request**:
```
"Competitor analysis on The Ordinary's Niacinamide 10% + Zinc 1%.
We're launching a similar product at $25 vs. their $6. Need to
understand their positioning and how we can justify premium pricing."
```

**Comprehensive Request**:
```
"Deep-dive competitor analysis on The Ordinary:
- Focus on their Niacinamide and Retinol serums
- Analyze pricing strategy and value perception
- Distribution channels and market reach
- Brand positioning and target demographics
- Formulation quality vs. premium brands
- Weaknesses we can exploit
Goal: Develop counter-positioning strategy for our premium serum line."
```

### 3. Product Analysis

**Minimal Request**:
```
"Analyze market fit for caffeine eye cream"
```

**Good Request**:
```
"Product analysis for 5% Caffeine + Peptide eye cream at $35/15ml.
Target: 30-45 year olds with dark circles and puffiness.
Competitors: The Ordinary ($7), RoC ($25), Drunk Elephant ($68).
Is there room in the mid-tier?"
```

**Comprehensive Request**:
```
"Full product analysis for our new eye cream:
Product Specs:
- 5% Caffeine + Palmitoyl Tripeptide-1
- Claims: Reduces dark circles, depuffs, smooths fine lines
- Price: $35/15ml
- Packaging: Airless pump, recyclable
- Target: Professional women 30-45

Market Context:
- Category: Eye creams (dark circles/puffiness)
- Geography: US, targeting Sephora placement
- Competitive set: The Ordinary, Cerave, RoC, Drunk Elephant

Analysis Needed:
- Market gap vs. existing products
- Price-value assessment
- Claims substantiation requirements
- Innovation level
- Go/no-go recommendation"
```

### 4. Brand Analysis

**Minimal Request**:
```
"Analyze Glossier's brand strategy"
```

**Good Request**:
```
"Brand analysis on Glossier - their positioning, target market,
distribution strategy. We want to learn from their DTC success
for our own brand launch."
```

**Comprehensive Request**:
```
"Complete brand analysis on Glossier:

Focus Areas:
- Brand positioning and personality
- Target audience (demographics + psychographics)
- Product strategy (minimalism vs. efficacy)
- Pricing tier and value perception
- Distribution (DTC vs. retail partnerships)
- Marketing channels and influencer strategy
- Community building approach

Context:
We're launching a clean beauty brand targeting Gen Z/Millennials
with science-backed, minimalist skincare. Want to understand:
- What Glossier does well that we should emulate
- Their weaknesses/gaps we can exploit
- How saturated is the "millennial pink minimalist" positioning
- Alternative positioning strategies"
```

### 5. Ingredient Analysis

**Minimal Request**:
```
"Analyze bakuchiol as an ingredient"
```

**Good Request**:
```
"Ingredient analysis for bakuchiol vs. retinol. Considering using
bakuchiol in our anti-aging serum to differentiate from retinol
products. Need efficacy comparison, cost analysis, and market trends."
```

**Comprehensive Request**:
```
"Full ingredient analysis on bakuchiol:

Technical Questions:
- Efficacy vs. retinol (clinical data comparison)
- Typical concentration ranges
- Stability and formulation challenges
- Solubility and compatibility

Market Questions:
- How many brands use it? (saturation level)
- Consumer awareness and perception
- Price premium vs. retinol products
- Trend trajectory (growing/peaking/declining)

Competitive Questions:
- Which brands use bakuchiol successfully?
- How do they position it (retinol alternative, sensitive skin, clean, etc.)
- Price points of bakuchiol products
- Claims they make (substantiated?)

Strategic Questions:
- Is bakuchiol still a good differentiator in 2025?
- Should we use it for anti-aging or position differently?
- What concentration to use for marketing claims?
- Cost implications vs. retinol

Decision: Should we formulate with bakuchiol (1%) or stick with
encapsulated retinol for our sensitive skin anti-aging serum?"
```

---

## Specifying Analysis Depth

### Quick Overview (5-10 minutes)
```
"Quick SWOT for peptide serum"
"Brief competitor analysis on Sunday Riley"
```
- High-level insights only
- Top 3-5 key points per section
- Essential recommendations
- Limited RAG queries

### Standard Analysis (10-15 minutes)
```
"Analyze niacinamide market saturation"
"Product analysis for our vitamin C serum"
```
- Balanced depth and breadth
- Complete framework application
- RAG data integration
- Strategic recommendations

### Comprehensive Deep-Dive (20-30 minutes)
```
"Comprehensive SWOT with full competitive landscape analysis"
"Deep-dive brand analysis with marketing mix review"
```
- Extensive research and data gathering
- Multiple RAG queries for thorough data
- Detailed competitive comparisons
- Scenario analysis and risk assessment
- Extensive strategic recommendations

---

## Iterating on Analysis

After receiving your analysis, you can refine it:

**Add More Detail**:
- "Expand on the Opportunities section with specific product concepts"
- "Add more competitor pricing data to the analysis"
- "Include clinical efficacy data for the ingredient comparison"

**Change Focus**:
- "Reframe this SWOT for the European market instead"
- "Focus more on pricing strategy than formulation"
- "Analyze from a luxury brand perspective, not mass market"

**Request Specific Sections**:
- "Generate only the competitive comparison table"
- "Give me just the risk assessment and mitigation strategies"
- "Provide only strategic recommendations, skip the detailed analysis"

**Compare Multiple Options**:
- "Now compare bakuchiol vs. retinol vs. retinal - which is best for our positioning?"
- "SWOT for Option A (niacinamide) and Option B (azelaic acid) side-by-side"

---

## Using RAG Data Effectively

I can pull real data from your ingredient database for:

### Ingredient-Specific Queries
```
"Analyze niacinamide - include our current stock data and supplier pricing"
```
I'll query for: INCI names, CAS numbers, supplier info, pricing, specifications

### Formulation Comparisons
```
"Compare our retinol formulation to The Ordinary's - do we have similar ingredients in stock?"
```
I'll query for: Ingredient availability, concentrations, alternative options

### Cost Analysis
```
"Analyze if bakuchiol is cost-effective vs. retinol based on our supplier prices"
```
I'll query for: Price per kg, MOQ, supplier reliability

### Regulatory Compliance
```
"SWOT for launching in EU - check ingredient regulatory status"
```
I'll query for: EU compliance data, restricted ingredients, concentration limits

---

## Output Format Preferences

Specify how you want the results:

**Format Options**:
- "Provide as markdown table"
- "Give me bullet points only, no paragraphs"
- "Include visual scoring (⭐ ratings)"
- "Add color coding for risks (🟢🟡🔴)"

**Length Options**:
- "Keep it to one page"
- "Provide 2-3 page detailed report"
- "Executive summary only (5 sentences max)"

**Focus Options**:
- "Emphasize commercial viability over technical details"
- "Focus on risks more than opportunities"
- "Prioritize quick wins vs. long-term strategy"

---

## Common Decision Scenarios

### Product Development
```
"Should we use niacinamide or azelaic acid for our brightening serum?
Need ingredient analysis for both with recommendation."
```

### Market Entry
```
"SWOT for entering the men's skincare market with our existing
anti-aging products. Is it worth reformulating or just rebranding?"
```

### Competitive Positioning
```
"Competitor analysis on 3 main rivals in premium vitamin C serums.
How should we position our product differently?"
```

### Pricing Strategy
```
"Product analysis: Can we charge $45 for our peptide serum when
The Ordinary is $25 and Drunk Elephant is $68? What's the sweet spot?"
```

### Brand Strategy
```
"Brand analysis of Sunday Riley - should we adopt their science-luxury
positioning or go for Glossier's minimalist approach?"
```

---

## Tips for Best Results

1. **Be Specific About Objectives**
   - Don't just say "analyze X"
   - Say "analyze X to decide whether to launch/price/position/etc."

2. **Provide Context**
   - Your target market, price tier, distribution channels
   - What decision you're trying to make
   - Current competitive landscape

3. **Indicate Priority**
   - "Most important is pricing strategy"
   - "Focus on regulatory compliance first"
   - "Efficacy data is critical for our claims"

4. **Mention Constraints**
   - Budget limitations ("must keep COGS under $5")
   - Timeline ("launching in 3 months")
   - Distribution ("Sephora placement required")

5. **Request Specific Comparisons**
   - Name specific competitors to benchmark against
   - Specify alternative ingredients/approaches to compare

---

## What I Can't Do

- **Access External Websites**: I can't browse competitor websites or check real-time pricing
- **Conduct Surveys**: I can't gather primary consumer research
- **Provide Financial Advice**: I analyze markets, not investment opportunities
- **Guarantee Accuracy**: Some estimates are based on industry averages, not exact data

**When I'm Uncertain**:
- I'll clearly state confidence levels (High/Medium/Low)
- I'll note assumptions made
- I'll suggest where to get additional data
- I'll flag risks and limitations

---

## After the Analysis

Once you have your analysis, I can help with:
- **Follow-up Questions**: "What if we target Gen Z instead of Millennials?"
- **Scenario Planning**: "How would this change if we launched in Europe first?"
- **Action Plans**: "Create a 90-day roadmap based on these recommendations"
- **Pitch Preparation**: "Turn this into talking points for a board presentation"

---

Ready to get strategic insights? Just tell me what you want to analyze and any specific context!
