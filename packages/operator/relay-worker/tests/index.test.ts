import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, encodeFunctionData, keccak256, stringToHex } from "viem";
import {
  AEH_ABI,
  AEL_ABI,
  ApiKeyUsageLimiter,
  WalletLimiter,
  buildRelayerSecretName,
  chooseRelayerOrder,
  deriveApiKey,
  handleStorageUploadRequest,
  isRecordStalled,
  parseConfig,
  validateRelayPayload,
  verifyApiKey,
} from "../src/index";

const AEL_ADDRESS = "0x1111111111111111111111111111111111111111";
const FORWARDER_ADDRESS = "0x2222222222222222222222222222222222222222";
const USER_ADDRESS = "0x3333333333333333333333333333333333333333";
const PAYMENT_DEMO_APP_ID = keccak256(stringToHex("payment-demo-app"));
const PAYMENT_DEMO_ACTION_TRANSFER = keccak256(stringToHex("Transfer"));

function makeEnv(overrides: Record<string, string> = {}) {
  return {
    AEL_ADDRESS,
    FORWARDER_ADDRESS,
    ARBITRUM_SEPOLIA_RPC_URL: "https://example.invalid",
    RELAYER_IDS: "relay_a,relay_b",
    MAX_GAS_LIMIT: "3000000",
    RELAYER_PRIVATE_KEY_RELAY_A: "0x" + "11".repeat(32),
    RELAYER_PRIVATE_KEY_RELAY_B: "0x" + "22".repeat(32),
    WALLET_LIMITER: null,
    RELAY_DISPATCHER: null,
    ...overrides,
  } as never;
}

function makePayload(
  overrides: Partial<{
    to: string;
    deadline: string;
    gas: string;
    value: string;
    data: `0x${string}`;
    signature: `0x${string}`;
  }> = {},
) {
  return {
    request: {
      from: USER_ADDRESS,
      to: overrides.to ?? AEL_ADDRESS,
      value: overrides.value ?? "0",
      gas: overrides.gas ?? "450000",
      deadline: overrides.deadline ?? String(Math.floor(Date.now() / 1000) + 120),
      data:
        overrides.data ??
        encodeFunctionData({
          abi: AEL_ABI,
          functionName: "publish",
          args: [
            "/0x3333333333333333333333333333333333333333/apps/demo",
            "synthetic",
            "synthetic-demo",
            ("0x" + "44".repeat(32)) as `0x${string}`,
            "{}",
          ],
        }),
    },
    signature: overrides.signature ?? (("0x" + "55".repeat(65)) as `0x${string}`),
  };
}

class MemoryStorage {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }

  async list<T>(options?: { prefix?: string }) {
    const prefix = options?.prefix ?? "";
    const entries = Array.from(this.map.entries()).filter(([key]) => key.startsWith(prefix));
    return {
      keys: function* () {
        for (const [key] of entries) {
          yield key;
        }
      },
      values: function* () {
        for (const [, value] of entries) {
          yield value as T;
        }
      },
    };
  }
}

describe("validateRelayPayload", () => {
  it("accepts a valid publish request", () => {
    const config = parseConfig(makeEnv());
    const result = validateRelayPayload(makePayload(), config);
    assert.equal(result.request.to, AEL_ADDRESS);
    assert.equal(result.request.value, 0n);
    assert.equal(result.selector.startsWith("0x"), true);
  });

  it("rejects a wrong target contract", () => {
    const config = parseConfig(makeEnv());
    assert.throws(() => validateRelayPayload(makePayload({ to: FORWARDER_ADDRESS }), config), 
      /Target contract is not allowed/,
    );
  });

  it("rejects an expired deadline", () => {
    const config = parseConfig(makeEnv());
    assert.throws(() =>
      validateRelayPayload(makePayload({ deadline: String(Math.floor(Date.now() / 1000) - 1) }), config),
    /Relay request is expired/);
  });

  it("rejects oversized metadata", () => {
    const config = parseConfig(makeEnv({ MAX_METADATA_LENGTH: "4" }));
    const oversized = encodeFunctionData({
      abi: AEL_ABI,
      functionName: "publish",
      args: [
        "/0x3333333333333333333333333333333333333333/apps/demo",
        "synthetic",
        "synthetic-demo",
        ("0x" + "44".repeat(32)) as `0x${string}`,
        "{\"oversized\":true}",
      ],
    });
    assert.throws(() => validateRelayPayload(makePayload({ data: oversized }), config),
      /metadata exceeds configured maximum length/,
    );
  });

  it("accepts domain-scoped grant writer", () => {
    const config = parseConfig(makeEnv());
    const data = encodeFunctionData({
      abi: AEH_ABI,
      functionName: "grantWriter",
      args: ["/0x3333333333333333333333333333333333333333/apps/demo", FORWARDER_ADDRESS],
    });
    const result = validateRelayPayload(makePayload({ data }), config);
    assert.equal(result.request.to, AEL_ADDRESS);
  });

  it("accepts payment demo submitToApp transfer", () => {
    const config = parseConfig(makeEnv());
    const payload = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [FORWARDER_ADDRESS, 25n],
    );
    const data = encodeFunctionData({
      abi: AEH_ABI,
      functionName: "submitToApp",
      args: [PAYMENT_DEMO_APP_ID, PAYMENT_DEMO_ACTION_TRANSFER, payload],
    });
    const result = validateRelayPayload(makePayload({ data, gas: "900000" }), config);
    assert.equal(result.selector.startsWith("0x"), true);
  });

  it("rejects non-payment demo submitToApp app ids", () => {
    const config = parseConfig(makeEnv());
    const payload = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [FORWARDER_ADDRESS, 25n],
    );
    const data = encodeFunctionData({
      abi: AEH_ABI,
      functionName: "submitToApp",
      args: [("0x" + "99".repeat(32)) as `0x${string}`, PAYMENT_DEMO_ACTION_TRANSFER, payload],
    });
    assert.throws(() => validateRelayPayload(makePayload({ data, gas: "900000" }), config), /Application is not allowed/);
  });

  it("rejects unknown payment demo actions", () => {
    const config = parseConfig(makeEnv());
    const payload = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [FORWARDER_ADDRESS, 25n],
    );
    const data = encodeFunctionData({
      abi: AEH_ABI,
      functionName: "submitToApp",
      args: [PAYMENT_DEMO_APP_ID, ("0x" + "98".repeat(32)) as `0x${string}`, payload],
    });
    assert.throws(() => validateRelayPayload(makePayload({ data, gas: "900000" }), config), /Application action is not allowed/);
  });
});

describe("relayer pool config", () => {
  it("parses multiple relayers from env", () => {
    const config = parseConfig(makeEnv());
    assert.equal(config.relayers.length, 2);
    assert.equal(config.relayers[0]?.id, "relay_a");
    assert.equal(config.relayers[1]?.id, "relay_b");
  });

  it("builds secret names from relayer ids", () => {
    assert.equal(buildRelayerSecretName("relay_a"), "RELAYER_PRIVATE_KEY_RELAY_A");
    assert.equal(buildRelayerSecretName("relay-b"), "RELAYER_PRIVATE_KEY_RELAY_B");
  });

  it("produces deterministic wrapped relayer order from request id", () => {
    assert.deepEqual(chooseRelayerOrder(("0x" + "00".repeat(32)) as `0x${string}`, ["a", "b", "c"]), ["a", "b", "c"]);
    assert.deepEqual(chooseRelayerOrder(("0x" + "02".repeat(32)) as `0x${string}`, ["a", "b", "c"]), ["c", "a", "b"]);
  });
});

describe("API keys", () => {
  it("derives and verifies deterministic HMAC API keys", async () => {
    const seed = "operator-seed";
    const apiKey = await deriveApiKey(seed, "developer-demo");
    assert.equal(apiKey.startsWith("strl_developer-demo_"), true);

    const identity = await verifyApiKey(apiKey, seed);
    assert.equal(identity.keyId, "developer-demo");

    await assert.rejects(() => verifyApiKey(apiKey, "wrong-seed"), /Invalid API key/);
  });

  it("can issue multiple keys for the same key id", async () => {
    const seed = "operator-seed";
    const first = await deriveApiKey(seed, "developer-demo");
    const second = await deriveApiKey(seed, "developer-demo");

    assert.notEqual(first, second);
    assert.equal((await verifyApiKey(first, seed)).keyId, "developer-demo");
    assert.equal((await verifyApiKey(second, seed)).keyId, "developer-demo");
  });

  it("enforces API key usage buckets", async () => {
    const storage = new MemoryStorage();
    const limiter = new ApiKeyUsageLimiter(
      { storage } as never,
      makeEnv({
        API_USAGE_MAX_UNITS_PER_HOUR: "100",
        API_USAGE_MAX_UNITS_PER_DAY: "1000",
      }),
    );

    const first = await limiter.fetch(
      new Request("https://api-key-usage-limiter/reserve", {
        method: "POST",
        body: JSON.stringify({ keyId: "developer-demo", units: 70, nowMs: 1_000, reason: "storage" }),
      }),
    );
    assert.equal(first.status, 200);

    const second = await limiter.fetch(
      new Request("https://api-key-usage-limiter/reserve", {
        method: "POST",
        body: JSON.stringify({ keyId: "developer-demo", units: 40, nowMs: 2_000, reason: "storage" }),
      }),
    );
    assert.equal(second.status, 429);
    const body = await second.json() as { error: { code: string; retryAfterSeconds: number } };
    assert.equal(body.error.code, "API_KEY_USAGE_EXCEEDED");
    assert.equal(body.error.retryAfterSeconds > 0, true);
  });
});

describe("WalletLimiter", () => {
  it("enforces multi-window wallet limits", async () => {
    const storage = new MemoryStorage();
    const limiter = new WalletLimiter(
      { storage } as never,
      makeEnv({
        MAX_WALLET_REQUESTS_PER_FIVE_MINUTES: "2",
        MAX_WALLET_REQUESTS_PER_HOUR: "3",
        MAX_WALLET_REQUESTS_PER_DAY: "4",
        MAX_WALLET_REQUESTS_PER_WEEK: "5",
        DEBOUNCE_TTL_MS: "0",
      }),
    );

    const first = await limiter.fetch(
      new Request("https://wallet-limiter/check", {
        method: "POST",
        body: JSON.stringify({ requestId: "0x" + "01".repeat(32), nowMs: 1_000 }),
      }),
    );
    assert.equal(first.status, 200);

    const second = await limiter.fetch(
      new Request("https://wallet-limiter/check", {
        method: "POST",
        body: JSON.stringify({ requestId: "0x" + "02".repeat(32), nowMs: 2_000 }),
      }),
    );
    assert.equal(second.status, 200);

    const third = await limiter.fetch(
      new Request("https://wallet-limiter/check", {
        method: "POST",
        body: JSON.stringify({ requestId: "0x" + "03".repeat(32), nowMs: 3_000 }),
      }),
    );
    assert.equal(third.status, 429);
  });

  it("debounces the same request id inside the TTL", async () => {
    const storage = new MemoryStorage();
    const limiter = new WalletLimiter({ storage } as never, makeEnv({ DEBOUNCE_TTL_MS: "60000" }));
    const requestId = "0x" + "ab".repeat(32);

    const first = await limiter.fetch(
      new Request("https://wallet-limiter/check", {
        method: "POST",
        body: JSON.stringify({ requestId, nowMs: 10_000 }),
      }),
    );
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true });

    const second = await limiter.fetch(
      new Request("https://wallet-limiter/check", {
        method: "POST",
        body: JSON.stringify({ requestId, nowMs: 20_000 }),
      }),
    );
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { ok: true, duplicate: true });
  });
});

describe("handleStorageUploadRequest", () => {
  it("uploads through Pinata proxy and returns a normalized storage result", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Request[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      calls.push(request);
      assert.equal(request.headers.get("Authorization"), "Bearer pinata-jwt");
      assert.equal(request.url, "https://uploads.example/v3/files");
      return new Response(JSON.stringify({ data: { cid: "bafy-proxy-demo", name: "profile.json", size: 18, mime_type: "application/json" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const response = await handleStorageUploadRequest(
        new Request("https://worker.example/v1/storage/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "profile.json",
              contentBase64: btoa("storage proxy demo"),
              metadata: {
                module: "test",
                provider: "wrong",
                contentType: "text/plain",
                contentKind: "text",
              },
            }),
        }),
        makeEnv({
          PINATA_JWT: "pinata-jwt",
          PINATA_UPLOAD_URL: "https://uploads.example/v3/files",
          PINATA_GATEWAY_BASE_URL: "https://gateway.example",
        }),
      );
      const body = await response.json() as {
        providerId: string;
        pointer: string;
        contentHash: string;
        metadata: string;
      };
      const metadata = JSON.parse(body.metadata) as { gatewayUrl: string; module: string; provider: string; contentType: string; contentKind: string };
      assert.equal(response.status, 200);
      assert.equal(body.providerId, "pinata");
      assert.equal(body.pointer, "bafy-proxy-demo");
      assert.equal(body.contentHash, keccak256(stringToHex("storage proxy demo")));
      assert.equal(metadata.provider, "pinata");
      assert.equal(metadata.gatewayUrl, "https://gateway.example/ipfs/bafy-proxy-demo");
      assert.equal(metadata.contentType, "application/json");
      assert.equal(metadata.contentKind, "json");
      assert.equal(metadata.module, "test");
      assert.equal(calls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails clearly when Pinata credentials are not configured", async () => {
    await assert.rejects(
      () =>
        handleStorageUploadRequest(
          new Request("https://worker.example/v1/storage/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contentBase64: btoa("content") }),
          }),
          makeEnv(),
        ),
      /PINATA_JWT or PINATA_API_KEY\/PINATA_API_SECRET is not configured/,
    );
  });
});

describe("isRecordStalled", () => {
  it("marks old unresolved requests as stalled", () => {
    assert.equal(
      isRecordStalled(
        {
          requestId: ("0x" + "aa".repeat(32)) as `0x${string}`,
          txHash: ("0x" + "bb".repeat(32)) as `0x${string}`,
          rawTransaction: "0x1234",
          relayerNonce: 7,
          selector: "0x12345678",
          status: "submitted",
          broadcastAttempts: 1,
          createdAt: 1_000,
          updatedAt: 1_000,
          lastBroadcastAt: 2_000,
          reservedGasWei: "1",
          failureCode: null,
          failureMessage: null,
        },
        200_001,
        180_000,
      ),
      true,
    );
  });

  it("keeps fresh unresolved requests healthy", () => {
    assert.equal(
      isRecordStalled(
        {
          requestId: ("0x" + "aa".repeat(32)) as `0x${string}`,
          txHash: ("0x" + "bb".repeat(32)) as `0x${string}`,
          rawTransaction: "0x1234",
          relayerNonce: 7,
          selector: "0x12345678",
          status: "pending_broadcast",
          broadcastAttempts: 0,
          createdAt: 100_000,
          updatedAt: 100_000,
          lastBroadcastAt: 110_000,
          reservedGasWei: "1",
          failureCode: null,
          failureMessage: null,
        },
        200_000,
        180_000,
      ),
      false,
    );
  });
});
