// Copyright (C) 2026 Defa Wang

import type { Address, Hex } from "viem";
import type { ContentKind, StandardStorageMetadata } from "./content.js";
import type { StorailError } from "./errors.js";

export type { Address, Hex };

export type StorailPath = `/${Address}${string}`;

export type OperationStatus =
  | "draft"
  | "storage_uploading"
  | "storage_uploaded"
  | "registering"
  | "signing"
  | "signed"
  | "submitting"
  | "submitted"
  | "mined"
  | "confirmed"
  | "indexed"
  | "rejected"
  | "expired"
  | "reverted"
  | "rate_limited"
  | "relay_unavailable"
  | "indexing_delayed"
  | "storage_failed"
  | "registration_failed"
  | "failed";

export type MutationKind = "publish" | "update" | "remove" | "grantWriter" | "revokeWriter" | "submitToApp";

export type ForwardRequestBody = {
  from: Address;
  to: Address;
  value: "0";
  gas: string;
  deadline: string;
  data: Hex;
};

export type SignedForwardRequest = {
  request: ForwardRequestBody;
  nonce: bigint;
  signature: Hex;
};

export type StorailOperation = {
  operationId: string;
  kind: MutationKind;
  status: OperationStatus;
  requestId?: Hex;
  transactionHashes: Hex[];
  receiptBlock?: bigint;
  signedRequest?: SignedForwardRequest;
  error?: StorailError;
};

export type StorageUploadInput = {
  name?: string;
  content: Blob | Uint8Array | string;
  contentType?: string;
  metadata?: Record<string, unknown>;
};

export type StorageEncryptionOptions = {
  enabled?: boolean;
  blockSize?: number;
};

export type StorageDecryptionOptions = {
  enabled?: boolean;
};

export type StorageUploadResult = {
  providerId: string;
  pointer: string;
  contentHash: Hex;
  metadata?: string;
};

export type { ContentKind, StandardStorageMetadata };

export type StorageProvider = {
  readonly providerId: string;
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
};

export type StorageRegistrationKind = "publish" | "update";

export type StorageRegistrationInput = StorageUploadInput & {
  path: StorailPath;
  encryption?: boolean | StorageEncryptionOptions;
};

export type UploadedStorageRegistrationInput = {
  path: StorailPath;
  storage: StorageUploadResult;
  registrationKind?: StorageRegistrationKind;
};

export type StorageRegistrationOperation = StorailOperation & {
  path: StorailPath;
  storage?: StorageUploadResult;
  registrationKind: StorageRegistrationKind;
};

export type StorageRecordInput = {
  path: StorailPath;
  providerId: string;
  pointer: string;
  contentHash: Hex;
  metadata?: string;
};

export type RemoveInput = {
  path: StorailPath;
};

export type WriteCreateInput = StorageRegistrationInput;

export type WriteReplaceInput = StorageRegistrationInput;

export type WriteDeleteInput = RemoveInput;

export type ReadStorageRecord = {
  id: string;
  pathHash: Hex;
  path: StorailPath;
  owner: Address;
  providerId: string;
  pointer: string;
  contentHash: Hex;
  metadata: string;
  exists: boolean;
  createdBy: Address;
  updatedBy: Address;
  createdAtBlock: string;
  createdAtTimestamp: string;
  updatedAtBlock: string;
  updatedAtTimestamp: string;
  deletedAtBlock?: string | null;
  deletedAtTimestamp?: string | null;
};

export type ReadRecordListInput = {
  path: StorailPath;
  first?: number;
  skip?: number;
  includeDeleted?: boolean;
};

export type ReadContentInput = {
  path: StorailPath;
  gatewayUrl?: string;
  decryption?: boolean | StorageDecryptionOptions;
};

export type ReadContentResult = {
  record: ReadStorageRecord;
  url: string;
  bytes: Uint8Array;
  contentType?: string | null;
  verified: boolean;
};

export type WriterInput = {
  domain: StorailPath;
  writer: Address;
};

export type SubmitToAppInput = {
  appId: Hex;
  actionType: Hex;
  payload: Hex;
};

export type PaymentDemoTransferInput = {
  to: Address;
  amount: bigint;
};

export type PaymentDemoInitSupplyInput = {
  amount: bigint;
};

export type PaymentDemoBalanceInput = {
  account: Address;
};

export type PaymentDemoBalance = {
  account: Address;
  balance: bigint;
};

export type RelayResponse = {
  requestId: Hex;
  transactionHash: Hex;
  status: "pending_broadcast" | "submitted" | "confirmed" | "reverted" | "failed" | "stalled";
  relayerNonce: number;
  relayerId?: string;
  code?: string;
  message?: string;
};

export type WalletLike = {
  getAddress(): Promise<Address> | Address;
  getChainId?(): Promise<number> | number;
  sendTransaction?(input: { to: Address; value: bigint; data: Hex; gas?: bigint }): Promise<Hex>;
  signTypedData(input: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: Address;
    };
    types: Record<string, readonly { readonly name: string; readonly type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
};

export type PublicClientLike = {
  readContract(input: unknown): Promise<unknown>;
  simulateContract(input: unknown): Promise<unknown>;
  call?(input: { to: Address; data: Hex }): Promise<unknown>;
  waitForTransactionReceipt?(input: { hash: Hex; confirmations?: number; timeout?: number }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    transactionHash: Hex;
  }>;
};

export type GraphqlFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type IndexedVerifier = (context: {
  client: StorailMutationClientLike;
  operation: StorailOperation;
  receiptBlock: bigint;
}) => Promise<boolean>;

export type StorailMutationClientLike = {
  querySubgraph<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
};

export type OperationStore = {
  get(operationId: string): Promise<StorailOperation | undefined>;
  put(operation: StorailOperation): Promise<void>;
  delete?(operationId: string): Promise<void>;
};
