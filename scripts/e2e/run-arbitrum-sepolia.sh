#!/usr/bin/env bash
# Copyright (C) 2026 Defa Wang
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

RESULT_FILE="codex/deployments/arbitrum-sepolia-e2e-latest.json"
STAGES_FILE="codex/deployments/arbitrum-sepolia-e2e-stages.json"

source_env() {
  local file="$1"
  if [[ -f "$file" ]]; then
    set -a
    source "$file"
    set +a
  fi
}

source_env "scripts/e2e/.env"
source_env "scripts/operator/.env"
source_env "packages/operator/public-domain-subgraph/.env"
source_env "packages/operator/relay-worker/.env"
source_env "packages/developer/sdk/.env"
source_env "packages/developer/payment-demo-subgraph/.env"

mkdir -p "$(dirname "$STAGES_FILE")"
printf '{"network":"arbitrum-sepolia","startedAt":"%s","stages":[]}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STAGES_FILE"

run_stage() {
  local name="$1"
  shift
  local started
  local finished
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "==> $name"
  if "$@"; then
    finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    node -e '
      const fs = require("fs");
      const file = process.argv[1];
      const result = JSON.parse(fs.readFileSync(file, "utf8"));
      result.stages.push({ name: process.argv[2], status: "passed", startedAt: process.argv[3], finishedAt: process.argv[4] });
      fs.writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
    ' "$STAGES_FILE" "$name" "$started" "$finished"
  else
    local code="$?"
    finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    node -e '
      const fs = require("fs");
      const file = process.argv[1];
      const result = JSON.parse(fs.readFileSync(file, "utf8"));
      result.stages.push({ name: process.argv[2], status: "failed", exitCode: Number(process.argv[5]), startedAt: process.argv[3], finishedAt: process.argv[4] });
      fs.writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
    ' "$STAGES_FILE" "$name" "$started" "$finished" "$code"
    exit "$code"
  fi
}

facility_smoke() {
  [[ -n "${ARBITRUM_SEPOLIA_RPC_URL:-}" ]] || { echo "ARBITRUM_SEPOLIA_RPC_URL is required." >&2; return 1; }
  [[ -n "${RELAY_WORKER_URL:-}" ]] || { echo "RELAY_WORKER_URL is required." >&2; return 1; }
  [[ -n "${SUBGRAPH_QUERY_URL:-}" ]] || { echo "SUBGRAPH_QUERY_URL is required." >&2; return 1; }

  cast block-number --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" >/dev/null
  curl -sS "$RELAY_WORKER_URL/health" >/dev/null
  curl -sS -X POST -H "Content-Type: application/json" \
    --data '{"query":"{ _meta { block { number } } }"}' \
    "$SUBGRAPH_QUERY_URL" >/dev/null
}

run_stage "facility-smoke" facility_smoke
run_stage "public-domain-and-payment-chain" bash scripts/e2e/public-domain-and-payment-arbitrum-sepolia.sh

if [[ -n "${SUBGRAPH_QUERY_URL:-}" ]]; then
  run_stage "public-domain-subgraph" node scripts/e2e/verify-public-domain-subgraph.cjs "$RESULT_FILE"
fi

run_stage "sdk-mutation-lifecycle" pnpm --filter @storail/sdk e2e:arbitrum-sepolia
run_stage "sdk-storage-pinata" pnpm --filter @storail/sdk e2e:pinata:arbitrum-sepolia

if [[ -n "${PAYMENT_DEMO_SUBGRAPH_QUERY_URL:-}" ]]; then
  run_stage "payment-demo-subgraph" pnpm --filter @storail/payment-demo-subgraph test
fi

node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const result = JSON.parse(fs.readFileSync(file, "utf8"));
  result.status = "passed";
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
' "$STAGES_FILE"
