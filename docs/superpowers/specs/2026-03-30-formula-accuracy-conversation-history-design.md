# Design: Formula Accuracy Enhancement + Conversation History

**Date:** 2026-03-30
**Status:** Approved
**Scope:** 3 parts — Formulation Engine, Conversation History Backend, Frontend History Sidebar

---

## Part 1: Structured Formulation Engine

### Problem
Current `generate-formula-handler.ts` uses pure vector-similarity scoring with weighted percentage distribution. No phase awareness, no regulatory limits, no mandatory ingredients. R&D clients report: wrong percentages, missing formulation structure, no regulatory awareness, output feels like a rough guess.

### Solution: 3-Layer Formula Generation Pipeline

**Layer 1 — Phase-Aware Ingredient Selection**
Categorize every ingredient into formulation phases:
- Water Phase (aqua, glycerin, humectants)
- Oil Phase (emollients, oils, waxes)
- Active Phase (target benefit actives)
- Emulsifier Phase (stabilizers)
- Preservative Phase (auto-added if missing)
- pH Adjuster Phase (auto-added if missing)

Each phase has a percentage budget based on product type template. Ingredients are allocated within their phase budget, not globally.

**Layer 2 — Regulatory & Safety Validation**
A validation layer that runs AFTER generation:
- Max usage percentage per ingredient (e.g., Retinol ≤1%, Salicylic Acid ≤2%, Niacinamide ≤10%)
- Known incompatible pairs (e.g., Retinol + AHA at high %, Vitamin C + Niacinamide at low pH)
- Mandatory ingredients check (preservative system present? pH adjuster present?)
- Total must sum to 100% (water phase absorbs the remainder)
- Validation rules live in a config file (not hardcoded), so R&D clients can update limits without code changes.

**Layer 3 — Output Formatting**
Structured output that looks like a real formulation brief:
- Phase-grouped ingredient table
- Each ingredient: INCI name, trade name, function, %, amount (g), rationale
- Warnings section (if any regulatory concerns)
- Estimated cost per batch
- "AI-suggested — R&D should validate before production" disclaimer

---

## Part 2: Conversation History — Data Model

### Problem
Current `Conversation` model has no `organizationId`, stores flat messages, no concept of threads or agent type. Frontend uses only `useState` — everything lost on refresh.

### Solution: New ChatThread + ChatMessage Models

**Schema (Prisma/MongoDB):**

```prisma
model ChatThread {
  id              String         @id @default(auto()) @map("_id") @db.ObjectId
  organizationId  String         @db.ObjectId
  userId          String         @db.ObjectId
  agentType       AgentType
  title           String
  messageCount    Int            @default(0)
  lastMessageAt   DateTime       @default(now())
  isArchived      Boolean        @default(false)
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  organization    Organization   @relation(fields: [organizationId], references: [id])
  messages        ChatMessage[]

  @@index([organizationId, agentType])
  @@index([userId, agentType])
  @@index([lastMessageAt])
  @@map("chat_threads")
}

enum AgentType {
  raw_materials_ai
  sales_rnd_ai
}

model ChatMessage {
  id         String     @id @default(auto()) @map("_id") @db.ObjectId
  threadId   String     @db.ObjectId
  role       String     // "user" | "assistant"
  content    String
  metadata   Json?
  createdAt  DateTime   @default(now())

  thread     ChatThread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId])
  @@map("chat_messages")
}
```

**Thread title:** First user message truncated to 50 chars.

**tRPC Router: chatThreads**
- `list` — Get threads for org + agent type, sorted by lastMessageAt
- `create` — Start new thread
- `getMessages` — Paginated messages for a thread
- `addMessage` — Append message to thread (increments messageCount, updates lastMessageAt)
- `archive` — Soft delete

---

## Part 3: Frontend History Sidebar

### Layout
```
┌──────────────────────────────────────────────┐
│  AI Page Header                              │
├────────────┬─────────────────────────────────┤
│  History   │  Chat Area                      │
│  Sidebar   │  Messages + Input               │
│            │                                 │
│  [+New]    │                                 │
│  Today     │                                 │
│  · Thread1 │                                 │
│  · Thread2 │                                 │
│  Yesterday │                                 │
│  · Thread3 │                                 │
│  [toggle]  │                                 │
└────────────┴─────────────────────────────────┘
```

### Behavior
- Toggle button in chat header to show/hide sidebar
- Default: collapsed on mobile, open on desktop
- Width: ~240px open, 0px closed (fully hidden)
- Threads grouped by date: Today, Yesterday, Previous 7 Days, Older
- Active thread highlighted
- "+ New Chat" button at top
- Thread shows: truncated title + relative time

### Components
- `AIChatSidebar` — history panel (reusable across both pages)
- `AIChatLayout` — wraps sidebar + chat area with toggle logic
- `use_chat_threads.ts` — hook for thread CRUD via tRPC

### State Flow
- On page load: fetch thread list → auto-select most recent (or empty state)
- New chat: thread created on first message send (avoids empty threads)
- Messages loaded from/saved to selected thread via tRPC
- Both AI pages use same components, pass different `agentType`
