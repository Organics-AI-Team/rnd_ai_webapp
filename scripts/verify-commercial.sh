#!/usr/bin/env bash
set -euo pipefail

trap 'docker compose -f docker-compose.test.yml down -v' EXIT

if [[ "${COMMERCIAL_TEST_ADAPTER_MODE:-}" != "credential_free" ]]; then
  echo "COMMERCIAL_TEST_ADAPTER_MODE must be set to credential_free." >&2
  exit 64
fi

# Commercial verification is intentionally isolated from paid providers and
# production data. The adapter mode must supply deterministic local doubles.
unset CLERK_SECRET_KEY GEMINI_API_KEY OPENAI_API_KEY QDRANT_API_KEY ANTHROPIC_API_KEY
export NODE_ENV=test
export DATABASE_URL="mongodb://127.0.0.1:27018/rnd_ai_commercial_test?replicaSet=rs0&directConnection=true"
export MONGODB_URI="${DATABASE_URL}"
export QDRANT_URL="http://127.0.0.1:6335"

docker compose -f docker-compose.test.yml up -d --wait
npm ci
if [[ "$(uname -s)" == "Linux" ]]; then
  npx playwright install --with-deps chromium
else
  npx playwright install chromium
fi
npx prisma validate
npx prisma generate
npm run build:worker
npm run typecheck
npm run lint
npm test
npm run test:resilience
npm run test:load
npm run security:scan
npm run eval:legacy -- --artifact=legacy-frozen
npm run eval:ooda -- --artifact=ooda-current
npm run eval:compare -- --baseline=legacy-frozen --candidate=ooda-current
npm run test:e2e
npm run build:web
docker build --progress=plain -f Dockerfile -t rnd-ai-commercial-verify:local .
