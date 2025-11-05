#!/bin/bash

# Aggressive Clean All Script
# Removes all cache, build artifacts, temporary files, and resets the project to pristine state

set -e  # Exit on any error

echo "🧹 Starting aggressive clean all..."
echo "📍 Current directory: $(pwd)"
echo "⚠️  This will remove ALL cache, build artifacts, node_modules, and temporary files!"
echo ""
read -p "Are you sure you want to continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Clean cancelled."
    exit 1
fi

echo ""
echo "🔥 Removing build directories..."
rm -rf .next
rm -rf dist
rm -rf build
rm -rf out

echo "🔥 Removing cache directories..."
rm -rf .cache
rm -rf .turbo
rm -rf .vite
rm -rf .parcel-cache
rm -rf .swc
rm -rf .eslintcache

echo "🔥 Removing testing coverage directories..."
rm -rf coverage
rm -rf .nyc_output
rm -rf .pytest_cache
rm -rf __pycache__
rm -rf .jest

echo "🔥 Removing deployment directories..."
rm -rf .vercel
rm -rf .netlify
rm -rf .wrangler
rm -rf .sst
rm -rf .output
rm -rf .amplify

echo "🔥 Removing temporary directories..."
rm -rf .tmp
rm -rf .temp
rm -rf tmp
rm -rf temp

echo "🔥 Removing Node modules..."
rm -rf node_modules

echo "🔥 Removing log files..."
rm -f *.log
rm -f npm-debug.log*
rm -f yarn-debug.log*
rm -f yarn-error.log*
rm -f pnpm-debug.log*
rm -f lerna-debug.log*
rm -f .pnpm-debug.log*

echo "🔥 Preserving all environment files (.env, .env.local, .env.*)..."
echo "  ✅ Environment files will NOT be deleted"

echo "🔥 Removing system files..."
find . -name '.DS_Store' -delete
find . -name 'Thumbs.db' -delete
find . -name 'Desktop.ini' -delete

echo "🔥 Removing TypeScript build info..."
find . -name '*.tsbuildinfo' -delete

echo "🔥 Removing editor cache files..."
rm -rf .vscode/.extensions-cache
rm -rf .idea
rm -rf *.swp
rm -rf *.swo
rm -rf *~

echo "🔥 Cleaning package manager caches..."
if command -v npm &> /dev/null; then
    echo "  Cleaning npm cache..."
    npm cache clean --force
fi

if command -v yarn &> /dev/null; then
    echo "  Cleaning yarn cache..."
    yarn cache clean
fi

if command -v pnpm &> /dev/null; then
    echo "  Cleaning pnpm store..."
    pnpm store prune
fi

echo "🔥 Removing lock files for fresh install (optional)..."
read -p "Remove package-lock.json/yarn.lock/pnpm-lock.yaml for completely fresh install? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -f package-lock.json
    rm -f yarn.lock
    rm -f pnpm-lock.yaml
    echo "  ✅ Lock files removed"
fi

echo ""
echo "🔥 Removing any remaining hidden cache files..."
find . -name '.*cache*' -type d -exec rm -rf {} + 2>/dev/null || true
find . -name '.*cache*' -type f -delete 2>/dev/null || true

echo ""
echo "📊 Summary of removed items:"
echo "  • Build artifacts (.next, dist, build, out)"
echo "  • Cache directories (.cache, .turbo, .vite, .swc, .parcel-cache)"
echo "  • Testing coverage (coverage, .nyc_output, .pytest_cache)"
echo "  • Deployment folders (.vercel, .netlify, .wrangler, .sst)"
echo "  • Node modules and dependencies"
echo "  • Log files and debug logs"
echo "  • System files (.DS_Store, Thumbs.db)"
echo "  • ❌ Environment files (.env, .env.local, .env.*) are PRESERVED"
echo "  • TypeScript build info"
echo "  • Editor cache files"
echo "  • Package manager caches"
echo "  • Hidden cache files"

echo ""
echo "✅ Aggressive clean completed successfully!"
echo ""
echo "📝 Next steps:"
echo "  1. Run 'npm install' or 'yarn install' to reinstall dependencies"
echo "  2. Your .env files are preserved and ready to use"
echo "  3. Run 'npm run dev' to start development"
echo ""
echo "🎯 Your project is now in a pristine state!"