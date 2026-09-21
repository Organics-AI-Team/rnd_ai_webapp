# R&D AI Management System

> **A comprehensive AI-powered R&D management platform with intelligent chatbots, vector search, and analytics**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)
[![License](https://img.shields.io/badge/license-ISC-green.svg)](LICENSE)

**Monorepo architecture with separate Web (frontend) and AI (backend) services for scalability and maintainability.**

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Development](#development)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Tech Stack](#tech-stack)

---

## 🎯 Overview

R&D AI Management is a multi-tenant platform for cosmetic R&D teams, featuring:

- **AI-Powered R&D Agent**: One skill-based agent for raw-material, stock, formula, and sales R&D work
- **Vector Search**: Qdrant-backed semantic search across R&D knowledge
- **Order Management**: Complete order lifecycle with multi-channel support
- **Analytics Dashboard**: Real-time insights and reporting
- **Credit System**: Organization-based credit management for shipping

---

## ✨ Features

### 🤖 AI Capabilities

- **Unified R&D AI Agent**
  - Intelligent ingredient search and recommendations
  - Regulatory compliance checking
  - Material compatibility analysis
  - Real-time stock information
  - Market intelligence gathering
  - Product formulation suggestions
  - Trend analysis

- **Vector Search (RAG)**
  - Semantic search across knowledge base
  - Qdrant collections for FDA, stock, sales R&D, and MySkin data
  - Gemini embeddings with OpenAI fallback

### 📊 Management Features

- **Multi-Tenant Architecture**: Organization-based isolation
- **Role-Based Access**: Owner, Admin, Member roles
- **Order Management**: Complete lifecycle tracking
- **Formula Management**: Create and manage formulations
- **Stock Tracking**: Real-time inventory monitoring
- **Credit System**: Shipping cost management

### 📈 Analytics & Reporting

- **AI Chat Analytics**: Conversation metrics and feedback
- **Sales Dashboard**: Revenue and channel analytics
- **Stock Reports**: Inventory levels and alerts
- **PDF Export**: Generate detailed reports

---

## 🏗️ Architecture

### Monorepo Structure

```
rnd_ai_management/
├── apps/
│   ├── web/                # Next.js Frontend (Port 3000)
│   │   ├── app/            # Pages & API routes
│   │   ├── components/     # React components
│   │   ├── hooks/          # React hooks
│   │   └── lib/            # Utilities
│   │
│   └── ai/                 # AI Backend Service (Port 3001)
│       ├── agents/         # AI agents & logic
│       ├── server/         # tRPC routers
│       ├── scripts/        # Indexing scripts
│       └── lib/            # AI utilities
│
├── packages/
│   ├── shared-types/       # Shared TypeScript types
│   └── shared-config/      # Shared configurations
│
├── config/                 # Deployment configs
├── docs/                   # Documentation
└── _archive/               # Legacy files
```

### Key Technologies

**Frontend (apps/web)**
- Next.js 14 with App Router
- React 19
- Tailwind CSS + shadcn/ui
- tRPC Client
- TanStack Query

**Backend (apps/ai)**
- Node.js + TypeScript
- tRPC Server
- Google Gemini AI
- OpenAI
- Qdrant
- MongoDB

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- npm or pnpm

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd rnd_ai_management

# Install dependencies
npm install --legacy-peer-deps

# Copy environment variables
cp .env.example .env
# Edit .env with your values
```

### Environment Setup

Create `.env` in root with:

```env
# Database
MONGODB_URI=mongodb+srv://...
RAW_MATERIALS_REAL_STOCK_MONGODB_URI=mongodb+srv://...

# AI Keys
GEMINI_API_KEY=AIza...
OPENAI_API_KEY=sk-...
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY= # Optional for authenticated clusters

# Admin Credentials
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your_secure_password

```

### Run Development Server

```bash
# Run web app (frontend)
npm run dev

# Or run specific apps
npm run dev:web    # Web app on http://localhost:3000
npm run dev:ai     # AI service on http://localhost:3001
```

### Seed Admin Account

```bash
npm run seed-admin
```

Creates test account:
- Email: admin@test.com
- Password: admin123
- Credits: 1000 THB

---

## 💻 Development

### Available Scripts

**Development**
```bash
npm run dev        # Run web app
npm run dev:web    # Run web app explicitly
npm run dev:ai     # Run AI service
```

**Build**
```bash
npm run build      # Build all apps
npm run build:web  # Build web app only
npm run build:ai   # Build AI service only
```

**AI Operations**
```bash
npm run seed-admin           # Seed admin user
npm run migrate              # Run migrations
npm run index:qdrant         # Index all RAG collections in Qdrant
npm run check:qdrant         # Check Qdrant statistics
```

**Maintenance**
```bash
npm run clean      # Clean build artifacts
npm run clean-all  # Aggressive clean
npm run reset      # Clean and reinstall
npm run lint       # Run linters
```

### Project Structure

See [docs/MONOREPO_README.md](docs/MONOREPO_README.md) for detailed architecture documentation.

---

## 🐳 Docker & Deployment

### Docker Compose (Local Development)

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f web
docker-compose logs -f qdrant

# Stop services
docker-compose down
```

Services:
- **Web**: http://localhost:3000
- **Qdrant**: http://localhost:6333

### Production Deployment (DigitalOcean Droplet)

```bash
# On the production Droplet, from /opt/rnd-ai/app
git pull --ff-only
./scripts/deploy-droplet.sh --up
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed deployment guides.

---

## 📚 Documentation

- **[MONOREPO_README.md](docs/MONOREPO_README.md)** - Architecture & workspace guide
- **[DEPLOYMENT.md](docs/DEPLOYMENT.md)** - DigitalOcean Droplet deployment
- **[CHANGELOG.md](CHANGELOG.md)** - Version history & changes

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: Next.js 14 (App Router)
- **UI**: React 19, Tailwind CSS, shadcn/ui, Radix UI
- **State**: TanStack Query (React Query)
- **API**: tRPC Client
- **Charts**: Recharts
- **PDF**: jsPDF
- **Icons**: Lucide React

### Backend
- **Runtime**: Node.js + TypeScript
- **API**: tRPC Server
- **AI**: Gemini with OpenAI embedding fallback and skill-based tools
- **LLMs**: Google Gemini, OpenAI
- **Vector DB**: Qdrant
- **Database**: MongoDB
- **Real-time**: Socket.IO
- **ML**: TensorFlow.js

### DevOps
- **Monorepo**: npm workspaces
- **Containerization**: Docker, Docker Compose
- **Deployment**: DigitalOcean Droplet + Docker Compose
- **CI/CD**: Git hooks

---

## 🎯 Use Cases

### For R&D Teams
- Research ingredient compatibility
- Get regulatory compliance information
- Find alternative materials
- Access real-time stock data

### For Sales Teams
- Generate market intelligence
- Create pitch decks
- Analyze product trends
- Get formulation recommendations

### For Management
- Track orders and inventory
- Monitor AI chat analytics
- Manage team credits
- Generate reports

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the ISC License.

---

## 🙋 Support

For issues and questions:
- Check [docs/](docs/) for detailed guides
- Review [CHANGELOG.md](CHANGELOG.md) for recent changes
- Open an issue on GitHub

---

## 🔗 Links

- **Documentation**: [docs/MONOREPO_README.md](docs/MONOREPO_README.md)
- **Deployment Guide**: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **API Reference**: Coming soon
- **Component Library**: shadcn/ui + Radix UI

---

**Built with ❤️ for the R&D community**
