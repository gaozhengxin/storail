// Copyright (C) 2026 Defa Wang

import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { AEH_ABI, FORWARDER_ABI, FORWARD_REQUEST_TYPES } from "./abi.js";
import { StorailError, normalizeStorailError } from "./errors.js";
import { decryptStorageContent, encryptStorageUploadInput, prepareUploadInput } from "./storage.js";
import type {
  ForwardRequestBody,
  GraphqlFetch,
  IndexedVerifier,
  MutationKind,
  OperationStore,
  PaymentDemoInitSupplyInput,
  PaymentDemoBalance,
  PaymentDemoBalanceInput,
  PaymentDemoTransferInput,
  PublicClientLike,
  ReadContentInput,
  ReadContentResult,
  ReadRecordListInput,
  ReadStorageRecord,
  RelayResponse,
  RemoveInput,
  SignedForwardRequest,
  StorageProvider,
  StorageRegistrationInput,
  StorageRegistrationKind,
  StorageRegistrationOperation,
  StorageUploadResult,
  StorageRecordInput,
  StorailOperation,
  StorailPath,
  SubmitToAppInput,
  UploadedStorageRegistrationInput,
  WalletLike,
  WriterInput,
} from "./types.js";

export type StorailMutationClientOptions = {
  chainId: number;
  aehAddress: Address;
  forwarderAddress: Address;
  relayUrl: string;
  apiKey?: string;
  subgraphUrl?: string;
  paymentDemoSubgraphUrl?: string;
  rpcUrl?: string;
  wallet: WalletLike;
  publicClient?: PublicClientLike;
  fetch?: GraphqlFetch;
  confirmationThreshold?: number;
  indexingTimeoutMs?: number;
  indexingPollMs?: number;
  defaultGasLimit?: bigint;
  forwarderName?: string;
  forwarderVersion?: string;
  operationStore?: OperationStore;
  paymentDemoAppId?: Hex;
  storageProvider?: StorageProvider;
  contentGatewayBaseUrl?: string;
};

type MutationSpec = {
  kind: MutationKind;
  data: Hex;
  expectedIndex?: IndexedVerifier;
};

const DEFAULT_CONFIRMATIONS = 1;
const DEFAULT_INDEXING_TIMEOUT_MS = 45_000;
const DEFAULT_INDEXING_POLL_MS = 2_000;
const DEFAULT_GAS_LIMIT = 650_000n;

export class StorailMutationClient {
  readonly chainId: number;
  readonly aehAddress: Address;
  readonly forwarderAddress: Address;
  readonly relayUrl: string;
  readonly apiKey?: string;
  readonly subgraphUrl?: string;
  readonly paymentDemoSubgraphUrl?: string;
  readonly wallet: WalletLike;
  readonly publicClient: PublicClientLike;
  readonly fetch: GraphqlFetch;
  readonly confirmationThreshold: number;
  readonly indexingTimeoutMs: number;
  readonly indexingPollMs: number;
  readonly defaultGasLimit: bigint;
  readonly forwarderName: string;
  readonly forwarderVersion: string;
  readonly operationStore?: OperationStore;
  readonly paymentDemoAppId: Hex;
  readonly storageProvider?: StorageProvider;
  readonly contentGatewayBaseUrl?: string;
  readonly write: StorailWriteModule;
  readonly read: StorailReadModule;
  readonly paymentDemo: StorailPaymentDemoModule;

  constructor(options: StorailMutationClientOptions) {
    this.chainId = options.chainId;
    this.aehAddress = getAddress(options.aehAddress);
    this.forwarderAddress = getAddress(options.forwarderAddress);
    this.relayUrl = options.relayUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.subgraphUrl = options.subgraphUrl;
    this.paymentDemoSubgraphUrl = options.paymentDemoSubgraphUrl;
    this.wallet = options.wallet;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.confirmationThreshold = options.confirmationThreshold ?? DEFAULT_CONFIRMATIONS;
    this.indexingTimeoutMs = options.indexingTimeoutMs ?? DEFAULT_INDEXING_TIMEOUT_MS;
    this.indexingPollMs = options.indexingPollMs ?? DEFAULT_INDEXING_POLL_MS;
    this.defaultGasLimit = options.defaultGasLimit ?? DEFAULT_GAS_LIMIT;
    this.forwarderName = options.forwarderName ?? "Storail Forwarder";
    this.forwarderVersion = options.forwarderVersion ?? "1";
    this.operationStore = options.operationStore;
    this.paymentDemoAppId = options.paymentDemoAppId ?? PAYMENT_DEMO_APP_ID;
    this.storageProvider = options.storageProvider;
    this.contentGatewayBaseUrl = options.contentGatewayBaseUrl?.replace(/\/$/, "");
    this.write = new StorailWriteModule(this);
    this.read = new StorailReadModule(this);
    this.paymentDemo = new StorailPaymentDemoModule(this);
    this.publicClient =
      options.publicClient ??
      createPublicClient({
        transport: http(required(options.rpcUrl, "rpcUrl is required when publicClient is not provided")),
      });
  }

  async publish(input: StorageRecordInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    validateRecordInput(input);
    await this.assertCanWritePath(input.path, options);
    return this.executeMutation(
      {
        kind: "publish",
        data: encodeFunctionData({
          abi: AEH_ABI,
          functionName: "publish",
          args: [input.path, input.providerId, input.pointer, input.contentHash, input.metadata ?? ""],
        }),
        expectedIndex: recordVerifier(input, true),
      },
      options,
    );
  }

  async update(input: StorageRecordInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    validateRecordInput(input);
    await this.assertCanWritePath(input.path, options);
    return this.executeMutation(
      {
        kind: "update",
        data: encodeFunctionData({
          abi: AEH_ABI,
          functionName: "update",
          args: [input.path, input.providerId, input.pointer, input.contentHash, input.metadata ?? ""],
        }),
        expectedIndex: recordVerifier(input, true),
      },
      options,
    );
  }

  uploadAndPublish(input: StorageRegistrationInput, options: ExecuteOptions = {}): Promise<StorageRegistrationOperation> {
    return this.executeStorageRegistration("publish", input, options);
  }

  uploadAndUpdate(input: StorageRegistrationInput, options: ExecuteOptions = {}): Promise<StorageRegistrationOperation> {
    return this.executeStorageRegistration("update", input, options);
  }

  registerUploadedStorage(
    input: UploadedStorageRegistrationInput,
    options: ExecuteOptions = {},
  ): Promise<StorageRegistrationOperation> {
    validatePath(input.path);
    validateRecordInput({
      path: input.path,
      providerId: input.storage.providerId,
      pointer: input.storage.pointer,
      contentHash: input.storage.contentHash,
      metadata: input.storage.metadata,
    });
    return this.executeUploadedStorageRegistration(
      input.registrationKind ?? "update",
      input.path,
      input.storage,
      options,
    );
  }

  async remove(input: RemoveInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    validatePath(input.path);
    await this.assertCanWritePath(input.path, options);
    return this.executeMutation(
      {
        kind: "remove",
        data: encodeFunctionData({
          abi: AEH_ABI,
          functionName: "remove",
          args: [input.path],
        }),
        expectedIndex: recordVerifier({ path: input.path }, false),
      },
      options,
    );
  }

  async grantWriter(input: WriterInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    validatePath(input.domain);
    validateAddress(input.writer, "writer");
    await this.assertPathOwner(input.domain, options);
    validateDistinctWriter(input.domain, input.writer);
    return this.executeMutation(
      {
        kind: "grantWriter",
        data: encodeFunctionData({
          abi: AEH_ABI,
          functionName: "grantWriter",
          args: [input.domain, getAddress(input.writer)],
        }),
        expectedIndex: writerVerifier(input, true),
      },
      options,
    );
  }

  async revokeWriter(input: WriterInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    validatePath(input.domain);
    validateAddress(input.writer, "writer");
    await this.assertPathOwner(input.domain, options);
    validateDistinctWriter(input.domain, input.writer);
    return this.executeMutation(
      {
        kind: "revokeWriter",
        data: encodeFunctionData({
          abi: AEH_ABI,
          functionName: "revokeWriter",
          args: [input.domain, getAddress(input.writer)],
        }),
        expectedIndex: writerVerifier(input, false),
      },
      options,
    );
  }

  submitToApp(input: SubmitToAppInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    validateBytes32(input.appId, "appId");
    validateBytes32(input.actionType, "actionType");
    if (!isHex(input.payload)) {
      throw new StorailError("VALIDATION_ERROR", "payload must be hex");
    }

    return this.executeMutation(
      {
        kind: "submitToApp",
        data: encodeFunctionData({
          abi: AEH_ABI,
          functionName: "submitToApp",
          args: [input.appId, input.actionType, input.payload],
        }),
        expectedIndex: options.indexedVerifier,
      },
      options,
    );
  }

  paymentDemoTransfer(input: PaymentDemoTransferInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    return this.paymentDemo.transfer(input, options);
  }

  paymentDemoInitializeSupply(input: PaymentDemoInitSupplyInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    return this.paymentDemo.initializeSupply(input, options);
  }

  async resumeOperation(operationId: string, options: ResumeOptions = {}): Promise<StorailOperation | undefined> {
    const operation = await this.operationStore?.get(operationId);
    if (!operation) {
      return undefined;
    }
    if (!operation.requestId && operation.signedRequest && options.retrySubmission !== false) {
      const relayResponse = await this.submitRelay(operation.signedRequest);
      operation.requestId = relayResponse.requestId;
      operation.transactionHashes = addHash(operation.transactionHashes, relayResponse.transactionHash);
      operation.status = relayResponse.status === "confirmed" ? "confirmed" : "submitted";
      await this.persistOperation(operation);
    }
    if (operation.requestId) {
      const status = await this.waitForRelayStatus(operation.requestId);
      operation.transactionHashes = addHash(operation.transactionHashes, status.transactionHash);
      operation.status = relayStatusToOperationStatus(status.status);
      await this.persistOperation(operation);
    }
    if (options.waitForReceipt !== false && operation.transactionHashes[0] && operation.status !== "indexed") {
      const receipt = await waitForReceiptFromClient(this.publicClient, operation.transactionHashes[0], this.confirmationThreshold);
      operation.receiptBlock = receipt.blockNumber;
      operation.status = receipt.status === "success" ? "confirmed" : "reverted";
      await this.persistOperation(operation);
    }
    return operation;
  }

  async executeMutation(spec: MutationSpec, options: ExecuteOptions = {}): Promise<StorailOperation> {
    const operation: StorailOperation = {
      operationId: options.operationId ?? operationIdFor(spec.kind, spec.data),
      kind: spec.kind,
      status: "draft",
      transactionHashes: [],
    };
    options.onStatus?.({ ...operation, transactionHashes: [...operation.transactionHashes] });
    await this.persistOperation(operation);

    try {
      await this.assertWalletChain();

      if (options.mode === "direct") {
        return await this.executeDirectMutation(operation, spec, options);
      }

      await this.setOperationStatus(operation, "signing", options);
      const signedRequest = await this.signForwardRequest(spec.data, options);
      operation.signedRequest = signedRequest;
      await this.setOperationStatus(operation, "signed", options);

      if (options.preflight !== false) {
        await this.preflight(signedRequest);
      }

      await this.setOperationStatus(operation, "submitting", options);
      const relayResponse = await this.submitRelay(signedRequest);
      operation.requestId = relayResponse.requestId;
      operation.transactionHashes = addHash(operation.transactionHashes, relayResponse.transactionHash);
      await this.setOperationStatus(operation, relayResponse.status === "confirmed" ? "confirmed" : "submitted", options);

      if (options.waitForReceipt !== false) {
        const receipt = await this.waitForReceipt(relayResponse);
        operation.transactionHashes = addHash(operation.transactionHashes, receipt.transactionHash);
        operation.receiptBlock = receipt.blockNumber;
        await this.setOperationStatus(operation, receipt.status === "success" ? "confirmed" : "reverted", options);
        if (receipt.status !== "success") {
          throw new StorailError("TRANSACTION_REVERTED", "Relayed transaction reverted", receipt);
        }
      }

      if (options.waitForIndex !== false && spec.expectedIndex) {
        if (!operation.receiptBlock) {
          throw new StorailError("INDEXING_DELAYED", "Cannot wait for indexing before a receipt block is known");
        }
        const indexed = await this.waitForIndexed(operation, operation.receiptBlock, options.indexedVerifier ?? spec.expectedIndex);
        await this.setOperationStatus(operation, indexed ? "indexed" : "indexing_delayed", options);
      }

      return operation;
    } catch (error) {
      operation.error = mapError(error);
      await this.setOperationStatus(operation, statusForError(operation.error), options);
      return operation;
    }
  }

  async executeStorageRegistration(
    registrationKind: StorageRegistrationKind,
    input: StorageRegistrationInput,
    options: ExecuteOptions = {},
  ): Promise<StorageRegistrationOperation> {
    validatePath(input.path);
    await this.assertCanWritePath(input.path, options);
    if (!this.storageProvider) {
      throw new StorailError("VALIDATION_ERROR", "storageProvider is required");
    }
    const uploadInput = await encryptStorageUploadInput(input, {
      wallet: this.wallet,
      chainId: this.chainId,
      verifyingContract: this.aehAddress,
    });
    const prepared = await prepareUploadInput(uploadInput);

    const operation: StorageRegistrationOperation = {
      operationId: options.operationId ?? storageOperationId(registrationKind, input.path, prepared.contentHash, input.name),
      kind: registrationKind,
      path: input.path,
      registrationKind,
      status: "storage_uploading",
      transactionHashes: [],
    };
    options.onStatus?.({ ...operation, transactionHashes: [...operation.transactionHashes] });
    await this.persistOperation(operation);

    try {
      const storage = await this.storageProvider.upload(uploadInput);
      if (storage.contentHash.toLowerCase() !== prepared.contentHash.toLowerCase()) {
        throw new StorailError("STORAGE_FAILED", "Storage proxy returned a content hash that does not match the local content", {
          localContentHash: prepared.contentHash,
          remoteContentHash: storage.contentHash,
        });
      }
      operation.storage = storage;
      await this.setOperationStatus(operation, "storage_uploaded", options);
      return await this.executeUploadedStorageRegistration(registrationKind, input.path, storage, {
        ...options,
        operationId: operation.operationId,
      });
    } catch (error) {
      operation.error = mapError(error);
      await this.setOperationStatus(operation, operation.storage ? "registration_failed" : "storage_failed", options);
      return operation;
    }
  }

  private async executeUploadedStorageRegistration(
    registrationKind: StorageRegistrationKind,
    path: StorailPath,
    storage: StorageUploadResult,
    options: ExecuteOptions,
  ): Promise<StorageRegistrationOperation> {
    const operationId = options.operationId ?? storageOperationId(registrationKind, path, storage.contentHash, storage.pointer);
    const shell: StorageRegistrationOperation = {
      operationId,
      kind: registrationKind,
      path,
      storage,
      registrationKind,
      status: "registering",
      transactionHashes: [],
    };
    await this.setOperationStatus(shell, "registering", options);

    const record = {
      path,
      providerId: storage.providerId,
      pointer: storage.pointer,
      contentHash: storage.contentHash,
      metadata: storage.metadata,
    };
    const registrationOptions = {
      ...options,
      operationId,
      onStatus: (next: StorailOperation) => {
        options.onStatus?.({
          ...next,
          path,
          storage,
          registrationKind,
          transactionHashes: [...next.transactionHashes],
        } as StorageRegistrationOperation);
      },
    };
    const registered = registrationKind === "publish"
      ? await this.publish(record, registrationOptions)
      : await this.update(record, registrationOptions);
    const combined = {
      ...registered,
      path,
      storage,
      registrationKind,
      transactionHashes: [...registered.transactionHashes],
    } as StorageRegistrationOperation;
    if (isRegistrationFailure(combined.status)) {
      combined.status = "registration_failed";
      await this.persistOperation(combined);
      options.onStatus?.({ ...combined, transactionHashes: [...combined.transactionHashes] });
    }
    return combined;
  }

  async signForwardRequest(data: Hex, options: ExecuteOptions = {}): Promise<SignedForwardRequest> {
    const from = getAddress(await this.wallet.getAddress());
    const nonce = await this.forwarderNonce(from);
    const gas = options.gasLimit ?? this.defaultGasLimit;
    const deadline = options.deadline ?? Math.floor(Date.now() / 1000) + 300;
    const message = {
      from,
      to: this.aehAddress,
      value: 0n,
      gas,
      nonce,
      deadline,
      data,
    };

    const signature = await this.wallet.signTypedData({
      domain: {
        name: this.forwarderName,
        version: this.forwarderVersion,
        chainId: this.chainId,
        verifyingContract: this.forwarderAddress,
      },
      types: FORWARD_REQUEST_TYPES,
      primaryType: "ForwardRequest",
      message,
    });

    return {
      request: {
        from,
        to: this.aehAddress,
        value: "0",
        gas: gas.toString(),
        deadline: String(deadline),
        data,
      },
      nonce,
      signature,
    };
  }

  async preflight(signed: SignedForwardRequest): Promise<void> {
    const forwardRequest = toForwarderStruct(signed);
    const currentNonce = await this.forwarderNonce(signed.request.from);
    if (currentNonce !== signed.nonce) {
      throw new StorailError("FORWARDER_NONCE_CHANGED", "Forwarder nonce changed before submission", {
        signedNonce: signed.nonce.toString(),
        currentNonce: currentNonce.toString(),
      });
    }

    const verified = await this.publicClient.readContract({
      address: this.forwarderAddress,
      abi: FORWARDER_ABI,
      functionName: "verify",
      args: [forwardRequest],
    });
    if (verified !== true) {
      throw new StorailError("CONTRACT_REVERTED", "Forwarder verification failed");
    }

    await this.publicClient.simulateContract({
      address: this.forwarderAddress,
      abi: FORWARDER_ABI,
      functionName: "execute",
      args: [forwardRequest],
    });
  }

  async submitRelay(signed: SignedForwardRequest): Promise<RelayResponse> {
    const response = await this.fetch(`${this.relayUrl}/v1/relay`, {
      method: "POST",
      headers: this.workerHeaders(),
      body: JSON.stringify({
        request: signed.request,
        signature: signed.signature,
      }),
    });

    const body = (await response.json().catch(() => ({}))) as Partial<RelayResponse> & { code?: string; message?: string };
    if (!response.ok) {
      throw relayError(body, response.status);
    }

    if (!body.requestId || !body.transactionHash || !body.status) {
      throw new StorailError("RELAY_UNAVAILABLE", "Relay returned an incomplete response", body);
    }

    return body as RelayResponse;
  }

  async waitForRelayStatus(requestId: Hex): Promise<RelayResponse> {
    const response = await this.fetch(`${this.relayUrl}/v1/relay/${requestId}`, {
      headers: this.workerHeaders(),
    });
    const body = (await response.json().catch(() => ({}))) as Partial<RelayResponse> & { code?: string; message?: string };
    if (!response.ok) {
      throw relayError(body, response.status);
    }
    if (!body.requestId || !body.transactionHash || !body.status) {
      throw new StorailError("RELAY_UNAVAILABLE", "Relay returned an incomplete status response", body);
    }
    return body as RelayResponse;
  }

  private workerHeaders(): HeadersInit {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async querySubgraph<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!this.subgraphUrl) {
      throw new StorailError("INDEXING_DELAYED", "subgraphUrl is not configured");
    }

    const response = await this.fetch(this.subgraphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as { data?: T; errors?: unknown };
    if (!response.ok || body.errors || !body.data) {
      throw new StorailError("INDEXING_DELAYED", "Subgraph query failed", body.errors ?? body);
    }
    return body.data;
  }

  async queryPaymentDemoSubgraph<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!this.paymentDemoSubgraphUrl) {
      throw new StorailError("INDEXING_DELAYED", "paymentDemoSubgraphUrl is not configured");
    }

    const response = await this.fetch(this.paymentDemoSubgraphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as { data?: T; errors?: unknown };
    if (!response.ok || body.errors || !body.data) {
      throw new StorailError("INDEXING_DELAYED", "Payment demo subgraph query failed", body.errors ?? body);
    }
    return body.data;
  }

  async assertCanWritePath(path: StorailPath, options: ExecuteOptions = {}): Promise<void> {
    if (options.permissionPreflight === false || !this.subgraphUrl) {
      return;
    }
    const writer = getAddress(await this.wallet.getAddress());
    if (pathOwner(path).toLowerCase() === writer.toLowerCase()) {
      return;
    }
    const domains = permissionDomainsForPath(path);
    const data = await this.querySubgraph<{
      writerPermissions: Array<{ domain: StorailPath; active: boolean }>;
    }>(
      `query StorailWriterPermissions($writer: Bytes!, $domains: [String!]) {
        writerPermissions(first: 1, where: { writer: $writer, domain_in: $domains, active: true }) {
          domain
          active
        }
      }`,
      { writer: writer.toLowerCase(), domains },
    );
    if (data.writerPermissions.length === 0) {
      throw new StorailError("VALIDATION_ERROR", "Wallet is not authorized to write this path", { path, writer });
    }
  }

  private async assertPathOwner(path: StorailPath, options: ExecuteOptions = {}): Promise<void> {
    if (options.permissionPreflight === false) {
      return;
    }
    const actor = getAddress(await this.wallet.getAddress());
    if (pathOwner(path).toLowerCase() !== actor.toLowerCase()) {
      throw new StorailError("VALIDATION_ERROR", "Only the namespace owner can manage writer permissions", {
        path,
        actor,
      });
    }
  }

  private async forwarderNonce(address: Address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.forwarderAddress,
      abi: FORWARDER_ABI,
      functionName: "nonces",
      args: [address],
    })) as bigint;
  }

  private async waitForReceipt(relayResponse: RelayResponse): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    transactionHash: Hex;
  }> {
    if (relayResponse.status === "confirmed") {
      const status = await this.waitForRelayStatus(relayResponse.requestId);
      if (status.status === "confirmed") {
        return waitForReceiptFromClient(this.publicClient, status.transactionHash, this.confirmationThreshold);
      }
    }

    if (!this.publicClient.waitForTransactionReceipt) {
      throw new StorailError("RPC_UNAVAILABLE", "publicClient.waitForTransactionReceipt is required");
    }

    return this.publicClient.waitForTransactionReceipt({
      hash: relayResponse.transactionHash,
      confirmations: this.confirmationThreshold,
    });
  }

  private async waitForIndexed(operation: StorailOperation, receiptBlock: bigint, verifier: IndexedVerifier): Promise<boolean> {
    const deadline = Date.now() + this.indexingTimeoutMs;
    while (Date.now() <= deadline) {
      const meta = await this.querySubgraph<{ _meta: { block: { number: string | number } } }>(
        "{ _meta { block { number } } }",
      );
      if (BigInt(meta._meta.block.number) >= receiptBlock && (await verifier({ client: this, operation, receiptBlock }))) {
        return true;
      }
      await sleep(this.indexingPollMs);
    }
    return false;
  }

  private async executeDirectMutation(
    operation: StorailOperation,
    spec: MutationSpec,
    options: ExecuteOptions,
  ): Promise<StorailOperation> {
    if (!this.wallet.sendTransaction) {
      throw new StorailError("VALIDATION_ERROR", "wallet.sendTransaction is required for direct mode");
    }

    if (options.preflight !== false && this.publicClient.call) {
      await this.publicClient.call({
        to: this.aehAddress,
        data: spec.data,
      });
    }

    await this.setOperationStatus(operation, "submitting", options);
    const txHash = await this.wallet.sendTransaction({
      to: this.aehAddress,
      value: 0n,
      data: spec.data,
      gas: options.gasLimit,
    });
    operation.transactionHashes = addHash(operation.transactionHashes, txHash);
    await this.setOperationStatus(operation, "submitted", options);

    if (options.waitForReceipt !== false) {
      const receipt = await waitForReceiptFromClient(this.publicClient, txHash, this.confirmationThreshold);
      operation.receiptBlock = receipt.blockNumber;
      await this.setOperationStatus(operation, receipt.status === "success" ? "confirmed" : "reverted", options);
      if (receipt.status !== "success") {
        throw new StorailError("TRANSACTION_REVERTED", "Direct transaction reverted", receipt);
      }
    }

    if (options.waitForIndex !== false && spec.expectedIndex) {
      if (!operation.receiptBlock) {
        throw new StorailError("INDEXING_DELAYED", "Cannot wait for indexing before a receipt block is known");
      }
      const indexed = await this.waitForIndexed(operation, operation.receiptBlock, options.indexedVerifier ?? spec.expectedIndex);
      await this.setOperationStatus(operation, indexed ? "indexed" : "indexing_delayed", options);
    }

    return operation;
  }

  private async assertWalletChain(): Promise<void> {
    if (!this.wallet.getChainId) {
      return;
    }
    const walletChainId = await this.wallet.getChainId();
    if (walletChainId !== this.chainId) {
      throw new StorailError("VALIDATION_ERROR", `Wallet is connected to chain ${walletChainId}, expected ${this.chainId}`);
    }
  }

  private async setOperationStatus(
    operation: StorailOperation,
    status: StorailOperation["status"],
    options: ExecuteOptions,
  ): Promise<void> {
    operation.status = status;
    options.onStatus?.({ ...operation, transactionHashes: [...operation.transactionHashes] });
    await this.persistOperation(operation);
  }

  private async persistOperation(operation: StorailOperation): Promise<void> {
    await this.operationStore?.put({ ...operation, transactionHashes: [...operation.transactionHashes] });
  }
}

export type ExecuteOptions = {
  mode?: "relay" | "direct";
  operationId?: string;
  gasLimit?: bigint;
  deadline?: number;
  preflight?: boolean;
  permissionPreflight?: boolean;
  waitForReceipt?: boolean;
  waitForIndex?: boolean;
  indexedVerifier?: IndexedVerifier;
  onStatus?: (operation: StorailOperation) => void;
};

export type ResumeOptions = {
  retrySubmission?: boolean;
  waitForReceipt?: boolean;
};

export function createStorailMutationClient(options: StorailMutationClientOptions): StorailMutationClient {
  return new StorailMutationClient(options);
}

export class StorailWriteModule {
  constructor(private readonly client: StorailMutationClient) {}

  publish(input: StorageRecordInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    return this.client.publish(input, options);
  }

  update(input: StorageRecordInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    return this.client.update(input, options);
  }

  remove(input: RemoveInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    return this.client.remove(input, options);
  }

  delete(input: RemoveInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    return this.client.remove(input, options);
  }

  grantWriter(input: WriterInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    return this.client.grantWriter(input, options);
  }

  revokeWriter(input: WriterInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    return this.client.revokeWriter(input, options);
  }

  create(input: StorageRegistrationInput, options: ExecuteOptions = {}): Promise<StorageRegistrationOperation> {
    return this.client.uploadAndPublish(input, options);
  }

  replace(input: StorageRegistrationInput, options: ExecuteOptions = {}): Promise<StorageRegistrationOperation> {
    return this.client.uploadAndUpdate(input, options);
  }

  registerUploaded(
    input: UploadedStorageRegistrationInput,
    options: ExecuteOptions = {},
  ): Promise<StorageRegistrationOperation> {
    return this.client.registerUploadedStorage(input, options);
  }
}

export class StorailReadModule {
  constructor(private readonly client: StorailMutationClient) {}

  async getRecord(path: StorailPath): Promise<ReadStorageRecord | undefined> {
    validatePath(path);
    const data = await this.client.querySubgraph<{ storageRecords: ReadStorageRecord[] }>(
      `query StorailRecord($path: String!) {
        storageRecords(first: 1, where: { path: $path }) {
          id
          pathHash
          path
          owner
          providerId
          pointer
          contentHash
          metadata
          exists
          createdBy
          updatedBy
          createdAtBlock
          createdAtTimestamp
          updatedAtBlock
          updatedAtTimestamp
          deletedAtBlock
          deletedAtTimestamp
        }
      }`,
      { path },
    );
    return data.storageRecords[0];
  }

  async listRecords(input: ReadRecordListInput): Promise<ReadStorageRecord[]> {
    validatePath(input.path);
    const first = input.first ?? 50;
    const skip = input.skip ?? 0;
    if (first < 1 || first > 1000) {
      throw new StorailError("VALIDATION_ERROR", "first must be between 1 and 1000");
    }
    if (skip < 0) {
      throw new StorailError("VALIDATION_ERROR", "skip must be non-negative");
    }

    const where = input.includeDeleted === true
      ? "{ path_starts_with: $path }"
      : "{ path_starts_with: $path, exists: true }";
    const data = await this.client.querySubgraph<{ storageRecords: ReadStorageRecord[] }>(
      `query StorailRecords($path: String!, $first: Int!, $skip: Int!) {
        storageRecords(first: $first, skip: $skip, orderBy: updatedAtBlock, orderDirection: desc, where: ${where}) {
          id
          pathHash
          path
          owner
          providerId
          pointer
          contentHash
          metadata
          exists
          createdBy
          updatedBy
          createdAtBlock
          createdAtTimestamp
          updatedAtBlock
          updatedAtTimestamp
          deletedAtBlock
          deletedAtTimestamp
        }
      }`,
      { path: input.path, first, skip },
    );
    return data.storageRecords;
  }

  async getContent(input: StorailPath | ReadContentInput): Promise<ReadContentResult> {
    const path = typeof input === "string" ? input : input.path;
    const gatewayUrl = typeof input === "string" ? undefined : input.gatewayUrl;
    const decryption = typeof input === "string" ? undefined : input.decryption;
    const record = await this.getRecord(path);
    if (!record || !record.exists) {
      throw new StorailError("INDEXING_DELAYED", "No active storage record found for path", { path });
    }
    const url = resolveContentUrl(record, gatewayUrl ?? this.client.contentGatewayBaseUrl);
    const response = await this.client.fetch(url);
    if (!response.ok) {
      throw new StorailError("STORAGE_FAILED", "Failed to retrieve stored content", {
        path,
        url,
        status: response.status,
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const prepared = await prepareUploadInput({ content: bytes });
    const verified = prepared.contentHash.toLowerCase() === record.contentHash.toLowerCase();
    if (!verified) {
      throw new StorailError("STORAGE_FAILED", "Retrieved content hash does not match the registered content hash", {
        path,
        url,
        expected: record.contentHash,
        actual: prepared.contentHash,
      });
    }
    const shouldDecrypt = decryption === true || (typeof decryption === "object" && decryption.enabled !== false);
    const content = shouldDecrypt
      ? await decryptStorageContent({
          path,
          bytes,
          metadata: record.metadata,
          wallet: this.client.wallet,
          chainId: this.client.chainId,
          verifyingContract: this.client.aehAddress,
        })
      : { bytes, contentType: response.headers.get("Content-Type") };
    return {
      record,
      url,
      bytes: content.bytes,
      contentType: content.contentType ?? response.headers.get("Content-Type"),
      verified,
    };
  }
}

export class StorailPaymentDemoModule {
  constructor(private readonly client: StorailMutationClient) {}

  transfer(input: PaymentDemoTransferInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    validateAddress(input.to, "to");
    if (input.amount < 0n) {
      throw new StorailError("VALIDATION_ERROR", "amount must be non-negative");
    }

    return this.client.submitToApp(
      {
        appId: this.client.paymentDemoAppId,
        actionType: PAYMENT_DEMO_ACTION_TRANSFER,
        payload: encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [getAddress(input.to), input.amount]),
      },
      options,
    );
  }

  initializeSupply(input: PaymentDemoInitSupplyInput, options: ExecuteOptions = {}): Promise<StorailOperation> {
    if (input.amount < 0n) {
      throw new StorailError("VALIDATION_ERROR", "amount must be non-negative");
    }

    return this.client.submitToApp(
      {
        appId: this.client.paymentDemoAppId,
        actionType: PAYMENT_DEMO_ACTION_INIT_SUPPLY,
        payload: encodeAbiParameters([{ type: "uint256" }], [input.amount]),
      },
      options,
    );
  }

  async getBalance(input: PaymentDemoBalanceInput): Promise<PaymentDemoBalance> {
    validateAddress(input.account, "account");
    const account = getAddress(input.account);
    const data = await this.client.queryPaymentDemoSubgraph<{
      paymentAccounts: Array<{ address: Address; balance: string }>;
    }>(
      `query PaymentDemoBalance($account: Bytes!) {
        paymentAccounts(first: 1, where: { address: $account }) {
          address
          balance
        }
      }`,
      { account: account.toLowerCase() },
    );
    const row = data.paymentAccounts[0];
    return {
      account,
      balance: row ? BigInt(row.balance) : 0n,
    };
  }
}

export function buildOperationId(kind: MutationKind, data: Hex): string {
  return operationIdFor(kind, data);
}

function operationIdFor(kind: MutationKind, data: Hex): string {
  return keccak256(`${stringToHex(kind)}${data.slice(2)}` as Hex);
}

function toForwarderStruct(signed: SignedForwardRequest) {
  return {
    from: signed.request.from,
    to: signed.request.to,
    value: 0n,
    gas: BigInt(signed.request.gas),
    deadline: Number(signed.request.deadline),
    data: signed.request.data,
    signature: signed.signature,
  };
}

function validateRecordInput(input: StorageRecordInput): void {
  validatePath(input.path);
  if (!input.providerId) {
    throw new StorailError("VALIDATION_ERROR", "providerId is required");
  }
  if (!input.pointer) {
    throw new StorailError("VALIDATION_ERROR", "pointer is required");
  }
  if (!isHex(input.contentHash) || input.contentHash.length !== 66) {
    throw new StorailError("VALIDATION_ERROR", "contentHash must be bytes32 hex");
  }
}

function validatePath(path: string): asserts path is StorailPath {
  if (!path.startsWith("/")) {
    throw new StorailError("VALIDATION_ERROR", "path must start with /");
  }
  const owner = path.split("/")[1];
  if (!owner || !isAddress(owner)) {
    throw new StorailError("VALIDATION_ERROR", "path must start with an owner address namespace");
  }
}

function pathOwner(path: StorailPath): Address {
  return getAddress(path.split("/")[1]);
}

function permissionDomainsForPath(path: StorailPath): StorailPath[] {
  const domains: StorailPath[] = [];
  for (let index = 43; index < path.length; index += 1) {
    if (path[index] === "/") {
      domains.push(path.slice(0, index) as StorailPath);
    }
  }
  domains.push(path);
  return domains;
}

function validateAddress(address: string, field: string): void {
  if (!isAddress(address)) {
    throw new StorailError("VALIDATION_ERROR", `${field} must be an address`);
  }
}

function validateDistinctWriter(domain: StorailPath, writer: Address): void {
  if (pathOwner(domain).toLowerCase() === getAddress(writer).toLowerCase()) {
    throw new StorailError("VALIDATION_ERROR", "writer must not be the namespace owner");
  }
}

function validateBytes32(value: Hex, field: string): void {
  if (!isHex(value) || value.length !== 66) {
    throw new StorailError("VALIDATION_ERROR", `${field} must be bytes32 hex`);
  }
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === null || value === "") {
    throw new StorailError("VALIDATION_ERROR", message);
  }
  return value;
}

function relayError(body: { code?: string; message?: string }, status: number): StorailError {
  if (status === 429) {
    return new StorailError("RATE_LIMITED", body.message ?? "Relay rate limited the request", body);
  }
  if (body.code === "RELAYER_POOL_EXHAUSTED") {
    return new StorailError("RELAYER_POOL_EXHAUSTED", body.message ?? "No relayer is available", body);
  }
  return new StorailError("RELAY_UNAVAILABLE", body.message ?? "Relay request failed", body);
}

function mapError(error: unknown): StorailError {
  const normalized = normalizeStorailError(error);
  if (normalized.code === "FAILED" && normalized.message.toLowerCase().includes("user rejected")) {
    return new StorailError("SIGNATURE_REJECTED", normalized.message, normalized.details);
  }
  return normalized;
}

function statusForError(error: StorailError) {
  switch (error.code) {
    case "SIGNATURE_REJECTED":
      return "rejected";
    case "RATE_LIMITED":
      return "rate_limited";
    case "RELAY_UNAVAILABLE":
    case "RELAYER_POOL_EXHAUSTED":
      return "relay_unavailable";
    case "TRANSACTION_REVERTED":
    case "CONTRACT_REVERTED":
      return "reverted";
    case "INDEXING_DELAYED":
      return "indexing_delayed";
    case "STORAGE_FAILED":
      return "storage_failed";
    case "REGISTRATION_FAILED":
      return "registration_failed";
    default:
      return "failed";
  }
}

function isRegistrationFailure(status: StorailOperation["status"]): boolean {
  return (
    status === "failed" ||
    status === "reverted" ||
    status === "rate_limited" ||
    status === "relay_unavailable" ||
    status === "rejected" ||
    status === "expired"
  );
}

function addHash(hashes: Hex[], hash: Hex): Hex[] {
  return hashes.includes(hash) ? hashes : [...hashes, hash];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function relayStatusToOperationStatus(status: RelayResponse["status"]): StorailOperation["status"] {
  switch (status) {
    case "pending_broadcast":
    case "submitted":
      return "submitted";
    case "confirmed":
      return "confirmed";
    case "reverted":
      return "reverted";
    default:
      return "failed";
  }
}

async function waitForReceiptFromClient(
  client: PublicClientLike,
  hash: Hex,
  confirmations: number,
): Promise<{ status: "success" | "reverted"; blockNumber: bigint; transactionHash: Hex }> {
  if (!client.waitForTransactionReceipt) {
    throw new StorailError("RPC_UNAVAILABLE", "publicClient.waitForTransactionReceipt is required");
  }
  return client.waitForTransactionReceipt({ hash, confirmations });
}

function recordVerifier(input: Partial<StorageRecordInput> & { path: StorailPath }, exists: boolean): IndexedVerifier {
  return async ({ client }) => {
    const data = await client.querySubgraph<{
      storageRecords: Array<{
        exists: boolean;
        providerId: string;
        pointer: string;
        contentHash: Hex;
        metadata: string;
      }>;
    }>(
      `query StorailRecord($path: String!) {
        storageRecords(first: 1, where: { path: $path }) {
          exists
          providerId
          pointer
          contentHash
          metadata
        }
      }`,
      { path: input.path },
    );
    const record = data.storageRecords[0];
    if (!record) {
      return !exists;
    }
    if (!exists) {
      return record.exists === false;
    }
    return (
      record.exists === true &&
      record.providerId === input.providerId &&
      record.pointer === input.pointer &&
      record.contentHash.toLowerCase() === input.contentHash?.toLowerCase() &&
      record.metadata === (input.metadata ?? "")
    );
  };
}

function writerVerifier(input: WriterInput, active: boolean): IndexedVerifier {
  return async ({ client }) => {
    const data = await client.querySubgraph<{
      writerPermissions: Array<{ active: boolean }>;
    }>(
      `query StorailWriter($domain: String!, $writer: Bytes!) {
        writerPermissions(first: 1, where: { domain: $domain, writer: $writer }) {
          active
        }
      }`,
      { domain: input.domain, writer: input.writer.toLowerCase() },
    );
    return data.writerPermissions[0]?.active === active;
  };
}

function stringToHex(value: string): Hex {
  return `0x${Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function storageOperationId(kind: StorageRegistrationKind, path: StorailPath, contentHash: Hex, name?: string): string {
  return keccak256(stringToHex(`storage:${kind}:${path}:${contentHash}:${name ?? ""}`));
}

function resolveContentUrl(record: ReadStorageRecord, override?: string): string {
  if (override) {
    return `${override.replace(/\/$/, "")}/${record.pointer}`;
  }
  const metadataUrl = contentUrlFromMetadata(record.metadata);
  if (metadataUrl) {
    return metadataUrl;
  }
  if (record.providerId === "lighthouse") {
    return `https://gateway.lighthouse.storage/ipfs/${record.pointer}`;
  }
  if (record.providerId === "pinata") {
    return `https://ipfs.io/ipfs/${record.pointer}`;
  }
  if (record.providerId === "storacha") {
    return `https://w3s.link/ipfs/${record.pointer}`;
  }
  return `https://ipfs.io/ipfs/${record.pointer}`;
}

function contentUrlFromMetadata(metadata: string): string | undefined {
  if (!metadata) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(metadata) as { gatewayUrl?: unknown; url?: unknown };
    if (typeof parsed.gatewayUrl === "string" && parsed.gatewayUrl) {
      return parsed.gatewayUrl;
    }
    if (typeof parsed.url === "string" && parsed.url) {
      return parsed.url;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export const PAYMENT_DEMO_APP_ID = keccak256(stringToHex("payment-demo-app"));
export const PAYMENT_DEMO_ACTION_INIT_SUPPLY = keccak256(stringToHex("InitSupply"));
export const PAYMENT_DEMO_ACTION_TRANSFER = keccak256(stringToHex("Transfer"));
