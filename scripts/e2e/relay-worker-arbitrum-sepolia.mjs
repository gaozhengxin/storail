// Copyright (C) 2026 Defa Wang

import fs from "node:fs";
import { createPublicClient, encodeFunctionData, getAddress, http, keccak256, parseAbi, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const env = loadEnvFiles([
  "scripts/e2e/.env",
  "packages/operator/relay-worker/.env",
  "packages/operator/public-domain-subgraph/.env",
]);
const workerUrl = requiredEnv(env, "RELAY_WORKER_URL");
const rpcUrl = requiredEnv(env, "ARBITRUM_SEPOLIA_RPC_URL");
const eventLog = getAddress(requiredEnv(env, "AEL_ADDRESS", "0xe335D14f1b4cc5458014362589579a51E21d56A9"));
const forwarder = getAddress(requiredEnv(env, "FORWARDER_ADDRESS", "0x71761d73cA0ca8310943977663fFd251e4023b8a"));

const USER_PRIVATE_KEY = derivePrivateKey("storail:relay-e2e:user:v1");
const user = privateKeyToAccount(USER_PRIVATE_KEY);
const runId = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const path = `/${user.address}/apps/storail-relay-e2e/runs/${runId}/owner-record`;
const pointer = `bafy-relay-${runId}`;
const metadata = JSON.stringify({ module: "relay-worker", runId, actor: "owner" });
const contentHash = keccakHex(`storail:relay:${runId}:content`);

const AEL_ABI = parseAbi([
  "function publish(string path,string providerId,string pointer,bytes32 contentHash,string metadata)",
  "function getRecord(string path) view returns ((address owner,string providerId,string pointer,bytes32 contentHash,string metadata,bool exists))",
]);
const FORWARDER_ABI = parseAbi([
  "function nonces(address owner) view returns (uint256)",
]);

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(rpcUrl),
});

const nonce = await publicClient.readContract({
  address: forwarder,
  abi: FORWARDER_ABI,
  functionName: "nonces",
  args: [user.address],
});

const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
const data = encodeFunctionData({
  abi: AEL_ABI,
  functionName: "publish",
  args: [path, "storacha", pointer, contentHash, metadata],
});

const signature = await user.signTypedData({
  domain: {
    name: "Storail Forwarder",
    version: "1",
    chainId: 421614,
    verifyingContract: forwarder,
  },
  types: {
    ForwardRequest: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ],
  },
  primaryType: "ForwardRequest",
  message: {
    from: user.address,
    to: eventLog,
    value: 0n,
    gas: 500_000n,
    nonce,
    deadline: Number(deadline),
    data,
  },
});

const relayResponse = await fetch(`${workerUrl}/v1/relay`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    request: {
      from: user.address,
      to: eventLog,
      value: "0",
      gas: "500000",
      deadline: deadline.toString(),
      data,
    },
    signature,
  }),
});

const relayPayload = await relayResponse.json();
if (!relayResponse.ok) {
  throw new Error(`Relay request failed: ${JSON.stringify(relayPayload)}`);
}

const { requestId, transactionHash } = relayPayload;
let finalStatus = relayPayload.status;
for (let i = 0; i < 24; i++) {
  if (finalStatus === "confirmed" || finalStatus === "reverted" || finalStatus === "failed" || finalStatus === "stalled") {
    break;
  }
  await sleep(5000);
  const statusResponse = await fetch(`${workerUrl}/v1/relay/${requestId}`);
  const statusPayload = await statusResponse.json();
  if (!statusResponse.ok) {
    throw new Error(`Relay status failed: ${JSON.stringify(statusPayload)}`);
  }
  finalStatus = statusPayload.status;
}

if (finalStatus !== "confirmed") {
  throw new Error(`Relay request did not confirm: ${finalStatus}`);
}

const record = await publicClient.readContract({
  address: eventLog,
  abi: AEL_ABI,
  functionName: "getRecord",
  args: [path],
});

if (getAddress(record.owner) !== user.address) {
  throw new Error(`Unexpected record owner: ${record.owner}`);
}
if (record.pointer !== pointer) {
  throw new Error(`Unexpected pointer: ${record.pointer}`);
}
if (record.contentHash.toLowerCase() !== contentHash.toLowerCase()) {
  throw new Error(`Unexpected content hash: ${record.contentHash}`);
}
if (!record.exists) {
  throw new Error("Record was not created");
}

console.log(
  JSON.stringify(
    {
      workerUrl,
      requestId,
      transactionHash,
      user: user.address,
      path,
      pointer,
      contentHash,
      status: finalStatus,
    },
    null,
    2,
  ),
);

function loadEnvFiles(paths) {
  return paths.reduce((env, path) => ({ ...env, ...loadEnv(path) }), {});
}

function loadEnv(path) {
  if (!fs.existsSync(path)) {
    return {};
  }
  const raw = fs.readFileSync(path, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }
  return env;
}

function requiredEnv(env, key, fallback) {
  return env[key] ?? fallback ?? (() => {
    throw new Error(`${key} is required`);
  })();
}

function derivePrivateKey(seed) {
  return keccakHex(seed);
}

function keccakHex(input) {
  return keccak256(stringToHex(input));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
