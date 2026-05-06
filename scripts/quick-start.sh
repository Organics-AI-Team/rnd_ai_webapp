#!/bin/bash

# Quick Start Script for R&D AI Management Monorepo
# This script helps you get started quickly with the development environment

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Header
echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║        R&D AI Management - Quick Start Setup              ║"
echo "║                  Monorepo Edition                          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check prerequisites
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js 18+ first.${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js version must be 18 or higher. Current: $(node -v)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js $(node -v) detected${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ npm $(npm -v) detected${NC}"

# Check if in correct directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Please run this script from the project root directory${NC}"
    exit 1
fi

echo -e "${GREEN}✓ In correct directory${NC}"

# Clean old installations
echo -e "\n${YELLOW}[2/6] Cleaning old installations...${NC}"

if [ -d "node_modules" ]; then
    echo "Removing old node_modules..."
    rm -rf node_modules
fi

if [ -d "apps/web/node_modules" ]; then
    echo "Removing apps/web/node_modules..."
    rm -rf apps/web/node_modules
fi

if [ -d "apps/ai/node_modules" ]; then
    echo "Removing apps/ai/node_modules..."
    rm -rf apps/ai/node_modules
fi

if [ -d ".next" ]; then
    echo "Removing old .next..."
    rm -rf .next
fi

if [ -d "apps/web/.next" ]; then
    echo "Removing apps/web/.next..."
    rm -rf apps/web/.next
fi

echo -e "${GREEN}✓ Cleaned old installations${NC}"

# Install dependencies
echo -e "\n${YELLOW}[3/6] Installing dependencies...${NC}"
echo "This may take a few minutes..."

npm install --legacy-peer-deps

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Dependencies installed successfully${NC}"
else
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    exit 1
fi

# Setup environment files
echo -e "\n${YELLOW}[4/6] Setting up environment files...${NC}"

# Check if .env exists in root
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
        echo -e "${YELLOW}⚠️  Please edit .env and add your actual values${NC}"
    else
        echo -e "${YELLOW}⚠️  No .env.example found, skipping...${NC}"
    fi
else
    echo -e "${GREEN}✓ .env already exists${NC}"
fi

# Check if .env exists in apps/web
if [ ! -f "apps/web/.env" ]; then
    if [ -f "apps/web/.env.example" ]; then
        echo "Creating apps/web/.env from .env.example..."
        cp apps/web/.env.example apps/web/.env
        echo -e "${YELLOW}⚠️  Please edit apps/web/.env and add your actual values${NC}"
    fi
fi

# Check if .env exists in apps/ai
if [ ! -f "apps/ai/.env" ]; then
    if [ -f "apps/ai/.env.example" ]; then
        echo "Creating apps/ai/.env from .env.example..."
        cp apps/ai/.env.example apps/ai/.env
        echo -e "${YELLOW}⚠️  Please edit apps/ai/.env and add your actual values${NC}"
    fi
fi

echo -e "${GREEN}✓ Environment files ready${NC}"

# Verify workspace structure
echo -e "\n${YELLOW}[5/6] Verifying workspace structure...${NC}"

npm ls --workspaces --depth=0 > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Workspace structure verified${NC}"
else
    echo -e "${RED}❌ Workspace structure verification failed${NC}"
fi

# Test build
echo -e "\n${YELLOW}[6/6] Testing build...${NC}"

read -p "Do you want to test the build? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Building web app..."
    npm run build:web

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Build successful!${NC}"
    else
        echo -e "${RED}❌ Build failed. Please check the errors above.${NC}"
        exit 1
    fi
else
    echo "Skipping build test..."
fi

# Final instructions
echo -e "\n${GREEN}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Setup Complete! 🎉                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "\n${BLUE}Next Steps:${NC}"
echo ""
echo "1. Edit environment files with your actual values:"
echo "   - .env"
echo "   - apps/web/.env"
echo "   - apps/ai/.env"
echo ""
echo "2. Start the development server:"
echo -e "   ${GREEN}npm run dev:web${NC}     # Start web app (http://localhost:3000)"
echo -e "   ${GREEN}npm run dev:ai${NC}      # Start AI service (http://localhost:3001)"
echo ""
echo "3. Seed admin account (optional):"
echo -e "   ${GREEN}npm run seed-admin${NC}"
echo ""
echo "4. View all available commands:"
echo -e "   ${GREEN}npm run${NC}"
echo ""
echo "5. Read the documentation:"
echo -e "   - ${BLUE}README.md${NC} - Overview and quick start"
echo -e "   - ${BLUE}docs/MONOREPO_README.md${NC} - Architecture guide"
echo -e "   - ${BLUE}docs/DEPLOYMENT.md${NC} - Deployment strategies"
echo -e "   - ${BLUE}docs/MIGRATION_GUIDE.md${NC} - Migration help"
echo ""

echo -e "${YELLOW}Important Notes:${NC}"
echo "• Make sure MongoDB is running and accessible"
echo "• Add your API keys (GEMINI_API_KEY, OPENAI_API_KEY) to .env files"
echo "• Run 'npm run index:chromadb' to index your data for AI features"
echo ""

echo -e "${GREEN}Happy coding! 🚀${NC}"
