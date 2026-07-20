import { Address, Bytes } from "@graphprotocol/graph-ts";
import { afterEach, assert, clearStore, describe, test } from "matchstick-as/assembly/index";
import { handlePublished, handleUpdated } from "../src/payment-demo";
import { createPublishedEvent, createUpdatedEvent, withLogIndex } from "./payment-demo-utils";

const APP = "0x1000000000000000000000000000000000000001";
const DEVELOPER = "0xb34cdac031d3bf18e014f8e9ce17dda9cdb9ebe9";
const USER = "0x2000000000000000000000000000000000000002";
const RECIPIENT = "0x3000000000000000000000000000000000000003";
const PATH_HASH = "0xc95b3d494981dfa4de87fad24dfc3fb6241404316d289993c3ebcd7bfee3ff4f";
const CONTENT_HASH = "0x2cc22cb266f169438134c290b7721d543ed37dab391df08548d40b78011c0315";
const INBOX_PATH = "/" + APP + "/payment-demo-app/inbox";
const OTHER_PATH = "/" + APP + "/payment-demo-app/other";

describe("Payment demo mappings", () => {
  afterEach(() => {
    clearStore();
  });

  test("ignores non-inbox records", () => {
    handlePublished(
      createPublishedEvent(
        Bytes.fromHexString(PATH_HASH),
        Address.fromString(APP),
        Address.fromString(DEVELOPER),
        OTHER_PATH,
        "InitSupply",
        DEVELOPER,
        Bytes.fromHexString(CONTENT_HASH),
        DEVELOPER + ":100",
      ),
    );

    assert.entityCount("PaymentState", 0);
    assert.entityCount("PaymentInstruction", 0);
  });

  test("replays init supply and valid transfer into balances", () => {
    const app = Address.fromString(APP);
    const developer = Address.fromString(DEVELOPER);
    const recipient = Address.fromString(RECIPIENT);

    handlePublished(
      withLogIndex(
        createPublishedEvent(
          Bytes.fromHexString(PATH_HASH),
          app,
          developer,
          INBOX_PATH,
          "InitSupply",
          DEVELOPER,
          Bytes.fromHexString(CONTENT_HASH),
          DEVELOPER + ":100",
        ),
        0,
      ),
    );

    handleUpdated(
      withLogIndex(
        createUpdatedEvent(
          Bytes.fromHexString(PATH_HASH),
          app,
          developer,
          INBOX_PATH,
          "Transfer",
          RECIPIENT,
          Bytes.fromHexString(CONTENT_HASH),
          DEVELOPER + ":30",
        ),
        1,
      ),
    );

    assert.entityCount("PaymentState", 1);
    assert.entityCount("PaymentAccount", 2);
    assert.entityCount("PaymentInstruction", 2);
    assert.fieldEquals("PaymentState", APP, "initialized", "true");
    assert.fieldEquals("PaymentState", APP, "totalSupply", "100");
    assert.fieldEquals("PaymentState", APP, "instructionCount", "2");
    assert.fieldEquals("PaymentState", APP, "acceptedCount", "2");
    assert.fieldEquals("PaymentState", APP, "ignoredCount", "0");
    assert.fieldEquals("PaymentAccount", APP + "-" + DEVELOPER, "balance", "70");
    assert.fieldEquals("PaymentAccount", APP + "-" + RECIPIENT, "balance", "30");
    assert.fieldEquals("PaymentInstruction", "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-0", "type", "INIT_SUPPLY");
    assert.fieldEquals("PaymentInstruction", "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1", "type", "TRANSFER");
    assert.fieldEquals("PaymentInstruction", "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1", "accepted", "true");
    assert.fieldEquals("PaymentInstruction", "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1", "to", RECIPIENT);
    assert.fieldEquals("PaymentInstruction", "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1", "amount", "30");
  });

  test("records duplicate init and insufficient transfer as ignored instructions", () => {
    const app = Address.fromString(APP);
    const developer = Address.fromString(DEVELOPER);
    const user = Address.fromString(USER);
    const recipient = Address.fromString(RECIPIENT);

    handlePublished(
      withLogIndex(
        createPublishedEvent(
          Bytes.fromHexString(PATH_HASH),
          app,
          developer,
          INBOX_PATH,
          "InitSupply",
          DEVELOPER,
          Bytes.fromHexString(CONTENT_HASH),
          DEVELOPER + ":100",
        ),
        0,
      ),
    );
    handleUpdated(
      withLogIndex(
        createUpdatedEvent(
          Bytes.fromHexString(PATH_HASH),
          app,
          user,
          INBOX_PATH,
          "InitSupply",
          USER,
          Bytes.fromHexString(CONTENT_HASH),
          USER + ":999",
        ),
        1,
      ),
    );
    handleUpdated(
      withLogIndex(
        createUpdatedEvent(
          Bytes.fromHexString(PATH_HASH),
          app,
          user,
          INBOX_PATH,
          "Transfer",
          RECIPIENT,
          Bytes.fromHexString(CONTENT_HASH),
          USER + ":1000",
        ),
        2,
      ),
    );

    assert.fieldEquals("PaymentState", APP, "totalSupply", "100");
    assert.fieldEquals("PaymentState", APP, "instructionCount", "3");
    assert.fieldEquals("PaymentState", APP, "acceptedCount", "1");
    assert.fieldEquals("PaymentState", APP, "ignoredCount", "2");
    assert.fieldEquals("PaymentAccount", APP + "-" + DEVELOPER, "balance", "100");
    assert.fieldEquals("PaymentInstruction", "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1", "accepted", "false");
    assert.fieldEquals("PaymentInstruction", "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1", "ignoredReason", "ALREADY_INITIALIZED");
    assert.fieldEquals("PaymentInstruction", "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-2", "accepted", "false");
    assert.fieldEquals("PaymentInstruction", "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-2", "ignoredReason", "INSUFFICIENT_BALANCE");
  });
});
