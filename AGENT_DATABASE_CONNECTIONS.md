# AI Agent Database Connections Configuration

This document outlines how each AI agent connects to specific MongoDB collections for vector indexing and RAG operations.

## 🏗️ Database Architecture Overview

Each agent has its own MongoDB database but may share collections for vector indexing purposes.

### **MongoDB Connection:** `mongodb+srv://admin:admin@stockmanagement.crbiufo.mongodb.net/rnd_ai`

## 🤖 Agent Configurations

### **1. Raw Materials AI (Stock)**
- **URL:** `/ai/raw-materials-ai`
- **Database:** `raw_materials_stock_db`
- **Vector Index:** `raw-materials-stock-vectors`
- **Embedding:** OpenAI `text-embedding-3-small` (1536 dimensions)
- **MongoDB Collection for RAG:** `raw_materials_real_stock`
- **Purpose:** Specific stock database queries and inventory management

**Data Flow:**
```
MongoDB Collection → Vector Index → RAG Search → AI Response
raw_materials_real_stock → raw-materials-stock-vectors → Pinecone → Gemini AI
```

### **2. Raw Materials All AI**
- **URL:** `/ai/raw-materials-all-ai`
- **Database:** `raw_materials_all_ai_db`
- **Vector Index:** `raw-materials-general-vectors`
- **Embedding:** Gemini `gemini-embedding-001` (768 dimensions)
- **MongoDB Collection for RAG:** `raw_materials_console`
- **Purpose:** General raw materials knowledge and conversations

**Data Flow:**
```
MongoDB Collection → Vector Index → RAG Search → AI Response
raw_materials_console → raw-materials-general-vectors → Pinecone → Gemini AI
```

### **3. Sales RND AI**
- **URL:** `/ai/sales-rnd-ai`
- **Database:** `sales_rnd_ai_db`
- **Vector Index:** `sales-rnd-intelligence-vectors`
- **Embedding:** Gemini `gemini-embedding-001` (768 dimensions)
- **MongoDB Collection for RAG:** `raw_materials_real_stock`
- **Purpose:** Sales intelligence and market analysis (sales perspective)

**Data Flow:**
```
MongoDB Collection → Vector Index → RAG Search → AI Response
raw_materials_real_stock → sales-rnd-intelligence-vectors → Pinecone → Gemini AI
```

## 📊 Collection Usage Summary

| MongoDB Collection | Used By Agents | Purpose |
|------------------|------------------|---------|
| `raw_materials_real_stock` | Raw Materials AI, Sales RND AI | Stock data with sales/technical perspectives |
| `raw_materials_console` | Raw Materials All AI | General console data and broader knowledge |

## 🔧 RAG Filter Configuration

Each agent has specific RAG filters to ensure they search the correct data:

### **Raw Materials AI (Stock)**
```typescript
filters: {
  collection: 'raw_materials_real_stock',
  source: 'stock_database'
}
```

### **Raw Materials All AI**
```typescript
filters: {
  collection: 'raw_materials_console',
  source: 'console_data'
}
```

### **Sales RND AI**
```typescript
filters: {
  collection: 'raw_materials_real_stock',
  source: 'sales_intelligence'
}
```

## 📄 Vector Database Indexes

| Agent | Pinecone Index | Dimensions | Embedding Model |
|-------|---------------|------------|----------------|
| Raw Materials AI | `raw-materials-stock-vectors` | 1536 | OpenAI text-embedding-3-small |
| Raw Materials All AI | `raw-materials-general-vectors` | 768 | Gemini gemini-embedding-001 |
| Sales RND AI | `sales-rnd-intelligence-vectors` | 768 | Gemini gemini-embedding-001 |

## 🔄 Data Indexing Process

1. **Vectorize:** Create embeddings from MongoDB collection data
2. **Index:** Store vectors in respective Pinecone indexes
3. **Search:** Agent-specific RAG searches with filters
4. **Retrieve:** Get relevant documents for AI context

## 🌐 Universal API Endpoint

All agents work through the same API:
```
POST /api/agents/[agentId]/chat
```

**Agent IDs:**
- `raw-materials-ai` → Uses `raw_materials_real_stock`
- `raw-materials-all-ai` → Uses `raw_materials_console`
- `sales-rnd-ai` → Uses `raw_materials_real_stock`

## 🚀 Benefits of This Architecture

1. **✅ Data Source Flexibility:** Each agent can target specific collections
2. **✅ Shared Data Efficiency:** Multiple agents can index the same collection with different perspectives
3. **✅ Specialized AI Responses:** Each agent gets context-appropriate information
4. **✅ Scalable Architecture:** Easy to add new agents with different data sources
5. **✅ Centralized Management:** All configurations in one place

## 🎯 Usage Examples

### **Raw Materials AI Query:**
```typescript
// Searches raw_materials_real_stock with stock perspective
"What is the cost of RC00A004?"
```

### **Raw Materials All AI Query:**
```typescript
// Searches raw_materials_console with general knowledge
"What are the benefits of benzothiazine?"
```

### **Sales RND AI Query:**
```typescript
// Searches raw_materials_real_stock with sales perspective
"What sales opportunities exist for RC00A004?"
```

This configuration ensures each AI agent has access to the right data sources while maintaining clean separation and specialized functionality.