.PHONY: help install dev dev-web dev-ai build build-web build-ai clean clean-all reset
.PHONY: seed-admin migrate index index-resume check-chromadb
.PHONY: docker-up docker-down docker-logs docker-build
.PHONY: quick-start lint test

# ============================================================================
# R&D AI Management - Makefile (Monorepo)
# ============================================================================

# Default target - show help
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m # No Color

# ============================================================================
# HELP
# ============================================================================

help: ## Show this help message
	@echo ""
	@echo "$(BLUE)╔════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(BLUE)║        R&D AI Management - Makefile Commands              ║$(NC)"
	@echo "$(BLUE)║                  Monorepo Edition                          ║$(NC)"
	@echo "$(BLUE)╚════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(GREEN)Development Commands:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(YELLOW)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(BLUE)Usage:$(NC)"
	@echo "  make <command>"
	@echo ""
	@echo "$(BLUE)Examples:$(NC)"
	@echo "  make install      # Install dependencies"
	@echo "  make dev-web      # Start web app"
	@echo "  make docker-up    # Start all services with Docker"
	@echo ""

# ============================================================================
# INSTALLATION
# ============================================================================

install: ## Install all dependencies
	@echo "$(BLUE)Installing dependencies for monorepo...$(NC)"
	@echo "Using --legacy-peer-deps to handle conflicts:"
	@echo "  - chromadb@1.8.1 (requires @google/generative-ai@^0.1.1)"
	@echo "  - @langchain/google-genai (requires @google/generative-ai@^0.24.0)"
	npm install --legacy-peer-deps
	@echo "$(GREEN)✓ Installation complete!$(NC)"

quick-start: ## Run quick start setup script
	@echo "$(BLUE)Running quick start setup...$(NC)"
	chmod +x scripts/quick-start.sh
	./scripts/quick-start.sh

# ============================================================================
# DEVELOPMENT
# ============================================================================

dev: dev-web ## Start development server (default: web app)

dev-web: ## Start web app development server
	@echo "$(BLUE)Starting web app on http://localhost:3000$(NC)"
	npm run dev:web

dev-ai: ## Start AI service development server
	@echo "$(BLUE)Starting AI service on http://localhost:3001$(NC)"
	npm run dev:ai

dev-all: ## Start both web and AI services (requires tmux)
	@echo "$(BLUE)Starting both services...$(NC)"
	@if command -v tmux > /dev/null; then \
		tmux new-session -d -s rnd-ai; \
		tmux split-window -h; \
		tmux send-keys -t rnd-ai:0.0 'make dev-web' C-m; \
		tmux send-keys -t rnd-ai:0.1 'make dev-ai' C-m; \
		tmux attach -t rnd-ai; \
	else \
		echo "$(RED)tmux is not installed. Please install tmux or run services in separate terminals.$(NC)"; \
		echo "  Terminal 1: make dev-web"; \
		echo "  Terminal 2: make dev-ai"; \
	fi

# ============================================================================
# BUILD
# ============================================================================

build: ## Build all apps
	@echo "$(BLUE)Building all applications...$(NC)"
	npm run build
	@echo "$(GREEN)✓ Build complete!$(NC)"

build-web: ## Build web app only
	@echo "$(BLUE)Building web app...$(NC)"
	npm run build:web
	@echo "$(GREEN)✓ Web app build complete!$(NC)"

build-ai: ## Build AI service only
	@echo "$(BLUE)Building AI service...$(NC)"
	npm run build:ai
	@echo "$(GREEN)✓ AI service build complete!$(NC)"

# ============================================================================
# TESTING & LINTING
# ============================================================================

lint: ## Run linters on all workspaces
	@echo "$(BLUE)Running linters...$(NC)"
	npm run lint
	@echo "$(GREEN)✓ Linting complete!$(NC)"

test: ## Run tests (if available)
	@echo "$(YELLOW)Tests not yet configured$(NC)"
	@echo "TODO: Add test command when tests are available"

# ============================================================================
# CLEANING
# ============================================================================

clean: ## Clean build artifacts and cache
	@echo "$(BLUE)Cleaning build artifacts and cache...$(NC)"
	rm -rf .next
	rm -rf apps/web/.next
	rm -rf apps/web/out
	rm -rf apps/ai/dist
	rm -rf dist
	rm -rf node_modules/.cache
	rm -rf apps/*/node_modules/.cache
	rm -rf *.tsbuildinfo
	rm -rf apps/*/*.tsbuildinfo
	@echo "$(GREEN)✓ Clean complete!$(NC)"

clean-all: clean ## Clean everything including node_modules
	@echo "$(YELLOW)Cleaning node_modules in all workspaces...$(NC)"
	rm -rf node_modules
	rm -rf apps/web/node_modules
	rm -rf apps/ai/node_modules
	rm -rf packages/*/node_modules
	@echo "$(GREEN)✓ Clean all complete!$(NC)"
	@echo "$(YELLOW)Run 'make install' to reinstall dependencies.$(NC)"

reset: clean-all install ## Clean everything and reinstall
	@echo "$(GREEN)✓ Reset complete!$(NC)"

# ============================================================================
# AI OPERATIONS
# ============================================================================

seed-admin: ## Seed admin user in database
	@echo "$(BLUE)Seeding admin user...$(NC)"
	npm run seed-admin
	@echo "$(GREEN)✓ Admin user seeded!$(NC)"

migrate: ## Run database migrations
	@echo "$(BLUE)Running migrations...$(NC)"
	npm run migrate
	@echo "$(GREEN)✓ Migrations complete!$(NC)"

index: ## Index data to ChromaDB
	@echo "$(BLUE)Indexing data to ChromaDB...$(NC)"
	npm run index:chromadb
	@echo "$(GREEN)✓ Indexing complete!$(NC)"

index-resume: ## Resume ChromaDB indexing
	@echo "$(BLUE)Resuming ChromaDB indexing...$(NC)"
	npm run index:chromadb:resume
	@echo "$(GREEN)✓ Indexing resumed!$(NC)"

index-fast: ## Fast ChromaDB indexing
	@echo "$(BLUE)Fast ChromaDB indexing...$(NC)"
	npm run index:chromadb:fast
	@echo "$(GREEN)✓ Fast indexing complete!$(NC)"

check-chromadb: ## Check ChromaDB statistics
	@echo "$(BLUE)Checking ChromaDB statistics...$(NC)"
	npm run check:chromadb

# ============================================================================
# DOCKER
# ============================================================================

docker-up: ## Start all services with Docker Compose
	@echo "$(BLUE)Starting services with Docker Compose...$(NC)"
	docker-compose up -d
	@echo "$(GREEN)✓ Services started!$(NC)"
	@echo "$(BLUE)Web:      http://localhost:3000$(NC)"
	@echo "$(BLUE)AI:       http://localhost:3001$(NC)"
	@echo "$(BLUE)ChromaDB: http://localhost:8000$(NC)"

docker-down: ## Stop all Docker services
	@echo "$(BLUE)Stopping Docker services...$(NC)"
	docker-compose down
	@echo "$(GREEN)✓ Services stopped!$(NC)"

docker-logs: ## View Docker logs (all services)
	docker-compose logs -f

docker-logs-web: ## View web app logs
	docker-compose logs -f web

docker-logs-ai: ## View AI service logs
	docker-compose logs -f ai

docker-logs-chroma: ## View ChromaDB logs
	docker-compose logs -f chromadb

docker-build: ## Rebuild Docker images
	@echo "$(BLUE)Rebuilding Docker images...$(NC)"
	docker-compose build
	@echo "$(GREEN)✓ Build complete!$(NC)"

docker-rebuild: docker-down docker-build docker-up ## Rebuild and restart services

# ============================================================================
# DEPLOYMENT
# ============================================================================

deploy-railway: ## Deploy to Railway
	@echo "$(BLUE)Deploying to Railway...$(NC)"
	railway up
	@echo "$(GREEN)✓ Deployment started!$(NC)"

deploy-railway-web: ## Deploy web app to Railway
	@echo "$(BLUE)Deploying web app to Railway...$(NC)"
	railway up --config config/railway.web.json
	@echo "$(GREEN)✓ Deployment started!$(NC)"

# ============================================================================
# UTILITIES
# ============================================================================

status: ## Show project status
	@echo "$(BLUE)╔════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(BLUE)║              R&D AI Management - Status                   ║$(NC)"
	@echo "$(BLUE)╚════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(GREEN)Branch:$(NC)"
	@git branch --show-current
	@echo ""
	@echo "$(GREEN)Recent Commits:$(NC)"
	@git log --oneline -5
	@echo ""
	@echo "$(GREEN)Workspace Packages:$(NC)"
	@npm ls --workspaces --depth=0 2>/dev/null || echo "Run 'make install' first"
	@echo ""
	@echo "$(GREEN)Node Version:$(NC)"
	@node -v
	@echo ""
	@echo "$(GREEN)NPM Version:$(NC)"
	@npm -v

version: ## Show versions of all tools
	@echo "$(BLUE)Tool Versions:$(NC)"
	@echo "Node:    $$(node -v)"
	@echo "NPM:     $$(npm -v)"
	@echo "Git:     $$(git --version)"
	@echo "Docker:  $$(docker --version 2>/dev/null || echo 'Not installed')"

check-env: ## Check if environment variables are set
	@echo "$(BLUE)Checking environment variables...$(NC)"
	@if [ -f .env ]; then \
		echo "$(GREEN)✓ Root .env exists$(NC)"; \
	else \
		echo "$(RED)✗ Root .env missing$(NC)"; \
	fi
	@if [ -f apps/web/.env ]; then \
		echo "$(GREEN)✓ apps/web/.env exists$(NC)"; \
	else \
		echo "$(RED)✗ apps/web/.env missing$(NC)"; \
	fi
	@if [ -f apps/ai/.env ]; then \
		echo "$(GREEN)✓ apps/ai/.env exists$(NC)"; \
	else \
		echo "$(RED)✗ apps/ai/.env missing$(NC)"; \
	fi

docs: ## Open documentation in browser
	@echo "$(BLUE)Opening documentation...$(NC)"
	@open README.md 2>/dev/null || xdg-open README.md 2>/dev/null || echo "$(YELLOW)Please open README.md manually$(NC)"

# ============================================================================
# SHORTCUTS
# ============================================================================

i: install ## Shortcut for install
d: dev ## Shortcut for dev
b: build ## Shortcut for build
c: clean ## Shortcut for clean
r: reset ## Shortcut for reset
