// Copyright (C) 2026 Defa Wang

import {
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  isAddressEqual,
  isHex,
  keccak256,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

export const AEH_ABI = parseAbi([
  "function publish(string path,string providerId,string pointer,bytes32 contentHash,string metadata)",
  "function update(string path,string providerId,string pointer,bytes32 contentHash,string metadata)",
  "function remove(string path)",
  "function grantWriter(string domain,address writer)",
  "function revokeWriter(string domain,address writer)",
  "function submitToApp(bytes32 appId,bytes32 actionType,bytes payload)",
]);

export const AEL_ABI = AEH_ABI;

export const FORWARDER_ABI = parseAbi([
  "function verify((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) view returns (bool)",
  "function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) payable",
]);

const FORWARD_REQUEST_COMPONENTS = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "gas", type: "uint256" },
  { name: "deadline", type: "uint48" },
  { name: "data", type: "bytes" },
  { name: "signature", type: "bytes" },
] as const;

export const ALLOWED_SELECTORS = new Set<Hex>([
  toFunctionSelector("publish(string,string,string,bytes32,string)"),
  toFunctionSelector("update(string,string,string,bytes32,string)"),
  toFunctionSelector("remove(string)"),
  toFunctionSelector("grantWriter(string,address)"),
  toFunctionSelector("revokeWriter(string,address)"),
  toFunctionSelector("submitToApp(bytes32,bytes32,bytes)"),
]);

type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

interface StorageListLike<T> {
  keys(): IterableIterator<string>;
  values(): IterableIterator<T>;
}

type StorageLike = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean | void>;
  list<T>(options?: { prefix?: string }): Promise<StorageListLike<T>>;
};

interface Env {
  AEH_ADDRESS?: string;
  AEL_ADDRESS: string;
  FORWARDER_ADDRESS: string;
  ARBITRUM_SEPOLIA_RPC_URL: string;
  RELAYER_IDS: string;
  RELAY_CHAIN_ID?: string;
  MAX_DEADLINE_SECONDS?: string;
  MAX_GAS_LIMIT?: string;
  MAX_DAILY_REQUESTS?: string;
  MAX_DAILY_GAS_WEI?: string;
  MAX_WALLET_REQUESTS_PER_MINUTE?: string;
  MAX_WALLET_REQUESTS_PER_FIVE_MINUTES?: string;
  MAX_WALLET_REQUESTS_PER_HOUR?: string;
  MAX_WALLET_REQUESTS_PER_DAY?: string;
  MAX_WALLET_REQUESTS_PER_WEEK?: string;
  MAX_PATH_LENGTH?: string;
  MAX_PROVIDER_ID_LENGTH?: string;
  MAX_POINTER_LENGTH?: string;
  MAX_METADATA_LENGTH?: string;
  MAX_APP_PAYLOAD_BYTES?: string;
  PAYMENT_DEMO_APP_ID?: string;
  PAYMENT_DEMO_ACTION_INIT_SUPPLY?: string;
  PAYMENT_DEMO_ACTION_TRANSFER?: string;
  DEBOUNCE_TTL_MS?: string;
  RELAYER_RESERVE_FLOOR_WEI?: string;
  RELAYER_PENDING_TIMEOUT_MS?: string;
  RELAYER_MAX_BROADCAST_ATTEMPTS?: string;
  STORAGE_PROVIDER_ID?: string;
  STORAGE_MAX_UPLOAD_BYTES?: string;
  PINATA_JWT?: string;
  PINATA_API_KEY?: string;
  PINATA_API_SECRET?: string;
  PINATA_UPLOAD_URL?: string;
  PINATA_GATEWAY_BASE_URL?: string;
  API_KEY_SEED?: string;
  API_USAGE_MAX_UNITS_PER_HOUR?: string;
  API_USAGE_MAX_UNITS_PER_DAY?: string;
  API_USAGE_RELAY_BASE_UNITS?: string;
  API_USAGE_RELAY_GAS_UNIT_DIVISOR?: string;
  API_USAGE_STORAGE_BASE_UNITS?: string;
  API_USAGE_STORAGE_BYTES_PER_UNIT?: string;
  API_USAGE_STORAGE_UNIT_MULTIPLIER?: string;
  IP_RATE_LIMITER?: RateLimitBinding;
  WALLET_RATE_LIMITER?: RateLimitBinding;
  WALLET_LIMITER: DurableObjectNamespace;
  RELAY_DISPATCHER: DurableObjectNamespace;
  API_KEY_USAGE_LIMITER: DurableObjectNamespace;
  [key: string]: unknown;
}

type RelayRequestBody = {
  request: {
    from: Address;
    to: Address;
    value: string;
    gas: string;
    deadline: string;
    data: Hex;
  };
  signature: Hex;
};

type ForwardRequest = {
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  deadline: number;
  data: Hex;
  signature: Hex;
};

type ValidatedRelayRequest = {
  request: ForwardRequest;
  requestId: Hex;
  selector: Hex;
};

type DispatchRequest = {
  relayerId: string;
  request: {
    from: Address;
    to: Address;
    value: string;
    gas: string;
    deadline: string;
    data: Hex;
    signature: Hex;
  };
  requestId: Hex;
  selector: Hex;
};

type RelayStatus =
  | "pending_broadcast"
  | "submitted"
  | "confirmed"
  | "reverted"
  | "failed"
  | "stalled";

type RelayErrorCode =
  | "REQUEST_INVALID"
  | "FORWARD_REQUEST_INVALID"
  | "RATE_LIMITED"
  | "RELAYER_BALANCE_TOO_LOW"
  | "RELAYER_NONCE_STALLED"
  | "RELAYER_BUDGET_EXCEEDED"
  | "RELAYER_BROADCAST_FAILED"
  | "RELAYER_POOL_EXHAUSTED"
  | "RPC_UNAVAILABLE"
  | "API_KEY_INVALID"
  | "API_KEY_USAGE_EXCEEDED"
  | "STORAGE_UPLOAD_FAILED"
  | "INTERNAL_ERROR";

type RequestRecord = {
  requestId: Hex;
  txHash: Hex;
  rawTransaction: Hex;
  relayerNonce: number;
  selector: Hex;
  status: RelayStatus;
  broadcastAttempts: number;
  createdAt: number;
  updatedAt: number;
  lastBroadcastAt: number | null;
  reservedGasWei: string;
  failureCode: RelayErrorCode | null;
  failureMessage: string | null;
};

type RelayResponse = {
  relayerId?: string;
  requestId: Hex;
  transactionHash: Hex;
  status: RelayStatus;
  relayerNonce: number;
  code?: RelayErrorCode;
  message?: string;
};

type BudgetState = {
  dayBucket: string;
  acceptedRequests: number;
  reservedGasWei: string;
};

type RelayerState = {
  relayerId: string;
  relayerAddress: Address;
  storedNextNonce: number;
  latestObservedPendingNonce: number;
  status: "healthy" | "low_balance" | "stalled" | "unavailable";
  stalledSince: number | null;
  lastHealthyAt: number | null;
};

type RelayerConfig = {
  id: string;
  privateKey: Hex;
  address: Address;
};

type RelayerAvailability = {
  relayerId: string;
  relayerAddress: Address;
  available: boolean;
  status: RelayerState["status"];
  code?: RelayErrorCode;
  message?: string;
};

type RelayConfig = {
  aehAddress: Address;
  forwarderAddress: Address;
  rpcUrl: string;
  relayers: RelayerConfig[];
  chainId: bigint;
  maxDeadlineSeconds: bigint;
  maxGasLimit: bigint;
  maxDailyRequests: number;
  maxDailyGasWei: bigint;
  walletRequestsPerFiveMinutes: number;
  walletRequestsPerHour: number;
  walletRequestsPerDay: number;
  walletRequestsPerWeek: number;
  maxPathLength: number;
  maxProviderIdLength: number;
  maxPointerLength: number;
  maxMetadataLength: number;
  maxAppPayloadBytes: number;
  paymentDemoAppId: Hex;
  paymentDemoActionInitSupply: Hex;
  paymentDemoActionTransfer: Hex;
  relayerReserveFloorWei: bigint;
  relayerPendingTimeoutMs: number;
  relayerMaxBroadcastAttempts: number;
  debounceTtlMs: number;
};

type RelayPublicClient = ReturnType<typeof makePublicClient>;

type RelayFeeConfig = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

type StorageUploadRequestBody = {
  name?: string;
  contentBase64: string;
  contentType?: string;
  metadata?: Record<string, unknown>;
};

type StorageUploadResponse = {
  providerId: string;
  pointer: string;
  contentHash: Hex;
  metadata: string;
};

type ApiKeyIdentity = {
  keyId: string;
};

type ApiUsageConfig = {
  maxUnitsPerHour: number;
  maxUnitsPerDay: number;
  relayBaseUnits: number;
  relayGasUnitDivisor: bigint;
  storageBaseUnits: number;
  storageBytesPerUnit: number;
  storageUnitMultiplier: number;
};

type ApiUsageReserveRequest = {
  keyId: string;
  units: number;
  nowMs: number;
  reason: "relay" | "storage";
};

type ApiUsageReserveResponse = {
  ok: boolean;
  keyId: string;
  units: number;
  bucket?: string;
  limit?: number;
  used?: number;
  retryAfterSeconds?: number;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const RELAYER_STATE_KEY = "relayer:state";
const RELAYER_NEXT_NONCE_KEY = "relayer:nextNonce";

class RelayError extends Error {
  code: RelayErrorCode;
  status: number;
  details?: Record<string, unknown>;

  constructor(code: RelayErrorCode, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ status: "ok" });
      }

      if (request.method === "GET" && url.pathname === "/status") {
        return await handlePublicStatusRequest(request, env);
      }

      if (request.method === "POST" && url.pathname === "/v1/relay") {
        const apiKey = await requireApiKey(request, env);
        return await handleRelayRequest(request, env, apiKey);
      }

      if (request.method === "GET" && url.pathname.startsWith("/v1/relay/")) {
        await requireApiKey(request, env);
        return await handleRelayStatusRequest(request, env);
      }

      if (request.method === "POST" && url.pathname === "/v1/storage/upload") {
        const apiKey = await requireApiKey(request, env);
        return await handleStorageUploadRequest(request, env, apiKey);
      }

      return errorResponse(new RelayError("REQUEST_INVALID", "Not found", 404));
    } catch (error) {
      return errorResponse(normalizeError(error));
    }
  },
};

export class WalletLimiter implements DurableObject {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== "POST") {
        throw new RelayError("REQUEST_INVALID", "Method not allowed", 405);
      }

      const body = (await request.json()) as { requestId: Hex; nowMs: number };
      const config = parseConfig(this.env);
      const storage = this.ctx.storage as StorageLike;
      const debounceKey = `debounce:${body.requestId.toLowerCase()}`;
      const debounce = await storage.get<{ firstSeenAt: number; lastSeenAt: number; hitCount: number }>(debounceKey);
      if (debounce && body.nowMs - debounce.lastSeenAt <= config.debounceTtlMs) {
        await storage.put(debounceKey, {
          firstSeenAt: debounce.firstSeenAt,
          lastSeenAt: body.nowMs,
          hitCount: debounce.hitCount + 1,
        });
        return json({ ok: true, duplicate: true });
      }

      await enforceFixedWindow(storage, "five-minute", body.nowMs, 5 * 60_000, config.walletRequestsPerFiveMinutes);
      await enforceFixedWindow(storage, "hour", body.nowMs, 60 * 60_000, config.walletRequestsPerHour);
      await enforceFixedWindow(storage, "day", body.nowMs, 24 * 60 * 60_000, config.walletRequestsPerDay);
      await enforceFixedWindow(storage, "week", body.nowMs, 7 * 24 * 60 * 60_000, config.walletRequestsPerWeek);

      await storage.put(debounceKey, {
        firstSeenAt: body.nowMs,
        lastSeenAt: body.nowMs,
        hitCount: 1,
      });

      return json({ ok: true });
    } catch (error) {
      return errorResponse(normalizeError(error));
    }
  }
}

export class ApiKeyUsageLimiter implements DurableObject {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== "POST") {
        throw new RelayError("REQUEST_INVALID", "Method not allowed", 405);
      }

      const body = (await request.json()) as ApiUsageReserveRequest;
      if (!body.keyId || !Number.isSafeInteger(body.units) || body.units < 0) {
        throw new RelayError("REQUEST_INVALID", "Invalid API usage request", 400);
      }

      const config = parseApiUsageConfig(this.env);
      const storage = this.ctx.storage as StorageLike;
      await reserveApiUsageWindow(storage, body, "hour", 60 * 60_000, config.maxUnitsPerHour);
      await reserveApiUsageWindow(storage, body, "day", 24 * 60 * 60_000, config.maxUnitsPerDay);
      return json({
        ok: true,
        keyId: body.keyId,
        units: body.units,
      } satisfies ApiUsageReserveResponse);
    } catch (error) {
      return errorResponse(normalizeError(error));
    }
  }
}

export class RelayDispatcher implements DurableObject {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname.startsWith("/availability/")) {
        const relayerId = url.pathname.split("/").pop();
        if (!relayerId) {
          throw new RelayError("REQUEST_INVALID", "Missing relayer id", 400);
        }
        return await this.handleAvailability(relayerId);
      }

      if (request.method === "POST" && url.pathname === "/submit") {
        return await this.handleSubmit((await request.json()) as DispatchRequest);
      }

      if (request.method === "GET" && url.pathname.startsWith("/status/")) {
        const requestId = url.pathname.split("/").pop();
        if (!requestId || !isHex(requestId)) {
          throw new RelayError("REQUEST_INVALID", "Invalid request id", 400);
        }
        return await this.handleStatus(requestId as Hex);
      }

      throw new RelayError("REQUEST_INVALID", "Not found", 404);
    } catch (error) {
      return errorResponse(normalizeError(error));
    }
  }

  private async handleSubmit(dispatch: DispatchRequest): Promise<Response> {
    const config = parseConfig(this.env);
    const storage = this.ctx.storage as StorageLike;
    const relayerConfig = getRelayerConfig(config, dispatch.relayerId);
    const relayRequest = deserializeDispatchRequest(dispatch);
    const existing = await storage.get<RequestRecord>(requestStorageKey(dispatch.requestId));
    if (existing) {
      return json(toRelayResponse(existing, dispatch.relayerId));
    }

    const publicClient = makePublicClient(config);
    const relayer = privateKeyToAccount(relayerConfig.privateKey);
    const now = Date.now();
    const stalled = await findStalledRecord(storage, now, config.relayerPendingTimeoutMs);
    if (stalled) {
      await saveRelayerState(storage, {
        relayerId: dispatch.relayerId,
        relayerAddress: relayer.address,
        storedNextNonce: stalled.relayerNonce,
        latestObservedPendingNonce: stalled.relayerNonce,
        status: "stalled",
        stalledSince: stalled.lastBroadcastAt ?? stalled.createdAt,
        lastHealthyAt: null,
      });
      throw new RelayError("RELAYER_NONCE_STALLED", "Relayer nonce lane is stalled", 503, {
        blockingRequestId: stalled.requestId,
        relayerNonce: stalled.relayerNonce,
      });
    }

    const isValid = await rpcGuard(
      () =>
        publicClient.readContract({
          address: config.forwarderAddress,
          abi: FORWARDER_ABI,
          functionName: "verify",
          args: [relayRequest],
        }),
      "Failed to verify forward request",
    );
    if (!isValid) {
      throw new RelayError("FORWARD_REQUEST_INVALID", "Forward request is not valid", 422);
    }

    const rpcPendingNonce = await rpcGuard(
      () =>
        publicClient.getTransactionCount({
          address: relayer.address,
          blockTag: "pending",
        }),
      "Failed to load relayer pending nonce",
    );
    const storedNextNonce = (await storage.get<number>(RELAYER_NEXT_NONCE_KEY)) ?? rpcPendingNonce;
    const relayerNonce = Math.max(storedNextNonce, rpcPendingNonce);

    const executeData = encodeFunctionData({
      abi: FORWARDER_ABI,
      functionName: "execute",
      args: [relayRequest],
    });
    const fees = await estimateRelayFees(publicClient);
    const estimatedGas = await rpcGuard(
      () =>
        publicClient.estimateGas({
          account: relayer.address,
          to: config.forwarderAddress,
          data: executeData,
          value: 0n,
        }),
      "Failed to estimate relay gas",
    );
    if (estimatedGas > config.maxGasLimit) {
      throw new RelayError("FORWARD_REQUEST_INVALID", "Estimated gas exceeds relay limit", 422, {
        estimatedGas: estimatedGas.toString(),
        maxGasLimit: config.maxGasLimit.toString(),
      });
    }

    const gasWithBuffer = estimatedGas + estimatedGas / 5n + 25_000n;
    const reservedGasWei = gasWithBuffer * fees.maxFeePerGas;
    await this.reserveDailyBudget(storage, config, reservedGasWei);

    const balance = await rpcGuard(
      () => publicClient.getBalance({ address: relayer.address }),
      "Failed to load relayer balance",
    );
    if (balance < reservedGasWei + config.relayerReserveFloorWei) {
      await saveRelayerState(storage, {
        relayerId: dispatch.relayerId,
        relayerAddress: relayer.address,
        storedNextNonce: relayerNonce,
        latestObservedPendingNonce: rpcPendingNonce,
        status: "low_balance",
        stalledSince: null,
        lastHealthyAt: null,
      });
      throw new RelayError("RELAYER_BALANCE_TOO_LOW", "Relayer balance is below the configured reserve floor", 503, {
        relayerAddress: relayer.address,
        requiredWei: (reservedGasWei + config.relayerReserveFloorWei).toString(),
        actualWei: balance.toString(),
      });
    }

    const rawTransaction = await relayer.signTransaction({
      chainId: arbitrumSepolia.id,
      nonce: relayerNonce,
      gas: gasWithBuffer,
      type: "eip1559",
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      to: config.forwarderAddress,
      data: executeData,
      value: 0n,
    });
    const txHash = keccak256(rawTransaction);
    const record: RequestRecord = {
      requestId: dispatch.requestId,
      txHash,
      rawTransaction,
      relayerNonce,
      selector: dispatch.selector,
      status: "pending_broadcast",
      broadcastAttempts: 0,
      createdAt: now,
      updatedAt: now,
      lastBroadcastAt: null,
      reservedGasWei: reservedGasWei.toString(),
      failureCode: null,
      failureMessage: null,
    };

    await storage.put(RELAYER_NEXT_NONCE_KEY, relayerNonce + 1);
    await storage.put(requestStorageKey(dispatch.requestId), record);

    try {
      await publicClient.sendRawTransaction({ serializedTransaction: rawTransaction });
      record.status = "submitted";
      record.broadcastAttempts += 1;
      record.updatedAt = Date.now();
      record.lastBroadcastAt = record.updatedAt;
      await storage.put(requestStorageKey(dispatch.requestId), record);
      await saveRelayerState(storage, {
        relayerId: dispatch.relayerId,
        relayerAddress: relayer.address,
        storedNextNonce: relayerNonce + 1,
        latestObservedPendingNonce: rpcPendingNonce,
        status: "healthy",
        stalledSince: null,
        lastHealthyAt: record.updatedAt,
      });
      return json(toRelayResponse(record, dispatch.relayerId));
    } catch (error) {
      const relayError = new RelayError(
        "RELAYER_BROADCAST_FAILED",
        error instanceof Error ? error.message : "Broadcast failed",
        503,
        { requestId: dispatch.requestId, transactionHash: txHash, relayerNonce },
      );
      record.failureCode = relayError.code;
      record.failureMessage = relayError.message;
      record.updatedAt = Date.now();
      await storage.put(requestStorageKey(dispatch.requestId), record);
      await saveRelayerState(storage, {
        relayerId: dispatch.relayerId,
        relayerAddress: relayer.address,
        storedNextNonce: relayerNonce + 1,
        latestObservedPendingNonce: rpcPendingNonce,
        status: "unavailable",
        stalledSince: null,
        lastHealthyAt: null,
      });
      return errorResponse(relayError);
    }
  }

  private async handleStatus(requestId: Hex): Promise<Response> {
    const config = parseConfig(this.env);
    const storage = this.ctx.storage as StorageLike;
    const record = await storage.get<RequestRecord>(requestStorageKey(requestId));
    const relayerState = await storage.get<RelayerState>(RELAYER_STATE_KEY);
    if (!record) {
      throw new RelayError("REQUEST_INVALID", "Unknown request id", 404);
    }

    if (record.status === "confirmed" || record.status === "reverted" || record.status === "failed" || record.status === "stalled") {
      return json(toRelayResponse(record, relayerState?.relayerId));
    }

    const publicClient = makePublicClient(config);
    const receipt = await publicClient.getTransactionReceipt({ hash: record.txHash }).catch(() => null);
    if (!receipt) {
      if (record.status === "pending_broadcast" && record.broadcastAttempts < config.relayerMaxBroadcastAttempts) {
        try {
          await publicClient.sendRawTransaction({ serializedTransaction: record.rawTransaction });
          record.broadcastAttempts += 1;
          record.status = "submitted";
          record.updatedAt = Date.now();
          record.lastBroadcastAt = record.updatedAt;
          record.failureCode = null;
          record.failureMessage = null;
          await storage.put(requestStorageKey(requestId), record);
        } catch (error) {
          record.failureCode = "RELAYER_BROADCAST_FAILED";
          record.failureMessage = error instanceof Error ? error.message : "Broadcast failed";
          record.updatedAt = Date.now();
          await storage.put(requestStorageKey(requestId), record);
        }
      }

      if (isRecordStalled(record, Date.now(), config.relayerPendingTimeoutMs)) {
        record.status = "stalled";
        record.failureCode = "RELAYER_NONCE_STALLED";
        record.failureMessage = "Relayer nonce lane is stalled";
        record.updatedAt = Date.now();
        await storage.put(requestStorageKey(requestId), record);
      }

      return json(toRelayResponse(record, relayerState?.relayerId));
    }

    record.status = receipt.status === "success" ? "confirmed" : "reverted";
    record.failureCode = null;
    record.failureMessage = null;
    record.updatedAt = Date.now();
    await storage.put(requestStorageKey(requestId), record);
    return json(toRelayResponse(record, relayerState?.relayerId));
  }

  private async handleAvailability(relayerId: string): Promise<Response> {
    const config = parseConfig(this.env);
    const storage = this.ctx.storage as StorageLike;
    const relayerConfig = getRelayerConfig(config, relayerId);
    const publicClient = makePublicClient(config);
    const relayer = privateKeyToAccount(relayerConfig.privateKey);
    const now = Date.now();
    const stalled = await findStalledRecord(storage, now, config.relayerPendingTimeoutMs);

    if (stalled) {
      const state: RelayerState = {
        relayerId,
        relayerAddress: relayer.address,
        storedNextNonce: stalled.relayerNonce,
        latestObservedPendingNonce: stalled.relayerNonce,
        status: "stalled",
        stalledSince: stalled.lastBroadcastAt ?? stalled.createdAt,
        lastHealthyAt: null,
      };
      await saveRelayerState(storage, state);
      return json({
        relayerId,
        relayerAddress: relayer.address,
        available: false,
        status: "stalled",
        code: "RELAYER_NONCE_STALLED",
        message: "Relayer nonce lane is stalled",
      } satisfies RelayerAvailability, 503);
    }

    try {
      const rpcPendingNonce = await publicClient.getTransactionCount({
        address: relayer.address,
        blockTag: "pending",
      });
      const balance = await publicClient.getBalance({ address: relayer.address });
      const status: RelayerState["status"] = balance < config.relayerReserveFloorWei ? "low_balance" : "healthy";
      await saveRelayerState(storage, {
        relayerId,
        relayerAddress: relayer.address,
        storedNextNonce: (await storage.get<number>(RELAYER_NEXT_NONCE_KEY)) ?? rpcPendingNonce,
        latestObservedPendingNonce: rpcPendingNonce,
        status,
        stalledSince: null,
        lastHealthyAt: status === "healthy" ? now : null,
      });
      return json({
        relayerId,
        relayerAddress: relayer.address,
        available: status === "healthy",
        status,
        ...(status === "low_balance"
          ? {
              code: "RELAYER_BALANCE_TOO_LOW" as RelayErrorCode,
              message: "Relayer balance is below the configured reserve floor",
            }
          : {}),
      } satisfies RelayerAvailability, status === "healthy" ? 200 : 503);
    } catch (error) {
      const message = error instanceof Error ? error.message : "RPC unavailable";
      await saveRelayerState(storage, {
        relayerId,
        relayerAddress: relayer.address,
        storedNextNonce: (await storage.get<number>(RELAYER_NEXT_NONCE_KEY)) ?? 0,
        latestObservedPendingNonce: 0,
        status: "unavailable",
        stalledSince: null,
        lastHealthyAt: null,
      });
      return json({
        relayerId,
        relayerAddress: relayer.address,
        available: false,
        status: "unavailable",
        code: "RPC_UNAVAILABLE",
        message,
      } satisfies RelayerAvailability, 503);
    }
  }

  private async reserveDailyBudget(storage: StorageLike, config: RelayConfig, reservedGasWei: bigint): Promise<void> {
    const dayBucket = new Date().toISOString().slice(0, 10);
    const key = `budget:${dayBucket}`;
    const existing = (await storage.get<BudgetState>(key)) ?? {
      dayBucket,
      acceptedRequests: 0,
      reservedGasWei: "0",
    };

    if (existing.acceptedRequests + 1 > config.maxDailyRequests) {
      throw new RelayError("RELAYER_BUDGET_EXCEEDED", "Daily relay request budget exceeded", 429);
    }

    const updatedReserved = BigInt(existing.reservedGasWei) + reservedGasWei;
    if (updatedReserved > config.maxDailyGasWei) {
      throw new RelayError("RELAYER_BUDGET_EXCEEDED", "Daily relay gas budget exceeded", 429);
    }

    await storage.put(key, {
      dayBucket,
      acceptedRequests: existing.acceptedRequests + 1,
      reservedGasWei: updatedReserved.toString(),
    } satisfies BudgetState);
  }
}

async function handleRelayRequest(request: Request, env: Env, apiKey: ApiKeyIdentity): Promise<Response> {
  if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 32_768) {
    throw new RelayError("REQUEST_INVALID", "Request body too large", 413);
  }

  let body: RelayRequestBody;
  try {
    body = (await request.json()) as RelayRequestBody;
  } catch {
    throw new RelayError("REQUEST_INVALID", "Request body must be valid JSON", 400);
  }

  const config = parseConfig(env);
  const validated = validateRelayPayload(body, config);
  await reserveApiUsage(env, apiKey, relayUsageUnits(validated.request.gas, parseApiUsageConfig(env)), "relay");

  if (env.IP_RATE_LIMITER) {
    const ipKey = request.headers.get("cf-connecting-ip") ?? "unknown";
    const result = await env.IP_RATE_LIMITER.limit({ key: ipKey });
    if (!result.success) {
      throw new RelayError("RATE_LIMITED", "IP rate limit exceeded", 429);
    }
  }

  if (env.WALLET_RATE_LIMITER) {
    const result = await env.WALLET_RATE_LIMITER.limit({ key: validated.request.from.toLowerCase() });
    if (!result.success) {
      throw new RelayError("RATE_LIMITED", "Wallet edge rate limit exceeded", 429);
    }
  }

  const walletLimiter = env.WALLET_LIMITER.getByName(validated.request.from.toLowerCase());
  const walletResponse = await walletLimiter.fetch("https://wallet-limiter/check", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      requestId: validated.requestId,
      nowMs: Date.now(),
    }),
  });
  if (!walletResponse.ok) {
    return walletResponse;
  }

  const publicClient = makePublicClient(config);
  const isValid = await rpcGuard(
    () =>
      publicClient.readContract({
        address: config.forwarderAddress,
        abi: FORWARDER_ABI,
        functionName: "verify",
        args: [validated.request],
      }),
    "Failed to verify forward request",
  );
  if (!isValid) {
    throw new RelayError("FORWARD_REQUEST_INVALID", "Forward request is not valid", 422);
  }

  const relayerOrder = chooseRelayerOrder(validated.requestId, config.relayers.map((relayer) => relayer.id));
  for (const relayerId of relayerOrder) {
    const dispatcher = env.RELAY_DISPATCHER.getByName(relayerId);
    const availabilityResponse = await dispatcher.fetch(`https://relay-dispatcher/availability/${relayerId}`);
    const availability = (await availabilityResponse.json()) as RelayerAvailability;
    if (!availability.available) {
      continue;
    }

    return dispatcher.fetch("https://relay-dispatcher/submit", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        relayerId,
        request: {
          from: validated.request.from,
          to: validated.request.to,
          value: validated.request.value.toString(),
          gas: validated.request.gas.toString(),
          deadline: validated.request.deadline.toString(),
          data: validated.request.data,
          signature: validated.request.signature,
        },
        requestId: validated.requestId,
        selector: validated.selector,
      }),
    });
  }

  throw new RelayError("RELAYER_POOL_EXHAUSTED", "No healthy relayer is currently available", 503);
}

export async function handleStorageUploadRequest(request: Request, env: Env, apiKey?: ApiKeyIdentity): Promise<Response> {
  const maxUploadBytes = Number(env.STORAGE_MAX_UPLOAD_BYTES ?? "4194304");
  if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > maxUploadBytes * 2) {
    throw new RelayError("REQUEST_INVALID", "Storage upload request body too large", 413);
  }

  let body: StorageUploadRequestBody;
  try {
    body = (await request.json()) as StorageUploadRequestBody;
  } catch {
    throw new RelayError("REQUEST_INVALID", "Storage upload body must be valid JSON", 400);
  }

  if (!body.contentBase64) {
    throw new RelayError("REQUEST_INVALID", "contentBase64 is required", 400);
  }
  const bytes = base64ToBytes(body.contentBase64);
  if (bytes.byteLength > maxUploadBytes) {
    throw new RelayError("REQUEST_INVALID", "Storage upload exceeds configured maximum size", 413, {
      maxUploadBytes,
      actualBytes: bytes.byteLength,
    });
  }
  if (apiKey) {
    await reserveApiUsage(env, apiKey, storageUsageUnits(bytes.byteLength, parseApiUsageConfig(env)), "storage");
  }

  const providerId = String(env.STORAGE_PROVIDER_ID ?? "pinata");
  if (providerId !== "pinata") {
    throw new RelayError("REQUEST_INVALID", `Unsupported storage provider: ${providerId}`, 500);
  }

  if (!pinataAuthHeaders(env)) {
    throw new RelayError("STORAGE_UPLOAD_FAILED", "PINATA_JWT or PINATA_API_KEY/PINATA_API_SECRET is not configured", 500);
  }

  const result = await uploadToPinata(bytes, body, env);
  const contentHash = keccak256(bytesToHex(bytes));
  const contentType = normalizeContentType(body.contentType ?? result.mimeType, body.name ?? result.name);
  return json({
    providerId,
    pointer: result.cid,
    contentHash,
    metadata: JSON.stringify({
      ...userStorageMetadata(body.metadata),
      provider: providerId,
      cid: result.cid,
      gatewayUrl: `${pinataGatewayBaseUrl(env)}/ipfs/${result.cid}`,
      name: body.name ?? result.name,
      contentType,
      contentKind: resolveContentKind(contentType),
      size: result.size ?? bytes.byteLength,
    }),
  } satisfies StorageUploadResponse);
}

async function handleRelayStatusRequest(request: Request, env: Env): Promise<Response> {
  const requestId = new URL(request.url).pathname.split("/").pop();
  if (!requestId || !isHex(requestId)) {
    throw new RelayError("REQUEST_INVALID", "Invalid request id", 400);
  }

  const config = parseConfig(env);
  for (const relayer of config.relayers) {
    const dispatcher = env.RELAY_DISPATCHER.getByName(relayer.id);
    const response = await dispatcher.fetch(`https://relay-dispatcher/status/${requestId}`);
    if (response.status !== 404) {
      return response;
    }
  }

  throw new RelayError("REQUEST_INVALID", "Unknown request id", 404);
}

async function handlePublicStatusRequest(request: Request, env: Env): Promise<Response> {
  const config = parseConfig(env);
  const publicClient = makePublicClient(config);
  const url = new URL(request.url);
  const accounts = await Promise.all(
    config.relayers.map(async (relayer, index) => {
      try {
        const balance = await publicClient.getBalance({ address: relayer.address });
        return {
          name: `account ${index + 1}`,
          balance: balance >= config.relayerReserveFloorWei ? "sufficient" : "insufficient",
        };
      } catch {
        return {
          name: `account ${index + 1}`,
          balance: "insufficient",
        };
      }
    }),
  );

  if (url.searchParams.get("format") === "json") {
    return json({
      status: "ok",
      accounts,
    });
  }

  const rows = accounts
    .map(
      (account) =>
        `<tr><td>${escapeHtml(account.name)}</td><td class="${account.balance}">${account.balance}</td></tr>`,
    )
    .join("");
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Storail Relay Status</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
    main { width: min(520px, calc(100vw - 32px)); }
    h1 { font-size: 20px; margin: 0 0 16px; font-weight: 650; }
    table { width: 100%; border-collapse: collapse; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); }
    th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
    th { font-size: 13px; font-weight: 650; }
    td { font-size: 15px; }
    tr:last-child td { border-bottom: 0; }
    .sufficient { color: #047857; font-weight: 650; }
    .insufficient { color: #b91c1c; font-weight: 650; }
  </style>
</head>
<body>
  <main>
    <h1>Storail Relay Status</h1>
    <table>
      <thead><tr><th>Account</th><th>Balance</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export function validateRelayPayload(body: RelayRequestBody, config: RelayConfig): ValidatedRelayRequest {
  if (!body || typeof body !== "object" || !body.request || typeof body.signature !== "string") {
    throw new RelayError("REQUEST_INVALID", "Invalid request body", 400);
  }

  const forwardRequest: ForwardRequest = {
    from: getAddress(body.request.from),
    to: getAddress(body.request.to),
    value: parseUnsigned(body.request.value, "value"),
    gas: parseUnsigned(body.request.gas, "gas"),
    deadline: parseUint48(body.request.deadline, "deadline"),
    data: requireHex(body.request.data, "data"),
    signature: requireHex(body.signature, "signature"),
  };

  if (!isAddressEqual(forwardRequest.to, config.aehAddress)) {
    throw new RelayError("REQUEST_INVALID", "Target contract is not allowed", 400);
  }
  if (forwardRequest.value !== 0n) {
    throw new RelayError("REQUEST_INVALID", "Native value is not supported", 400);
  }
  if (forwardRequest.gas > config.maxGasLimit) {
    throw new RelayError("REQUEST_INVALID", "Requested gas exceeds configured limit", 400);
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(forwardRequest.deadline) <= nowSeconds) {
    throw new RelayError("REQUEST_INVALID", "Relay request is expired", 400);
  }
  if (BigInt(forwardRequest.deadline) > nowSeconds + config.maxDeadlineSeconds) {
    throw new RelayError("REQUEST_INVALID", "Relay deadline exceeds configured maximum", 400);
  }

  const selector = forwardRequest.data.slice(0, 10).toLowerCase() as Hex;
  if (!ALLOWED_SELECTORS.has(selector)) {
    throw new RelayError("REQUEST_INVALID", "Function selector is not allowed", 400);
  }

  const decoded = decodeFunctionData({ abi: AEH_ABI, data: forwardRequest.data });
  validateDecodedArgs(decoded.functionName, decoded.args ?? [], config);

  const requestId = keccak256(
    encodeAbiParameters(
      [{ type: "tuple", components: FORWARD_REQUEST_COMPONENTS }],
      [forwardRequest],
    ),
  );

  return { request: forwardRequest, requestId, selector };
}

function validateDecodedArgs(functionName: string, args: readonly unknown[], config: RelayConfig): void {
  if ((functionName === "publish" || functionName === "update") && typeof args[0] === "string" && args[0].length > config.maxPathLength) {
    throw new RelayError("REQUEST_INVALID", "Path exceeds configured maximum length", 400);
  }
  if ((functionName === "publish" || functionName === "update") && typeof args[1] === "string" && args[1].length > config.maxProviderIdLength) {
    throw new RelayError("REQUEST_INVALID", "providerId exceeds configured maximum length", 400);
  }
  if ((functionName === "publish" || functionName === "update") && typeof args[2] === "string" && args[2].length > config.maxPointerLength) {
    throw new RelayError("REQUEST_INVALID", "pointer exceeds configured maximum length", 400);
  }
  if ((functionName === "publish" || functionName === "update") && typeof args[4] === "string" && args[4].length > config.maxMetadataLength) {
    throw new RelayError("REQUEST_INVALID", "metadata exceeds configured maximum length", 400);
  }
  if (functionName === "remove" && typeof args[0] === "string" && args[0].length > config.maxPathLength) {
    throw new RelayError("REQUEST_INVALID", "Path exceeds configured maximum length", 400);
  }
  if ((functionName === "grantWriter" || functionName === "revokeWriter") && typeof args[0] === "string" && args[0].length > config.maxPathLength) {
    throw new RelayError("REQUEST_INVALID", "Domain exceeds configured maximum length", 400);
  }
  if (functionName === "submitToApp") {
    validateSubmitToAppArgs(args, config);
  }
}

function validateSubmitToAppArgs(args: readonly unknown[], config: RelayConfig): void {
  const appId = normalizeBytes32(args[0], "appId");
  const actionType = normalizeBytes32(args[1], "actionType");
  const payload = requireHex(String(args[2] ?? ""), "payload");

  if (appId.toLowerCase() !== config.paymentDemoAppId.toLowerCase()) {
    throw new RelayError("REQUEST_INVALID", "Application is not allowed", 400);
  }
  if (
    actionType.toLowerCase() !== config.paymentDemoActionInitSupply.toLowerCase() &&
    actionType.toLowerCase() !== config.paymentDemoActionTransfer.toLowerCase()
  ) {
    throw new RelayError("REQUEST_INVALID", "Application action is not allowed", 400);
  }
  if ((payload.length - 2) / 2 > config.maxAppPayloadBytes) {
    throw new RelayError("REQUEST_INVALID", "Application payload exceeds configured maximum length", 400);
  }
}

export function parseConfig(env: Env): RelayConfig {
  const relayerIds = parseRelayerIds(env.RELAYER_IDS);
  return {
    aehAddress: getAddress(env.AEH_ADDRESS ?? env.AEL_ADDRESS),
    forwarderAddress: getAddress(env.FORWARDER_ADDRESS),
    rpcUrl: env.ARBITRUM_SEPOLIA_RPC_URL,
    relayers: relayerIds.map((relayerId) => {
      const privateKey = parsePrivateKey(
        String(env[buildRelayerSecretName(relayerId)] ?? ""),
        buildRelayerSecretName(relayerId),
      );
      const address = privateKeyToAccount(privateKey).address;
      return { id: relayerId, privateKey, address };
    }),
    chainId: BigInt(env.RELAY_CHAIN_ID ?? "421614"),
    maxDeadlineSeconds: BigInt(env.MAX_DEADLINE_SECONDS ?? "300"),
    maxGasLimit: BigInt(env.MAX_GAS_LIMIT ?? "600000"),
    maxDailyRequests: Number(env.MAX_DAILY_REQUESTS ?? "1000"),
    maxDailyGasWei: BigInt(env.MAX_DAILY_GAS_WEI ?? "100000000000000000"),
    walletRequestsPerFiveMinutes: Number(env.MAX_WALLET_REQUESTS_PER_FIVE_MINUTES ?? "10"),
    walletRequestsPerHour: Number(env.MAX_WALLET_REQUESTS_PER_HOUR ?? "20"),
    walletRequestsPerDay: Number(env.MAX_WALLET_REQUESTS_PER_DAY ?? "50"),
    walletRequestsPerWeek: Number(env.MAX_WALLET_REQUESTS_PER_WEEK ?? "100"),
    maxPathLength: Number(env.MAX_PATH_LENGTH ?? "512"),
    maxProviderIdLength: Number(env.MAX_PROVIDER_ID_LENGTH ?? "64"),
    maxPointerLength: Number(env.MAX_POINTER_LENGTH ?? "512"),
    maxMetadataLength: Number(env.MAX_METADATA_LENGTH ?? "2048"),
    maxAppPayloadBytes: Number(env.MAX_APP_PAYLOAD_BYTES ?? "256"),
    paymentDemoAppId: parseBytes32(env.PAYMENT_DEMO_APP_ID ?? keccak256String("payment-demo-app"), "PAYMENT_DEMO_APP_ID"),
    paymentDemoActionInitSupply: parseBytes32(
      env.PAYMENT_DEMO_ACTION_INIT_SUPPLY ?? keccak256String("InitSupply"),
      "PAYMENT_DEMO_ACTION_INIT_SUPPLY",
    ),
    paymentDemoActionTransfer: parseBytes32(
      env.PAYMENT_DEMO_ACTION_TRANSFER ?? keccak256String("Transfer"),
      "PAYMENT_DEMO_ACTION_TRANSFER",
    ),
    relayerReserveFloorWei: BigInt(env.RELAYER_RESERVE_FLOOR_WEI ?? "5000000000000000"),
    relayerPendingTimeoutMs: Number(env.RELAYER_PENDING_TIMEOUT_MS ?? "180000"),
    relayerMaxBroadcastAttempts: Number(env.RELAYER_MAX_BROADCAST_ATTEMPTS ?? "3"),
    debounceTtlMs: Number(env.DEBOUNCE_TTL_MS ?? "60000"),
  };
}

function parseApiUsageConfig(env: Env): ApiUsageConfig {
  return {
    maxUnitsPerHour: Number(env.API_USAGE_MAX_UNITS_PER_HOUR ?? "5000"),
    maxUnitsPerDay: Number(env.API_USAGE_MAX_UNITS_PER_DAY ?? "50000"),
    relayBaseUnits: Number(env.API_USAGE_RELAY_BASE_UNITS ?? "10"),
    relayGasUnitDivisor: BigInt(env.API_USAGE_RELAY_GAS_UNIT_DIVISOR ?? "100000"),
    storageBaseUnits: Number(env.API_USAGE_STORAGE_BASE_UNITS ?? "100"),
    storageBytesPerUnit: Number(env.API_USAGE_STORAGE_BYTES_PER_UNIT ?? "1024"),
    storageUnitMultiplier: Number(env.API_USAGE_STORAGE_UNIT_MULTIPLIER ?? "10"),
  };
}

export async function deriveApiKey(seed: string, keyId: string): Promise<string> {
  validateApiKeyId(keyId);
  const keyNonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(12)));
  const secret = await deriveApiKeySecret(seed, keyId, keyNonce);
  return `strl_${keyId}_${keyNonce}_${secret}`;
}

async function requireApiKey(request: Request, env: Env): Promise<ApiKeyIdentity> {
  const seed = String(env.API_KEY_SEED ?? "");
  if (!seed) {
    throw new RelayError("API_KEY_INVALID", "API_KEY_SEED is not configured", 500);
  }
  const raw = apiKeyFromRequest(request);
  if (!raw) {
    throw new RelayError("API_KEY_INVALID", "API key is required", 401);
  }
  return verifyApiKey(raw, seed);
}

export async function verifyApiKey(apiKey: string, seed: string): Promise<ApiKeyIdentity> {
  const parsed = parseApiKey(apiKey);
  const expected = await deriveApiKeySecret(seed, parsed.keyId, parsed.keyNonce);
  if (!constantTimeEqual(parsed.secret, expected)) {
    throw new RelayError("API_KEY_INVALID", "Invalid API key", 401, { keyId: parsed.keyId });
  }
  return { keyId: parsed.keyId };
}

function parseApiKey(apiKey: string): { keyId: string; keyNonce: string; secret: string } {
  const match = /^strl_([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})_([A-Za-z0-9_-]{8,64})_([A-Za-z0-9_-]{43})$/.exec(apiKey);
  if (!match) {
    throw new RelayError("API_KEY_INVALID", "Invalid API key format", 401);
  }
  const keyId = match[1] ?? "";
  validateApiKeyId(keyId);
  return { keyId, keyNonce: match[2] ?? "", secret: match[3] ?? "" };
}

function validateApiKeyId(keyId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(keyId)) {
    throw new RelayError("REQUEST_INVALID", "Invalid API key id", 400);
  }
}

async function deriveApiKeySecret(seed: string, keyId: string, keyNonce: string): Promise<string> {
  if (!seed) {
    throw new RelayError("API_KEY_INVALID", "API key seed is required", 500);
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(seed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`storail-api-key:${keyId}:${keyNonce}`));
  return base64UrlEncode(new Uint8Array(signature));
}

function apiKeyFromRequest(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return request.headers.get("x-storail-api-key") ?? undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function relayUsageUnits(requestedGas: bigint, config: ApiUsageConfig): number {
  return config.relayBaseUnits + Number((requestedGas + config.relayGasUnitDivisor - 1n) / config.relayGasUnitDivisor);
}

function storageUsageUnits(byteLength: number, config: ApiUsageConfig): number {
  return config.storageBaseUnits + Math.ceil(byteLength / config.storageBytesPerUnit) * config.storageUnitMultiplier;
}

async function reserveApiUsage(
  env: Env,
  apiKey: ApiKeyIdentity,
  units: number,
  reason: ApiUsageReserveRequest["reason"],
): Promise<void> {
  const limiter = env.API_KEY_USAGE_LIMITER.getByName(apiKey.keyId);
  const response = await limiter.fetch("https://api-key-usage-limiter/reserve", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      keyId: apiKey.keyId,
      units,
      nowMs: Date.now(),
      reason,
    } satisfies ApiUsageReserveRequest),
  });
  if (!response.ok) {
    throw normalizeErrorFromResponse(await response.json().catch(() => undefined), response.status);
  }
}

async function reserveApiUsageWindow(
  storage: StorageLike,
  body: ApiUsageReserveRequest,
  label: "hour" | "day",
  windowMs: number,
  limit: number,
): Promise<void> {
  const bucket = Math.floor(body.nowMs / windowMs);
  const currentKey = `api-usage:${label}:${bucket}`;
  const lastBucketKey = `api-usage:${label}:last`;
  const previousBucket = (await storage.get<number>(lastBucketKey)) ?? bucket;
  if (previousBucket !== bucket) {
    await storage.delete(`api-usage:${label}:${previousBucket}`);
  }
  const used = (await storage.get<number>(currentKey)) ?? 0;
  if (used + body.units > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil(((bucket + 1) * windowMs - body.nowMs) / 1000));
    throw new RelayError("API_KEY_USAGE_EXCEEDED", `API key ${label} usage limit exceeded`, 429, {
      keyId: body.keyId,
      bucket: label,
      limit,
      used,
      attemptedUnits: body.units,
      retryAfterSeconds,
    });
  }
  await storage.put(currentKey, used + body.units);
  await storage.put(lastBucketKey, bucket);
}

function makePublicClient(config: RelayConfig) {
  return createPublicClient({
    chain: arbitrumSepolia,
    transport: http(config.rpcUrl),
  });
}

async function estimateRelayFees(publicClient: RelayPublicClient): Promise<RelayFeeConfig> {
  try {
    const estimated = await publicClient.estimateFeesPerGas({
      type: "eip1559",
    });
    if (estimated.maxFeePerGas && estimated.maxPriorityFeePerGas) {
      return {
        maxFeePerGas: estimated.maxFeePerGas,
        maxPriorityFeePerGas: estimated.maxPriorityFeePerGas,
      };
    }
  } catch {
    // fall through to conservative fallback below
  }

  const gasPrice = await rpcGuard(() => publicClient.getGasPrice(), "Failed to load gas price");
  const priorityFloor = 100_000n;
  const maxPriorityFeePerGas = gasPrice > priorityFloor ? priorityFloor : gasPrice;
  const maxFeePerGas = gasPrice * 2n + maxPriorityFeePerGas;
  return {
    maxFeePerGas,
    maxPriorityFeePerGas,
  };
}

async function rpcGuard<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new RelayError("RPC_UNAVAILABLE", error instanceof Error ? error.message : message, 503);
  }
}

function parseUnsigned(value: string, label: string): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new RelayError("REQUEST_INVALID", `${label} must be an unsigned integer string`, 400);
  }
}

function parseUint48(value: string, label: string): number {
  const parsed = parseUnsigned(value, label);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed > ((1n << 48n) - 1n)) {
    throw new RelayError("REQUEST_INVALID", `${label} exceeds uint48 range`, 400);
  }
  return Number(parsed);
}

function requireHex(value: string, label: string): Hex {
  if (!isHex(value)) {
    throw new RelayError("REQUEST_INVALID", `${label} must be a hex string`, 400);
  }
  return value;
}

function parseBytes32(value: string, label: string): Hex {
  const parsed = requireHex(value, label);
  if (parsed.length !== 66) {
    throw new RelayError("REQUEST_INVALID", `${label} must be bytes32`, 500);
  }
  return parsed;
}

function normalizeBytes32(value: unknown, label: string): Hex {
  if (typeof value !== "string") {
    throw new RelayError("REQUEST_INVALID", `${label} must be bytes32`, 400);
  }
  const parsed = requireHex(value, label);
  if (parsed.length !== 66) {
    throw new RelayError("REQUEST_INVALID", `${label} must be bytes32`, 400);
  }
  return parsed;
}

function keccak256String(value: string): Hex {
  return keccak256(new TextEncoder().encode(value));
}

function parsePrivateKey(value: string, label: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  return requireHex(normalized, label);
}

function requestStorageKey(requestId: Hex): string {
  return `request:${requestId.toLowerCase()}`;
}

function deserializeDispatchRequest(dispatch: DispatchRequest): ForwardRequest {
  return {
    from: getAddress(dispatch.request.from),
    to: getAddress(dispatch.request.to),
    value: parseUnsigned(dispatch.request.value, "value"),
    gas: parseUnsigned(dispatch.request.gas, "gas"),
    deadline: parseUint48(dispatch.request.deadline, "deadline"),
    data: requireHex(dispatch.request.data, "data"),
    signature: requireHex(dispatch.request.signature, "signature"),
  };
}

async function enforceFixedWindow(
  storage: StorageLike,
  label: string,
  nowMs: number,
  windowMs: number,
  limit: number,
): Promise<void> {
  const bucket = Math.floor(nowMs / windowMs);
  const currentKey = `window:${label}:${bucket}`;
  const lastBucketKey = `window:${label}:last`;
  const previousBucket = (await storage.get<number>(lastBucketKey)) ?? bucket;

  if (previousBucket !== bucket) {
    await storage.delete(`window:${label}:${previousBucket}`);
  }

  const count = ((await storage.get<number>(currentKey)) ?? 0) + 1;
  if (count > limit) {
    throw new RelayError("RATE_LIMITED", `Wallet ${label} rate limit exceeded`, 429);
  }

  await storage.put(currentKey, count);
  await storage.put(lastBucketKey, bucket);
}

function errorResponse(error: RelayError): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ?? {}),
      },
    }),
    { status: error.status, headers: jsonHeaders },
  );
}

function toRelayResponse(record: RequestRecord, relayerId?: string): RelayResponse {
  const response: RelayResponse = {
    relayerId,
    requestId: record.requestId,
    transactionHash: record.txHash,
    status: record.status,
    relayerNonce: record.relayerNonce,
  };

  if (record.failureCode) {
    response.code = record.failureCode;
    response.message = record.failureMessage ?? undefined;
  }

  return response;
}

function normalizeError(error: unknown): RelayError {
  if (error instanceof RelayError) {
    return error;
  }

  return new RelayError(
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : "Unknown error",
    500,
  );
}

function normalizeErrorFromResponse(body: unknown, status: number): RelayError {
  const error = (body as { error?: { code?: RelayErrorCode; message?: string } & Record<string, unknown> } | undefined)?.error;
  if (error?.code) {
    const { code, message, ...details } = error;
    return new RelayError(code, message ?? "Worker subrequest failed", status, details);
  }
  return new RelayError("INTERNAL_ERROR", "Worker subrequest failed", status);
}

async function findStalledRecord(
  storage: StorageLike,
  nowMs: number,
  pendingTimeoutMs: number,
): Promise<RequestRecord | null> {
  const records = await listRequestRecords(storage);
  const unresolved = records
    .filter((record) => record.status === "pending_broadcast" || record.status === "submitted")
    .sort((left, right) => left.relayerNonce - right.relayerNonce || left.createdAt - right.createdAt);

  if (unresolved.length === 0) {
    return null;
  }

  return isRecordStalled(unresolved[0], nowMs, pendingTimeoutMs) ? unresolved[0] : null;
}

async function listRequestRecords(storage: StorageLike): Promise<RequestRecord[]> {
  const entries = await storage.list<RequestRecord>({ prefix: "request:" });
  return Array.from(entries.values());
}

export function isRecordStalled(record: RequestRecord, nowMs: number, pendingTimeoutMs: number): boolean {
  if (record.status !== "pending_broadcast" && record.status !== "submitted") {
    return false;
  }

  const anchor = record.lastBroadcastAt ?? record.createdAt;
  return nowMs - anchor > pendingTimeoutMs;
}

async function saveRelayerState(storage: StorageLike, state: RelayerState): Promise<void> {
  await storage.put(RELAYER_STATE_KEY, state);
}

export function buildRelayerSecretName(relayerId: string): string {
  return `RELAYER_PRIVATE_KEY_${relayerId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
}

function parseRelayerIds(raw: string): string[] {
  const relayerIds = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (relayerIds.length === 0) {
    throw new RelayError("REQUEST_INVALID", "RELAYER_IDS must contain at least one relayer id", 500);
  }

  return relayerIds;
}

function getRelayerConfig(config: RelayConfig, relayerId: string): RelayerConfig {
  const relayer = config.relayers.find((candidate) => candidate.id === relayerId);
  if (!relayer) {
    throw new RelayError("REQUEST_INVALID", `Unknown relayer id: ${relayerId}`, 400);
  }
  return relayer;
}

export function chooseRelayerOrder(requestId: Hex, relayerIds: string[]): string[] {
  if (relayerIds.length === 0) {
    return [];
  }

  const normalized = requestId.slice(2, 10);
  const startIndex = Number.parseInt(normalized, 16) % relayerIds.length;
  return relayerIds.slice(startIndex).concat(relayerIds.slice(0, startIndex));
}

async function uploadToPinata(
  bytes: Uint8Array,
  input: StorageUploadRequestBody,
  env: Env,
): Promise<{ cid: string; name?: string; size?: number; mimeType?: string }> {
  const formData = new FormData();
  const blob = new Blob([arrayBufferFromBytes(bytes)], input.contentType ? { type: input.contentType } : undefined);
  formData.append("file", blob, input.name ?? "storail-upload");
  formData.append("network", "public");
  const uploadUrl = String(env.PINATA_UPLOAD_URL ?? "https://uploads.pinata.cloud/v3/files");
  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    headers: pinataAuthHeaders(env) ?? undefined,
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: { cid?: string; name?: string; size?: number; mime_type?: string };
    error?: string;
    message?: string;
  };
  if (!response.ok || !body.data?.cid) {
    throw new RelayError("STORAGE_UPLOAD_FAILED", body.error ?? body.message ?? "Pinata upload failed", response.ok ? 502 : response.status, {
      provider: "pinata",
    });
  }
  return {
    cid: body.data.cid,
    name: body.data.name,
    size: body.data.size,
    mimeType: body.data.mime_type,
  };
}

function pinataAuthHeaders(env: Env): HeadersInit | undefined {
  const jwt = String(env.PINATA_JWT ?? "");
  if (jwt) {
    return { Authorization: `Bearer ${jwt}` };
  }
  const apiKey = String(env.PINATA_API_KEY ?? "");
  const apiSecret = String(env.PINATA_API_SECRET ?? "");
  if (apiKey && apiSecret) {
    return {
      pinata_api_key: apiKey,
      pinata_secret_api_key: apiSecret,
    };
  }
  return undefined;
}

function pinataGatewayBaseUrl(env: Env): string {
  return String(env.PINATA_GATEWAY_BASE_URL ?? "https://ipfs.io").replace(/\/$/, "");
}

function normalizeContentType(contentType: string | undefined, name: string | undefined): string {
  const explicit = contentType?.split(";")[0]?.trim().toLowerCase();
  if (explicit) {
    return explicit;
  }
  return contentTypeFromName(name) ?? "application/octet-stream";
}

function resolveContentKind(contentType: string): string {
  if (contentType === "text/markdown" || contentType === "text/x-markdown") {
    return "markdown";
  }
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    return "json";
  }
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    return "html";
  }
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (contentType.startsWith("video/")) {
    return "video";
  }
  if (contentType.startsWith("audio/")) {
    return "audio";
  }
  if (contentType.startsWith("text/")) {
    return "text";
  }
  if (contentType === "application/octet-stream") {
    return "binary";
  }
  return "unknown";
}

function userStorageMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const result = { ...(metadata ?? {}) };
  for (const key of ["provider", "cid", "gatewayUrl", "url", "name", "contentType", "contentKind", "size"]) {
    delete result[key];
  }
  return result;
}

function contentTypeFromName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  const pathname = name.split(/[?#]/)[0] ?? name;
  const dot = pathname.lastIndexOf(".");
  if (dot === -1) {
    return undefined;
  }
  const extension = pathname.slice(dot).toLowerCase();
  return {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".json": "application/json",
    ".html": "text/html",
    ".htm": "text/html",
    ".txt": "text/plain",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  }[extension];
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new RelayError("REQUEST_INVALID", "contentBase64 must be valid base64", 400);
  }
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as Hex;
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
