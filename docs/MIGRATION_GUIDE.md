# Migration Guide - Monorepo Refactoring

This guide helps developers migrate from the old single-app structure to the new monorepo architecture.

## 📋 Table of Contents

- [What Changed](#what-changed)
- [Before You Start](#before-you-start)
- [Step-by-Step Migration](#step-by-step-migration)
- [Common Issues](#common-issues)
- [Rollback Instructions](#rollback-instructions)

---

## 🔄 What Changed

### Project Structure

**OLD Structure (Before):**
```
rnd_ai_management/
├── app/                    # Next.js pages
├── components/             # React components
├── ai/                     # AI logic
├── server/                 # tRPC server
├── lib/                    # Mixed utilities
├── scripts/                # Scripts
└── package.json            # Single package file
```

**NEW Structure (After):**
```
rnd_ai_management/
├── apps/
│   ├── web/                # Frontend application
│   │   ├── app/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── package.json    # Web dependencies
│   │
│   └── ai/                 # Backend AI service
│       ├── agents/
│       ├── server/
│       ├── scripts/
│       ├── lib/
│       └── package.json    # AI dependencies
│
├── packages/
│   ├── shared-types/       # Shared types
│   └── shared-config/      # Shared configs
│
├── config/                 # Deployment configs
├── docs/                   # Documentation
└── package.json            # Root workspace config
```

### Key Differences

1. **Workspace Structure**: Now using npm workspaces
2. **Separate Dependencies**: Each app has its own `package.json`
3. **Shared Packages**: Common code in `packages/`
4. **Organized Configs**: Deployment files in `config/`
5. **Better Documentation**: All docs in `docs/`

---

## 🚦 Before You Start

### Prerequisites

- [ ] Git is clean (commit or stash current changes)
- [ ] You have backups of important data
- [ ] Node.js 18+ is installed
- [ ] You understand the new structure

### Backup Current State

```bash
# Create a backup branch
git checkout -b backup-before-monorepo

# Commit current state
git add -A
git commit -m "Backup before monorepo migration"

# Return to develop
git checkout develop
```

---

## 📝 Step-by-Step Migration

### Step 1: Pull Latest Changes

```bash
# Ensure you're on develop branch
git checkout develop

# Pull latest changes
git pull origin develop
```

### Step 2: Clean Old Build Artifacts

```bash
# Remove old build files
npm run clean-all

# This will delete:
# - node_modules
# - .next
# - dist
# - *.tsbuildinfo
```

### Step 3: Install Dependencies

```bash
# Install with legacy peer deps flag
npm install --legacy-peer-deps

# This installs:
# - Root workspace dependencies
# - apps/web dependencies
# - apps/ai dependencies
# - packages/* dependencies
```

**Expected output:**
```
added XXX packages in Xs
```

### Step 4: Verify Installation

```bash
# Check workspace structure
npm ls --workspaces --depth=0

# Expected output:
# @rnd-ai/web@1.0.0
# @rnd-ai/ai@1.0.0
# @rnd-ai/shared-types@1.0.0
# @rnd-ai/shared-config@1.0.0
```

### Step 5: Update Environment Variables

**Before:**
- Single `.env` in root

**After:**
- `.env` in root (for shared variables)
- `apps/web/.env` (for web-specific variables)
- `apps/ai/.env` (for AI-specific variables)

```bash
# Copy .env.example to each app
cp .env.example apps/web/.env
cp .env.example apps/ai/.env

# Edit each file with appropriate values
```

### Step 6: Test Build

```bash
# Build web app
npm run build:web

# Should see:
# ✓ Compiled successfully
# ✓ Generating static pages (35/35)
```

### Step 7: Test Development Server

```bash
# Start web app
npm run dev:web

# Open http://localhost:3000
# Verify app loads correctly
```

### Step 8: Update Your Workflow

**OLD Commands:**
```bash
npm run dev         # Run app
npm run build       # Build app
npm run lint        # Lint code
```

**NEW Commands:**
```bash
npm run dev:web     # Run web app
npm run dev:ai      # Run AI service
npm run build:web   # Build web app
npm run build:ai    # Build AI service
npm run lint        # Lint all workspaces
```

---

## 🔧 Common Issues

### Issue 1: Module Not Found

**Error:**
```
Module not found: Can't resolve '@/ai/agents/...'
```

**Solution:**
```bash
# Ensure all dependencies are installed
npm install --legacy-peer-deps

# Rebuild
npm run build:web
```

### Issue 2: Import Path Errors

**Error:**
```
Cannot find module '@/server'
```

**Solution:**
Check `apps/web/tsconfig.json` has correct path aliases:
```json
{
  "paths": {
    "@/*": ["./*"],
    "@/ai/*": ["../ai/*"],
    "@/server/*": ["../ai/server/*"]
  }
}
```

### Issue 3: Environment Variables Not Loading

**Error:**
```
MONGODB_URI environment variable is not set
```

**Solution:**
```bash
# Check .env files exist in correct locations
ls -la apps/web/.env
ls -la apps/ai/.env

# Ensure variables are set
cat apps/web/.env | grep MONGODB_URI
```

### Issue 4: Build Fails with TypeScript Errors

**Error:**
```
Type error: Cannot find name 'XXX'
```

**Solution:**
```bash
# Clear TypeScript cache
rm -rf apps/web/*.tsbuildinfo
rm -rf apps/ai/*.tsbuildinfo

# Rebuild
npm run build:web
```

### Issue 5: Scripts Not Found

**Error:**
```
npm error Missing script: "seed-admin"
```

**Solution:**
Use workspace-aware commands:
```bash
# OLD
npm run seed-admin

# NEW (from root)
npm run seed-admin  # This proxies to apps/ai

# OR run directly in workspace
cd apps/ai
npm run seed-admin
```

---

## 🔙 Rollback Instructions

If you need to rollback to the old structure:

### Option 1: Using Git

```bash
# Switch to backup branch
git checkout backup-before-monorepo

# Create a new working branch
git checkout -b rollback-working

# Continue working in old structure
```

### Option 2: Reset to Specific Commit

```bash
# Find commit before monorepo
git log --oneline | grep -B 5 "monorepo"

# Reset to that commit
git reset --hard <commit-hash>

# Force push (careful!)
git push origin develop --force
```

### Option 3: Manual Revert

```bash
# Revert the monorepo commit
git revert <monorepo-commit-hash>

# Resolve conflicts if any
git add -A
git commit
```

---

## ✅ Verification Checklist

After migration, verify:

- [ ] `npm install` completes without errors
- [ ] `npm run dev:web` starts successfully
- [ ] Web app loads at http://localhost:3000
- [ ] Login works
- [ ] AI chat works
- [ ] Database connections work
- [ ] `npm run build:web` completes successfully
- [ ] All tests pass (if you have tests)

---

## 📚 Additional Resources

- [MONOREPO_README.md](./MONOREPO_README.md) - Architecture guide
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment strategies
- [CHANGELOG.md](../CHANGELOG.md) - Detailed changes

---

## 🆘 Getting Help

If you encounter issues:

1. **Check Documentation**
   - Read MONOREPO_README.md
   - Check CHANGELOG.md for breaking changes

2. **Common Fixes**
   ```bash
   # Clear everything and reinstall
   npm run clean-all
   npm install --legacy-peer-deps
   ```

3. **Check Git Status**
   ```bash
   git status
   git log --oneline -10
   ```

4. **Ask for Help**
   - Open an issue on GitHub
   - Contact the development team

---

## 🎯 Next Steps

After successful migration:

1. **Update Your Local Workflow**
   - Bookmark new commands
   - Update any custom scripts

2. **Review Documentation**
   - Read MONOREPO_README.md fully
   - Understand new structure

3. **Test Thoroughly**
   - Test all features you work with
   - Report any issues

4. **Share Feedback**
   - Help improve this guide
   - Suggest improvements

---

**Migration completed successfully! 🎉**

You're now working with the new monorepo structure. Welcome to improved organization and scalability!
