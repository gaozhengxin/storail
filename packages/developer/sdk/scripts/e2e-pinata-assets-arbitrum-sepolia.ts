// Copyright (C) 2026 Defa Wang

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { createStorageProxyProvider, createStorailMutationClient, type ContentKind } from "../src/index.js";

const env = loadEnvFiles([
  new URL("../.env", import.meta.url),
  new URL("../../../../scripts/operator/.env", import.meta.url),
]);
const deployment = JSON.parse(
  fs.readFileSync(new URL("../../../../codex/deployments/arbitrum-sepolia.json", import.meta.url), "utf8"),
) as {
  authorizedEventHub: Address;
  erc2771Forwarder: Address;
};

const rpcUrl = required(env, "ARBITRUM_SEPOLIA_RPC_URL");
const relayUrl = env.RELAY_WORKER_URL ?? process.env.RELAY_WORKER_URL ?? "https://storail-relay-worker.zhengxingao.workers.dev";
const apiKey = env.STORAIL_API_KEY ?? process.env.STORAIL_API_KEY;
const subgraphUrl = process.env.SUBGRAPH_QUERY_URL ?? required(env, "SUBGRAPH_QUERY_URL");
const privateKey = required(env, "PRIVATE_KEY") as Hex;
const contentBaseUrl = process.env.CONTENT_BASE_URL ?? "https://storail-content-worker.zhengxingao.workers.dev";
const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(rpcUrl),
});
const walletClient = createWalletClient({
  account,
  chain: arbitrumSepolia,
  transport: http(rpcUrl),
});
const execFileAsync = promisify(execFile);

const wallet = {
  getAddress: () => account.address,
  getChainId: () => arbitrumSepolia.id,
  signTypedData: account.signTypedData,
  sendTransaction: (input: { to: Address; value: bigint; data: Hex; gas?: bigint }) =>
    walletClient.sendTransaction({
      account,
      to: input.to,
      value: input.value,
      data: input.data,
      gas: input.gas,
    }),
};

const runId = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const storageProvider = createStorageProxyProvider({
  workerUrl: relayUrl,
  apiKey,
  fetch: curlFetch,
});
const client = createStorailMutationClient({
  chainId: arbitrumSepolia.id,
  aehAddress: deployment.authorizedEventHub,
  forwarderAddress: deployment.erc2771Forwarder,
  relayUrl,
  apiKey,
  subgraphUrl,
  publicClient,
  fetch: curlFetch,
  wallet,
  storageProvider,
  indexingTimeoutMs: 180_000,
  indexingPollMs: 5_000,
});

const assets: Array<{ kind: ContentKind; name: string; content: Blob | Uint8Array | string }> = [
  {
    kind: "html",
    name: `storail-html-asset-${runId}.html`,
    content: fs.readFileSync(new URL("../fixtures/content-assets-e2e.html", import.meta.url), "utf8"),
  },
  {
    kind: "image",
    name: `storail-image-asset-${runId}.png`,
    content: await makePngImage(runId),
  },
  {
    kind: "audio",
    name: `storail-audio-asset-${runId}.wav`,
    content: makeWavTone(),
  },
  {
    kind: "video",
    name: `storail-video-asset-${runId}.mp4`,
    content: await makeMp4Clip(runId),
  },
];

const results = [];
for (const asset of assets) {
  const assetPath = `/${account.address}/apps/storail-content-assets-e2e/${runId}/${asset.kind}` as const;
  const statuses: string[] = [];
  const operation = await client.uploadAndUpdate(
    {
      path: assetPath,
      name: asset.name,
      content: asset.content,
      metadata: {
        module: "content-assets-e2e",
        runId,
        expectedKind: asset.kind,
      },
    },
    {
      mode: "direct",
      preflight: false,
      gasLimit: 650_000n,
      waitForIndex: false,
      onStatus: (next) => {
        statuses.push(next.status);
        console.log(`${asset.kind}: status=${next.status}`);
      },
    },
  );
  if (operation.status !== "confirmed") {
    console.error(JSON.stringify(operation, bigintReplacer, 2));
    process.exit(1);
  }
  const metadata = operation.storage?.metadata ? JSON.parse(operation.storage.metadata) as { contentKind?: string; contentType?: string } : {};
  if (metadata.contentKind !== asset.kind) {
    console.error(JSON.stringify({ error: "unexpected contentKind", kind: asset.kind, metadata }, null, 2));
    process.exit(1);
  }
  results.push({
    kind: asset.kind,
    path: assetPath,
    contentUrl: `${contentBaseUrl.replace(/\/$/, "")}${assetPath}`,
    storage: operation.storage,
    transactionHashes: operation.transactionHashes,
    receiptBlock: operation.receiptBlock?.toString(),
    statuses,
  });
}

console.log(JSON.stringify({ status: "confirmed", runId, results }, null, 2));

function loadEnvFiles(paths: URL[]): Record<string, string> {
  return paths.reduce((env, path) => ({ ...env, ...loadEnv(path) }), {});
}

function loadEnv(path: URL): Record<string, string> {
  if (!fs.existsSync(path)) {
    return {};
  }
  const raw = fs.readFileSync(path, "utf8");
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^"|"$/g, "");
  }
  return result;
}

function required(env: Record<string, string>, key: string): string {
  const value = env[key] ?? process.env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

async function curlFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const method = init.method ?? "GET";
  const args = ["-sS", "-X", method];
  for (const [key, value] of headersToEntries(init.headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  if (init.body !== undefined) {
    args.push("--data", String(init.body));
  }
  args.push(url);
  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 1024 * 1024 });
  return new Response(stdout, { status: 200 });
}

function headersToEntries(headers: HeadersInit | undefined): Array<[string, string]> {
  if (!headers) {
    return [];
  }
  if (headers instanceof Headers) {
    return Array.from(headers.entries());
  }
  if (Array.isArray(headers)) {
    return headers.map(([key, value]) => [key, value]);
  }
  return Object.entries(headers);
}

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function makeWavTone(): Uint8Array {
  const sampleRate = 8000;
  const samples = 1600;
  const dataSize = samples * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataSize, true);
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 14000);
    view.setInt16(44 + index * 2, sample, true);
  }
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

async function makeMp4Clip(runId: string): Promise<Uint8Array> {
  const file = path.join(os.tmpdir(), `storail-video-asset-${runId}.mp4`);
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=96x54:rate=2:duration=1",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "faststart",
    "-y",
    file,
  ]);
  return fs.readFileSync(file);
}

async function makePngImage(runId: string): Promise<Uint8Array> {
  const file = path.join(os.tmpdir(), `storail-image-asset-${runId}.png`);
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x180:rate=1:duration=1",
    "-frames:v",
    "1",
    "-y",
    file,
  ]);
  return fs.readFileSync(file);
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
