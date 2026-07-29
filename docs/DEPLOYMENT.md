# Deployment Guide

The supported production target is a DigitalOcean droplet running Docker
Compose behind Nginx. MongoDB is hosted by DigitalOcean Managed Databases;
Qdrant runs on the droplet and is bound to localhost.

## Production topology

- Nginx terminates TLS and proxies the public domain to `127.0.0.1:3000`.
- Docker Compose runs the Next.js `web` container and the `qdrant` container.
- The web container connects to DigitalOcean Managed MongoDB and Qdrant over
  the private Compose network.
- Qdrant ports `6333` and `6334` are published on localhost only.
- The governed AI worker is a private process. It must not receive a public
  route; add it to the droplet supervisor/Compose stack before commercial
  rollout.

## Prerequisites

The droplet needs:

- Docker Engine with the Compose plugin
- Git
- Nginx and a valid TLS certificate
- SSH key access
- At least 4 GB RAM; the setup script creates a 2 GB swap file when absent
- Network access to the managed MongoDB cluster and required AI providers

To provision a new droplet with `doctl`, run:

```bash
./scripts/provision-droplet.sh
```

The existing production droplet should be reused unless a reviewed migration
explicitly calls for a replacement.

## First-time setup

Clone the repository to the standard host path:

```bash
git clone <repository-url> /opt/rnd-ai
cd /opt/rnd-ai
./scripts/deploy-droplet.sh --setup
```

The setup command copies `.env.example` to `.env` when needed. Replace every
placeholder before deploying:

```bash
nano /opt/rnd-ai/.env
```

At minimum, configure:

```dotenv
MONGODB_URI=mongodb+srv://...
DATABASE_URL=mongodb+srv://...
RAW_MATERIALS_REAL_STOCK_MONGODB_URI=mongodb+srv://...
GEMINI_API_KEY=...
NEXT_PUBLIC_API_URL=https://<public-domain>/api
NEXT_PUBLIC_TRPC_URL=https://<public-domain>/api/trpc
GOOGLE_SEARCH_API_KEY=...
GOOGLE_SEARCH_CSE_ID=...
```

`DATABASE_URL` and `MONGODB_URI` normally point to the same managed MongoDB
database. Keep provider credentials server-side; never add them to a
`NEXT_PUBLIC_` variable.

## Deploy

Update the reviewed branch, build, and start the stack:

```bash
cd /opt/rnd-ai
git fetch origin
git checkout <reviewed-branch-or-tag>
git pull --ff-only
./scripts/deploy-droplet.sh --up
```

Equivalent Make targets are available when already logged into the droplet:

```bash
make deploy-droplet
make droplet-health
make droplet-logs
```

The deployment script builds locally on the droplet and runs:

```bash
docker compose --env-file .env up -d
```

## Verify

Check container state and the public health route:

```bash
docker compose ps
./scripts/deploy-droplet.sh --health
curl --fail http://127.0.0.1:3000/api/health
curl --fail https://<public-domain>/api/health
```

Expected web response:

```json
{"status":"ok"}
```

Then run the credentialed staged browser story and verify the private worker,
provider calls, approval resume, SSE reconnect, usage reconciliation, and
emergency-disable behavior before promoting any tenant cohort.

## Nginx

The host Nginx site should proxy the public domain to the web container:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

After changing Nginx:

```bash
nginx -t
systemctl reload nginx
```

## Operations

```bash
# Follow all logs
./scripts/deploy-droplet.sh --logs

# Follow one service
./scripts/deploy-droplet.sh --logs web
./scripts/deploy-droplet.sh --logs qdrant

# Restart the stack
./scripts/deploy-droplet.sh --restart

# Stop containers without deleting Qdrant data
./scripts/deploy-droplet.sh --down

# Re-index Qdrant
./scripts/deploy-droplet.sh --index
```

Do not use `docker compose down -v` in production unless Qdrant data deletion
is explicitly approved and a restore path has been verified.

## Rollback

Keep the previous reviewed tag or commit available. To roll back:

```bash
cd /opt/rnd-ai
git checkout <previous-reviewed-tag-or-commit>
./scripts/deploy-droplet.sh --up
./scripts/deploy-droplet.sh --health
```

Application rollback does not automatically roll back MongoDB documents,
indexes, Qdrant collections, or environment variables. Review compatibility
before changing code versions.

## Troubleshooting

### Web container is unhealthy

```bash
docker compose ps
docker compose logs --tail=200 web
curl -v http://127.0.0.1:3000/api/health
```

Confirm `MONGODB_URI`, `DATABASE_URL`, `GEMINI_API_KEY`, and
`NEXT_PUBLIC_API_URL` are set in `.env`.

### Qdrant is unhealthy

```bash
docker compose logs --tail=200 qdrant
curl -v http://127.0.0.1:6333/healthz
docker volume inspect rnd-ai-qdrant-data
```

### Public domain fails but localhost works

```bash
nginx -t
systemctl status nginx
systemctl reload nginx
```

Check DNS, the TLS certificate, the Nginx upstream, and the DigitalOcean
firewall rules for ports 80 and 443.

### Build fails

Run the same image build locally, then inspect the first failing layer:

```bash
docker compose build --no-cache web
```

The production image uses Node 24 and generates the Prisma client during the
build.
