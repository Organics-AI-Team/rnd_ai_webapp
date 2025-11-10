# Sales RND AI Agent - Integration Guide

## Overview

The Sales RND AI Agent is a sophisticated multi-agent system designed to help with sales, product development, and market analysis for cosmetic formulations. It features an intelligent orchestration layer that automatically routes requests to specialized sub-agents and tools.

## Architecture

```
User Query
    ↓
Enhanced Sales RND AI Agent
    ↓
Orchestrator (Intent Detection)
    ↓
    ├─→ Pitch Deck Creator Sub-Agent (Complex, Creative)
    ├─→ Follow-up Generator Tool (Template-based)
    ├─→ Slide Drafter Tool (Structured Content)
    └─→ Main Agent (General Queries, Formula Creation)
```

### Components

1. **Main Agent** (`enhanced-sales-rnd-agent.ts`)
   - Handles general sales R&D queries
   - Performs knowledge retrieval, quality scoring, regulatory checks
   - Orchestrates delegation to sub-agents and tools

2. **Orchestrator** (`orchestrator.ts`)
   - Detects user intent from messages
   - Routes to appropriate handler
   - Manages parameter extraction

3. **Sub-Agents**
   - **Pitch Deck Creator** (`sub-agents/pitch-deck-creator/`)
     - Creates complete 12-slide pitch decks
     - Storytelling and narrative structure
     - Audience-specific adaptation
     - RAG-enhanced with real ingredient data

4. **Tools**
   - **Follow-up Generator** (`tools/follow-up-generator.ts`)
     - Creates professional follow-up emails
     - 3 tone levels, 3 urgency levels
     - Action items and send timing

   - **Slide Drafter** (`tools/slide-drafter.ts`)
     - Generates individual slide content
     - 12 slide types (title, problem, solution, etc.)
     - Visual direction for designers
     - Speaker notes for presenters

## Usage Examples

### 1. Creating a Full Pitch Deck

**User Request:**
```
Create a full pitch deck for "BrightGlow Vitamin C Serum" targeting Sephora buyers.
Key benefits: brightening, anti-aging, stable formulation. Uses Ascorbyl Glucoside
from our inventory. Premium positioning at $45/30ml.
```

**What Happens:**
1. Orchestrator detects `pitch_deck` intent (keywords: "pitch deck", "serum", "sephora")
2. Extracts parameters:
   - `productCategory`: serum
   - `targetAudience`: sephora (retailer)
   - `keyBenefit`: brightening, anti-aging
3. Delegates to **Pitch Deck Creator Sub-Agent**
4. Sub-agent queries RAG for Ascorbyl Glucoside data
5. Generates 12-slide deck with:
   - Science-backed claims from ingredient database
   - Competitive positioning for Sephora
   - Premium market pricing strategy
   - Visual direction for each slide
   - Speaker notes with transitions

**Expected Output:**
- Complete 12-slide markdown document
- Structured format ready for PowerPoint/Keynote
- Real ingredient data (INCI names, CAS numbers, efficacy %)
- Tailored messaging for retail buyers

### 2. Generating a Follow-up Email

**User Request:**
```
Write a follow-up email after meeting with Ulta Beauty about our anti-acne line.
We discussed timeline, pricing, and their private label requirements.
Next steps are sending samples and proposal.
```

**What Happens:**
1. Orchestrator detects `follow_up_email` intent (keywords: "follow-up", "email", "meeting")
2. Extracts parameters:
   - `client_name`: "Ulta Beauty"
   - `key_discussion_points`: ["timeline", "pricing", "private label requirements"]
   - `next_steps`: ["sending samples", "proposal"]
3. Invokes **Follow-up Generator Tool**
4. Returns formatted email immediately

**Expected Output:**
```
Subject: Following Up on Our Anti-Acne Line Discussion

Dear Ulta Beauty Team,

Thank you for taking the time to meet with us yesterday to discuss our
anti-acne product line. I wanted to recap our conversation and confirm
next steps.

Key Discussion Points:
• Product development timeline and launch windows
• Pricing structure and margin requirements
• Private label customization options for Ulta Beauty

Next Steps:
1. Send product samples for evaluation (by [date])
2. Prepare detailed proposal with pricing and terms (by [date])

Action Items:
- [ ] Ship sample kit to your evaluation team
- [ ] Schedule follow-up call for week of [date]
- [ ] Prepare cost breakdown and MOQ details

I'm excited about the potential partnership and look forward to your
feedback on the samples.

Best regards,
[Your Name]

Recommended Send Time: Within 24 hours of meeting
```

### 3. Drafting a Single Slide

**User Request:**
```
Draft a slide about the science behind our peptide complex for a technical audience.
Include Matrixyl 3000 mechanism and clinical data.
```

**What Happens:**
1. Orchestrator detects `single_slide` intent (keywords: "draft a slide", "slide about")
2. Extracts parameters:
   - `slide_type`: "science"
   - `topic`: "peptide complex"
   - `target_audience`: "technical"
3. Invokes **Slide Drafter Tool**
4. Queries RAG for Matrixyl 3000 data
5. Returns structured slide content

**Expected Output:**
```
SLIDE: The Science Behind Results

Headline: Dual Peptide Complex Stimulates Collagen Synthesis

Subheadline: Clinically-proven mechanism with 8-week efficacy data

Key Points:
• Matrixyl 3000® (Palmitoyl Tripeptide-1 + Palmitoyl Tetrapeptide-7)
  at 6% concentration
• Binds to fibroblast receptors → Increases collagen I synthesis by 117%
  (in vitro)
• Reduces wrinkle depth by 23% after 56 days (clinical study, n=35)
• Synergistic action: collagen boost + anti-inflammatory (Tetrapeptide-7)
• Stable in formulation (>95% activity retention at 3 months, 40°C)

Visual Direction:
Molecular diagram showing peptide-receptor binding mechanism.
Split-screen: Left = molecular structure, Right = before/after clinical
imagery. Use scientific blue/green palette. Include data graph showing
collagen synthesis increase over time (bar chart).

Speaker Notes:
"Unlike single peptides, our Matrixyl 3000 uses a dual-peptide approach.
The Tripeptide-1 signals collagen production, while Tetrapeptide-7
reduces inflammation that degrades collagen. This is backed by a 56-day
clinical study showing measurable wrinkle reduction. The stability data
ensures consistent results throughout shelf life."

Estimated Duration: 2m 15s
```

### 4. General Sales Query (Main Agent)

**User Request:**
```
What's the market opportunity for anti-pollution skincare in Southeast Asia?
Consider regulatory requirements and competitive landscape.
```

**What Happens:**
1. Orchestrator detects `general_query` (no specific tool/sub-agent keywords)
2. Delegates to **Main Agent**
3. Main agent performs:
   - Knowledge retrieval (market intelligence)
   - Quality scoring
   - Regulatory compliance check
   - Response reranking
4. Returns comprehensive analysis with sources

**Expected Output:**
- Market size and growth estimates
- Key competitors and their positioning
- Regulatory requirements (ASEAN cosmetic directive)
- Consumer preferences and trends
- Recommended ingredients and claims
- Cost/pricing analysis
- Strategic recommendations

## Integration with RAG

All components share the **same RAG vector database** (`raw-materials-stock-vectors`):

- **Vector Index:** ChromaDB collection
- **Embedding Model:** text-embedding-004 (3072D)
- **Data Source:** MongoDB `raw_materials_real_stock` collection

### RAG Query Examples

**Pitch Deck Creator:**
```typescript
// Queries for ingredient details
"Ascorbyl Glucoside INCI CAS number stability pH cosmetic properties"
"Matrixyl 3000 peptide efficacy anti-aging collagen synthesis"
```

**Slide Drafter:**
```typescript
// Queries for technical data
"hyaluronic acid molecular weight penetration hydration mechanism"
```

**Main Agent:**
```typescript
// Queries for formulation context
"anti-pollution serum ingredients antioxidants urban stress protection"
```

## API Usage

### TypeScript/JavaScript

```typescript
import { EnhancedSalesRndAgent } from '@/ai/agents/sales-rnd-ai/enhanced-sales-rnd-agent';

const agent = new EnhancedSalesRndAgent();

// Example 1: Pitch Deck Request
const pitchDeckResponse = await agent.generateEnhancedResponse(
  "Create a pitch deck for brightening serum targeting Sephora",
  {
    userId: "user-123",
    userRole: "sales_manager",
    productType: "serum",
    targetRegions: ["US", "EU"],
    clientBrief: {
      targetCustomer: "Sephora",
      priceTier: "premium",
      keyBenefit: "brightening"
    }
  }
);

// Example 2: Follow-up Email
const emailResponse = await agent.generateEnhancedResponse(
  "Write a follow-up email after meeting with Ulta about anti-acne line",
  {
    userId: "user-123",
    userRole: "sales_manager"
  }
);

// Example 3: General Query
const generalResponse = await agent.generateEnhancedResponse(
  "What ingredients work best for anti-aging serums?",
  {
    userId: "user-123",
    userRole: "product_manager",
    queryType: "concept_development"
  }
);
```

### Response Structure

```typescript
interface EnhancedSalesResponse {
  success: boolean;
  response: string;              // Final formatted response
  originalResponse: string;      // Pre-enhancement response
  metadata: {
    processingTime: number;
    userRole: string;
    productType: string;
    queryType: string;
    conceptsFound: number;
    ingredientsFound: number;
    sourcesUsed: number;
    overallConfidence: number;
  };
  optimizations: {
    knowledgeRetrieval: { ... };
    qualityScoring: { ... };
    regulatoryCheck: { ... };
    responseReranking: { ... };
  };
  knowledgeData: any;            // RAG data, delegation info, or tool results
  marketData: any[];
  costData: any;
  regulatoryData: any[];
}
```

## Orchestrator Decision Logic

### Intent Detection Keywords

| Intent Type | Keywords | Handler |
|------------|----------|---------|
| `pitch_deck` | pitch deck, presentation, slides, deck, full deck | Pitch Deck Creator Sub-Agent |
| `follow_up_email` | follow up, follow-up, email after meeting, write email, meeting recap | Follow-up Generator Tool |
| `single_slide` | draft a slide, create slide, single slide, make a slide, slide about | Slide Drafter Tool |
| `formula_creation` | create formula, formulate, formulation, product concept | Main Agent |
| `general_query` | (default) | Main Agent |

### Parameter Extraction

The orchestrator automatically extracts:

- **Product types:** serum, cream, cleanser, toner, mask, sunscreen, lotion
- **Audiences:** sephora, ulta, retailer, oem, odm, brand, distributor
- **Benefits:** anti-aging, brightening, acne, hydrating, anti-pollution
- **Client names:** Pattern matching with "with [Name]"
- **Urgency:** urgent, asap, important

## Tool Schemas

The agent exposes tool schemas for AI model integration:

```typescript
const agent = new EnhancedSalesRndAgent();
const toolSchemas = agent.getToolsSchema();

// Returns:
[
  {
    name: 'generate_follow_up_email',
    description: 'Generate professional follow-up emails after client meetings',
    parameters: { ... }
  },
  {
    name: 'draft_slide_content',
    description: 'Generate structured content for a single presentation slide',
    parameters: { ... }
  }
]
```

## Configuration

### Agent Config (`config/agent-config.ts`)

```typescript
export const SALES_RND_AI_CONFIG = {
  id: 'sales-rnd-ai',
  name: 'salesRndAi',
  displayName: 'Sales RND AI',

  aiModel: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.8  // Higher for sales creativity
  },

  // SHARED RAG configuration
  vectorDb: {
    indexName: 'raw-materials-stock-vectors',
    dimensions: 3072
  },

  embedding: {
    provider: 'gemini',
    model: 'text-embedding-004',
    dimensions: 3072
  }
};
```

### Sub-Agent Config (`sub-agents/pitch-deck-creator/config/agent-config.ts`)

```typescript
export const PITCH_DECK_CREATOR_CONFIG = {
  id: 'pitch-deck-creator',

  aiModel: {
    temperature: 0.85,  // High creativity for presentations
    maxTokens: 12000    // Larger for multi-slide output
  },

  // INHERITS parent's RAG configuration
  vectorDb: {
    indexName: 'raw-materials-stock-vectors'  // Same as parent
  }
};
```

## Testing

### Manual Testing

```bash
# Test pitch deck creation
curl -X POST http://localhost:3000/api/ai/sales-rnd-ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Create a pitch deck for anti-aging cream targeting OEM partners",
    "conversationId": "test-123"
  }'

# Test follow-up email
curl -X POST http://localhost:3000/api/ai/sales-rnd-ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Write a follow-up email after meeting with Sephora about sunscreen line",
    "conversationId": "test-456"
  }'
```

### Unit Testing

```typescript
import { salesOrchestrator } from '@/ai/agents/sales-rnd-ai/orchestrator';

describe('Sales Orchestrator', () => {
  it('should detect pitch deck intent', async () => {
    const result = await salesOrchestrator.processRequest(
      'Create a pitch deck for brightening serum',
      {}
    );

    expect(result.delegatedTo).toBe('pitch_deck_creator_subagent');
    expect(result.requiresSubAgent).toBe(true);
  });

  it('should invoke follow-up tool directly', async () => {
    const result = await salesOrchestrator.processRequest(
      'Write a follow-up email to John at Ulta Beauty',
      {}
    );

    expect(result.delegatedTo).toBe('follow_up_generator_tool');
    expect(result.result).toBeDefined();
  });
});
```

## Troubleshooting

### Common Issues

**1. Sub-agent not invoked**
- Check if keywords match patterns in `orchestrator.ts:detectIntent()`
- Verify `requiresSubAgent` flag is `true`

**2. Tool returns "request_info" instead of result**
- Tool needs required parameters (client_name, slide_type, etc.)
- Provide more details in the user message

**3. RAG data not appearing in responses**
- Verify ChromaDB connection (`CHROMA_URL` env var)
- Check vector index name matches (`raw-materials-stock-vectors`)
- Ensure embedding model matches (text-embedding-004, 3072D)

**4. Generic responses instead of tool output**
- Orchestrator may have failed intent detection
- Check console logs for `[Orchestrator] Detected intent:`
- Verify tool keywords in user message

### Debug Mode

Enable detailed logging:

```typescript
// In orchestrator.ts or enhanced-sales-rnd-agent.ts
console.log('🎯 [Orchestrator] Processing user request', { message });
console.log('🔍 [Orchestrator] Detected intent:', intent);
console.log('📌 [EnhancedSalesRndAgent] Delegating to:', orchestrationResult.delegatedTo);
```

## Future Enhancements

### Planned Features

1. **Pitch Deck Export**
   - Direct PowerPoint/Google Slides export
   - PDF generation with branding
   - Interactive preview

2. **Advanced Market Intelligence**
   - Real-time market data integration (Mintel, Euromonitor)
   - Competitive product tracking
   - Trend forecasting

3. **Cost Optimization Tool**
   - Real-time ingredient pricing
   - Alternative ingredient suggestions
   - Margin calculator

4. **Regulatory Compliance Tool**
   - Multi-region compliance checks
   - Claim substantiation validation
   - Required documentation generation

5. **Customer Segmentation Tool**
   - Persona-based pitch deck variants
   - A/B testing for messaging
   - Sales enablement content library

## Support

For questions or issues:
- Check the [CHANGELOG.md](../../../CHANGELOG.md) for recent updates
- Review console logs for error messages
- Verify RAG database connection and data availability

## License

Internal use only - RND AI Management System
