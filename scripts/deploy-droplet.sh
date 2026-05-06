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

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Install with: curl -fsSL https://get.docker.com | sh"
        exit 1
    fi

    if ! command -v docker compose &> /dev/null && ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed."
        exit 1
    fi

    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env file not found. Copy .env.production to .env and fill in values:"
        log_error "  cp .env.production .env && nano .env"
        exit 1
    fi

    # Validate required env vars
    local required_vars=("MONGODB_URI" "GEMINI_API_KEY" "ADMIN_EMAIL" "ADMIN_PASSWORD")
    for var in "${required_vars[@]}"; do
        if ! grep -q "^${var}=" "$ENV_FILE" || grep -q "^${var}=your-" "$ENV_FILE" || grep -q "^${var}=change" "$ENV_FILE"; then
            log_error "Required variable ${var} is not set or still has placeholder value in .env"
            exit 1
        fi
    done

    log_info "Prerequisites OK"
}

# Determine docker compose command
get_compose_cmd() {
    if command -v docker compose &> /dev/null; then
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
        cp "${PROJECT_DIR}/.env.production" "$ENV_FILE"
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

    # Pass only NEXT_PUBLIC_* vars as build args (no server secrets)
    $compose_cmd --env-file "$ENV_FILE" build \
        --build-arg NEXT_PUBLIC_GEMINI_API_KEY="$(grep '^NEXT_PUBLIC_GEMINI_API_KEY=' "$ENV_FILE" | cut -d'=' -f2-)" \
        --build-arg NEXT_PUBLIC_OPENAI_API_KEY="$(grep '^NEXT_PUBLIC_OPENAI_API_KEY=' "$ENV_FILE" | cut -d'=' -f2-)" \
        --build-arg NEXT_PUBLIC_API_URL="$(grep '^NEXT_PUBLIC_API_URL=' "$ENV_FILE" | cut -d'=' -f2-)"

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

    local services=("web:3000" "qdrant:6333")
    for svc in "${services[@]}"; do
        local name="${svc%%:*}"
        local port="${svc##*:}"
        if curl -sf "http://localhost:${port}/" > /dev/null 2>&1; then
            log_info "${name} (port ${port}): UP"
        else
            log_warn "${name} (port ${port}): DOWN or unreachable"
        fi
    done
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
        echo "  --logs     Show logs (optionally: --logs web|ai|qdrant)"
        echo "  --health   Check service health"
        echo "  --restart  Restart all services"
        echo "  --index    Re-index data into Qdrant vector database"
        ;;
esac
