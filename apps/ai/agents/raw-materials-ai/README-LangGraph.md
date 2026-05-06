# LangGraph-Powered Raw Materials AI Agent

## Overview

This directory contains an advanced implementation of the Raw Materials AI Agent using LangGraph, a state-based workflow framework that enables more sophisticated query routing, tool orchestration, and error handling.

## Architecture

### State-Based Workflow

The LangGraph agent implements a finite state machine with the following nodes:

1. **classify_query** - Analyzes user intent and categorizes queries
2. **route_query** - Determines which tool(s) to use based on query type
3. **search_database** - Executes FDA database searches
4. **check_stock** - Checks material availability in stock
5. **get_profile** - Retrieves detailed material profiles
6. **search_usecase** - Finds materials for specific use cases
7. **synthesize_results** - Combines and deduplicates results from multiple tools
8. **generate_response** - Creates natural language responses
9. **handle_error** - Graceful error handling and fallback responses

### Query Types

- **search**: General ingredient/material searches (แนะนำ, หา, ค้นหา)
- **stock_check**: Stock availability checks (มีไหม, สั่งได้)
- **profile**: Detailed material information (สารนี้ทำอะไร)
- **usecase_search**: Use case-specific searches (สารสำหรับ)
- **general**: General questions about raw materials

## Key Features

### 1. Intelligent Query Classification
- Automatic detection of user intent
- Support for Thai and English queries
- Contextual understanding of material-related terminology

### 2. Conditional Routing
- Dynamic selection of appropriate tools based on query type
- Ability to combine multiple tools for complex queries
- Optimized workflow paths for different query categories

### 3. Advanced Error Handling
- Graceful fallbacks when tools fail
- Multiple retry mechanisms
- User-friendly error messages

### 4. Confidence Scoring
- Real-time confidence assessment for each response
- Tool-specific confidence metrics
- Overall workflow confidence calculation

### 5. Result Synthesis
- Intelligent deduplication of results from multiple tools
- Priority-based result ordering
- Context-aware result filtering

## Usage

### API Endpoint

```
POST /api/ai/raw-materials-agent/langgraph-route
```

### Request Format

```json
{
  "action": "process",
  "prompt": "แนะนำสาร 5 ตัวที่ช่วยลดริ้วรอย",
  "userId": "user123",
  "enableML": true
}
```

### Response Format

```json
{
  "success": true,
  "response": "ผมขอแนะนำสารที่ช่วยลดริ้วรอย 5 ตัวดังนี้...",
  "confidence": 0.92,
  "toolCalls": ["search_fda_database"],
  "results": [...],
  "processingTime": 1250,
  "agent": "langgraph",
  "metadata": {
    "workflowType": "state_graph",
    "nodesExecuted": 3,
    "queryType": "search"
  }
}
```

## Implementation Details

### State Schema

```typescript
interface RawMaterialsState {
  messages: Message[];
  query?: string;
  queryType?: 'search' | 'stock_check' | 'profile' | 'usecase_search' | 'general';
  searchResults?: any[];
  stockResults?: any[];
  profileResults?: any[];
  usecaseResults?: any[];
  needsTools?: boolean;
  toolCalls?: string[];
  response?: string;
  confidence?: number;
  error?: string;
}
```

### Tool Integration

The LangGraph agent integrates with existing tools:

- `search_fda_database` - Comprehensive FDA database search
- `check_stock_availability` - Stock availability verification
- `get_material_profile` - Detailed material information
- `search_materials_by_usecase` - Use case-specific searches

### Parameter Extraction

Advanced parameter extraction from natural language:

```typescript
// Extract limits: "5 อัน", "10 ตัว"
const limitMatch = query.match(/(\d+)\s*(อัน|ตัว|ชิ้น)/);

// Extract benefits: "benefit: ลดริ้วรอย"
const benefitMatch = query.match(/benefit[:\s]+([^\n]+)/i);

// Extract exclusions: "exclude: SAM, BHT"
const excludeMatch = query.match(/exclude[:\s]+([^\n]+)/i);
```

## Benefits Over Traditional Agent

### 1. Better Query Understanding
- State-based approach allows for more nuanced query analysis
- Context preservation across multiple tool calls
- Improved handling of complex, multi-step queries

### 2. Enhanced Error Recovery
- Multiple fallback paths when tools fail
- Graceful degradation of functionality
- User-friendly error messages with suggestions

### 3. Improved Performance
- Optimized routing reduces unnecessary tool calls
- Parallel execution where possible
- Intelligent caching of intermediate results

### 4. Better Observability
- Detailed tracking of workflow execution
- Performance metrics for each node
- Confidence scoring throughout the process

## Configuration

### Environment Variables

```bash
GEMINI_API_KEY=your_gemini_api_key
PINECONE_API_KEY=your_pinecone_api_key
MONGODB_URI=your_mongodb_uri
```

### Customization

The agent can be customized by modifying:

1. **Query Classification Rules** - Update the classification prompt
2. **Tool Routing Logic** - Modify conditional edges in the graph
3. **Response Generation** - Adjust the LLM prompts for different contexts
4. **Error Handling** - Customize error messages and fallback strategies

## Testing

### Health Check

```bash
GET /api/ai/raw-materials-agent/langgraph-route
```

### Workflow Stats

```bash
POST /api/ai/raw-materials-agent/langgraph-route
{
  "action": "stats"
}
```

### Example Queries

```javascript
// General search
"แนะนำวัตถุดิบสำหรับ serum ให้ความชุ่มชื้น"

// Stock check
"มีวิตามินซี ไหม สั่งได้เลยไหม"

// Material profile
"ไฮยาลูรอนิกแอซิด ใช้ทำอะไร"

// Use case search
"สารสำหรับ eye cream ลดรอยคล้ำ"
```

## Performance Considerations

### Optimization Features

1. **Lazy Loading** - Services initialized only when needed
2. **Connection Pooling** - Reused database connections
3. **Result Caching** - Intermediate results cached when possible
4. **Parallel Processing** - Multiple tools can execute concurrently

### Monitoring

Key metrics to monitor:

- Average processing time per query
- Tool success rates
- Query classification accuracy
- Error rates by node
- User satisfaction scores

## Future Enhancements

### Planned Features

1. **Multi-turn Conversations** - Context preservation across multiple queries
2. **Learning from Feedback** - Improve classification based on user corrections
3. **Advanced Filtering** - More sophisticated result filtering options
4. **Visual Workflow Designer** - GUI for modifying the state graph
5. **A/B Testing** - Compare different workflow strategies

### Integration Opportunities

- **Voice Interface** - Support for spoken queries
- **Image Recognition** - Identify materials from images
- **Supplier Integration** - Real-time supplier inventory
- **Regulatory Updates** - Automated regulatory compliance checks

## Troubleshooting

### Common Issues

1. **Classification Failures**
   - Check Gemini API key configuration
   - Verify query format and language
   - Review classification prompts

2. **Tool Timeouts**
   - Increase timeout values
   - Check database connectivity
   - Monitor Pinecone index status

3. **Low Confidence Scores**
   - Review training data
   - Adjust confidence thresholds
   - Improve result synthesis logic

### Debug Mode

Enable detailed logging by setting:

```typescript
process.env.NODE_ENV = 'development';
```

This will provide detailed console output for each workflow step.

## Contributing

When modifying the LangGraph agent:

1. **Test Workflow Changes** - Verify all paths still work
2. **Update Documentation** - Keep this README current
3. **Add Integration Tests** - Ensure robustness
4. **Performance Testing** - Monitor impact on response times
5. **Error Scenarios** - Test edge cases and failure modes

## License

This implementation follows the same license as the main project.