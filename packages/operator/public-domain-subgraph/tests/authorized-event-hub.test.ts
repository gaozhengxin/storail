import { Address, Bytes } from "@graphprotocol/graph-ts";
import { afterEach, assert, clearStore, describe, test } from "matchstick-as/assembly/index";
import {
  handleDeleted,
  handlePublished,
  handleUpdated,
  handleWriterGranted,
  handleWriterRevoked,
} from "../src/authorized-event-hub";
import {
  createDeletedEvent,
  createPublishedEvent,
  createUpdatedEvent,
  createWriterGrantedEvent,
  createWriterRevokedEvent,
  withLogIndex,
} from "./authorized-event-hub-utils";

const OWNER = "0xb34cdac031d3bf18e014f8e9ce17dda9cdb9ebe9";
const PATH_HASH = "0xc95b3d494981dfa4de87fad24dfc3fb6241404316d289993c3ebcd7bfee3ff4f";
const CONTENT_HASH = "0x2cc22cb266f169438134c290b7721d543ed37dab391df08548d40b78011c0315";
const WRITER = "0x03f9ff3a5f982cdb1d89415ede1c1c3082132187";
const WRITER_PATH_HASH = "0x8efbf348316625511c4f1ae8200c158a71cf109288b05b31e1fac24e7caf9223";
const DOMAIN_HASH = "0xb7a099d1bbb8be29c0b5109e7ed0a32471099c92c06fbc6f1c2d0bde4500361f";

describe("AuthorizedEventHub mappings", () => {
  afterEach(() => {
    clearStore();
  });

  test("indexes the first published record", () => {
    const owner = Address.fromString(OWNER);
    const published = createPublishedEvent(
      Bytes.fromHexString(PATH_HASH),
      owner,
      owner,
      "/0xB34Cdac031d3bF18e014f8e9ce17DDA9cdb9EbE9/apps/storail-e2e-authorized-event-hub-v1/runs/test/owner-record",
      "synthetic",
      "synthetic-owner-v1",
      Bytes.fromHexString(CONTENT_HASH),
      "{}",
    );
    handlePublished(published);

    assert.entityCount("Namespace", 1);
    assert.entityCount("StorageRecord", 1);
    assert.entityCount("RegistryEvent", 1);
  });

  test("replays the complete seven-mutation integration flow", () => {
    const owner = Address.fromString(OWNER);
    const writer = Address.fromString(WRITER);
    const ownerPathHash = Bytes.fromHexString(PATH_HASH);
    const writerPathHash = Bytes.fromHexString(WRITER_PATH_HASH);
    const ownerPath = "/" + OWNER + "/apps/storail-e2e-authorized-event-hub-v1/runs/test/owner-record";
    const domain = "/" + OWNER + "/apps/storail-e2e-authorized-event-hub-v1/runs/test";
    const domainHash = Bytes.fromHexString(DOMAIN_HASH);
    const writerPath = "/" + OWNER + "/apps/storail-e2e-authorized-event-hub-v1/runs/test/writer-record";
    handlePublished(withLogIndex(createPublishedEvent(ownerPathHash, owner, owner, ownerPath, "synthetic", "synthetic-owner-v1", Bytes.fromHexString(CONTENT_HASH), "{}"), 0));
    handleUpdated(withLogIndex(createUpdatedEvent(ownerPathHash, owner, owner, ownerPath, "synthetic", "synthetic-owner-v2", Bytes.fromHexString(CONTENT_HASH), "{}"), 2));
    handleWriterGranted(withLogIndex(createWriterGrantedEvent(owner, domainHash, domain, writer), 4));
    handlePublished(withLogIndex(createPublishedEvent(writerPathHash, owner, writer, writerPath, "synthetic", "synthetic-writer-v1", Bytes.fromHexString(CONTENT_HASH), "{}"), 6));
    handleUpdated(withLogIndex(createUpdatedEvent(writerPathHash, owner, writer, writerPath, "synthetic", "synthetic-writer-v2", Bytes.fromHexString(CONTENT_HASH), "{}"), 8));
    handleWriterRevoked(withLogIndex(createWriterRevokedEvent(owner, domainHash, domain, writer), 10));
    handleDeleted(withLogIndex(createDeletedEvent(writerPathHash, owner, owner, writerPath), 12));

    assert.entityCount("Namespace", 1);
    assert.entityCount("StorageRecord", 2);
    assert.entityCount("WriterPermission", 1);
    assert.entityCount("RegistryEvent", 7);
    assert.fieldEquals("Namespace", OWNER, "recordCount", "2");
    assert.fieldEquals("Namespace", OWNER, "writerCount", "0");
    assert.fieldEquals("StorageRecord", PATH_HASH, "pointer", "synthetic-owner-v2");
    assert.fieldEquals("StorageRecord", WRITER_PATH_HASH, "exists", "false");
    assert.fieldEquals("WriterPermission", OWNER + "-" + DOMAIN_HASH + "-" + WRITER, "active", "false");
    assert.fieldEquals("WriterPermission", OWNER + "-" + DOMAIN_HASH + "-" + WRITER, "domain", domain);
  });
});
