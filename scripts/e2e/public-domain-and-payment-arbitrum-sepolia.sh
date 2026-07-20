#!/usr/bin/env bash
# Copyright (C) 2026 Defa Wang
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

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

MODULE_NAME="storail-e2e-authorized-event-hub-v1"
DEPLOYMENT_FILE="codex/deployments/arbitrum-sepolia.json"
RESULT_FILE="codex/deployments/arbitrum-sepolia-e2e-latest.json"
AEH="$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(d.authorizedEventHub || d.authorizedEventLog || d.storageRegistry)' "$DEPLOYMENT_FILE")"
PAYMENT_APP="$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(d.paymentDemoApp || "")' "$DEPLOYMENT_FILE")"

if [[ -z "$AEH" || "$AEH" == "undefined" ]]; then
  echo "Missing authorizedEventHub in $DEPLOYMENT_FILE" >&2
  exit 1
fi
if [[ -z "$PAYMENT_APP" || "$PAYMENT_APP" == "undefined" ]]; then
  echo "Missing paymentDemoApp in $DEPLOYMENT_FILE" >&2
  exit 1
fi

OWNER_PRIVATE_KEY="$PRIVATE_KEY"
OWNER="$(cast wallet address --private-key "$OWNER_PRIVATE_KEY")"
WRITER_PRIVATE_KEY="$(cast keccak "storail:e2e:writer:arbitrum-sepolia:v2")"
WRITER="$(cast wallet address --private-key "$WRITER_PRIVATE_KEY")"
RECIPIENT_PRIVATE_KEY="$(cast keccak "storail:e2e:recipient:arbitrum-sepolia:v1")"
RECIPIENT="$(cast wallet address --private-key "$RECIPIENT_PRIVATE_KEY")"

RUN_ID="$(date -u +%Y%m%d%H%M%S)"
DOMAIN="/${OWNER}/apps/${MODULE_NAME}/runs/${RUN_ID}"
OWNER_PATH="${DOMAIN}/owner-record"
WRITER_PATH="${DOMAIN}/writer-record"
SIBLING_PATH="/${OWNER}/apps/${MODULE_NAME}/sibling/${RUN_ID}/writer-record"
INVALID_PATH="/apps/${MODULE_NAME}/invalid"

OWNER_PATH_HASH="$(cast keccak "$OWNER_PATH")"
WRITER_PATH_HASH="$(cast keccak "$WRITER_PATH")"

OWNER_CONTENT_V1="$(cast keccak "${MODULE_NAME}:${RUN_ID}:owner:v1")"
OWNER_CONTENT_V2="$(cast keccak "${MODULE_NAME}:${RUN_ID}:owner:v2")"
WRITER_CONTENT_V1="$(cast keccak "${MODULE_NAME}:${RUN_ID}:writer:v1")"
WRITER_CONTENT_V2="$(cast keccak "${MODULE_NAME}:${RUN_ID}:writer:v2")"
PAYMENT_CONTENT="$(cast keccak "${MODULE_NAME}:${RUN_ID}:payment")"

PUBLISHED_TOPIC="$(cast keccak "Published(bytes32,address,address,string,string,string,bytes32,string)")"
UPDATED_TOPIC="$(cast keccak "Updated(bytes32,address,address,string,string,string,bytes32,string)")"
DELETED_TOPIC="$(cast keccak "Deleted(bytes32,address,address,string)")"
WRITER_GRANTED_TOPIC="$(cast keccak "WriterGranted(address,bytes32,address,string)")"
WRITER_REVOKED_TOPIC="$(cast keccak "WriterRevoked(address,bytes32,address,string)")"

TX_NAMES=()
TX_HASHES=()
TX_BLOCKS=()

main() {
  echo "Module: $MODULE_NAME"
  echo "AuthorizedEventHub: $AEH"
  echo "PaymentDemoApp: $PAYMENT_APP"
  echo "Owner: $OWNER"
  echo "Writer: $WRITER"
  echo "Run: $RUN_ID"

  fund_writer_if_needed

  expect_revert "invalid path publish" cast call "$AEH" \
    "publish(string,string,string,bytes32,string)" "$INVALID_PATH" "synthetic" "synthetic-invalid" "$OWNER_CONTENT_V1" "{}" \
    --from "$OWNER" --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL"

  expect_revert "writer publish before grant" cast call "$AEH" \
    "publish(string,string,string,bytes32,string)" "$WRITER_PATH" "synthetic" "synthetic-writer-before-grant" "$WRITER_CONTENT_V1" "{}" \
    --from "$WRITER" --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL"

  send_and_expect_event "$AEH" "owner_publish" "$PUBLISHED_TOPIC" "$OWNER_PRIVATE_KEY" \
    "publish(string,string,string,bytes32,string)" "$OWNER_PATH" "synthetic" "synthetic-owner-v1" "$OWNER_CONTENT_V1" "{\"module\":\"${MODULE_NAME}\",\"run\":\"${RUN_ID}\",\"actor\":\"owner\",\"version\":1}"

  send_and_expect_event "$AEH" "owner_update" "$UPDATED_TOPIC" "$OWNER_PRIVATE_KEY" \
    "update(string,string,string,bytes32,string)" "$OWNER_PATH" "synthetic" "synthetic-owner-v2" "$OWNER_CONTENT_V2" "{\"module\":\"${MODULE_NAME}\",\"run\":\"${RUN_ID}\",\"actor\":\"owner\",\"version\":2}"

  expect_revert "grant self" cast call "$AEH" \
    "grantWriter(string,address)" "$DOMAIN" "$OWNER" --from "$OWNER" --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL"

  send_and_expect_event "$AEH" "grant_writer" "$WRITER_GRANTED_TOPIC" "$OWNER_PRIVATE_KEY" \
    "grantWriter(string,address)" "$DOMAIN" "$WRITER"

  assert_bool_call "writer granted" true "$AEH" "isWriter(address,string,address)(bool)" "$OWNER" "$DOMAIN" "$WRITER"

  send_and_expect_event "$AEH" "writer_publish" "$PUBLISHED_TOPIC" "$WRITER_PRIVATE_KEY" \
    "publish(string,string,string,bytes32,string)" "$WRITER_PATH" "synthetic" "synthetic-writer-v1" "$WRITER_CONTENT_V1" "{\"module\":\"${MODULE_NAME}\",\"run\":\"${RUN_ID}\",\"actor\":\"writer\",\"version\":1}"

  send_and_expect_event "$AEH" "writer_update" "$UPDATED_TOPIC" "$WRITER_PRIVATE_KEY" \
    "update(string,string,string,bytes32,string)" "$WRITER_PATH" "synthetic" "synthetic-writer-v2" "$WRITER_CONTENT_V2" "{\"module\":\"${MODULE_NAME}\",\"run\":\"${RUN_ID}\",\"actor\":\"writer\",\"version\":2}"

  send_and_expect_event "$AEH" "writer_remove" "$DELETED_TOPIC" "$WRITER_PRIVATE_KEY" \
    "remove(string)" "$WRITER_PATH"

  expect_revert "writer sibling publish rejected" cast call "$AEH" \
    "publish(string,string,string,bytes32,string)" "$SIBLING_PATH" "synthetic" "synthetic-sibling" "$WRITER_CONTENT_V1" "{}" \
    --from "$WRITER" --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL"

  send_and_expect_event "$AEH" "owner_republish_after_writer_remove" "$PUBLISHED_TOPIC" "$OWNER_PRIVATE_KEY" \
    "publish(string,string,string,bytes32,string)" "$WRITER_PATH" "synthetic" "synthetic-owner-after-writer-remove" "$WRITER_CONTENT_V2" "{\"module\":\"${MODULE_NAME}\",\"run\":\"${RUN_ID}\",\"actor\":\"owner\",\"after\":\"writer-remove\"}"

  send_and_expect_event "$AEH" "revoke_writer" "$WRITER_REVOKED_TOPIC" "$OWNER_PRIVATE_KEY" \
    "revokeWriter(string,address)" "$DOMAIN" "$WRITER"

  assert_bool_call "writer revoked" false "$AEH" "isWriter(address,string,address)(bool)" "$OWNER" "$DOMAIN" "$WRITER"

  expect_revert "writer update after revoke" cast call "$AEH" \
    "update(string,string,string,bytes32,string)" "$WRITER_PATH" "synthetic" "synthetic-writer-v3" "$WRITER_CONTENT_V2" "{}" \
    --from "$WRITER" --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL"

  test_payment_demo
  write_result_json "chain_passed"

  echo "E2E result: $RESULT_FILE"
}

test_payment_demo() {
  local before_count
  local after_direct_count
  local after_submit_count
  local before_events
  local after_events
  local action_transfer
  local transfer_payload
  local app_id

  before_count="$(call_uint "$PAYMENT_APP" "instructionCount()(uint256)")"
  before_events="$(call_uint "$PAYMENT_APP" "eventCount()(uint256)")"

  send_and_expect_event "$PAYMENT_APP" "payment_direct_transfer" "$UPDATED_TOPIC" "$OWNER_PRIVATE_KEY" \
    "transfer(address,uint256)" "$RECIPIENT" 11
  after_direct_count="$(call_uint "$PAYMENT_APP" "instructionCount()(uint256)")"
  assert_delta "payment direct instructionCount" "$before_count" "$after_direct_count" 1

  app_id="$(cast keccak "payment-demo-app")"
  action_transfer="$(cast keccak "Transfer")"
  transfer_payload="$(cast abi-encode "transfer(address,uint256)" "$RECIPIENT" 22)"

  send_and_expect_event "$AEH" "payment_submit_to_app_transfer" "$UPDATED_TOPIC" "$OWNER_PRIVATE_KEY" \
    "submitToApp(bytes32,bytes32,bytes)" "$app_id" "$action_transfer" "$transfer_payload"
  after_submit_count="$(call_uint "$PAYMENT_APP" "instructionCount()(uint256)")"
  after_events="$(call_uint "$PAYMENT_APP" "eventCount()(uint256)")"
  assert_delta "payment submitToApp instructionCount" "$after_direct_count" "$after_submit_count" 1
  assert_delta "payment eventCount" "$before_events" "$after_events" 2
}

fund_writer_if_needed() {
  local min_balance
  local balance
  min_balance="$(cast to-wei 0.001 ether)"
  balance="$(cast balance --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" "$WRITER")"

  if node -e 'process.exit(BigInt(process.argv[1]) >= BigInt(process.argv[2]) ? 0 : 1)' "$balance" "$min_balance"; then
    echo "Writer balance is sufficient."
    return
  fi

  echo "Funding deterministic writer with 0.002 ETH."
  local receipt
  receipt="$(cast send "$WRITER" --value 0.002ether --private-key "$OWNER_PRIVATE_KEY" --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" --json)"
  assert_receipt_status "fund_writer" "$receipt"
  record_tx "fund_writer" "$receipt"
}

send_and_expect_event() {
  local target="$1"
  local name="$2"
  local topic="$3"
  local private_key="$4"
  shift 4

  echo "Sending $name"
  local receipt
  receipt="$(cast send "$target" "$@" --private-key "$private_key" --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" --json)"
  assert_receipt_status "$name" "$receipt"
  assert_receipt_has_topic "$name" "$receipt" "$topic"
  record_tx "$name" "$receipt"
}

expect_revert() {
  local name="$1"
  shift
  echo "Expecting revert: $name"
  if "$@" >/tmp/storail-e2e-call.out 2>/tmp/storail-e2e-call.err; then
    echo "Expected revert but call succeeded: $name" >&2
    cat /tmp/storail-e2e-call.out >&2
    exit 1
  fi
}

assert_bool_call() {
  local name="$1"
  local expected="$2"
  shift 2
  local actual
  actual="$(cast call "$@" --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" | tr -d '[:space:]')"
  if [[ "$actual" != "$expected" ]]; then
    echo "Boolean assertion failed for $name: expected $expected got $actual" >&2
    exit 1
  fi
}

assert_delta() {
  local name="$1"
  local before="$2"
  local after="$3"
  local expected="$4"
  node -e '
    const before = BigInt(process.argv[1]);
    const after = BigInt(process.argv[2]);
    const expected = BigInt(process.argv[3]);
    if (after - before !== expected) {
      console.error(`${process.argv[4]} delta: expected ${expected}, got ${after - before}`);
      process.exit(1);
    }
  ' "$before" "$after" "$expected" "$name"
}

call_uint() {
  local target="$1"
  local signature="$2"
  cast call "$target" "$signature" --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" | tr -d '[:space:]'
}

assert_receipt_status() {
  local name="$1"
  local receipt="$2"
  node -e '
    const receipt = JSON.parse(process.argv[1]);
    if (receipt.status !== "0x1" && receipt.status !== "1" && receipt.status !== 1) {
      console.error(`Transaction failed: ${process.argv[2]}`);
      process.exit(1);
    }
  ' "$receipt" "$name"
}

assert_receipt_has_topic() {
  local name="$1"
  local receipt="$2"
  local topic="$3"
  node -e '
    const receipt = JSON.parse(process.argv[1]);
    const topic = process.argv[2].toLowerCase();
    const logs = receipt.logs || [];
    const found = logs.some((log) => Array.isArray(log.topics) && String(log.topics[0]).toLowerCase() === topic);
    if (!found) {
      console.error(`Expected event topic not found for ${process.argv[3]}: ${process.argv[2]}`);
      process.exit(1);
    }
  ' "$receipt" "$topic" "$name"
}

record_tx() {
  local name="$1"
  local receipt="$2"
  local hash
  local block
  hash="$(node -e 'const r=JSON.parse(process.argv[1]); console.log(r.transactionHash || r.hash)' "$receipt")"
  block="$(node -e 'const r=JSON.parse(process.argv[1]); const b=r.blockNumber; console.log(typeof b==="string" && b.startsWith("0x") ? Number.parseInt(b,16) : b)' "$receipt")"
  TX_NAMES+=("$name")
  TX_HASHES+=("$hash")
  TX_BLOCKS+=("$block")
}

write_result_json() {
  node -e '
    const fs = require("fs");
    const [
      file, status, moduleName, aeh, paymentApp, owner, writer, recipient, runId,
      ownerPath, writerPath, ownerPathHash, writerPathHash, ownerContentHash, writerContentHash,
      names, hashes, blocks,
    ] = process.argv.slice(1);
    const split = (value) => value ? value.split(",").filter(Boolean) : [];
    const txNames = split(names);
    const txHashes = split(hashes);
    const txBlocks = split(blocks);
    const transactions = txNames.map((name, index) => ({
      name,
      hash: txHashes[index] || "",
      blockNumber: Number(txBlocks[index] || 0),
    }));
    fs.mkdirSync(require("path").dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      status,
      moduleName,
      authorizedEventHub: aeh,
      paymentDemoApp: paymentApp,
      owner,
      writer,
      recipient,
      runId,
      ownerPath,
      writerPath,
      ownerPathHash,
      writerPathHash,
      ownerContentHash,
      writerContentHash,
      transactions,
      updatedAt: new Date().toISOString(),
    }, null, 2) + "\n");
  ' "$RESULT_FILE" "chain_passed" "$MODULE_NAME" "$AEH" "$PAYMENT_APP" "$OWNER" "$WRITER" "$RECIPIENT" "$RUN_ID" \
    "$OWNER_PATH" "$WRITER_PATH" "$OWNER_PATH_HASH" "$WRITER_PATH_HASH" "$OWNER_CONTENT_V2" "$WRITER_CONTENT_V2" \
    "$(IFS=,; echo "${TX_NAMES[*]}")" "$(IFS=,; echo "${TX_HASHES[*]}")" "$(IFS=,; echo "${TX_BLOCKS[*]}")"
}

main "$@"
