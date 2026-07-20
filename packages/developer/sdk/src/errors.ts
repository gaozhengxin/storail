// Copyright (C) 2026 Defa Wang

export type StorailErrorCode =
  | "VALIDATION_ERROR"
  | "SIGNATURE_REJECTED"
  | "FORWARDER_NONCE_CHANGED"
  | "CONTRACT_REVERTED"
  | "RATE_LIMITED"
  | "RELAYER_POOL_EXHAUSTED"
  | "RPC_UNAVAILABLE"
  | "RELAY_UNAVAILABLE"
  | "TRANSACTION_REVERTED"
  | "INDEXING_DELAYED"
  | "STORAGE_FAILED"
  | "REGISTRATION_FAILED"
  | "FAILED";

export class StorailError extends Error {
  readonly code: StorailErrorCode;
  readonly details?: unknown;

  constructor(code: StorailErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "StorailError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeStorailError(error: unknown): StorailError {
  if (error instanceof StorailError) {
    return error;
  }

  if (error instanceof Error) {
    return new StorailError("FAILED", error.message, error);
  }

  return new StorailError("FAILED", "Unknown Storail SDK error", error);
}
