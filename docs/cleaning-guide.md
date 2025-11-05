# 🧹 Project Cleaning Guide

This guide explains the various cleaning options available for the R&D AI Management project.

## 📋 Available Cleaning Commands

### 1. Basic Clean
```bash
npm run clean
```
**What it removes:**
- `.next/` directory (Next.js build cache)

**When to use:**
- Before rebuilding the application
- When Next.js cache issues occur
- Light cleanup between development sessions

### 2. Clean All
```bash
npm run clean-all
```
**What it removes:**
- Build artifacts: `.next/`, `dist/`, `build/`, `out/`
- Cache directories: `.cache/`, `.turbo/`, `.vite/`, `.swc/`, `.parcel-cache/`
- Testing coverage: `coverage/`, `.nyc_output/`, `.pytest_cache/`, `__pycache__/`
- Deployment folders: `.vercel/`, `.netlify/`, `.wrangler/`, `.sst/`, `.output/`
- Node modules: `node_modules/`
- Log files: `*.log`, `npm-debug.log*`, `yarn-debug.log*`, etc.
- **❌ Environment files are PRESERVED**: `.env`, `.env.local`, `.env.*` files are never deleted
- System files: `.DS_Store`, `Thumbs.db`
- TypeScript build info: `*.tsbuildinfo`
- Editor cache: `.eslintcache`
- Package manager cache: `npm cache clean --force`

**When to use:**
- Before major dependency updates
- When experiencing unexplained build issues
- Before switching Node.js versions
- Complete project reset (except lock files)

### 3. Clean Aggressive (Interactive)
```bash
npm run clean-aggressive
```
**What it removes:**
- Everything from `clean-all`
- Additional deployment directories: `.amplify/`
- More temporary directories: `tmp/`, `temp/`
- Editor files: `.idea/`, `*.swp`, `*.swo`, `*~`
- VS Code extensions cache: `.vscode/.extensions-cache`
- Hidden cache files: `.*cache*`
- **❌ Environment files are PRESERVED**: `.env`, `.env.local`, `.env.*` files are never deleted
- **Optionally:** Lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`)
- **Optionally:** Additional package manager caches (yarn, pnpm)

**When to use:**
- Complete project reset to pristine state
- Before major version upgrades
- When transferring project to new environment
- Troubleshooting persistent issues

### 4. Reset Project
```bash
npm run reset
```
**What it does:**
- Runs `clean-all`
- Automatically reinstalls dependencies with `npm install`

**When to use:**
- Quick project reset with fresh dependencies
- After `clean-all` when you want to continue development

## 🎯 Recommended Usage Scenarios

### Daily Development
```bash
npm run clean
npm run dev
```

### Weekly Maintenance
```bash
npm run clean-all
npm install
npm run dev
```

### Major Updates / Troubleshooting
```bash
npm run clean-aggressive
# Follow prompts for options
npm install
npm run dev
```

### Quick Reset
```bash
npm run reset
npm run dev
```

## ⚠️ Important Notes

### Backup Before Cleaning
- Always backup `.env` files before running `clean-all` or `clean-aggressive`
- Save any important local configuration files
- Commit any changes to version control before cleaning

### Environment Files
**All environment files are PRESERVED** and NEVER deleted by any clean command:
- `.env` (main environment file)
- `.env.local` (local development secrets)
- `.env.development.local` (development overrides)
- `.env.test.local` (test overrides)
- `.env.production.local` (production overrides)
- `.env.example` (template file)
- `.env.*` (any other environment files)

**❌ NO environment files are deleted by clean commands**

### After Cleaning
1. Always run `npm install` after removing `node_modules`
2. Your `.env` files are preserved and ready to use
3. Restart development server with `npm run dev`
4. Test the application to ensure everything works

### Development Server
The development server will automatically rebuild the `.next` directory when it detects changes. If you run `npm run clean` while the server is running, it will automatically rebuild.

## 🚀 Automated Cleaning Options

### Git Hook (Optional)
Add to `.git/hooks/pre-commit` for automatic cleaning before commits:
```bash
#!/bin/sh
npm run clean
```

### CI/CD Integration
Use in your CI/CD pipeline for clean builds:
```yaml
- name: Clean and Build
  run: |
    npm run clean-all
    npm install
    npm run build
```

## 📊 What Gets Cleaned

| Category | Files/Directories | Impact |
|----------|-------------------|---------|
| **Build Artifacts** | `.next/`, `dist/`, `build/`, `out/` | Requires rebuild |
| **Cache** | `.cache/`, `.turbo/`, `.vite/`, `.swc/` | Slower first build |
| **Dependencies** | `node_modules/` | Requires reinstall |
| **Environment** | `.env`, `.env.local`, `.env.*` | ❌ **PRESERVED** - No impact |
| **Logs** | `*.log`, `npm-debug.log*` | No impact |
| **System Files** | `.DS_Store`, `Thumbs.db` | No impact |
| **Editor Files** | `.idea/`, `*.swp` | No impact |

## 🔧 Troubleshooting

### Issues After Cleaning
1. **Missing dependencies**: Run `npm install`
2. **Environment errors**: Restore `.env` files
3. **Build failures**: Check Node.js version compatibility
4. **Port conflicts**: Kill existing Node processes

### Manual Cleanup
If scripts fail, manually remove:
```bash
# Remove most common items
rm -rf .next node_modules .cache dist
npm cache clean --force
npm install
```

### Partial Cleaning
You can combine commands for specific needs:
```bash
# Remove only Next.js cache and node modules
rm -rf .next node_modules
npm install

# Remove only cache directories
rm -rf .cache .turbo .vite .swc
```