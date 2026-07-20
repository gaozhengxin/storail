#!/usr/bin/env bash
# Copyright (C) 2026 Defa Wang
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="packages/developer/payment-demo-subgraph/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE." >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${GRAPH_DEPLOY_KEY:-}" ]]; then
  echo "GRAPH_DEPLOY_KEY is required." >&2
  exit 1
fi

if [[ -z "${SUBGRAPH_SLUG_APP_DEMO_PAYMENT:-}" ]]; then
  echo "SUBGRAPH_SLUG_APP_DEMO_PAYMENT is required." >&2
  exit 1
fi

pnpm --filter @storail/payment-demo-subgraph codegen
pnpm --filter @storail/payment-demo-subgraph build
VERSION_LABEL="${SUBGRAPH_VERSION_LABEL:-v0.0.1}"
GRAPH_IPFS_URL="${GRAPH_IPFS_URL:-https://ipfs.thegraph.com/api/v0}"

pnpm --dir packages/developer/payment-demo-subgraph exec graph deploy "$SUBGRAPH_SLUG_APP_DEMO_PAYMENT" subgraph.yaml \
  --deploy-key "$GRAPH_DEPLOY_KEY" \
  --ipfs "$GRAPH_IPFS_URL" \
  --version-label "$VERSION_LABEL"

if [[ -n "${SUBGRAPH_ACCOUNT_ID:-}" ]]; then
  QUERY_URL="https://api.studio.thegraph.com/query/${SUBGRAPH_ACCOUNT_ID}/${SUBGRAPH_SLUG_APP_DEMO_PAYMENT}/version/latest"
  if grep -q '^PAYMENT_DEMO_SUBGRAPH_QUERY_URL=' "$ENV_FILE"; then
    perl -0pi -e "s#PAYMENT_DEMO_SUBGRAPH_QUERY_URL=.*#PAYMENT_DEMO_SUBGRAPH_QUERY_URL=${QUERY_URL}#" "$ENV_FILE"
  else
    printf '\nPAYMENT_DEMO_SUBGRAPH_QUERY_URL=%s\n' "$QUERY_URL" >> "$ENV_FILE"
  fi
  echo "PAYMENT_DEMO_SUBGRAPH_QUERY_URL=$QUERY_URL"
fi
