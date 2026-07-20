import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { newMockEvent } from "matchstick-as/assembly/index";
import {
  Deleted,
  Published,
  Updated,
  WriterGranted,
  WriterRevoked,
} from "../generated/AuthorizedEventHub/AuthorizedEventHub";

export function createPublishedEvent(
  pathHash: Bytes,
  owner: Address,
  actor: Address,
  path: string,
  providerId: string,
  pointer: string,
  contentHash: Bytes,
  metadata: string,
): Published {
  const event = changetype<Published>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(new ethereum.EventParam("pathHash", ethereum.Value.fromFixedBytes(pathHash)));
  event.parameters.push(new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner)));
  event.parameters.push(new ethereum.EventParam("actor", ethereum.Value.fromAddress(actor)));
  event.parameters.push(new ethereum.EventParam("path", ethereum.Value.fromString(path)));
  event.parameters.push(new ethereum.EventParam("providerId", ethereum.Value.fromString(providerId)));
  event.parameters.push(new ethereum.EventParam("pointer", ethereum.Value.fromString(pointer)));
  event.parameters.push(new ethereum.EventParam("contentHash", ethereum.Value.fromFixedBytes(contentHash)));
  event.parameters.push(new ethereum.EventParam("metadata", ethereum.Value.fromString(metadata)));
  return event;
}

export function createUpdatedEvent(
  pathHash: Bytes,
  owner: Address,
  actor: Address,
  path: string,
  providerId: string,
  pointer: string,
  contentHash: Bytes,
  metadata: string,
): Updated {
  const event = changetype<Updated>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(new ethereum.EventParam("pathHash", ethereum.Value.fromFixedBytes(pathHash)));
  event.parameters.push(new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner)));
  event.parameters.push(new ethereum.EventParam("actor", ethereum.Value.fromAddress(actor)));
  event.parameters.push(new ethereum.EventParam("path", ethereum.Value.fromString(path)));
  event.parameters.push(new ethereum.EventParam("providerId", ethereum.Value.fromString(providerId)));
  event.parameters.push(new ethereum.EventParam("pointer", ethereum.Value.fromString(pointer)));
  event.parameters.push(new ethereum.EventParam("contentHash", ethereum.Value.fromFixedBytes(contentHash)));
  event.parameters.push(new ethereum.EventParam("metadata", ethereum.Value.fromString(metadata)));
  return event;
}

export function createDeletedEvent(pathHash: Bytes, owner: Address, actor: Address, path: string): Deleted {
  const event = changetype<Deleted>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(new ethereum.EventParam("pathHash", ethereum.Value.fromFixedBytes(pathHash)));
  event.parameters.push(new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner)));
  event.parameters.push(new ethereum.EventParam("actor", ethereum.Value.fromAddress(actor)));
  event.parameters.push(new ethereum.EventParam("path", ethereum.Value.fromString(path)));
  return event;
}

export function createWriterGrantedEvent(owner: Address, domainHash: Bytes, domain: string, writer: Address): WriterGranted {
  const event = changetype<WriterGranted>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner)));
  event.parameters.push(new ethereum.EventParam("domainHash", ethereum.Value.fromFixedBytes(domainHash)));
  event.parameters.push(new ethereum.EventParam("writer", ethereum.Value.fromAddress(writer)));
  event.parameters.push(new ethereum.EventParam("domain", ethereum.Value.fromString(domain)));
  return event;
}

export function createWriterRevokedEvent(owner: Address, domainHash: Bytes, domain: string, writer: Address): WriterRevoked {
  const event = changetype<WriterRevoked>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner)));
  event.parameters.push(new ethereum.EventParam("domainHash", ethereum.Value.fromFixedBytes(domainHash)));
  event.parameters.push(new ethereum.EventParam("writer", ethereum.Value.fromAddress(writer)));
  event.parameters.push(new ethereum.EventParam("domain", ethereum.Value.fromString(domain)));
  return event;
}

export function withLogIndex<T extends ethereum.Event>(event: T, logIndex: i32): T {
  event.logIndex = BigInt.fromI32(logIndex);
  return event;
}
