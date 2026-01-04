#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
LOG_FILE="$ROOT_DIR/deploy.log"
: > "$LOG_FILE"

deploy_worker() {
  local dir="$1"
  local cmd="$2"
  echo "Deploying $dir..." | tee -a "$LOG_FILE"
  pushd "$dir" >/dev/null
  if eval "$cmd" >> "$LOG_FILE" 2>&1; then
    echo "[$dir] Deploy succeeded" | tee -a "$LOG_FILE"
  else
    echo "[$dir] Deploy failed" | tee -a "$LOG_FILE"
    popd >/dev/null
    return 1
  fi
  popd >/dev/null
}

check_health() {
  local name="$1"
  local url="$2"
  echo "Checking $name at $url" | tee -a "$LOG_FILE"
  if curl -fsS "$url" >/dev/null; then
    echo "[$name] Health OK" | tee -a "$LOG_FILE"
  else
    echo "[$name] Health check failed" | tee -a "$LOG_FILE"
    return 1
  fi
}

deploy_worker "$ROOT_DIR/gateway-api" "bun run --filter '@gateway/worker' deploy"
deploy_worker "$ROOT_DIR/metacogna-base" "npx wrangler deploy"
deploy_worker "$ROOT_DIR/metacogna-rag" "bun run worker:deploy"
deploy_worker "$ROOT_DIR/parti-architecture" "bun run deploy:prod"

check_health "Gateway" "https://api.metacogna.ai/hq/health"
check_health "Base" "https://hq.metacogna.ai/health"
check_health "RAG" "https://parti.metacogna.ai/api/health"
check_health "Parti" "https://build.metacogna.ai/api/projects"

