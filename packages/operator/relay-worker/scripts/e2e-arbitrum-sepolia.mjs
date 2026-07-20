// Copyright (C) 2026 Defa Wang

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const rootEnv = loadEnvFiles([
  new URL("../.env", import.meta.url),
  new URL("../../../../scripts/e2e/.env", import.meta.url),
]);
const deployment = JSON.parse(fs.readFileSync(new URL("../../../../codex/deployments/arbitrum-sepolia.json", import.meta.url), "utf8"));
const workerUrl = process.env.RELAY_WORKER_URL ?? "https://storail-relay-worker.zhengxingao.workers.dev";
const rpcUrl = requiredEnv(rootEnv, "ARBITRUM_SEPOLIA_RPC_URL");
const aeh = getAddress(rootEnv.AEH_ADDRESS ?? deployment.authorizedEventHub);
const forwarder = getAddress(rootEnv.FORWARDER_ADDRESS ?? deployment.erc2771Forwarder);
const recipient = getAddress("0xbfa3C486522181905b7B38fdeB14cb6D0e20E8Ff");

const USER_PRIVATE_KEY = keccakHex("storail:relay-e2e:user:v2");
const user = privateKeyToAccount(USER_PRIVATE_KEY);
const runId = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const path = `/${user.address}/apps/storail-relay-e2e/runs/${runId}/owner-record`;
const pointer = `bafy-relay-${runId}`;
const metadata = JSON.stringify({ module: "relay-worker", runId, actor: "owner" });
const contentHash = keccakHex(`storail:relay:${runId}:content`);

const AEH_ABI = parseAbi([
  "function publish(string path,string providerId,string pointer,bytes32 contentHash,string metadata)",
  "function submitToApp(bytes32 appId,bytes32 actionType,bytes payload)",
  "event Published(bytes32 indexed pathHash,address indexed owner,address indexed actor,string path,string providerId,string pointer,bytes32 contentHash,string metadata)",
  "event Updated(bytes32 indexed pathHash,address indexed owner,address indexed actor,string path,string providerId,string pointer,bytes32 contentHash,string metadata)",
]);
const PAYMENT_ABI = parseAbi([
  "function instructionCount() view returns (uint256)",
]);
const FORWARDER_ABI = parseAbi([
  "function nonces(address owner) view returns (uint256)",
]);

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(rpcUrl),
});

const publishData = encodeFunctionData({
  abi: AEH_ABI,
  functionName: "publish",
  args: [path, "storacha", pointer, contentHash, metadata],
});
const publishResult = await relayAndConfirm({
  data: publishData,
  gas: 600_000n,
});
assertReceiptHasTopic(publishResult.receipt, keccakHex("Published(bytes32,address,address,string,string,string,bytes32,string)"), "Published");

const beforeInstructionCount = await publicClient.readContract({
  address: getAddress(deployment.paymentDemoApp),
  abi: PAYMENT_ABI,
  functionName: "instructionCount",
});
const paymentPayload = encodeAbiParameters(
  [{ type: "address" }, { type: "uint256" }],
  [recipient, 7n],
);
const paymentData = encodeFunctionData({
  abi: AEH_ABI,
  functionName: "submitToApp",
  args: [keccakHex("payment-demo-app"), keccakHex("Transfer"), paymentPayload],
});
const paymentResult = await relayAndConfirm({
  data: paymentData,
  gas: 1_500_000n,
});
assertReceiptHasTopic(paymentResult.receipt, keccakHex("Updated(bytes32,address,address,string,string,string,bytes32,string)"), "Updated");
const afterInstructionCount = await publicClient.readContract({
  address: getAddress(deployment.paymentDemoApp),
  abi: PAYMENT_ABI,
  functionName: "instructionCount",
});
if (afterInstructionCount - beforeInstructionCount !== 1n) {
  throw new Error(`Unexpected payment instructionCount delta: ${afterInstructionCount - beforeInstructionCount}`);
}

console.log(
  JSON.stringify(
    {
      workerUrl,
      aeh,
      forwarder,
      user: user.address,
      publicDomain: {
        requestId: publishResult.requestId,
        transactionHash: publishResult.transactionHash,
        relayerId: publishResult.relayerId,
        path,
        pointer,
        contentHash,
      },
      paymentDemo: {
        requestId: paymentResult.requestId,
        transactionHash: paymentResult.transactionHash,
        relayerId: paymentResult.relayerId,
        recipient,
        amount: "7",
        instructionCountBefore: beforeInstructionCount.toString(),
        instructionCountAfter: afterInstructionCount.toString(),
      },
      status: "confirmed",
    },
    null,
    2,
  ),
);

async function relayAndConfirm({ data, gas }) {
  const nonce = await publicClient.readContract({
    address: forwarder,
    abi: FORWARDER_ABI,
    functionName: "nonces",
    args: [user.address],
  });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
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
      to: aeh,
      value: 0n,
      gas,
      nonce,
      deadline: Number(deadline),
      data,
    },
  });

  const relayPayload = curlJson(`${workerUrl}/v1/relay`, {
    request: {
      from: user.address,
      to: aeh,
      value: "0",
      gas: gas.toString(),
      deadline: deadline.toString(),
      data,
    },
    signature,
  });
  if (relayPayload.error) {
    throw new Error(`Relay request failed: ${JSON.stringify(relayPayload)}`);
  }

  let finalStatus = relayPayload.status;
  for (let i = 0; i < 30; i++) {
    if (finalStatus === "confirmed" || finalStatus === "reverted" || finalStatus === "failed" || finalStatus === "stalled") {
      break;
    }
    await sleep(5000);
    const statusPayload = curlJson(`${workerUrl}/v1/relay/${relayPayload.requestId}`);
    if (statusPayload.error) {
      throw new Error(`Relay status failed: ${JSON.stringify(statusPayload)}`);
    }
    finalStatus = statusPayload.status;
    relayPayload.relayerId = statusPayload.relayerId;
    relayPayload.transactionHash = statusPayload.transactionHash;
  }

  if (finalStatus !== "confirmed") {
    throw new Error(`Relay request did not confirm: ${finalStatus}`);
  }

  const receipt = await publicClient.getTransactionReceipt({ hash: relayPayload.transactionHash });
  if (receipt.status !== "success") {
    throw new Error(`Relay transaction reverted: ${relayPayload.transactionHash}`);
  }

  return {
    requestId: relayPayload.requestId,
    transactionHash: relayPayload.transactionHash,
    relayerId: relayPayload.relayerId,
    receipt,
  };
}

function assertReceiptHasTopic(receipt, topic, label) {
  const found = receipt.logs.some((log) => log.topics[0]?.toLowerCase() === topic.toLowerCase());
  if (!found) {
    throw new Error(`${label} event not found in receipt ${receipt.transactionHash}`);
  }
}

function curlJson(url, body) {
  const args = ["-sS"];
  if (body === undefined) {
    args.push(url);
  } else {
    args.push("-X", "POST", "-H", "Content-Type: application/json", "-d", JSON.stringify(body), url);
  }
  const output = execFileSync("curl", args, { encoding: "utf8" });
  return JSON.parse(output);
}

function loadEnvFiles(urls) {
  return urls.reduce((env, url) => ({ ...env, ...loadEnv(url) }), {});
}

function loadEnv(url) {
  if (!fs.existsSync(url)) {
    return {};
  }
  const raw = fs.readFileSync(url, "utf8");
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

function requiredEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function keccakHex(input) {
  return keccak256(stringToHex(input));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
