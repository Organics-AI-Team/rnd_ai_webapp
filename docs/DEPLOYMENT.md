# Production deployment: DigitalOcean Droplet

Production is served only from the `rnd-ai-prod` DigitalOcean Droplet using
Docker Compose. Do not deploy this application to Vercel or Railway.

## Release procedure

1. Verify the revision locally:

   ```bash
   npm run build:ai
   npm run build:web
   ```

2. Commit and push the verified revision to the branch used by the server.

3. Connect to the Droplet and move its checkout to that exact revision:

   ```bash
   ssh root@178.128.27.61
   cd /opt/rnd-ai/app
   git fetch origin
   git checkout <verified-commit-or-branch>
   ```

4. Keep the existing production `.env` on the server. Never copy it into the
   repository. Build and restart the application:

   ```bash
   ./scripts/deploy-droplet.sh --up
   ```

5. Confirm the containers and application are healthy:

   ```bash
   docker compose ps
   ./scripts/deploy-droplet.sh --health
   docker compose logs --tail=100 web
   ```

## First-time server setup

The Droplet provisioning script creates a Docker-capable server with the
`rnd-ai-prod` name. Once it is reachable, clone the repository to
`/opt/rnd-ai/app`, create its production `.env` from `.env.production`, and run:

```bash
cd /opt/rnd-ai/app
./scripts/deploy-droplet.sh --up
```

The compose stack starts two internal services:

- `rnd-ai-web` on port 3000
- `rnd-ai-qdrant` on localhost ports 6333 and 6334

The public reverse proxy must forward `rndai.erporganics.com` to the web
container. Keep the domain’s DNS proxied through Cloudflare only after the
origin has been verified.

## Rollback

Roll back by checking out the previous known-good Git revision and rebuilding:

```bash
cd /opt/rnd-ai/app
git checkout <previous-verified-commit>
./scripts/deploy-droplet.sh --up
```

Do not remove the Qdrant volume during an application rollback. It contains the
production vector index.

## Required production settings

Set server-side credentials in `/opt/rnd-ai/app/.env` on the Droplet. At a
minimum, configure MongoDB, Gemini, Clerk, Qdrant, and the public application
URL. Do not set browser-visible API keys unless a feature explicitly requires
them; the unified AI chat uses the server-side API route.
