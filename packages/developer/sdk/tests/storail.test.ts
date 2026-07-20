// Copyright (C) 2026 Defa Wang

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFunctionData, keccak256, stringToHex, type Address, type Hex } from "viem";
import {
  AEH_ABI,
  createStorageProxyProvider,
  createStorailMutationClient,
  inferContentType,
  resolveContentKind,
  StorailError,
  type PublicClientLike,
  type StorageProvider,
} from "../src/index.js";

const USER = "0x1111111111111111111111111111111111111111" as Address;
const AEH = "0x2222222222222222222222222222222222222222" as Address;
const FORWARDER = "0x3333333333333333333333333333333333333333" as Address;
const TX = "0x4444444444444444444444444444444444444444444444444444444444444444" as Hex;
const REQUEST_ID = "0x5555555555555555555555555555555555555555555555555555555555555555" as Hex;

class MockPublicClient implements PublicClientLike {
  nonce = 0n;
  verified = true;
  simulated = false;
  called = false;

  async readContract(input: { functionName?: string }): Promise<unknown> {
    if (input.functionName === "nonces") {
      return this.nonce;
    }
    if (input.functionName === "verify") {
      return this.verified;
    }
    throw new Error(`unexpected readContract ${input.functionName ?? ""}`);
  }

  async simulateContract(): Promise<unknown> {
    this.simulated = true;
    return {};
  }

  async call(): Promise<unknown> {
    this.called = true;
    return {};
  }

  async waitForTransactionReceipt(): Promise<{ status: "success"; blockNumber: bigint; transactionHash: Hex }> {
    return { status: "success", blockNumber: 12n, transactionHash: TX };
  }
}

function makeWallet(address: Address = USER) {
  return {
    signedMessages: [] as unknown[],
    sentTransactions: [] as unknown[],
    getAddress: async () => address,
    getChainId: async () => 421614,
    async signTypedData(input: unknown): Promise<Hex> {
      this.signedMessages.push(input);
      return `0x${"66".repeat(65)}` as Hex;
    },
    async sendTransaction(input: unknown): Promise<Hex> {
      this.sentTransactions.push(input);
      return TX;
    },
  };
}

class MemoryOperationStore {
  readonly operations = new Map<string, unknown>();

  async get(operationId: string) {
    return this.operations.get(operationId) as never;
  }

  async put(operation: { operationId: string }) {
    this.operations.set(operation.operationId, operation);
  }
}

class MockStorageProvider implements StorageProvider {
  readonly providerId = "lighthouse";
  uploads = 0;
  fail = false;
  lastUpload?: { content: Blob | Uint8Array | string; metadata?: Record<string, unknown>; contentType?: string };

  async upload(input: { content: Blob | Uint8Array | string; metadata?: Record<string, unknown>; contentType?: string }): Promise<{ providerId: string; pointer: string; contentHash: Hex; metadata: string }> {
    this.uploads += 1;
    this.lastUpload = input;
    if (this.fail) {
      throw new StorailError("STORAGE_FAILED", "mock storage failed");
    }
    const bytes = await testContentBytes(input.content);
    return {
      providerId: this.providerId,
      pointer: "bafy-storage-demo",
      contentHash: keccak256(testBytesToHex(bytes)),
      metadata: JSON.stringify({ provider: this.providerId, cid: "bafy-storage-demo", ...(input.metadata ?? {}) }),
    };
  }
}

function makeFetch() {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (url.endsWith("/v1/relay")) {
      return json({ requestId: REQUEST_ID, transactionHash: TX, status: "submitted", relayerNonce: 1 });
    }

    if (url.includes("/v1/relay/")) {
      return json({ requestId: REQUEST_ID, transactionHash: TX, status: "confirmed", relayerNonce: 1 });
    }

    if (url.includes("subgraph")) {
      return json({
        data: {
          _meta: { block: { number: "12" } },
          storageRecords: [
            {
              exists: true,
              providerId: "lighthouse",
              pointer: "bafy-demo",
              contentHash: keccak256(stringToHex("content")),
              metadata: "{}",
            },
          ],
          writerPermissions: [],
        },
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetch, calls };
}

describe("StorailMutationClient", () => {
  it("signs, preflights, relays, confirms, and indexes publish", async () => {
    const publicClient = new MockPublicClient();
    const wallet = makeWallet();
    const { fetch, calls } = makeFetch();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      subgraphUrl: "https://subgraph.example",
      wallet,
      publicClient,
      fetch,
      indexingPollMs: 1,
    });

    const contentHash = keccak256(stringToHex("content"));
    const statuses: string[] = [];
    const operation = await client.publish({
      path: `/${USER}/apps/demo/record`,
      providerId: "lighthouse",
      pointer: "bafy-demo",
      contentHash,
      metadata: "{}",
    }, {
      onStatus: (next) => statuses.push(next.status),
    });

    assert.equal(operation.status, "indexed");
    assert.deepEqual(statuses, ["draft", "signing", "signed", "submitting", "submitted", "confirmed", "indexed"]);
    assert.equal(operation.requestId, REQUEST_ID);
    assert.deepEqual(operation.transactionHashes, [TX]);
    assert.equal(publicClient.simulated, true);
    assert.equal(wallet.signedMessages.length, 1);

    const relayCall = calls.find((call) => call.url.endsWith("/v1/relay"));
    assert.ok(relayCall);
    const body = relayCall.body as { request: { data: Hex }; signature: Hex };
    const decoded = decodeFunctionData({ abi: AEH_ABI, data: body.request.data });
    assert.equal(decoded.functionName, "publish");
  });

  it("throws stable validation errors before signing invalid paths", async () => {
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      wallet: makeWallet(),
      publicClient: new MockPublicClient(),
      fetch: makeFetch().fetch,
    });

    await assert.rejects(
      () => client.remove({ path: "/not-an-address/demo" as never }),
      (error) => error instanceof StorailError && error.code === "VALIDATION_ERROR",
    );
  });

  it("detects nonce changes during preflight", async () => {
    const publicClient = new MockPublicClient();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      wallet: makeWallet(),
      publicClient,
      fetch: makeFetch().fetch,
    });

    const signed = await client.signForwardRequest(
      `0x${"12".repeat(4)}` as Hex,
      { gasLimit: 100n, deadline: 1000 },
    );
    publicClient.nonce = 1n;
    await assert.rejects(() => client.preflight(signed), /Forwarder nonce changed/);
  });

  it("supports direct wallet transaction mode", async () => {
    const publicClient = new MockPublicClient();
    const wallet = makeWallet();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      subgraphUrl: "https://subgraph.example",
      wallet,
      publicClient,
      fetch: makeFetch().fetch,
      indexingPollMs: 1,
    });

    const statuses: string[] = [];
    const operation = await client.remove(
      { path: `/${USER}/apps/demo/record` },
      { mode: "direct", waitForIndex: false, onStatus: (next) => statuses.push(next.status) },
    );

    assert.equal(operation.status, "confirmed");
    assert.deepEqual(statuses, ["draft", "submitting", "submitted", "confirmed"]);
    assert.equal(wallet.sentTransactions.length, 1);
    assert.equal(publicClient.called, true);
    assert.equal(wallet.signedMessages.length, 0);
  });

  it("persists operation snapshots", async () => {
    const store = new MemoryOperationStore();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      wallet: makeWallet(),
      publicClient: new MockPublicClient(),
      fetch: makeFetch().fetch,
      operationStore: store,
    });

    const operation = await client.update(
      {
        path: `/${USER}/apps/demo/record`,
        providerId: "lighthouse",
        pointer: "bafy-demo",
        contentHash: keccak256(stringToHex("content")),
        metadata: "{}",
      },
      { waitForIndex: false },
    );

    const persisted = await store.get(operation.operationId);
    assert.equal(persisted?.status, "confirmed");
    assert.equal(persisted?.requestId, REQUEST_ID);
  });

  it("uploads to storage and registers the pointer with update", async () => {
    const storageProvider = new MockStorageProvider();
    const { fetch, calls } = makeFetch();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      subgraphUrl: "https://subgraph.example",
      wallet: makeWallet(),
      publicClient: new MockPublicClient(),
      fetch,
      storageProvider,
      indexingPollMs: 1,
    });

    const statuses: string[] = [];
    const operation = await client.uploadAndUpdate(
      {
        path: `/${USER}/apps/demo/profile`,
        name: "profile.json",
        content: JSON.stringify({ name: "demo" }),
        contentType: "application/json",
      },
      { onStatus: (next) => statuses.push(next.status), waitForIndex: false },
    );

    assert.equal(operation.status, "confirmed");
    assert.equal(operation.storage?.pointer, "bafy-storage-demo");
    assert.equal(storageProvider.uploads, 1);
    assert.deepEqual(statuses, [
      "storage_uploading",
      "storage_uploaded",
      "registering",
      "draft",
      "signing",
      "signed",
      "submitting",
      "submitted",
      "confirmed",
    ]);

    const relayCall = calls.find((call) => call.url.endsWith("/v1/relay"));
    const body = relayCall?.body as { request: { data: Hex } };
    const decoded = decodeFunctionData({ abi: AEH_ABI, data: body.request.data });
    assert.equal(decoded.functionName, "update");
  });

  it("reports storage_failed before signing when upload fails", async () => {
    const storageProvider = new MockStorageProvider();
    storageProvider.fail = true;
    const wallet = makeWallet();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      wallet,
      publicClient: new MockPublicClient(),
      fetch: makeFetch().fetch,
      storageProvider,
    });

    const operation = await client.uploadAndPublish({
      path: `/${USER}/apps/demo/profile`,
      content: "bad",
    });

    assert.equal(operation.status, "storage_failed");
    assert.equal(operation.error?.code, "STORAGE_FAILED");
    assert.equal(wallet.signedMessages.length, 0);
  });

  it("reports registration_failed when storage succeeds but relay registration fails", async () => {
    const storageProvider = new MockStorageProvider();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      wallet: makeWallet(),
      publicClient: new MockPublicClient(),
      fetch: async (input: RequestInfo | URL): Promise<Response> => {
        if (String(input).endsWith("/v1/relay")) {
          return new Response(JSON.stringify({ code: "RELAY_DOWN", message: "relay down" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`unexpected fetch ${String(input)}`);
      },
      storageProvider,
    });

    const operation = await client.uploadAndUpdate({
      path: `/${USER}/apps/demo/profile`,
      content: "ok",
    });

    assert.equal(operation.status, "registration_failed");
    assert.equal(operation.storage?.pointer, "bafy-storage-demo");
    assert.equal(operation.error?.code, "RELAY_UNAVAILABLE");
  });

  it("rejects storage results whose content hash does not match local content", async () => {
    const storageProvider: StorageProvider = {
      providerId: "lighthouse",
      async upload() {
        return {
          providerId: "lighthouse",
          pointer: "bafy-wrong-hash",
          contentHash: keccak256(stringToHex("different content")),
          metadata: "{}",
        };
      },
    };
    const wallet = makeWallet();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      wallet,
      publicClient: new MockPublicClient(),
      fetch: makeFetch().fetch,
      storageProvider,
    });

    const operation = await client.uploadAndUpdate({
      path: `/${USER}/apps/demo/profile`,
      content: "expected content",
    });

    assert.equal(operation.status, "storage_failed");
    assert.equal(operation.error?.code, "STORAGE_FAILED");
    assert.equal(wallet.signedMessages.length, 0);
  });

  it("includes local content hash in storage operation ids", async () => {
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      wallet: makeWallet(),
      publicClient: new MockPublicClient(),
      fetch: makeFetch().fetch,
      storageProvider: new MockStorageProvider(),
    });

    const first = await client.uploadAndUpdate(
      { path: `/${USER}/apps/demo/profile`, name: "profile.json", content: "first" },
      { waitForIndex: false },
    );
    const second = await client.uploadAndUpdate(
      { path: `/${USER}/apps/demo/profile`, name: "profile.json", content: "second" },
      { waitForIndex: false },
    );

    assert.notEqual(first.operationId, second.operationId);
  });

  it("can register an already uploaded storage result without uploading again", async () => {
    const storageProvider = new MockStorageProvider();
    const { fetch, calls } = makeFetch();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      wallet: makeWallet(),
      publicClient: new MockPublicClient(),
      fetch,
      storageProvider,
    });

    const storage = {
      providerId: "lighthouse",
      pointer: "bafy-existing",
      contentHash: keccak256(stringToHex("existing content")),
      metadata: JSON.stringify({ provider: "lighthouse", cid: "bafy-existing" }),
    } as const;
    const operation = await client.registerUploadedStorage(
      {
        path: `/${USER}/apps/demo/profile`,
        registrationKind: "update",
        storage,
      },
      { waitForIndex: false },
    );

    assert.equal(operation.status, "confirmed");
    assert.equal(operation.storage?.pointer, "bafy-existing");
    assert.equal(storageProvider.uploads, 0);
    const relayCall = calls.find((call) => call.url.endsWith("/v1/relay"));
    const body = relayCall?.body as { request: { data: Hex } };
    const decoded = decodeFunctionData({ abi: AEH_ABI, data: body.request.data });
    assert.equal(decoded.functionName, "update");
  });

  it("encrypts storage-backed writes in aligned blocks and decrypts retrieved content", async () => {
    const storageProvider = new MockStorageProvider();
    const wallet = makeWallet();
    const path = `/${USER}/apps/demo/encrypted-profile` as const;
    const plaintext = "encrypted profile ".repeat(700);
    const publicClient = new MockPublicClient();
    const { fetch: relayFetch } = makeFetch();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      subgraphUrl: "https://subgraph.example",
      wallet,
      publicClient,
      fetch: relayFetch,
      storageProvider,
    });

    const operation = await client.write.replace(
      {
        path,
        name: "profile.json",
        content: plaintext,
        contentType: "application/json",
        metadata: { purpose: "profile" },
        encryption: { blockSize: 8 * 1024 },
      },
      { waitForIndex: false },
    );

    assert.equal(operation.status, "confirmed");
    assert.ok(operation.storage?.metadata);
    assert.equal(storageProvider.lastUpload?.contentType, "application/octet-stream");
    const encryptedBytes = await testContentBytes(storageProvider.lastUpload?.content ?? "");
    assert.notEqual(new TextDecoder().decode(encryptedBytes), plaintext);

    const metadata = JSON.parse(operation.storage.metadata) as {
      purpose: string;
      storailEncryption: {
        blockSize: number;
        plaintextSize: number;
        plaintextContentHash: Hex;
      };
    };
    assert.equal(metadata.purpose, "profile");
    assert.equal(metadata.storailEncryption.blockSize, 8 * 1024);
    assert.equal(metadata.storailEncryption.plaintextSize, new TextEncoder().encode(plaintext).byteLength);
    assert.equal(metadata.storailEncryption.plaintextContentHash, keccak256(stringToHex(plaintext)));

    const readClient = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      subgraphUrl: "https://subgraph.example",
      wallet,
      publicClient,
      fetch: async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.includes("subgraph")) {
          return json({
            data: {
              storageRecords: [
                {
                  id: "encrypted-record",
                  pathHash: keccak256(stringToHex(path)),
                  path,
                  owner: USER,
                  providerId: "lighthouse",
                  pointer: "bafy-storage-demo",
                  contentHash: operation.storage?.contentHash,
                  metadata: operation.storage?.metadata,
                  exists: true,
                  createdBy: USER,
                  updatedBy: USER,
                  createdAtBlock: "1",
                  createdAtTimestamp: "1",
                  updatedAtBlock: "2",
                  updatedAtTimestamp: "2",
                  deletedAtBlock: null,
                  deletedAtTimestamp: null,
                },
              ],
            },
          });
        }
        if (url === "https://gateway.lighthouse.storage/ipfs/bafy-storage-demo") {
          return new Response(encryptedBytes, {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" },
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    });

    const decrypted = await readClient.read.getContent({ path, decryption: true });
    assert.equal(new TextDecoder().decode(decrypted.bytes), plaintext);
    assert.equal(decrypted.contentType, "application/json");
  });

  it("uses the worker storage proxy provider without provider API keys", async () => {
    const calls: Array<{ url: string; body?: unknown; authorization?: string | null }> = [];
    const storageProvider = createStorageProxyProvider({
      workerUrl: "https://relay.example",
      apiKey: "strl_demo_secret",
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        calls.push({
          url: String(input),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          authorization: new Headers(init?.headers).get("Authorization"),
        });
        return json({
          providerId: "pinata",
          pointer: "bafy-proxy-demo",
          contentHash: keccak256(stringToHex("proxy content")),
          metadata: JSON.stringify({ provider: "pinata", cid: "bafy-proxy-demo" }),
        });
      },
    });

    const uploaded = await storageProvider.upload({
      name: "profile.json",
      content: "proxy content",
      contentType: "application/json",
    });

    assert.equal(uploaded.providerId, "pinata");
    assert.equal(uploaded.pointer, "bafy-proxy-demo");
    assert.equal(calls[0]?.url, "https://relay.example/v1/storage/upload");
    assert.equal(calls[0]?.authorization, "Bearer strl_demo_secret");
    assert.equal((calls[0]?.body as { contentBase64: string }).contentBase64, btoa("proxy content"));
  });

  it("infers content types and protects standard storage metadata fields", async () => {
    assert.equal(inferContentType({ name: "notes.md" }), "text/markdown");
    assert.equal(resolveContentKind({ contentType: "application/json" }), "json");

    const calls: Array<{ body?: unknown }> = [];
    const storageProvider = createStorageProxyProvider({
      workerUrl: "https://relay.example",
      fetch: async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return json({
          providerId: "pinata",
          pointer: "bafy-proxy-demo",
          contentHash: keccak256(stringToHex("proxy content")),
          metadata: JSON.stringify({ provider: "pinata", cid: "bafy-proxy-demo", contentType: "text/markdown", contentKind: "markdown" }),
        });
      },
    });

    await storageProvider.upload({
      name: "notes.md",
      content: "proxy content",
      metadata: {
        provider: "wrong",
        contentType: "application/json",
        contentKind: "json",
        module: "metadata-test",
      },
    });

    const body = calls[0]?.body as { contentType: string; metadata: Record<string, unknown> };
    assert.equal(body.contentType, "text/markdown");
    assert.equal(body.metadata.module, "metadata-test");
    assert.equal(body.metadata.provider, undefined);
    assert.equal(body.metadata.contentType, undefined);
    assert.equal(body.metadata.contentKind, undefined);
  });

  it("maps worker storage proxy error bodies to storage_failed", async () => {
    const storageProvider = createStorageProxyProvider({
      workerUrl: "https://relay.example",
      fetch: async (): Promise<Response> => json({
        error: {
          code: "STORAGE_UPLOAD_FAILED",
          message: "Trial expired",
        },
      }),
    });

    await assert.rejects(
      () => storageProvider.upload({ content: "proxy content" }),
      (error) => error instanceof StorailError && error.code === "STORAGE_FAILED" && error.message === "Trial expired",
    );
  });

  it("resumes a signed operation by resubmitting the same forward request", async () => {
    const store = new MemoryOperationStore();
    const signedRequest = {
      request: {
        from: USER,
        to: AEH,
        value: "0" as const,
        gas: "650000",
        deadline: "2000000000",
        data: `0x${"12".repeat(4)}` as Hex,
      },
      nonce: 0n,
      signature: `0x${"66".repeat(65)}` as Hex,
    };
    await store.put({
      operationId: "op-resume",
      kind: "publish",
      status: "signed",
      transactionHashes: [],
      signedRequest,
    });

    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      wallet: makeWallet(),
      publicClient: new MockPublicClient(),
      fetch: makeFetch().fetch,
      operationStore: store,
    });

    const resumed = await client.resumeOperation("op-resume", { waitForReceipt: false });
    assert.equal(resumed?.status, "confirmed");
    assert.equal(resumed?.requestId, REQUEST_ID);
    assert.deepEqual(resumed?.transactionHashes, [TX]);
  });

  it("builds payment demo submitToApp transfer operations", async () => {
    const wallet = makeWallet();
    const { fetch, calls } = makeFetch();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      wallet,
      publicClient: new MockPublicClient(),
      fetch,
    });

    const operation = await client.paymentDemoTransfer(
      { to: "0x7777777777777777777777777777777777777777", amount: 25n },
      { waitForIndex: false },
    );

    assert.equal(operation.kind, "submitToApp");
    const relayCall = calls.find((call) => call.url.endsWith("/v1/relay"));
    const body = relayCall?.body as { request: { data: Hex } };
    const decoded = decodeFunctionData({ abi: AEH_ABI, data: body.request.data });
    assert.equal(decoded.functionName, "submitToApp");
  });

  it("exposes write module aliases for storage-backed path writes", async () => {
    const storageProvider = new MockStorageProvider();
    const { fetch, calls } = makeFetch();
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      subgraphUrl: "https://subgraph.example",
      wallet: makeWallet(),
      publicClient: new MockPublicClient(),
      fetch,
      storageProvider,
    });

    const operation = await client.write.create(
      {
        path: `/${USER}/apps/demo/item`,
        content: "content",
      },
      { waitForIndex: false },
    );

    assert.equal(operation.status, "confirmed");
    assert.equal(operation.registrationKind, "publish");
    const relayCall = calls.find((call) => call.url.endsWith("/v1/relay"));
    const body = relayCall?.body as { request: { data: Hex } };
    const decoded = decodeFunctionData({ abi: AEH_ABI, data: body.request.data });
    assert.equal(decoded.functionName, "publish");
  });

  it("checks writer permission before asking the wallet to sign", async () => {
    const writer = "0x9999999999999999999999999999999999999999" as Address;
    const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
    const wallet = makeWallet(writer);
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      subgraphUrl: "https://subgraph.example",
      wallet,
      publicClient: new MockPublicClient(),
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (String(input).includes("subgraph")) {
          const body = init?.body ? JSON.parse(String(init.body)) as { variables: { writer: string; domains: string[] } } : undefined;
          assert.equal(body?.variables.writer, writer.toLowerCase());
          assert.deepEqual(body?.variables.domains, [
            `/${owner}`,
            `/${owner}/apps`,
            `/${owner}/apps/demo`,
            `/${owner}/apps/demo/item`,
          ]);
          return json({
            data: {
              writerPermissions: [
                {
                  domain: `/${owner}/apps/demo`,
                  active: true,
                },
              ],
            },
          });
        }
        if (String(input).endsWith("/v1/relay")) {
          return json({ requestId: REQUEST_ID, transactionHash: TX, status: "submitted", relayerNonce: 1 });
        }
        if (String(input).includes("/v1/relay/")) {
          return json({ requestId: REQUEST_ID, transactionHash: TX, status: "confirmed", relayerNonce: 1 });
        }
        throw new Error(`unexpected fetch ${String(input)}`);
      },
    });

    const operation = await client.write.update(
      {
        path: `/${owner}/apps/demo/item`,
        providerId: "lighthouse",
        pointer: "bafy-demo",
        contentHash: keccak256(stringToHex("content")),
        metadata: "{}",
      },
      { waitForIndex: false },
    );

    assert.equal(operation.status, "confirmed");
    assert.equal(wallet.signedMessages.length, 1);
  });

  it("rejects unauthorized path writes before signing", async () => {
    const writer = "0x9999999999999999999999999999999999999999" as Address;
    const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
    const wallet = makeWallet(writer);
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      subgraphUrl: "https://subgraph.example",
      wallet,
      publicClient: new MockPublicClient(),
      fetch: async (): Promise<Response> => json({ data: { writerPermissions: [] } }),
    });

    await assert.rejects(
      () => client.write.remove({ path: `/${owner}/apps/demo/item` }),
      (error) => error instanceof StorailError && error.code === "VALIDATION_ERROR",
    );
    assert.equal(wallet.signedMessages.length, 0);
  });

  it("reads public-domain records and verifies retrieved content", async () => {
    const contentHash = keccak256(stringToHex("hello"));
    const path = `/${USER}/apps/demo/profile` as const;
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      subgraphUrl: "https://subgraph.example",
      wallet: makeWallet(),
      publicClient: new MockPublicClient(),
      fetch: async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.includes("subgraph")) {
          return json({
            data: {
              storageRecords: [
                {
                  id: "record-1",
                  pathHash: keccak256(stringToHex(path)),
                  path,
                  owner: USER,
                  providerId: "lighthouse",
                  pointer: "bafy-profile",
                  contentHash,
                  metadata: JSON.stringify({ gatewayUrl: "https://gateway.example/bafy-profile" }),
                  exists: true,
                  createdBy: USER,
                  updatedBy: USER,
                  createdAtBlock: "1",
                  createdAtTimestamp: "1",
                  updatedAtBlock: "2",
                  updatedAtTimestamp: "2",
                  deletedAtBlock: null,
                  deletedAtTimestamp: null,
                },
              ],
            },
          });
        }
        if (url === "https://gateway.example/bafy-profile") {
          return new Response("hello", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    });

    const record = await client.read.getRecord(path);
    assert.equal(record?.pointer, "bafy-profile");

    const records = await client.read.listRecords({ path: `/${USER}/apps/demo`, first: 10 });
    assert.equal(records.length, 1);

    const content = await client.read.getContent(path);
    assert.equal(new TextDecoder().decode(content.bytes), "hello");
    assert.equal(content.verified, true);
    assert.equal(content.contentType, "text/plain");
  });

  it("queries payment demo balances through the dedicated module", async () => {
    const account = "0x7777777777777777777777777777777777777777" as Address;
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      paymentDemoSubgraphUrl: "https://payment-subgraph.example",
      wallet: makeWallet(),
      publicClient: new MockPublicClient(),
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        assert.equal(String(input), "https://payment-subgraph.example");
        const body = init?.body ? JSON.parse(String(init.body)) as { variables: { account: string } } : undefined;
        assert.equal(body?.variables.account, account.toLowerCase());
        return json({
          data: {
            paymentAccounts: [
              {
                address: account,
                balance: "123",
              },
            ],
          },
        });
      },
    });

    const balance = await client.paymentDemo.getBalance({ account });
    assert.equal(balance.account, account);
    assert.equal(balance.balance, 123n);
  });

  it("sends SDK API keys to relay endpoints", async () => {
    const calls: Array<{ url: string; authorization?: string | null }> = [];
    const client = createStorailMutationClient({
      chainId: 421614,
      aehAddress: AEH,
      forwarderAddress: FORWARDER,
      relayUrl: "https://relay.example",
      apiKey: "strl_demo_secret",
      wallet: makeWallet(),
      publicClient: new MockPublicClient(),
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") });
        if (String(input).endsWith("/v1/relay")) {
          return json({ requestId: REQUEST_ID, transactionHash: TX, status: "submitted", relayerNonce: 1 });
        }
        if (String(input).includes("/v1/relay/")) {
          return json({ requestId: REQUEST_ID, transactionHash: TX, status: "confirmed", relayerNonce: 1 });
        }
        throw new Error(`unexpected fetch ${String(input)}`);
      },
    });

    await client.remove(
      { path: `/${USER}/apps/demo/item` },
      { waitForReceipt: false, waitForIndex: false },
    );
    await client.waitForRelayStatus(REQUEST_ID);

    assert.equal(calls.find((call) => call.url.endsWith("/v1/relay"))?.authorization, "Bearer strl_demo_secret");
    assert.equal(calls.find((call) => call.url.includes("/v1/relay/"))?.authorization, "Bearer strl_demo_secret");
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function testContentBytes(content: Blob | Uint8Array | string): Promise<Uint8Array> {
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  return new Uint8Array(await content.arrayBuffer());
}

function testBytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as Hex;
}
