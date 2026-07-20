// Copyright (C) 2026 Defa Wang

import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Published, Updated } from "../generated/AuthorizedEventHub/AuthorizedEventHub";
import { PaymentAccount, PaymentInstruction, PaymentState } from "../generated/schema";

const PROVIDER_INIT_SUPPLY = "InitSupply";
const PROVIDER_TRANSFER = "Transfer";
const TYPE_INIT_SUPPLY = "INIT_SUPPLY";
const TYPE_TRANSFER = "TRANSFER";
const TYPE_UNKNOWN = "UNKNOWN";
const REASON_ALREADY_INITIALIZED = "ALREADY_INITIALIZED";
const REASON_NOT_INITIALIZED = "NOT_INITIALIZED";
const REASON_INVALID_RECIPIENT = "INVALID_RECIPIENT";
const REASON_INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const INBOX_SUFFIX = "/payment-demo-app/inbox";

export function handlePublished(event: Published): void {
  handleInstruction(
    event,
    event.params.owner,
    event.params.actor,
    event.params.path,
    event.params.providerId,
    event.params.pointer,
    event.params.contentHash,
    event.params.metadata,
  );
}

export function handleUpdated(event: Updated): void {
  handleInstruction(
    event,
    event.params.owner,
    event.params.actor,
    event.params.path,
    event.params.providerId,
    event.params.pointer,
    event.params.contentHash,
    event.params.metadata,
  );
}

function handleInstruction(
  event: ethereum.Event,
  app: Bytes,
  actor: Bytes,
  path: string,
  providerId: string,
  pointer: string,
  contentHash: Bytes,
  metadata: string,
): void {
  if (!isPaymentInbox(path)) {
    return;
  }

  const state = getOrCreateState(app, path, event);
  const sequence = state.instructionCount.plus(BigInt.fromI32(1));
  state.instructionCount = sequence;

  if (providerId == PROVIDER_INIT_SUPPLY) {
    applyInitSupply(event, state, sequence, actor, path, providerId, pointer, contentHash, metadata);
  } else if (providerId == PROVIDER_TRANSFER) {
    applyTransfer(event, state, sequence, actor, path, providerId, pointer, contentHash, metadata);
  } else {
    saveInstruction(
      event,
      state,
      sequence,
      TYPE_UNKNOWN,
      actor,
      null,
      null,
      null,
      BigInt.zero(),
      false,
      "UNKNOWN_PROVIDER",
      path,
      providerId,
      pointer,
      contentHash,
      metadata,
    );
    state.ignoredCount = state.ignoredCount.plus(BigInt.fromI32(1));
  }

  state.updatedAtBlock = event.block.number;
  state.updatedAtTimestamp = event.block.timestamp;
  state.save();
}

function applyInitSupply(
  event: ethereum.Event,
  state: PaymentState,
  sequence: BigInt,
  actor: Bytes,
  path: string,
  providerId: string,
  pointer: string,
  contentHash: Bytes,
  metadata: string,
): void {
  const amount = parseAmount(metadata);
  const recipient = Bytes.fromHexString(pointer);
  let accepted = false;
  let ignoredReason: string | null = null;

  if (state.initialized) {
    ignoredReason = REASON_ALREADY_INITIALIZED;
  } else if (pointer.toLowerCase() == ZERO_ADDRESS || amount.le(BigInt.zero())) {
    ignoredReason = REASON_INVALID_RECIPIENT;
  } else {
    accepted = true;
    state.initialized = true;
    state.totalSupply = amount;
    state.acceptedCount = state.acceptedCount.plus(BigInt.fromI32(1));
    const account = getOrCreateAccount(state.id, recipient, event);
    account.balance = account.balance.plus(amount);
    account.updatedAtBlock = event.block.number;
    account.updatedAtTimestamp = event.block.timestamp;
    account.save();
  }

  const instruction = saveInstruction(
    event,
    state,
    sequence,
    TYPE_INIT_SUPPLY,
    actor,
    recipient,
    null,
    null,
    amount,
    accepted,
    ignoredReason,
    path,
    providerId,
    pointer,
    contentHash,
    metadata,
  );

  if (accepted) {
    state.initInstruction = instruction.id;
  } else {
    state.ignoredCount = state.ignoredCount.plus(BigInt.fromI32(1));
  }
}

function applyTransfer(
  event: ethereum.Event,
  state: PaymentState,
  sequence: BigInt,
  actor: Bytes,
  path: string,
  providerId: string,
  pointer: string,
  contentHash: Bytes,
  metadata: string,
): void {
  const amount = parseAmount(metadata);
  const to = Bytes.fromHexString(pointer);
  const from = parseActor(metadata);
  let accepted = false;
  let ignoredReason: string | null = null;

  if (!state.initialized) {
    ignoredReason = REASON_NOT_INITIALIZED;
  } else if (pointer.toLowerCase() == ZERO_ADDRESS || amount.le(BigInt.zero())) {
    ignoredReason = REASON_INVALID_RECIPIENT;
  } else {
    const fromAccount = getOrCreateAccount(state.id, from, event);
    if (fromAccount.balance.lt(amount)) {
      ignoredReason = REASON_INSUFFICIENT_BALANCE;
    } else {
      accepted = true;
      state.acceptedCount = state.acceptedCount.plus(BigInt.fromI32(1));
      const toAccount = getOrCreateAccount(state.id, to, event);
      fromAccount.balance = fromAccount.balance.minus(amount);
      toAccount.balance = toAccount.balance.plus(amount);
      fromAccount.updatedAtBlock = event.block.number;
      fromAccount.updatedAtTimestamp = event.block.timestamp;
      toAccount.updatedAtBlock = event.block.number;
      toAccount.updatedAtTimestamp = event.block.timestamp;
      fromAccount.save();
      toAccount.save();
    }
  }

  saveInstruction(
    event,
    state,
    sequence,
    TYPE_TRANSFER,
    actor,
    null,
    from,
    to,
    amount,
    accepted,
    ignoredReason,
    path,
    providerId,
    pointer,
    contentHash,
    metadata,
  );

  if (!accepted) {
    state.ignoredCount = state.ignoredCount.plus(BigInt.fromI32(1));
  }
}

function getOrCreateState(app: Bytes, inboxPath: string, event: ethereum.Event): PaymentState {
  const id = app.toHexString();
  let state = PaymentState.load(id);
  if (state == null) {
    state = new PaymentState(id);
    state.app = app;
    state.inboxPath = inboxPath;
    state.initialized = false;
    state.initInstruction = null;
    state.totalSupply = BigInt.zero();
    state.instructionCount = BigInt.zero();
    state.acceptedCount = BigInt.zero();
    state.ignoredCount = BigInt.zero();
    state.updatedAtBlock = event.block.number;
    state.updatedAtTimestamp = event.block.timestamp;
    state.save();
  }
  return state;
}

function getOrCreateAccount(stateId: string, address: Bytes, event: ethereum.Event): PaymentAccount {
  const id = stateId + "-" + address.toHexString();
  let account = PaymentAccount.load(id);
  if (account == null) {
    account = new PaymentAccount(id);
    account.state = stateId;
    account.address = address;
    account.balance = BigInt.zero();
    account.updatedAtBlock = event.block.number;
    account.updatedAtTimestamp = event.block.timestamp;
    account.save();
  }
  return account;
}

function saveInstruction(
  event: ethereum.Event,
  state: PaymentState,
  sequence: BigInt,
  instructionType: string,
  actor: Bytes,
  recipient: Bytes | null,
  from: Bytes | null,
  to: Bytes | null,
  amount: BigInt,
  accepted: boolean,
  ignoredReason: string | null,
  path: string,
  providerId: string,
  pointer: string,
  contentHash: Bytes,
  metadata: string,
): PaymentInstruction {
  const instruction = new PaymentInstruction(eventId(event));
  instruction.state = state.id;
  instruction.sequence = sequence;
  instruction.type = instructionType;
  instruction.actor = actor;
  instruction.recipient = recipient;
  instruction.from = from;
  instruction.to = to;
  instruction.amount = amount;
  instruction.accepted = accepted;
  instruction.ignoredReason = ignoredReason;
  instruction.path = path;
  instruction.providerId = providerId;
  instruction.pointer = pointer;
  instruction.contentHash = contentHash;
  instruction.metadata = metadata;
  instruction.blockNumber = event.block.number;
  instruction.blockTimestamp = event.block.timestamp;
  instruction.transactionHash = event.transaction.hash;
  instruction.logIndex = event.logIndex;
  instruction.save();
  return instruction;
}

function parseActor(metadata: string): Bytes {
  const parts = metadata.split(":");
  return Bytes.fromHexString(parts[0]);
}

function parseAmount(metadata: string): BigInt {
  const parts = metadata.split(":");
  return BigInt.fromString(parts[parts.length - 1]);
}

function isPaymentInbox(path: string): boolean {
  if (path.length < INBOX_SUFFIX.length) {
    return false;
  }
  return path.slice(path.length - INBOX_SUFFIX.length) == INBOX_SUFFIX;
}

function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}
