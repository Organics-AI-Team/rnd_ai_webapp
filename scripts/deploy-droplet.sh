#!/bin/bash
# ============================================================================
# R&D AI Management - DigitalOcean Droplet Deployment Script
# ============================================================================
# Usage: ./scripts/deploy-droplet.sh [--build|--up|--down|--logs|--setup|--index]
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_DIR}/.env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Read the last assignment of a variable from the .env file (empty if unset)
env_value() {
    grep -E "^${1}=" "$ENV_FILE" | tail -n 1 | cut -d'=' -f2-
}

# Fail when a variable is unset or still carries a template placeholder
require_env_value() {
    local var="$1"
    local value
    value="$(env_value "$var")"
    if [ -z "$value" ] || [[ "$value" == *"replace-with"* ]] || [[ "$value" == *"username:password"* ]] || [[ "$value" == your-* ]] || [[ "$value" == change* ]]; then
        log_error "Required variable ${var} is not set or still has placeholder value in .env"
        exit 1
    fi
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Install with: curl -fsSL https://get.docker.com | sh"
        exit 1
    fi

    if ! docker compose version &> /dev/null && ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed."
        exit 1
    fi

    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env file not found. Copy .env.example to .env and fill in values:"
        log_error "  cp .env.example .env && nano .env"
        exit 1
    fi

    # Validate required env vars (worker cost accounting fails closed at boot,
    # so its price variables are deployment prerequisites, not options)
    local required_vars=(
        "MONGODB_URI"
        "GEMINI_API_KEY"
        "NEXT_PUBLIC_API_URL"
        "AI_GEMINI_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS"
        "AI_GEMINI_OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS"
    )
    for var in "${required_vars[@]}"; do
        require_env_value "$var"
    done

    # Clerk authentication contract: enabling the cutover without the full
    # key set would deploy a stack where nobody can sign in
    if [ "$(env_value CLERK_CUTOVER)" = "true" ]; then
        local clerk_vars=(
            "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
            "CLERK_SECRET_KEY"
            "CLERK_WEBHOOK_SIGNING_SECRET"
        )
        for var in "${clerk_vars[@]}"; do
            require_env_value "$var"
        done
        check_clerk_instance
    else
        log_warn "CLERK_CUTOVER is not 'true' — deploying with Clerk authentication disabled"
    fi

    # Knowledge upload authorization signs with an HMAC secret and fails
    # closed below 24 characters — catch that before users hit a 500
    local upload_secret
    upload_secret="$(env_value KNOWLEDGE_UPLOAD_AUTH_SECRET)"
    if [ "${#upload_secret}" -lt 24 ]; then
        log_warn "KNOWLEDGE_UPLOAD_AUTH_SECRET is missing or shorter than 24 chars — knowledge uploads will fail closed"
    fi

    log_info "Prerequisites OK"
}

# Verify the Clerk INSTANCE is actually configured for this deployment:
# the secret key must be valid, the organizations feature enabled, and the
# custom org roles present when CLERK_ORG_ROLE_MODE is not built_in. These
# are runtime instance settings that no amount of env validation catches.
check_clerk_instance() {
    log_info "Checking Clerk instance configuration..."
    local secret
    secret="$(env_value CLERK_SECRET_KEY)"

    local orgs_status
    orgs_status="$(curl -s -o /tmp/clerk-orgs-check.json -w "%{http_code}" \
        -H "Authorization: Bearer ${secret}" \
        "https://api.clerk.com/v1/organizations?limit=1")"
    if [ "$orgs_status" != "200" ]; then
        log_error "Clerk instance check failed (HTTP ${orgs_status}). Common causes:"
        log_error "  - invalid CLERK_SECRET_KEY"
        log_error "  - organizations feature disabled on the instance (enable with: clerk enable orgs)"
        grep -o '"code":"[^"]*"' /tmp/clerk-orgs-check.json 2>/dev/null | head -1 || true
        exit 1
    fi

    if [ "$(env_value CLERK_ORG_ROLE_MODE)" != "built_in" ]; then
        local roles
        roles="$(curl -s -H "Authorization: Bearer ${secret}" \
            "https://api.clerk.com/v1/organization_roles?limit=50")"
        for role_key in "org:manager" "org:user"; do
            if ! printf '%s' "$roles" | grep -q "\"key\":\"${role_key}\""; then
                log_error "Custom org role ${role_key} does not exist on the Clerk instance."
                log_error "Create it (POST /organization_roles) or set CLERK_ORG_ROLE_MODE=built_in."
                exit 1
            fi
        done
    fi

    log_info "Clerk instance OK (key valid, organizations enabled, roles consistent)"
}

# Determine docker compose command
get_compose_cmd() {
    if docker compose version &> /dev/null; then
        echo "docker compose"
    else
        echo "docker-compose"
    fi
}

# Setup the droplet (first-time only)
setup_droplet() {
    log_info "Setting up droplet for first deployment..."

    # Create data directories
    mkdir -p /opt/rnd-ai/data/qdrant

    # Create swap if not already present (prevents OOM on small droplets)
    if [ ! -f /swapfile ]; then
        log_info "Creating 2GB swap file..."
        fallocate -l 2G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
        log_info "Swap enabled"
    fi

    # Copy env template if not exists
    if [ ! -f "$ENV_FILE" ]; then
        cp "${PROJECT_DIR}/.env.example" "$ENV_FILE"
        log_warn ".env created from template. Edit it with your real credentials:"
        log_warn "  nano ${ENV_FILE}"
    fi

    # Enable Docker to start on boot
    systemctl enable docker 2>/dev/null || true

    log_info "Setup complete. Edit .env then run: ./scripts/deploy-droplet.sh --up"
}

# Build images
build() {
    check_prerequisites
    local compose_cmd=$(get_compose_cmd)
    log_info "Building Docker images..."

    # Only public values are build-time arguments (Next.js inlines NEXT_PUBLIC_*);
    # provider secrets stay runtime-only.
    $compose_cmd --env-file "$ENV_FILE" build \
        --build-arg NEXT_PUBLIC_API_URL="$(env_value NEXT_PUBLIC_API_URL)" \
        --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$(env_value NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)" \
        --build-arg NEXT_PUBLIC_APP_URL="$(env_value NEXT_PUBLIC_APP_URL)"

    log_info "Build complete"
}

# Start services
up() {
    check_prerequisites
    local compose_cmd=$(get_compose_cmd)
    log_info "Starting services..."

    $compose_cmd --env-file "$ENV_FILE" up -d

    log_info "Services started. Check status with: $compose_cmd ps"
    log_info "Web app: http://$(hostname -I | awk '{print $1}'):3000"
    log_info "Qdrant: http://127.0.0.1:6333 (localhost only)"
}

# Stop services
down() {
    local compose_cmd=$(get_compose_cmd)
    log_info "Stopping services..."
    $compose_cmd down
    log_info "Services stopped"
}

# Show logs
logs() {
    local compose_cmd=$(get_compose_cmd)
    local service="${1:-}"
    if [ -n "$service" ]; then
        $compose_cmd logs -f "$service"
    else
        $compose_cmd logs -f
    fi
}

# Health check
health() {
    log_info "Checking service health..."

    if curl -sf "http://localhost:3000/api/health" > /dev/null 2>&1; then
        log_info "web (port 3000): UP"
    else
        log_warn "web (port 3000): DOWN or unreachable"
    fi

    if curl -sf "http://localhost:6333/healthz" > /dev/null 2>&1; then
        log_info "qdrant (port 6333): UP"
    else
        log_warn "qdrant (port 6333): DOWN or unreachable"
    fi

    # The worker has no HTTP port; its container state is the health signal
    local worker_state
    worker_state="$(docker inspect -f '{{.State.Status}}' rnd-ai-worker 2>/dev/null || echo "absent")"
    if [ "$worker_state" = "running" ]; then
        log_info "worker (rnd-ai-worker): UP"
    else
        log_warn "worker (rnd-ai-worker): ${worker_state} — governed AI runs will queue but never complete"
    fi
}

# Re-index data into Qdrant
index_qdrant() {
    check_prerequisites
    local compose_cmd=$(get_compose_cmd)
    log_info "Re-indexing data into Qdrant..."
    $compose_cmd --env-file "$ENV_FILE" exec web npx tsx apps/ai/scripts/index-qdrant.ts
    log_info "Re-indexing complete"
}

# Main
case "${1:-}" in
    --setup)    setup_droplet ;;
    --build)    build ;;
    --up)       build && up ;;
    --down)     down ;;
    --logs)     logs "${2:-}" ;;
    --health)   health ;;
    --restart)  down && up ;;
    --index)    index_qdrant ;;
    *)
        echo "Usage: $0 [--setup|--build|--up|--down|--logs|--health|--restart|--index]"
        echo ""
        echo "  --setup    First-time droplet setup (directories, swap, env template)"
        echo "  --build    Build Docker images"
        echo "  --up       Build and start all services"
        echo "  --down     Stop all services"
        echo "  --logs     Show logs (optionally: --logs web|qdrant)"
        echo "  --health   Check service health"
        echo "  --restart  Restart all services"
        echo "  --index    Re-index data into Qdrant vector database"
        ;;
esac
