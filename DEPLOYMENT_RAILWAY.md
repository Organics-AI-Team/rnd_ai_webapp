# Railway Deployment Guide - RND AI Management

## 🚨 Critical Issue: AI Chat Shows "Disconnect" in Staging

### Root Cause
The AI chat shows "disconnect" when **required environment variables are missing** in Railway. The chat service initialization fails silently when `NEXT_PUBLIC_GEMINI_API_KEY` is not set.

---

## ✅ Required Environment Variables for Railway

Set these in **Railway Dashboard → Project → Variables**:

### 1. **Database (REQUIRED)**
```bash
MONGODB_URI=mongodb+srv://username:password@host/database?retryWrites=true&w=majority
```
- Get from MongoDB Atlas
- **CRITICAL**: Without this, the entire app won't work

### 2. **AI Chat - Client Side (REQUIRED for chat to work)**
```bash
NEXT_PUBLIC_GEMINI_API_KEY=your-gemini-api-key-here
```
- **CRITICAL**: This MUST have `NEXT_PUBLIC_` prefix for client-side access
- Get from: https://makersuite.google.com/app/apikey
- **This is why chat shows "disconnect" if missing!**

### 3. **AI Chat - Server Side (REQUIRED)**
```bash
GEMINI_API_KEY=your-gemini-api-key-here
```
- Same key as above, but without `NEXT_PUBLIC_` prefix
- Used for server-side AI operations

### 4. **Vector Database (REQUIRED for RAG)**
```bash
PINECONE_API_KEY=your-pinecone-api-key-here
```
- Get from: https://www.pinecone.io/
- Without this, RAG search won't work (but chat will still function)
- Index names are hardcoded in code (no need to set in env):
  - `002-rnd-ai` for Raw Materials All AI
  - `raw-materials-stock` for Stock Materials AI
  - `sales-rnd-ai` for Sales RND AI

### 5. **Optional but Recommended**
```bash
# For admin account
ADMIN_EMAIL=admin@admin.com
ADMIN_PASSWORD=admin

# If you need OpenAI (currently using Gemini)
OPENAI_API_KEY=your-openai-api-key
NEXT_PUBLIC_OPENAI_API_KEY=your-openai-api-key
```

---

## 🔍 How to Diagnose "Disconnect" Issue

### Check Browser Console (F12)
Look for these logs:
```javascript
// ❌ BAD - Service initialization failed
🔧 Initializing service: {hasApiKey: false, provider: 'gemini'}
❌ Failed to create service: API key is required

// ✅ GOOD - Service initialized successfully
🔧 Initializing service: {hasApiKey: true, provider: 'gemini'}
✅ Service created successfully
```

### Check Environment Variable in Railway
1. Go to Railway Dashboard
2. Click your project
3. Go to "Variables" tab
4. **VERIFY** `NEXT_PUBLIC_GEMINI_API_KEY` is set
5. **VERIFY** value is NOT empty

### Check Build Logs
Look for warnings about missing env vars:
```
Warning: NEXT_PUBLIC_GEMINI_API_KEY is not set
```

---

## 🚀 Deployment Steps

### Step 1: Set Environment Variables
In Railway Dashboard:
1. Go to **Variables** tab
2. Click **+ New Variable**
3. Add all REQUIRED variables above
4. Click **Deploy** (Railway will auto-redeploy)

### Step 2: Verify Build
Check build logs for:
- ✅ `Successfully compiled`
- ✅ No warnings about missing env vars
- ✅ Build completes without errors

### Step 3: Test AI Chat
1. Open staging URL
2. Navigate to any AI chat page
3. Check status indicator in top-right:
   - ✅ Green dot = "Connected" → Working!
   - ❌ Red dot = "Disconnected" → Check env vars!
4. Try sending a message
5. Should receive response

---

## 🐛 Troubleshooting

### Problem: Chat shows "Disconnect"
**Root Cause**: `NEXT_PUBLIC_GEMINI_API_KEY` not set in Railway

**Solution**:
1. Go to Railway → Variables
2. Add: `NEXT_PUBLIC_GEMINI_API_KEY`
3. Value: Your Gemini API key
4. Save and redeploy

### Problem: Chat works but no RAG results
**Root Cause**: `PINECONE_API_KEY` not set

**Solution**:
1. Add `PINECONE_API_KEY` in Railway
2. Ensure Pinecone indexes exist:
   - Run `npm run create-sales-index` locally (if not already created)
   - Indexes should be: `002-rnd-ai`, `raw-materials-stock`, `sales-rnd-ai`

### Problem: "API key is required" error in console
**Root Cause**: Missing or incorrect API key

**Solution**:
1. Check spelling: Must be **exactly** `NEXT_PUBLIC_GEMINI_API_KEY`
2. Check value: Should start with `AIza...`
3. Redeploy after setting

### Problem: Build fails
**Root Cause**: Missing required env vars during build

**Solution**:
All env vars listed in Dockerfile must be set:
- MONGODB_URI
- GEMINI_API_KEY
- NEXT_PUBLIC_GEMINI_API_KEY
- PINECONE_API_KEY

---

## 📋 Deployment Checklist

Before deploying to staging/production:

- [ ] **MongoDB**: Set `MONGODB_URI`
- [ ] **Gemini API (Client)**: Set `NEXT_PUBLIC_GEMINI_API_KEY`
- [ ] **Gemini API (Server)**: Set `GEMINI_API_KEY`
- [ ] **Pinecone**: Set `PINECONE_API_KEY`
- [ ] **Build**: Verify build completes successfully
- [ ] **Test**: Open staging URL and verify:
  - [ ] App loads without errors
  - [ ] Can log in
  - [ ] Chat shows "Connected" status
  - [ ] Can send messages and receive responses
  - [ ] RAG search returns results (optional)

---

## 🔐 Security Notes

### API Keys
- **NEVER** commit API keys to Git
- **ALWAYS** use Railway's environment variables
- Each environment (staging/prod) should have separate keys

### NEXT_PUBLIC_ Prefix
- Variables with `NEXT_PUBLIC_` are **exposed to browser**
- Only use for keys that are safe for client-side
- Gemini API key is safe for client-side with proper API restrictions

---

## 🎯 Quick Fix for Current Issue

If AI chat is showing "disconnect" in staging **right now**:

1. **Go to Railway Dashboard**
2. **Click your project**
3. **Go to Variables tab**
4. **Click + New Variable**
5. **Add**:
   ```
   Name: NEXT_PUBLIC_GEMINI_API_KEY
   Value: [Your Gemini API Key]
   ```
6. **Click "Add"**
7. **Railway will auto-redeploy** (wait 2-3 minutes)
8. **Refresh staging URL**
9. **✅ Chat should now show "Connected"**

---

## 📞 Need Help?

If chat still shows "disconnect" after setting env vars:

1. Check browser console (F12) for errors
2. Check Railway build logs for warnings
3. Verify API key is valid:
   - Test it at: https://makersuite.google.com/app/apikey
   - Make sure it's not expired or restricted
4. Clear browser cache and hard refresh (Cmd+Shift+R)

---

## 📝 Index Configuration (No Env Vars Needed!)

Index names are hardcoded in `ai/config/rag-config.ts`:

```typescript
rawMaterialsAllAI → '002-rnd-ai'
rawMaterialsAI → 'raw-materials-stock'
salesRndAI → 'sales-rnd-ai'
```

You **DO NOT** need to set `PINECONE_INDEX` or `PINECONE_ENVIRONMENT` in Railway!
Only `PINECONE_API_KEY` is needed.
