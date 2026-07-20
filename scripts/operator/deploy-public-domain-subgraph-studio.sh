#!/usr/bin/env bash
# Copyright (C) 2026 Defa Wang
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="packages/operator/public-domain-subgraph/.env"
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

if [[ -z "${SUBGRAPH_SLUG:-}" ]]; then
  echo "SUBGRAPH_SLUG is required." >&2
  exit 1
fi

pnpm --filter @storail/subgraph codegen
pnpm --filter @storail/subgraph build
VERSION_LABEL="${SUBGRAPH_VERSION_LABEL:-v0.0.3}"
GRAPH_IPFS_URL="${GRAPH_IPFS_URL:-https://ipfs.thegraph.com/api/v0}"

pnpm --dir packages/operator/public-domain-subgraph exec graph deploy "$SUBGRAPH_SLUG" subgraph.yaml \
  --deploy-key "$GRAPH_DEPLOY_KEY" \
  --ipfs "$GRAPH_IPFS_URL" \
  --version-label "$VERSION_LABEL"

if [[ -n "${SUBGRAPH_ACCOUNT_ID:-}" ]]; then
  QUERY_URL="https://api.studio.thegraph.com/query/${SUBGRAPH_ACCOUNT_ID}/${SUBGRAPH_SLUG}/version/latest"
  if grep -q '^SUBGRAPH_QUERY_URL=' "$ENV_FILE"; then
    perl -0pi -e "s#SUBGRAPH_QUERY_URL=.*#SUBGRAPH_QUERY_URL=${QUERY_URL}#" "$ENV_FILE"
  else
    printf '\nSUBGRAPH_QUERY_URL=%s\n' "$QUERY_URL" >> "$ENV_FILE"
  fi
  echo "SUBGRAPH_QUERY_URL=$QUERY_URL"
fi
