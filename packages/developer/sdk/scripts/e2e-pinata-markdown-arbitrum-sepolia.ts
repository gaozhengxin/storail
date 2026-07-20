// Copyright (C) 2026 Defa Wang

import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { createStorageProxyProvider, createStorailMutationClient } from "../src/index.js";

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
const path = `/${account.address}/apps/storail-markdown-viewer-e2e/${runId}` as const;
const markdown = `# Storail Markdown Viewer E2E

This document was uploaded through the Pinata storage proxy and registered in the Storail AEL.

## Inline formatting

The renderer should show **bold text**, *italic text*, \`inline code\`, and a [Storail website link](https://storail.pages.dev/).

## Lists

- First unordered item
- Second unordered item with **strong emphasis**
- Third unordered item with \`code\`

1. First ordered step
2. Second ordered step
3. Third ordered step

## Quote

> A blockquote should be visually separated from normal body text.

---

## Code block

\`\`\`ts
const contentUrl = "${contentBaseUrl}${path}";
console.log(contentUrl);
\`\`\`
`;

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

const statuses: string[] = [];
const operation = await client.uploadAndUpdate(
  {
    path,
    name: `storail-markdown-viewer-e2e-${runId}.md`,
    content: markdown,
    metadata: {
      module: "markdown-viewer-e2e",
      runId,
      title: "Storail Markdown Viewer E2E",
    },
  },
  {
    mode: "direct",
    preflight: false,
    gasLimit: 650_000n,
    waitForIndex: false,
    onStatus: (next) => {
      statuses.push(next.status);
      console.log(`status=${next.status}`);
    },
  },
);

if (operation.status !== "confirmed") {
  console.error(JSON.stringify(operation, bigintReplacer, 2));
  process.exit(1);
}

const storageMetadata = operation.storage?.metadata ? JSON.parse(operation.storage.metadata) as { contentType?: string; contentKind?: string } : {};
if (storageMetadata.contentType !== "text/markdown" || storageMetadata.contentKind !== "markdown") {
  console.error(JSON.stringify({ error: "unexpected storage metadata", storageMetadata }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: operation.status,
      operationId: operation.operationId,
      requestId: operation.requestId,
      transactionHashes: operation.transactionHashes,
      receiptBlock: operation.receiptBlock?.toString(),
      path,
      contentUrl: `${contentBaseUrl.replace(/\/$/, "")}${path}`,
      storage: operation.storage,
      statuses,
    },
    null,
    2,
  ),
);

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

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
