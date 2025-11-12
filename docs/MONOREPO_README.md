# R&D AI Management - Monorepo Structure

This project has been refactored into a monorepo structure with separate applications for Web (frontend) and AI (backend).

## Project Structure

```
rnd_ai_management/
├── apps/
│   ├── web/                    # Next.js Frontend Application
│   │   ├── app/                # Next.js app router (pages & API routes)
│   │   ├── components/         # React UI components
│   │   ├── hooks/              # React hooks
│   │   ├── lib/                # Web-specific utilities
│   │   ├── next.config.js      # Next.js configuration
│   │   ├── package.json        # Web app dependencies
│   │   └── tsconfig.json       # Web TypeScript config
│   │
│   └── ai/                     # AI Backend Service
│       ├── agents/             # AI agents (raw-materials, sales)
│       ├── server/             # tRPC server & routers
│       ├── scripts/            # Indexing & migration scripts
│       ├── chromadb-service/   # Vector database service
│       ├── lib/                # AI-specific utilities
│       ├── .chromadb/          # ChromaDB data directory
│       ├── package.json        # AI service dependencies
│       └── tsconfig.json       # AI TypeScript config
│
├── packages/
│   ├── shared-types/           # Shared TypeScript types
│   │   ├── src/
│   │   │   └── index.ts        # Exported types & interfaces
│   │   └── package.json
│   │
│   └── shared-config/          # Shared configuration
│       ├── tsconfig.base.json  # Base TypeScript config
│       └── package.json
│
├── docs/                       # Documentation
├── package.json               # Root workspace configuration
└── README.md                  # Original project README
```

## Getting Started

### Installation

Install all dependencies across the monorepo:

```bash
npm install --legacy-peer-deps
```

### Development

Run both applications in development mode:

```bash
# Run web app (default)
npm run dev

# Or run specific apps
npm run dev:web    # Next.js web app on port 3000
npm run dev:ai     # AI service on port 3001
```

### Building

Build all applications:

```bash
npm run build
```

Build specific apps:

```bash
npm run build:web
npm run build:ai
```

### Production

Start production servers:

```bash
npm run start       # Start web app
npm run start:web   # Start web app
npm run start:ai    # Start AI service
```

## Workspace Scripts

### AI Service Scripts

All AI-related scripts are proxied through the root package.json:

```bash
# Database operations
npm run seed-admin              # Seed admin user
npm run migrate                 # Run migrations

# Vector database indexing
npm run create-sales-index      # Create sales AI index
npm run index-sales-data        # Index sales data
npm run index:chromadb          # Index to ChromaDB
npm run index:chromadb:resume   # Resume ChromaDB indexing
npm run index:chromadb:fast     # Fast ChromaDB indexing
npm run check:chromadb          # Check ChromaDB stats
```

### Cleaning

```bash
npm run clean        # Clean all build artifacts
npm run clean-all    # Aggressive clean (removes node_modules)
npm run reset        # Clean and reinstall dependencies
```

## Architecture

### Web App (`apps/web`)

- **Framework**: Next.js 14 with App Router
- **UI**: React 19, Tailwind CSS, Radix UI
- **State Management**: TanStack Query (React Query)
- **API Communication**: tRPC client
- **Features**:
  - Admin dashboard
  - AI chat interfaces (Raw Materials AI, Sales R&D AI)
  - Stock management
  - Formula management
  - User authentication

### AI Service (`apps/ai`)

- **Framework**: Node.js with TypeScript
- **API**: tRPC server
- **AI**: LangChain, Google Gemini, OpenAI
- **Vector DB**: ChromaDB (primary), Pinecone (optional)
- **Database**: MongoDB
- **Features**:
  - AI agents (Raw Materials, Sales R&D)
  - RAG (Retrieval Augmented Generation)
  - Vector search & embeddings
  - Real-time chat via Socket.IO
  - Agent orchestration with sub-agents

### Shared Packages

- **`@rnd-ai/shared-types`**: Common TypeScript types and interfaces used across both apps
- **`@rnd-ai/shared-config`**: Shared configuration files (TypeScript, ESLint base configs)

## Technology Stack

### Frontend (Web)
- Next.js 14
- React 19
- TypeScript
- Tailwind CSS
- Radix UI
- TanStack Query
- tRPC Client
- Recharts (data visualization)
- jsPDF (PDF generation)

### Backend (AI)
- Node.js
- TypeScript
- tRPC Server
- LangChain & LangGraph
- Google Gemini AI
- OpenAI
- ChromaDB (vector database)
- MongoDB (primary database)
- Socket.IO (real-time)
- TensorFlow.js (ML)

## Environment Variables

Both apps require environment variables. Copy `.env.example` to `.env` in each app directory:

```bash
# For web app
cp apps/web/.env.example apps/web/.env

# For AI service
cp apps/ai/.env.example apps/ai/.env
```

Required environment variables:

### Web App
- `NEXT_PUBLIC_API_URL` - API endpoint
- `MONGODB_URI` - MongoDB connection string

### AI Service
- `MONGODB_URI` - MongoDB connection string
- `GEMINI_API_KEY` - Google Gemini API key
- `OPENAI_API_KEY` - OpenAI API key (optional)
- `PINECONE_API_KEY` - Pinecone API key (optional)
- `VECTOR_DB_PROVIDER` - Vector DB provider (chroma or pinecone)

## Deployment

### Docker

The project includes Docker support with standalone output:

```bash
docker build -t rnd-ai-web -f apps/web/Dockerfile .
docker build -t rnd-ai-service -f apps/ai/Dockerfile .
```

### Railway

Deployment configurations:
- `railway.json` - Railway deployment config
- `railway.toml` - Railway service definitions

## Benefits of Monorepo Structure

✅ **Separation of Concerns**: Clear boundary between frontend and AI backend
✅ **Independent Scaling**: Deploy and scale AI service separately
✅ **Better Code Organization**: Cleaner structure, easier to navigate
✅ **Shared Code Reuse**: Types and utilities shared across apps
✅ **Development Speed**: Run only what you need during development
✅ **Team Collaboration**: Teams can work on apps independently
✅ **Type Safety**: Shared types ensure consistency between frontend and backend

## Migration Notes

This monorepo was created by:
1. Splitting the original Next.js app into `apps/web` and `apps/ai`
2. Moving AI agents, server logic, and scripts to `apps/ai`
3. Keeping the Next.js frontend and API routes in `apps/web`
4. Extracting shared types to `packages/shared-types`
5. Setting up npm workspaces for dependency management
6. Updating TypeScript configurations with proper path aliases

## Troubleshooting

### Import Errors

If you encounter import errors, ensure:
1. All dependencies are installed: `npm install --legacy-peer-deps`
2. TypeScript path aliases are correct in `tsconfig.json`
3. The shared packages are properly linked via npm workspaces

### Build Errors

If builds fail:
1. Clean all build artifacts: `npm run clean-all`
2. Reinstall dependencies: `npm install --legacy-peer-deps`
3. Try building individual apps: `npm run build:web` or `npm run build:ai`

### Development Server Issues

If dev servers won't start:
1. Check ports 3000 (web) and 3001 (ai) are not in use
2. Verify environment variables are set
3. Check MongoDB and ChromaDB connections

## Contributing

When adding new code:
1. Place frontend code in `apps/web`
2. Place AI/backend code in `apps/ai`
3. Place shared types in `packages/shared-types`
4. Update this README if adding new features or changing structure

## License

ISC
