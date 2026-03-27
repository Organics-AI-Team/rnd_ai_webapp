#!/bin/bash
# ============================================================================
# R&D AI Management - DigitalOcean Droplet Provisioning Script
# ============================================================================
# Creates a new DigitalOcean droplet using doctl CLI.
# Prerequisites: doctl installed and authenticated (doctl auth init)
# Usage: ./scripts/provision-droplet.sh
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment variables if needed)
# ---------------------------------------------------------------------------
REGION="${DO_REGION:-sgp1}"
DROPLET_NAME="${DO_DROPLET_NAME:-rnd-ai-prod}"
DROPLET_SIZE="${DO_DROPLET_SIZE:-s-2vcpu-4gb}"
IMAGE="${DO_IMAGE:-docker-20-04}"
FIREWALL_NAME="${DO_FIREWALL_NAME:-rnd-ai-firewall}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "${CYAN}[STEP]${NC}  $1"; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
preflight_check() {
    log_step "Running pre-flight checks..."

    # Check doctl is installed
    if ! command -v doctl &> /dev/null; then
        log_error "doctl CLI is not installed."
        log_error "Install it: https://docs.digitalocean.com/reference/doctl/how-to/install/"
        exit 1
    fi

    # Check doctl is authenticated
    if ! doctl account get &> /dev/null; then
        log_error "doctl is not authenticated. Run: doctl auth init"
        exit 1
    fi

    local account_email
    account_email=$(doctl account get --format Email --no-header)
    log_info "Authenticated as: ${account_email}"
}

# ---------------------------------------------------------------------------
# SSH key selection
# ---------------------------------------------------------------------------
select_ssh_key() {
    log_step "Fetching SSH keys from your DigitalOcean account..."

    local keys_output
    keys_output=$(doctl compute ssh-key list --format ID,Name,FingerPrint --no-header)

    if [ -z "$keys_output" ]; then
        log_error "No SSH keys found in your DigitalOcean account."
        log_error "Add one at: https://cloud.digitalocean.com/account/security"
        exit 1
    fi

    echo ""
    echo "Available SSH keys:"
    echo "-------------------------------------------"
    local index=1
    local key_ids=()
    while IFS= read -r line; do
        local key_id key_name key_fp
        key_id=$(echo "$line" | awk '{print $1}')
        key_name=$(echo "$line" | awk '{print $2}')
        key_fp=$(echo "$line" | awk '{print $3}')
        key_ids+=("$key_id")
        printf "  [%d] %s  (ID: %s, FP: %s)\n" "$index" "$key_name" "$key_id" "$key_fp"
        index=$((index + 1))
    done <<< "$keys_output"
    echo "-------------------------------------------"

    local selection
    while true; do
        read -rp "Select SSH key number [1-${#key_ids[@]}]: " selection
        if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "${#key_ids[@]}" ]; then
            SSH_KEY_ID="${key_ids[$((selection - 1))]}"
            log_info "Selected SSH key ID: ${SSH_KEY_ID}"
            break
        else
            log_warn "Invalid selection. Please enter a number between 1 and ${#key_ids[@]}."
        fi
    done
}

# ---------------------------------------------------------------------------
# Create droplet
# ---------------------------------------------------------------------------
create_droplet() {
    log_step "Creating droplet '${DROPLET_NAME}' in ${REGION}..."
    log_info "  Size:  ${DROPLET_SIZE}"
    log_info "  Image: ${IMAGE}"
    log_info "  SSH Key: ${SSH_KEY_ID}"

    local droplet_output
    droplet_output=$(doctl compute droplet create "$DROPLET_NAME" \
        --region "$REGION" \
        --size "$DROPLET_SIZE" \
        --image "$IMAGE" \
        --ssh-keys "$SSH_KEY_ID" \
        --enable-private-networking \
        --wait \
        --format ID,Name,PublicIPv4,Region,Status \
        --no-header)

    DROPLET_ID=$(echo "$droplet_output" | awk '{print $1}')
    DROPLET_IP=$(echo "$droplet_output" | awk '{print $3}')

    log_info "Droplet created successfully!"
    log_info "  ID: ${DROPLET_ID}"
    log_info "  IP: ${DROPLET_IP}"
}

# ---------------------------------------------------------------------------
# Create firewall
# ---------------------------------------------------------------------------
create_firewall() {
    log_step "Creating firewall '${FIREWALL_NAME}'..."

    # Check if firewall already exists
    local existing_fw
    existing_fw=$(doctl compute firewall list --format ID,Name --no-header | grep "$FIREWALL_NAME" | awk '{print $1}' || true)

    if [ -n "$existing_fw" ]; then
        log_warn "Firewall '${FIREWALL_NAME}' already exists (ID: ${existing_fw}). Updating..."
        doctl compute firewall update "$existing_fw" \
            --name "$FIREWALL_NAME" \
            --droplet-ids "$DROPLET_ID" \
            --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0" \
            --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0 protocol:icmp,address:0.0.0.0/0,address:::/0" \
            > /dev/null
    else
        doctl compute firewall create \
            --name "$FIREWALL_NAME" \
            --droplet-ids "$DROPLET_ID" \
            --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0" \
            --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0 protocol:icmp,address:0.0.0.0/0,address:::/0" \
            > /dev/null
    fi

    log_info "Firewall configured: SSH(22), HTTP(80), HTTPS(443)"
}

# ---------------------------------------------------------------------------
# Print summary
# ---------------------------------------------------------------------------
print_summary() {
    echo ""
    echo "============================================================================"
    echo -e "${GREEN} Droplet Provisioned Successfully${NC}"
    echo "============================================================================"
    echo ""
    echo "  Droplet:   ${DROPLET_NAME}"
    echo "  ID:        ${DROPLET_ID}"
    echo "  IP:        ${DROPLET_IP}"
    echo "  Region:    ${REGION}"
    echo "  Size:      ${DROPLET_SIZE}"
    echo "  Firewall:  ${FIREWALL_NAME} (SSH + HTTP + HTTPS)"
    echo ""
    echo "============================================================================"
    echo "  Next Steps:"
    echo "============================================================================"
    echo ""
    echo "  1. SSH into the droplet:"
    echo "     ssh root@${DROPLET_IP}"
    echo ""
    echo "  2. Clone the repo:"
    echo "     git clone <your-repo-url> /opt/rnd-ai/app"
    echo "     cd /opt/rnd-ai/app"
    echo ""
    echo "  3. Run first-time setup:"
    echo "     ./scripts/deploy-droplet.sh --setup"
    echo ""
    echo "  4. Edit environment variables:"
    echo "     nano .env"
    echo ""
    echo "  5. Deploy the application:"
    echo "     ./scripts/deploy-droplet.sh --up"
    echo ""
    echo "  6. (Optional) Index Qdrant vector data:"
    echo "     ./scripts/deploy-droplet.sh --index"
    echo ""
    echo "============================================================================"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    echo "============================================================================"
    echo "  R&D AI Management - DigitalOcean Droplet Provisioning"
    echo "============================================================================"
    echo ""

    preflight_check
    select_ssh_key
    create_droplet
    create_firewall
    print_summary
}

main "$@"
