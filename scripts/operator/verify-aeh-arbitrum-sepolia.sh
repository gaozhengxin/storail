#!/usr/bin/env bash
# Copyright (C) 2026 Defa Wang
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="scripts/operator/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE." >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${ARBISCAN_API_KEY:-}" ]]; then
  echo "ARBISCAN_API_KEY is required." >&2
  exit 1
fi

DEPLOYMENT_FILE="codex/deployments/arbitrum-sepolia.json"
AEH="$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(d.authorizedEventHub || d.authorizedEventLog)' "$DEPLOYMENT_FILE")"
FORWARDER="$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).erc2771Forwarder)' "$DEPLOYMENT_FILE")"

forge verify-contract \
  --root contracts \
  --chain-id 421614 \
  --watch \
  --etherscan-api-key "$ARBISCAN_API_KEY" \
  --constructor-args "$(cast abi-encode 'constructor(address)' "$FORWARDER")" \
  "$AEH" \
  src/AuthorizedEventHub.sol:AuthorizedEventHub
