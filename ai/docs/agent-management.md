# AI Agent Management System

This document describes the comprehensive system for managing AI agents, their system prompts, and RAG indices.

## 📁 Organization Structure

```
ai/
├── agents/
│   ├── prompts/
│   │   └── system-prompts.ts      # System prompt definitions
│   ├── configs/
│   │   └── agent-configs.ts       # Agent configurations
│   └── agent-manager.ts           # Agent execution manager
├── rag/
│   └── indices/
│       └── index-config.ts        # RAG index configurations
├── prompts/
│   └── prompt-manager.ts          # Prompt template management
└── hooks/
    └── use-agent.ts               # React hook for agent management
```

## 🤖 AI Agents

### What is an AI Agent?

An AI Agent combines:
- **System Prompt**: Defines the agent's personality, expertise, and behavior
- **RAG Indices**: Access to specialized knowledge bases
- **Model Configuration**: Temperature, tokens, and other parameters
- **Capabilities**: Specific skills and functions the agent can perform

### Available Agents

#### 1. **General Assistant** (`general-assistant`)
- **Purpose**: Versatile AI assistant for general inquiries
- **RAG Indices**: None (relies on general knowledge)
- **Best for**: General questions, creative tasks, analysis

#### 2. **Raw Materials Specialist** (`raw-materials-specialist`)
- **Purpose**: Expert in cosmetic ingredients and raw materials
- **RAG Indices**:
  - `raw-materials-db` - Ingredient database
  - `suppliers-db` - Supplier information
  - `safety-db` - Safety data
- **Best for**: Ingredient research, supplier info, safety assessments

#### 3. **Formulation Advisor** (`formulation-advisor`)
- **Purpose**: Expert in cosmetic formulation development
- **RAG Indices**:
  - `formulations-db` - Formula database
  - `raw-materials-db` - Ingredient data
  - `safety-db` - Safety information
  - `research-db` - Scientific research
- **Best for**: Recipe development, optimization, compatibility

#### 4. **Regulatory Expert** (`regulatory-expert`)
- **Purpose**: Specialist in global cosmetic regulations
- **RAG Indices**:
  - `regulations-db` - Regulatory documents
  - `safety-db` - Safety assessments
  - `research-db` - Research papers
- **Best for**: Compliance, labeling, market entry

#### 5. **Market Analyst** (`market-analyst`)
- **Purpose**: Expert in cosmetic market trends and insights
- **RAG Indices**:
  - `market-research-db` - Market data
  - `research-db` - Research papers
- **Best for**: Market analysis, trend forecasting, strategy

#### 6. **Creative Developer** (`creative-developer`)
- **Purpose**: Specialist in product concept development
- **RAG Indices**:
  - `market-research-db` - Market insights
  - `formulations-db` - Formulation examples
- **Best for**: Concept development, branding, innovation

#### 7. **Technical Support** (`technical-support`)
- **Purpose**: Expert in technical troubleshooting
- **RAG Indices**:
  - `product-docs-db` - Technical documentation
  - `research-db` - Research papers
  - `raw-materials-db` - Material specifications
- **Best for**: Troubleshooting, optimization, technical guidance

## 🗃️ RAG Indices

### Raw Materials Database (`raw-materials-db`)
- **Content**: Cosmetic ingredients, properties, suppliers
- **Source**: `raw_materials_real_stock`
- **Update Schedule**: Daily at 2 AM
- **Chunk Size**: 1000 characters
- **Similarity Threshold**: 0.7

### Formulations Database (`formulations-db`)
- **Content**: Cosmetic formulations, recipes, guidelines
- **Source**: `formulation_library`
- **Update Schedule**: Weekly on Sunday at 3 AM
- **Chunk Size**: 800 characters
- **Similarity Threshold**: 0.75

### Regulatory Database (`regulations-db`)
- **Content**: Global regulations, compliance requirements
- **Source**: `regulatory_documents`
- **Update Schedule**: Monthly on 1st at 4 AM
- **Chunk Size**: 1200 characters
- **Similarity Threshold**: 0.8

### Market Research Database (`market-research-db`)
- **Content**: Market trends, consumer insights, competitive analysis
- **Source**: `market_research`
- **Update Schedule**: Mon, Wed, Fri at 1 AM
- **Chunk Size**: 900 characters
- **Similarity Threshold**: 0.65

### Research Database (`research-db`)
- **Content**: Scientific papers, studies, technical documentation
- **Source**: `scientific_papers`
- **Update Schedule**: Weekly on Sunday at 5 AM
- **Chunk Size**: 1500 characters
- **Similarity Threshold**: 0.7

### Product Documentation (`product-docs-db`)
- **Content**: Internal documentation, technical sheets
- **Source**: `internal_docs`
- **Update Schedule**: Daily at 6 AM
- **Chunk Size**: 700 characters
- **Similarity Threshold**: 0.72

### Suppliers Database (`suppliers-db`)
- **Content**: Supplier information, capabilities, performance
- **Source**: `supplier_data`
- **Update Schedule**: Weekly on Monday at midnight
- **Chunk Size**: 600 characters
- **Similarity Threshold**: 0.68

### Safety Database (`safety-db`)
- **Content**: Safety data, toxicology studies, assessments
- **Source**: `safety_data`
- **Update Schedule**: Monthly on 1st at 3 AM
- **Chunk Size**: 1000 characters
- **Similarity Threshold**: 0.75

## 📝 System Prompts

### System Prompt Structure
Each system prompt includes:
- **Identity**: Role and expertise area
- **Capabilities**: What the agent can do
- **Guidelines**: How to respond and behave
- **Context**: When to use RAG results
- **Constraints**: Limitations and safety considerations

### Customizing System Prompts

```typescript
// Add new system prompt
export const SYSTEM_PROMPTS = {
  ...existingPrompts,
  'custom-agent': {
    id: 'custom-agent',
    name: 'Custom Specialist',
    description: 'Agent for specific use case',
    prompt: `You are a specialized AI assistant...`,
    category: 'custom',
    version: '1.0.0',
    tags: ['custom', 'specialized'],
    temperature: 0.7,
    maxTokens: 500
  }
};
```

## 🎯 Usage Examples

### Using Agent Chat Component

```tsx
import { AgentChat } from '@/ai';

function MyComponent() {
  return (
    <AgentChat
      userId="user-123"
      initialAgentId="raw-materials-specialist"
      showAgentSelector={true}
      showMetrics={true}
      onAgentChange={(agent) => console.log('Agent changed:', agent)}
      onExecutionComplete={(result) => console.log('Execution result:', result)}
    />
  );
}
```

### Using Agent Hook Directly

```tsx
import { useAgent } from '@/ai';

function CustomAgentComponent() {
  const agent = useAgent({
    agentId: 'formulation-advisor',
    userId: 'user-123'
  });

  const handleQuery = async () => {
    if (agent.currentAgent) {
      const result = await agent.executeAgent(
        'Help me create a moisturizer for dry skin',
        {
          forceRAG: true,
          ragOptions: { topK: 8, similarityThreshold: 0.8 }
        }
      );
      console.log('Agent response:', result.response.response);
      console.log('RAG sources:', result.ragResults?.sources);
    }
  };

  return (
    <div>
      <h3>Current Agent: {agent.currentAgent?.name}</h3>
      <button onClick={handleQuery} disabled={agent.isLoading}>
        {agent.isLoading ? 'Processing...' : 'Ask Formulation Advisor'}
      </button>
    </div>
  );
}
```

### Managing Multiple Agents

```tsx
import { AgentManager } from '@/ai';

const agentManager = new AgentManager(aiService);

// Execute different agents for comparison
const results = await agentManager.executeMultipleAgents([
  {
    agentId: 'raw-materials-specialist',
    userId: 'user-123',
    request: 'What are good moisturizing ingredients?'
  },
  {
    agentId: 'formulation-advisor',
    userId: 'user-123',
    request: 'What are good moisturizing ingredients?'
  }
]);

// Compare responses from different perspectives
results.forEach((result, index) => {
  console.log(`${result.agentConfig.name}: ${result.response.response}`);
});
```

## 🔧 Configuration

### Adding New Agents

1. **Create System Prompt**:
```typescript
// in ai/agents/prompts/system-prompts.ts
export const SYSTEM_PROMPTS = {
  'new-specialist': {
    id: 'new-specialist',
    name: 'New Specialist',
    // ... prompt configuration
  }
};
```

2. **Configure Agent**:
```typescript
// in ai/agents/configs/agent-configs.ts
export const AGENT_CONFIGS = {
  'new-specialist': {
    id: 'new-specialist',
    name: 'New Specialist',
    systemPromptId: 'new-specialist',
    ragIndexIds: ['relevant-db'],
    provider: 'openai',
    // ... agent configuration
  }
};
```

3. **Use in Components**:
```tsx
<AgentChat initialAgentId="new-specialist" userId="user-123" />
```

### Adding New RAG Indices

1. **Configure Index**:
```typescript
// in ai/rag/indices/index-config.ts
export const RAG_INDICES = {
  'new-index': {
    id: 'new-index',
    name: 'New Knowledge Base',
    pineconeIndex: 'your-pinecone-index',
    namespace: 'new-namespace',
    // ... index configuration
  }
};
```

2. **Update Agent Configurations**:
```typescript
ragIndexIds: ['existing-db', 'new-index']
```

3. **Populate Index**:
```typescript
const ragService = new PineconeRAGService();
await ragService.batchProcessDocuments(documents);
```

## 📊 Monitoring and Analytics

### Agent Performance Metrics

- **Usage Count**: How often each agent is used
- **Execution Time**: Average response time per agent
- **User Satisfaction**: Average rating per agent
- **RAG Usage**: How often knowledge bases are accessed
- **Error Rate**: Frequency of errors per agent

### RAG Index Metrics

- **Document Count**: Number of documents in each index
- **Query Performance**: Average search time and relevance
- **Update Status**: Last update time and success status
- **Hit Rate**: How often searches return relevant results

### Accessing Metrics

```typescript
// Get agent metrics
const metrics = agentManager.getAgentMetrics('raw-materials-specialist');

// Get RAG index status
const indexConfig = getRAGIndexConfig('raw-materials-db');
console.log('Documents:', indexConfig.documentCount);
console.log('Last Updated:', indexConfig.lastUpdated);
console.log('Status:', indexConfig.status);
```

## 🔍 Best Practices

### 1. **Agent Selection**
- Choose agents based on user intent and query type
- Use general assistant for ambiguous queries
- Consider switching agents mid-conversation for specialized topics

### 2. **RAG Optimization**
- Set appropriate similarity thresholds for different use cases
- Balance between comprehensive results and response time
- Regularly update indices with fresh data

### 3. **System Prompt Management**
- Keep prompts concise but specific
- Include clear guidelines for RAG usage
- Test prompt variations for optimal performance

### 4. **Performance Monitoring**
- Track agent usage and satisfaction
- Monitor RAG search effectiveness
- Regularly review and optimize configurations

### 5. **Error Handling**
- Provide fallback agents when primary agents fail
- Gracefully handle RAG search failures
- Inform users about agent capabilities and limitations

This system provides a powerful, flexible foundation for AI-powered applications with specialized knowledge and capabilities.