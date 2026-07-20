// Copyright (C) 2026 Defa Wang

import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  Deleted,
  Published,
  Updated,
  WriterGranted,
  WriterRevoked,
} from "../generated/AuthorizedEventHub/AuthorizedEventHub";
import {
  Namespace,
  RegistryEvent,
  StorageRecord,
  WriterPermission,
} from "../generated/schema";

const EVENT_PUBLISHED = "PUBLISHED";
const EVENT_UPDATED = "UPDATED";
const EVENT_DELETED = "DELETED";
const EVENT_WRITER_GRANTED = "WRITER_GRANTED";
const EVENT_WRITER_REVOKED = "WRITER_REVOKED";

export function handlePublished(event: Published): void {
  const namespace = getOrCreateNamespace(event.params.owner, event);
  const recordId = event.params.pathHash.toHexString();
  let record = StorageRecord.load(recordId);

  if (record == null) {
    record = new StorageRecord(recordId);
    record.pathHash = event.params.pathHash;
    record.path = event.params.path;
    record.namespace = namespace.id;
    record.owner = event.params.owner;
    record.createdBy = event.params.actor;
    record.createdAtBlock = event.block.number;
    record.createdAtTimestamp = event.block.timestamp;
    namespace.recordCount = namespace.recordCount.plus(BigInt.fromI32(1));
  }

  record.providerId = event.params.providerId;
  record.pointer = event.params.pointer;
  record.contentHash = event.params.contentHash;
  record.metadata = event.params.metadata;
  record.exists = true;
  record.updatedBy = event.params.actor;
  record.updatedAtBlock = event.block.number;
  record.updatedAtTimestamp = event.block.timestamp;
  record.deletedAtBlock = null;
  record.deletedAtTimestamp = null;
  record.save();

  touchNamespace(namespace, event);
  namespace.save();

  saveRecordEvent(
    event,
    EVENT_PUBLISHED,
    namespace.id,
    record.id,
    event.params.pathHash,
    event.params.path,
    event.params.owner,
    event.params.actor,
    event.params.providerId,
    event.params.pointer,
    event.params.contentHash,
    event.params.metadata,
  );
}

export function handleUpdated(event: Updated): void {
  const namespace = getOrCreateNamespace(event.params.owner, event);
  const recordId = event.params.pathHash.toHexString();
  let record = StorageRecord.load(recordId);

  if (record == null) {
    record = new StorageRecord(recordId);
    record.pathHash = event.params.pathHash;
    record.path = event.params.path;
    record.namespace = namespace.id;
    record.owner = event.params.owner;
    record.createdBy = event.params.actor;
    record.createdAtBlock = event.block.number;
    record.createdAtTimestamp = event.block.timestamp;
    namespace.recordCount = namespace.recordCount.plus(BigInt.fromI32(1));
  }

  record.providerId = event.params.providerId;
  record.pointer = event.params.pointer;
  record.contentHash = event.params.contentHash;
  record.metadata = event.params.metadata;
  record.exists = true;
  record.updatedBy = event.params.actor;
  record.updatedAtBlock = event.block.number;
  record.updatedAtTimestamp = event.block.timestamp;
  record.deletedAtBlock = null;
  record.deletedAtTimestamp = null;
  record.save();

  touchNamespace(namespace, event);
  namespace.save();

  saveRecordEvent(
    event,
    EVENT_UPDATED,
    namespace.id,
    record.id,
    event.params.pathHash,
    event.params.path,
    event.params.owner,
    event.params.actor,
    event.params.providerId,
    event.params.pointer,
    event.params.contentHash,
    event.params.metadata,
  );
}

export function handleDeleted(event: Deleted): void {
  const namespace = getOrCreateNamespace(event.params.owner, event);
  const recordId = event.params.pathHash.toHexString();
  let record = StorageRecord.load(recordId);

  if (record == null) {
    record = new StorageRecord(recordId);
    record.pathHash = event.params.pathHash;
    record.path = event.params.path;
    record.namespace = namespace.id;
    record.owner = event.params.owner;
    record.providerId = "";
    record.pointer = "";
    record.contentHash = Bytes.empty();
    record.metadata = "";
    record.createdBy = event.params.actor;
    record.createdAtBlock = event.block.number;
    record.createdAtTimestamp = event.block.timestamp;
    namespace.recordCount = namespace.recordCount.plus(BigInt.fromI32(1));
  }

  record.exists = false;
  record.updatedBy = event.params.actor;
  record.updatedAtBlock = event.block.number;
  record.updatedAtTimestamp = event.block.timestamp;
  record.deletedAtBlock = event.block.number;
  record.deletedAtTimestamp = event.block.timestamp;
  record.save();

  touchNamespace(namespace, event);
  namespace.save();

  saveRecordEvent(
    event,
    EVENT_DELETED,
    namespace.id,
    record.id,
    event.params.pathHash,
    event.params.path,
    event.params.owner,
    event.params.actor,
    null,
    null,
    null,
    null,
  );
}

export function handleWriterGranted(event: WriterGranted): void {
  const namespace = getOrCreateNamespace(event.params.owner, event);
  const permission = getOrCreateWriterPermission(
    event.params.owner,
    event.params.domainHash,
    event.params.domain,
    event.params.writer,
    namespace.id,
    event,
  );
  const wasActive = permission.active;

  permission.active = true;
  permission.updatedAtBlock = event.block.number;
  permission.updatedAtTimestamp = event.block.timestamp;
  permission.save();

  if (!wasActive) {
    namespace.writerCount = namespace.writerCount.plus(BigInt.fromI32(1));
  }
  touchNamespace(namespace, event);
  namespace.save();

  saveWriterEvent(
    event,
    EVENT_WRITER_GRANTED,
    namespace.id,
    permission.id,
    event.params.owner,
    event.params.domainHash,
    event.params.domain,
    event.params.writer,
  );
}

export function handleWriterRevoked(event: WriterRevoked): void {
  const namespace = getOrCreateNamespace(event.params.owner, event);
  const permission = getOrCreateWriterPermission(
    event.params.owner,
    event.params.domainHash,
    event.params.domain,
    event.params.writer,
    namespace.id,
    event,
  );
  const wasActive = permission.active;

  permission.active = false;
  permission.updatedAtBlock = event.block.number;
  permission.updatedAtTimestamp = event.block.timestamp;
  permission.save();

  if (wasActive && namespace.writerCount.gt(BigInt.zero())) {
    namespace.writerCount = namespace.writerCount.minus(BigInt.fromI32(1));
  }
  touchNamespace(namespace, event);
  namespace.save();

  saveWriterEvent(
    event,
    EVENT_WRITER_REVOKED,
    namespace.id,
    permission.id,
    event.params.owner,
    event.params.domainHash,
    event.params.domain,
    event.params.writer,
  );
}

function getOrCreateNamespace(owner: Bytes, event: ethereum.Event): Namespace {
  const id = owner.toHexString();
  let namespace = Namespace.load(id);

  if (namespace == null) {
    namespace = new Namespace(id);
    namespace.owner = owner;
    namespace.recordCount = BigInt.zero();
    namespace.writerCount = BigInt.zero();
    namespace.createdAtBlock = event.block.number;
    namespace.createdAtTimestamp = event.block.timestamp;
    namespace.updatedAtBlock = event.block.number;
    namespace.updatedAtTimestamp = event.block.timestamp;
    namespace.save();
  }

  return namespace;
}

function getOrCreateWriterPermission(
  owner: Bytes,
  domainHash: Bytes,
  domain: string,
  writer: Bytes,
  namespaceId: string,
  event: ethereum.Event,
): WriterPermission {
  const id = owner.toHexString() + "-" + domainHash.toHexString() + "-" + writer.toHexString();
  let permission = WriterPermission.load(id);

  if (permission == null) {
    permission = new WriterPermission(id);
    permission.namespace = namespaceId;
    permission.owner = owner;
    permission.domainHash = domainHash;
    permission.domain = domain;
    permission.writer = writer;
    permission.active = false;
    permission.grantedAtBlock = event.block.number;
    permission.grantedAtTimestamp = event.block.timestamp;
    permission.updatedAtBlock = event.block.number;
    permission.updatedAtTimestamp = event.block.timestamp;
  }

  return permission;
}

function touchNamespace(namespace: Namespace, event: ethereum.Event): void {
  namespace.updatedAtBlock = event.block.number;
  namespace.updatedAtTimestamp = event.block.timestamp;
}

function saveRecordEvent(
  event: ethereum.Event,
  eventType: string,
  namespaceId: string,
  recordId: string,
  pathHash: Bytes,
  path: string,
  owner: Bytes,
  actor: Bytes,
  providerId: string | null,
  pointer: string | null,
  contentHash: Bytes | null,
  metadata: string | null,
): void {
  const registryEvent = new RegistryEvent(eventId(event));
  registryEvent.type = eventType;
  registryEvent.namespace = namespaceId;
  registryEvent.record = recordId;
  registryEvent.writerPermission = null;
  registryEvent.pathHash = pathHash;
  registryEvent.path = path;
  registryEvent.owner = owner;
  registryEvent.actor = actor;
  registryEvent.providerId = providerId;
  registryEvent.pointer = pointer;
  registryEvent.contentHash = contentHash;
  registryEvent.metadata = metadata;
  registryEvent.writer = null;
  registryEvent.domainHash = null;
  registryEvent.domain = null;
  registryEvent.blockNumber = event.block.number;
  registryEvent.blockTimestamp = event.block.timestamp;
  registryEvent.transactionHash = event.transaction.hash;
  registryEvent.logIndex = event.logIndex;
  registryEvent.save();
}

function saveWriterEvent(
  event: ethereum.Event,
  eventType: string,
  namespaceId: string,
  permissionId: string,
  owner: Bytes,
  domainHash: Bytes,
  domain: string,
  writer: Bytes,
): void {
  const registryEvent = new RegistryEvent(eventId(event));
  registryEvent.type = eventType;
  registryEvent.namespace = namespaceId;
  registryEvent.record = null;
  registryEvent.writerPermission = permissionId;
  registryEvent.pathHash = null;
  registryEvent.path = null;
  registryEvent.owner = owner;
  registryEvent.actor = owner;
  registryEvent.providerId = null;
  registryEvent.pointer = null;
  registryEvent.contentHash = null;
  registryEvent.metadata = null;
  registryEvent.writer = writer;
  registryEvent.domainHash = domainHash;
  registryEvent.domain = domain;
  registryEvent.blockNumber = event.block.number;
  registryEvent.blockTimestamp = event.block.timestamp;
  registryEvent.transactionHash = event.transaction.hash;
  registryEvent.logIndex = event.logIndex;
  registryEvent.save();
}

function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}
