# AI Module Refactoring

This document describes the refactored AI module structure and how to use the new organized components.

## 📁 New Folder Structure

```
ai/
├── services/
│   ├── core/                      # Core AI services and interfaces
│   │   ├── base-ai-service.ts     # Abstract base class for all AI services
│   │   ├── ai-service-interface.ts # Common interfaces
│   │   ├── ai-service-factory.ts  # Factory for creating AI services
│   │   └── feedback-analyzer.ts    # Shared feedback analysis logic
│   ├── providers/                 # AI provider implementations
│   │   ├── openai-service.ts      # OpenAI GPT service
│   │   ├── gemini-service.ts      # Google Gemini service
│   │   ├── langchain-service.ts   # LangChain integration
│   │   └── langgraph-service.ts   # LangGraph workflow orchestration
│   └── rag/                       # RAG and vector search services
│       └── pinecone-service.ts    # Pinecone vector database service
├── components/
│   ├── chat/                      # Chat components
│   │   ├── base-chat.tsx          # Reusable base chat component
│   │   ├── ai-chat.tsx            # General AI chat
│   │   └── raw-materials-chat.tsx # Raw materials specialized chat
│   └── feedback/
│       └── feedback-collector.tsx # Feedback collection component
├── types/                         # TypeScript types and interfaces
│   ├── ai-types.ts               # Core AI types
│   ├── feedback-types.ts         # Feedback-related types
│   └── conversation-types.ts     # Conversation types
├── hooks/                        # React hooks for AI functionality
│   ├── use-chat.ts               # Chat state management
│   ├── use-feedback.ts           # Feedback management
│   └── use-ai-service.ts         # AI service management
├── utils/                        # Utility functions
│   └── response-analyzer.ts      # Response analysis utilities
└── index.ts                      # Main exports file
```

## 🚀 Key Features

### 1. **Unified AI Service Interface**
All AI services now implement a common interface with consistent methods:
- `generateResponse(request: AIRequest): Promise<AIResponse>`
- `addFeedback(feedback: Feedback): void`
- `analyzeFeedbackPatterns(userId: string): FeedbackPatterns`

### 2. **Shared Feedback Analysis**
Common feedback analysis logic extracted to `FeedbackAnalyzer`:
- Parameter adjustment based on feedback
- User preference inference
- Response complexity assessment
- Learning insights generation

### 3. **Reusable Chat Components**
Base chat component with customizable:
- Message rendering
- Input handling
- Loading states
- Error handling
- Custom headers/footers

### 4. **React Hooks**
Simplified state management with:
- `useChat`: Chat functionality and message handling
- `useFeedback`: Feedback collection and analysis
- `useAIService`: AI service creation and management

### 5. **Service Factory**
Easy creation and management of AI services:
- Support for multiple providers
- Service registration and switching
- Health monitoring
- Fallback capabilities

## 📖 Usage Examples

### Basic AI Chat

```tsx
import { AIChat } from '@/ai';

function MyComponent() {
  return (
    <AIChat
      userId="user-123"
      apiKey={process.env.OPENAI_API_KEY}
      provider="openai"
      enableFeedback={true}
      onError={(error) => console.error(error)}
    />
  );
}
```

### Raw Materials Chat with RAG

```tsx
import { RawMaterialsChat } from '@/ai';

function RawMaterialsComponent() {
  return (
    <RawMaterialsChat
      userId="user-123"
      apiKey={process.env.GEMINI_API_KEY}
      provider="gemini"
      enableRAG={true}
      ragConfig={{
        topK: 5,
        similarityThreshold: 0.7
      }}
    />
  );
}
```

### Using Hooks Directly

```tsx
import { useChat, useFeedback } from '@/ai';

function CustomChatComponent() {
  const chat = useChat({
    userId: 'user-123',
    apiKey: process.env.OPENAI_API_KEY,
    provider: 'openai'
  });

  const feedback = useFeedback({
    userId: 'user-123',
    service: chat.getService()
  });

  return (
    <div>
      {/* Custom chat UI using chat.messages, chat.sendMessage, etc. */}
    </div>
  );
}
```

### Service Management

```tsx
import { getAIServiceFactory, OpenAIService } from '@/ai';

// Create and register a service
const factory = getAIServiceFactory();
const openaiService = factory.createAndRegisterService('main-openai', {
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  defaultConfig: {
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 500
  }
});

// Use the registered service
const service = factory.getService('main-openai');
```

## 🔄 Migration Guide

### From Old AI Services

**Old:**
```tsx
import { AIService } from '@/lib/ai-service';
const service = new AIService(apiKey);
```

**New:**
```tsx
import { getAIServiceFactory } from '@/ai';
const factory = getAIServiceFactory();
const service = factory.createService('openai', apiKey);
```

### From Old Chat Components

**Old:**
```tsx
import { AIChat } from '@/components/ai-chat';
<AIChat userId="user-123" apiKey={apiKey} />
```

**New:**
```tsx
import { AIChat } from '@/ai';
<AIChat userId="user-123" apiKey={apiKey} provider="openai" />
```

### Feedback Collection

**Old:**
```tsx
// Manual feedback handling
```

**New:**
```tsx
import { useFeedback } from '@/ai';
const feedback = useFeedback({ userId: 'user-123' });
await feedback.submitFeedback({
  responseId: 'response-123',
  userId: 'user-123',
  type: 'helpful',
  score: 4,
  aiModel: 'gpt-4',
  prompt: 'What is AI?',
  aiResponse: 'AI is...'
});
```

## 🎯 Benefits of Refactoring

1. **Reduced Code Duplication**: Common functionality extracted to shared services
2. **Improved Maintainability**: Organized structure makes code easier to find and modify
3. **Better Type Safety**: Comprehensive TypeScript interfaces
4. **Enhanced Reusability**: Components can be easily customized and extended
5. **Simplified Testing**: Smaller, focused modules are easier to test
6. **Better Developer Experience**: Clear documentation and examples

## 🔧 Configuration

### Environment Variables

```env
OPENAI_API_KEY=your_openai_api_key
GEMINI_API_KEY=your_gemini_api_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX=your_pinecone_index_name
```

### Default Service Configuration

```tsx
const defaultConfig = {
  openai: {
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 500,
    presencePenalty: 0.1,
    frequencyPenalty: 0.1
  },
  gemini: {
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    maxTokens: 500
  }
};
```

## 🧪 Testing

The refactored structure makes testing much easier:

```tsx
// Test individual services
import { OpenAIService } from '@/ai';

test('OpenAI service generates response', async () => {
  const service = new OpenAIService('test-key');
  const response = await service.generateResponse({
    prompt: 'Hello',
    userId: 'test-user'
  });
  expect(response.response).toBeDefined();
});

// Test hooks
import { renderHook, act } from '@testing-library/react';
import { useChat } from '@/ai';

test('useChat hook manages messages', async () => {
  const { result } = renderHook(() => useChat({
    userId: 'test-user',
    apiKey: 'test-key'
  }));

  await act(async () => {
    await result.current.sendMessage('Hello');
  });

  expect(result.current.messages).toHaveLength(2); // user + assistant
});
```

## 📚 API Reference

Detailed API documentation is available in the source files and TypeScript definitions. Key interfaces include:

- `AIRequest` / `AIResponse` - Core request/response types
- `UserPreferences` - User preference management
- `Feedback` - Feedback data structure
- `ConversationMessage` - Chat message structure
- `IAIService` - AI service interface

## 🤝 Contributing

When adding new AI providers or features:

1. Follow the established patterns in the `services/` directory
2. Implement the `IAIService` interface
3. Add appropriate TypeScript types
4. Include tests for new functionality
5. Update this documentation

## 📝 Next Steps

1. Update existing components to use the new AI module
2. Migrate database schemas if needed
3. Update API routes to use new services
4. Add comprehensive tests
5. Monitor performance and optimize as needed
