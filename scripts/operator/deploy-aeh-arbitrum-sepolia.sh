#!/usr/bin/env bash
# Copyright (C) 2026 Defa Wang
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="scripts/operator/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy scripts/operator/.env.example and fill PRIVATE_KEY and ARBITRUM_SEPOLIA_RPC_URL." >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

PRIVATE_KEY="${PRIVATE_KEY:-}"
PRIVATE_KEY="${PRIVATE_KEY%\"}"
PRIVATE_KEY="${PRIVATE_KEY#\"}"
PRIVATE_KEY="${PRIVATE_KEY%\'}"
PRIVATE_KEY="${PRIVATE_KEY#\'}"

if [[ ! "$PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "PRIVATE_KEY must be 0x followed by 64 hex characters." >&2
  exit 1
fi

if [[ -z "${ARBITRUM_SEPOLIA_RPC_URL:-}" ]]; then
  echo "ARBITRUM_SEPOLIA_RPC_URL is required." >&2
  exit 1
fi

export PRIVATE_KEY
export ARBITRUM_SEPOLIA_RPC_URL
export ARBITRUM_SEPOLIA_CHAIN_ID="${ARBITRUM_SEPOLIA_CHAIN_ID:-421614}"
export ARBISCAN_API_KEY="${ARBISCAN_API_KEY:-}"

pnpm deploy:authorized-hub:arbitrum-sepolia

BROADCAST_FILE="contracts/broadcast/DeployAuthorizedEventHub.s.sol/421614/run-latest.json"

node -e 'const fs=require("fs"); const src=JSON.parse(fs.readFileSync("contracts/out/AuthorizedEventHub.sol/AuthorizedEventHub.json","utf8")); const abi=JSON.stringify(src.abi,null,2)+"\n"; fs.writeFileSync("packages/operator/public-domain-subgraph/abis/AuthorizedEventHub.json",abi); fs.writeFileSync("packages/developer/payment-demo-subgraph/abis/AuthorizedEventHub.json",abi);'
node scripts/operator/sync-subgraph-from-broadcast.cjs "$BROADCAST_FILE"

pnpm --filter @storail/subgraph build
pnpm --filter @storail/payment-demo-subgraph build
