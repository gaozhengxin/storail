// Copyright (C) 2026 Defa Wang

import * as Client from "@storacha/client";
import * as Proof from "@storacha/client/proof";
import { Signer } from "@storacha/client/principal/ed25519";
import { StoreMemory } from "@storacha/client/stores/memory";
import { getAddress, isHex, keccak256, type Address, type Hex } from "viem";
import { inferContentType, resolveContentKind, storageMetadata, userStorageMetadata, type ContentKind } from "./content.js";
import { StorailError } from "./errors.js";
import type { GraphqlFetch } from "./types.js";
import type {
  StorageEncryptionOptions,
  StorageProvider,
  StorageRegistrationInput,
  StorageUploadInput,
  StorageUploadResult,
  StorailPath,
  WalletLike,
} from "./types.js";

export type StorageProxyProviderOptions = {
  workerUrl: string;
  providerId?: string;
  apiKey?: string;
  fetch?: GraphqlFetch;
};

export type LighthouseStorageProviderOptions = StorageProxyProviderOptions;

export type StorachaStorageProviderOptions = {
  key: string;
  proof: string;
  providerId?: string;
};

type StorachaClientLike = {
  uploadFile(file: Blob): Promise<{ toString(): string }>;
};

type EncryptionMetadata = {
  version: 1;
  algorithm: "AES-GCM";
  keyDerivation: "wallet-eip712-sha256";
  blockSize: number;
  nonce: string;
  plaintextSize: number;
  plaintextContentHash: Hex;
  plaintextContentType?: string;
  plaintextContentKind?: ContentKind;
};

export type StorachaStorageProviderTestOptions = {
  client: StorachaClientLike;
  providerId?: string;
};

export class StorageProxyProvider implements StorageProvider {
  readonly providerId: string;
  readonly workerUrl: string;
  readonly apiKey?: string;
  private readonly fetch: GraphqlFetch;

  constructor(options: StorageProxyProviderOptions) {
    if (!options.workerUrl) {
      throw new StorailError("VALIDATION_ERROR", "workerUrl is required");
    }
    this.providerId = options.providerId ?? "pinata";
    this.workerUrl = options.workerUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const prepared = await prepareUploadInput(input);
    const response = await this.fetch(`${this.workerUrl}/v1/storage/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        name: input.name,
        contentBase64: bytesToBase64(prepared.bytes),
        contentType: prepared.contentType,
        metadata: userStorageMetadata(input.metadata),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as Partial<StorageUploadResult> & {
      error?: { code?: string; message?: string };
    };
    if (!response.ok || body.error) {
      throw new StorailError("STORAGE_FAILED", body.error?.message ?? "Storage proxy upload failed", body);
    }
    if (!body.providerId || !body.pointer || !body.contentHash) {
      throw new StorailError("STORAGE_FAILED", "Storage proxy returned an incomplete response", body);
    }

    return {
      providerId: body.providerId,
      pointer: body.pointer,
      contentHash: body.contentHash,
      metadata: body.metadata,
    };
  }
}

export class StorachaStorageProvider implements StorageProvider {
  readonly providerId: string;
  private readonly clientPromise: Promise<StorachaClientLike>;

  constructor(options: StorachaStorageProviderOptions | StorachaStorageProviderTestOptions) {
    this.providerId = options.providerId ?? "storacha";
    if ("client" in options) {
      this.clientPromise = Promise.resolve(options.client);
    } else {
      this.clientPromise = createStorachaClient(options);
    }
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const prepared = await prepareUploadInput(input);
    const client = await this.clientPromise;
    const cid = await storageCall(() => client.uploadFile(prepared.blob), "Storacha upload failed");
    const pointer = cid.toString();
    if (!pointer) {
      throw new StorailError("STORAGE_FAILED", "Storacha returned an empty CID");
    }

    return {
      providerId: this.providerId,
      pointer,
      contentHash: prepared.contentHash,
      metadata: JSON.stringify(storageMetadata({
        provider: this.providerId,
        cid: pointer,
        name: input.name,
        contentType: prepared.contentType,
        contentKind: prepared.contentKind,
        size: prepared.size,
        metadata: input.metadata,
      })),
    };
  }
}

export function createStorageProxyProvider(options: StorageProxyProviderOptions): StorageProxyProvider {
  return new StorageProxyProvider(options);
}

export function createLighthouseStorageProvider(options: LighthouseStorageProviderOptions): StorageProxyProvider {
  return createStorageProxyProvider(options);
}

export function createStorachaStorageProvider(options: StorachaStorageProviderOptions): StorachaStorageProvider {
  return new StorachaStorageProvider(options);
}

export async function prepareUploadInput(input: StorageUploadInput): Promise<{
  blob: Blob;
  bytes: Uint8Array;
  contentHash: Hex;
  contentType: string;
  contentKind: ContentKind;
  size: number;
}> {
  const bytes = await contentBytes(input.content);
  const contentType = inferContentType({
    contentType: input.contentType,
    name: input.name,
    blobType: input.content instanceof Blob ? input.content.type : undefined,
  });
  const contentKind = resolveContentKind({ contentType, name: input.name });
  const blob = input.content instanceof Blob
    ? input.content
    : new Blob([arrayBufferFromBytes(bytes)], { type: contentType });
  return {
    blob,
    bytes,
    contentHash: keccak256(toHex(bytes)),
    contentType,
    contentKind,
    size: bytes.byteLength,
  };
}

export async function encryptStorageUploadInput(
  input: StorageRegistrationInput,
  options: {
    wallet: WalletLike;
    chainId: number;
    verifyingContract: Address;
  },
): Promise<StorageUploadInput> {
  const encryption = normalizeEncryptionOptions(input.encryption);
  if (!encryption) {
    return input;
  }

  const prepared = await prepareUploadInput(input);
  const plaintextContentType = prepared.contentType;
  const plaintextContentKind = prepared.contentKind;
  const keyBytes = await deriveStorageEncryptionKey({
    wallet: options.wallet,
    chainId: options.chainId,
    verifyingContract: options.verifyingContract,
    path: input.path,
  });
  const blockSize = normalizeBlockSize(encryption.blockSize);
  const nonce = randomBytes(12);
  const encrypted = await cryptBlocks("encrypt", prepared.bytes, {
    keyBytes,
    path: input.path,
    blockSize,
    nonce,
    plaintextSize: prepared.size,
  });
  const metadata = {
    ...(input.metadata ?? {}),
    storailEncryption: {
      version: 1,
      algorithm: "AES-GCM",
      keyDerivation: "wallet-eip712-sha256",
      blockSize,
      nonce: base64UrlEncode(nonce),
      plaintextSize: prepared.size,
      plaintextContentHash: prepared.contentHash,
      plaintextContentType,
      plaintextContentKind,
    } satisfies EncryptionMetadata,
  };

  return {
    name: input.name,
    content: encrypted,
    contentType: "application/octet-stream",
    metadata,
  };
}

export async function decryptStorageContent(
  input: {
    path: StorailPath;
    bytes: Uint8Array;
    metadata: string;
    wallet: WalletLike;
    chainId: number;
    verifyingContract: Address;
  },
): Promise<{ bytes: Uint8Array; contentType?: string }> {
  const encryption = encryptionMetadataFromString(input.metadata);
  if (!encryption) {
    return { bytes: input.bytes };
  }

  const keyBytes = await deriveStorageEncryptionKey({
    wallet: input.wallet,
    chainId: input.chainId,
    verifyingContract: input.verifyingContract,
    path: input.path,
  });
  const decrypted = await cryptBlocks("decrypt", input.bytes, {
    keyBytes,
    path: input.path,
    blockSize: encryption.blockSize,
    nonce: base64UrlDecode(encryption.nonce),
    plaintextSize: encryption.plaintextSize,
  });
  const prepared = await prepareUploadInput({ content: decrypted });
  if (prepared.contentHash.toLowerCase() !== encryption.plaintextContentHash.toLowerCase()) {
    throw new StorailError("STORAGE_FAILED", "Decrypted content hash does not match encryption metadata", {
      expected: encryption.plaintextContentHash,
      actual: prepared.contentHash,
    });
  }
  return { bytes: decrypted, contentType: encryption.plaintextContentType };
}

export function isStorageEncryptionEnabled(input: StorageRegistrationInput): boolean {
  return normalizeEncryptionOptions(input.encryption) !== undefined;
}

async function createStorachaClient(options: StorachaStorageProviderOptions): Promise<StorachaClientLike> {
  if (!options.key) {
    throw new StorailError("VALIDATION_ERROR", "Storacha key is required");
  }
  if (!options.proof) {
    throw new StorailError("VALIDATION_ERROR", "Storacha proof is required");
  }

  const principal = Signer.parse(options.key);
  const store = new StoreMemory();
  const client = await Client.create({ principal, store });
  const proof = await Proof.parse(options.proof);
  const space = await client.addSpace(proof);
  await client.setCurrentSpace(space.did());
  return client;
}

function normalizeEncryptionOptions(input: boolean | StorageEncryptionOptions | undefined): StorageEncryptionOptions | undefined {
  if (input === undefined || input === false) {
    return undefined;
  }
  if (input === true) {
    return {};
  }
  if (input.enabled === false) {
    return undefined;
  }
  return input;
}

function normalizeBlockSize(blockSize = 64 * 1024): number {
  if (!Number.isInteger(blockSize) || blockSize < 8 * 1024) {
    throw new StorailError("VALIDATION_ERROR", "storage encryption blockSize must be at least 8192 bytes");
  }
  return blockSize;
}

async function deriveStorageEncryptionKey(input: {
  wallet: WalletLike;
  chainId: number;
  verifyingContract: Address;
  path: StorailPath;
}): Promise<Uint8Array> {
  const owner = getAddress(await input.wallet.getAddress());
  const signature = await input.wallet.signTypedData({
    domain: {
      name: "Storail Storage Encryption",
      version: "1",
      chainId: input.chainId,
      verifyingContract: input.verifyingContract,
    },
    types: {
      StorageEncryptionKey: [
        { name: "purpose", type: "string" },
        { name: "owner", type: "address" },
        { name: "path", type: "string" },
        { name: "version", type: "uint256" },
      ],
    },
    primaryType: "StorageEncryptionKey",
    message: {
      purpose: "storail-storage-encryption",
      owner,
      path: input.path,
      version: 1n,
    },
  });
  const signatureBytes = hexToBytes(signature);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBufferFromBytes(signatureBytes)));
}

async function cryptBlocks(
  mode: "encrypt" | "decrypt",
  input: Uint8Array,
  options: {
    keyBytes: Uint8Array;
    path: StorailPath;
    blockSize: number;
    nonce: Uint8Array;
    plaintextSize: number;
  },
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", arrayBufferFromBytes(options.keyBytes), { name: "AES-GCM" }, false, [mode]);
  const output: Uint8Array[] = [];
  let inputOffset = 0;
  let plaintextOffset = 0;
  let blockIndex = 0;

  while (plaintextOffset < options.plaintextSize || (options.plaintextSize === 0 && blockIndex === 0)) {
    const plainLength = Math.min(options.blockSize, Math.max(0, options.plaintextSize - plaintextOffset));
    const inputLength = mode === "encrypt" ? plainLength : plainLength + 16;
    const block = input.subarray(inputOffset, inputOffset + inputLength);
    if (block.byteLength !== inputLength) {
      throw new StorailError("STORAGE_FAILED", "Encrypted storage content is truncated");
    }
    const result = await crypto.subtle[mode](
      {
        name: "AES-GCM",
        iv: arrayBufferFromBytes(blockNonce(options.nonce, blockIndex)),
        additionalData: arrayBufferFromBytes(blockAad(options.path, blockIndex, options.plaintextSize)),
      },
      key,
      arrayBufferFromBytes(block),
    );
    output.push(new Uint8Array(result));
    inputOffset += inputLength;
    plaintextOffset += plainLength;
    blockIndex += 1;
  }

  if (mode === "decrypt" && inputOffset !== input.byteLength) {
    throw new StorailError("STORAGE_FAILED", "Encrypted storage content has trailing bytes");
  }
  return concatBytes(output);
}

function blockNonce(baseNonce: Uint8Array, blockIndex: number): Uint8Array {
  if (baseNonce.byteLength !== 12) {
    throw new StorailError("STORAGE_FAILED", "storage encryption nonce must be 96 bits");
  }
  const nonce = new Uint8Array(baseNonce);
  nonce[8] ^= (blockIndex >>> 24) & 0xff;
  nonce[9] ^= (blockIndex >>> 16) & 0xff;
  nonce[10] ^= (blockIndex >>> 8) & 0xff;
  nonce[11] ^= blockIndex & 0xff;
  return nonce;
}

function blockAad(path: StorailPath, blockIndex: number, plaintextSize: number): Uint8Array {
  return new TextEncoder().encode(`storail-storage:v1:${path}:${blockIndex}:${plaintextSize}`);
}

function encryptionMetadataFromString(metadata: string): EncryptionMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(metadata) as { storailEncryption?: Partial<EncryptionMetadata> };
    const encryption = parsed.storailEncryption;
    if (!encryption) {
      return undefined;
    }
    if (
      encryption.version !== 1 ||
      encryption.algorithm !== "AES-GCM" ||
      encryption.keyDerivation !== "wallet-eip712-sha256" ||
      typeof encryption.blockSize !== "number" ||
      typeof encryption.nonce !== "string" ||
      typeof encryption.plaintextSize !== "number" ||
      typeof encryption.plaintextContentHash !== "string"
    ) {
      throw new StorailError("STORAGE_FAILED", "Invalid storage encryption metadata");
    }
    return encryption as EncryptionMetadata;
  } catch (error) {
    if (error instanceof StorailError) {
      throw error;
    }
    throw new StorailError("STORAGE_FAILED", "Failed to parse storage encryption metadata", error);
  }
}

async function contentBytes(content: Blob | Uint8Array | string): Promise<Uint8Array> {
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  if (content instanceof Blob) {
    return new Uint8Array(await content.arrayBuffer());
  }
  throw new StorailError("VALIDATION_ERROR", "Unsupported storage content");
}

function toHex(bytes: Uint8Array): Hex {
  const value = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const hex = `0x${value}` as Hex;
  if (!isHex(hex)) {
    throw new StorailError("VALIDATION_ERROR", "Failed to encode storage content hash input");
  }
  return hex;
}

function hexToBytes(value: Hex): Uint8Array {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function storageCall<T>(call: () => Promise<T>, fallbackMessage: string): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof StorailError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : fallbackMessage;
    throw new StorailError("STORAGE_FAILED", message, error);
  }
}
