# ChromaDB Service for Railway

This directory contains the ChromaDB standalone service configuration for Railway deployment.

## 🚀 Deployment Instructions

### 1. Create New Railway Service

1. Go to your Railway project
2. Click **"+ New"** → **"Empty Service"**
3. Connect to this **same GitHub repository**
4. Set **Root Directory** to: `chromadb-service`
5. Railway will automatically detect the Dockerfile

### 2. Configure Persistent Volume

**IMPORTANT**: ChromaDB needs persistent storage to keep your vector data.

1. In your ChromaDB service settings, go to **"Volumes"**
2. Click **"+ New Volume"**
3. Set **Mount Path** to: `/chroma/data`
4. Click **"Add"**

### 3. Configure Service Settings

**Environment Variables** (optional):
- `CHROMA_SERVER_HOST` = `0.0.0.0` (already set in Dockerfile)
- `CHROMA_SERVER_HTTP_PORT` = `8000` (already set in Dockerfile)
- `IS_PERSISTENT` = `TRUE` (already set in Dockerfile)

**Networking**:
- Railway will automatically assign a public URL
- Make it **private** if you only access from your Next.js service
- Copy the internal URL (e.g., `chromadb-service.railway.internal:8000`)

### 4. Update Next.js Service

Add environment variable to your Next.js Railway service:

```
CHROMA_URL=http://chromadb-service.railway.internal:8000
```

Or use the public URL:
```
CHROMA_URL=https://chromadb-xxxxx.up.railway.app
```

### 5. Initial Data Indexing

**Option A: From Local (Recommended)**

Run the indexing script from your local machine:

```bash
# Set environment variables
export CHROMA_URL=https://your-chromadb-service.up.railway.app
export MONGODB_URI=your-mongodb-connection-string
export GEMINI_API_KEY=your-gemini-api-key

# Run indexing script
npm run index:chromadb
```

**Option B: From Next.js Service**

Create a one-time job in Railway:
1. Deploy Next.js service
2. Run indexing script as a one-time command
3. Verify data in ChromaDB

## 📊 Architecture

```
┌─────────────────────┐
│   Next.js App       │
│   (Main Service)    │
│                     │
│  Connects to:       │
│  CHROMA_URL ────────┼──┐
└─────────────────────┘  │
                         │
                         ▼
              ┌──────────────────────┐
              │  ChromaDB Service    │
              │  (Separate Service)  │
              │                      │
              │  Port: 8000          │
              │  Volume: /chroma/data│
              │                      │
              │  Contains:           │
              │  - 31,179 vectors    │
              │  - Persistent data   │
              └──────────────────────┘
```

## ✅ Verification

Test ChromaDB is running:

```bash
curl https://your-chromadb-service.up.railway.app/api/v1/heartbeat
```

Should return:
```json
{"nanosecond heartbeat": 123456789}
```

## 🔧 Maintenance

### Reindexing Data

Only needed when:
- Adding new materials to MongoDB
- Updating embedding model
- Changing vector schema

Run the indexing script again (see step 5 above).

### Checking Collection Stats

```bash
# Connect to your ChromaDB service
curl https://your-chromadb-service.up.railway.app/api/v1/collections
```

### Backup

Railway volumes are automatically backed up. You can also:
1. Export vectors via API
2. Store in MongoDB as backup
3. Keep indexing scripts in git

## 💡 Benefits

- ✅ Fast Next.js deployments (no indexing wait)
- ✅ Data persists across deployments
- ✅ Independent scaling
- ✅ Clean separation of concerns
- ✅ Automatic backups via Railway volumes

## 🐛 Troubleshooting

**ChromaDB not accessible:**
- Check volume is mounted at `/chroma/data`
- Verify port 8000 is exposed
- Check Railway logs for errors

**Next.js can't connect:**
- Verify `CHROMA_URL` environment variable
- Check both services are in same Railway project
- Try internal URL (`.railway.internal`) for better performance

**Data lost after deployment:**
- Ensure persistent volume is configured
- Check volume mount path is `/chroma/data`
- Verify `IS_PERSISTENT=TRUE` environment variable
