#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT=${1:-production}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$ROOT_DIR/packages/gateway-worker"
WRANGLER_TOML="$WORKER_DIR/wrangler.toml"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
  printf "${BLUE}[%s]${NC} %s\n" "$1" "$2"
}

error() {
  printf "${RED}Error:${NC} %s\n" "$1" >&2
}

extract_var() {
  local key="$1"
  perl -ne "if(/^\s*$key\s*=\s*\"(.*)\"/){print \$1; exit}" "$WRANGLER_TOML"
}

validate_service() {
  local name="$1"
  local url="$2"

  log "$name" "Validating $url"
  if curl -sSf --max-time 10 "$url" >/dev/null; then
    printf "${GREEN}✔${NC} %s reachable\n" "$name"
  else
    error "$name is unreachable at $url"
    exit 1
  fi
}

log "Gateway" "Deploying gateway worker ($ENVIRONMENT)"

if ! command -v wrangler >/dev/null 2>&1; then
  error "wrangler CLI not found. Install with npm install -g wrangler"
  exit 1
fi

if ! wrangler whoami >/dev/null 2>&1; then
  error "Not authenticated with Cloudflare. Run wrangler login first."
  exit 1
fi

BUILD_URL="$(extract_var BUILD_SERVICE_URL)"
KV_URL="$(extract_var KV_SERVICE_URL)"
CORE_URL="$(extract_var CORE_SERVICE_URL)"

if [[ -z "$BUILD_URL" || -z "$KV_URL" || -z "$CORE_URL" ]]; then
  error "Missing service URL(s) in wrangler.toml"
  exit 1
fi

validate_service "Build Service" "$BUILD_URL"
validate_service "KV Service" "$KV_URL"
validate_service "Core Service" "$CORE_URL"

log "Gateway" "All child services reachable. Deploying…"
pushd "$WORKER_DIR" >/dev/null
if [[ "$ENVIRONMENT" == "staging" ]];then
  wrangler deploy --env staging
else
  wrangler deploy
fi
popd >/dev/null

log "Gateway" "${GREEN}Deployment complete${NC}"
