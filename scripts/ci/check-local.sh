#!/usr/bin/env bash
# Copyright (C) 2026 Defa Wang
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "==> TypeScript, subgraph codegen/build, and worker dry-run"
pnpm check
pnpm build

echo "==> Contract tests"
pnpm test

echo "==> SDK unit tests"
pnpm --filter @storail/sdk test

echo "==> Relay worker unit tests"
pnpm --dir packages/operator/relay-worker test

echo "==> Subgraph mapping tests"
pnpm --filter @storail/subgraph test
pnpm --filter @storail/payment-demo-subgraph test

echo "Local CI passed."
