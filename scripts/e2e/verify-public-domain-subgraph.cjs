// Copyright (C) 2026 Defa Wang

const fs = require("fs");

const resultFile = process.argv[2];
if (!resultFile) {
  console.error("Usage: node scripts/e2e/verify-public-domain-subgraph.cjs <result-json>");
  process.exit(1);
}

const endpoint = process.env.SUBGRAPH_QUERY_URL;
if (!endpoint) {
  console.error("SUBGRAPH_QUERY_URL is required.");
  process.exit(1);
}

const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
const owner = result.owner.toLowerCase();
const writer = result.writer.toLowerCase();
const ownerPathHash = result.pathHashes.ownerRecord.toLowerCase();
const writerPathHash = result.pathHashes.writerRecord.toLowerCase();
const permissionId = `${owner}-${writer}`;

const query = `
query StorailE2E($ownerRecord: ID!, $writerRecord: ID!, $permissionId: ID!) {
  ownerRecord: storageRecord(id: $ownerRecord) {
    id
    path
    owner
    providerId
    pointer
    contentHash
    metadata
    exists
  }
  writerRecord: storageRecord(id: $writerRecord) {
    id
    path
    owner
    providerId
    pointer
    contentHash
    metadata
    exists
    deletedAtBlock
  }
  writerPermission(id: $permissionId) {
    id
    owner
    writer
    active
  }
  ownerEvents: registryEvents(where: { pathHash: $ownerRecord }, orderBy: blockNumber, orderDirection: asc) {
    type
    actor
    pathHash
  }
  writerEvents: registryEvents(where: { pathHash: $writerRecord }, orderBy: blockNumber, orderDirection: asc) {
    type
    actor
    pathHash
  }
  permissionEvents: registryEvents(where: { writerPermission: $permissionId }, orderBy: blockNumber, orderDirection: asc) {
    type
    owner
    writer
  }
}
`;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const data = await pollGraph();

  assert(data.ownerRecord, "ownerRecord missing");
  assert(data.writerRecord, "writerRecord missing");
  assert(data.writerPermission, "writerPermission missing");

  assertEqual(data.ownerRecord.exists, true, "ownerRecord.exists");
  assertEqual(data.ownerRecord.pointer, "synthetic-owner-v2", "ownerRecord.pointer");
  assertEqual(data.ownerRecord.contentHash.toLowerCase(), result.finalContentHashes.ownerRecord.toLowerCase(), "ownerRecord.contentHash");

  assertEqual(data.writerRecord.exists, false, "writerRecord.exists");
  assertEqual(data.writerRecord.pointer, "synthetic-writer-v2", "writerRecord.pointer");
  assert(data.writerRecord.deletedAtBlock !== null, "writerRecord.deletedAtBlock missing");

  assertEqual(data.writerPermission.active, false, "writerPermission.active");

  assertEventTypes(data.ownerEvents, ["PUBLISHED", "UPDATED"], "ownerEvents");
  assertEventTypes(data.writerEvents, ["PUBLISHED", "UPDATED", "DELETED"], "writerEvents");
  assertEventTypes(data.permissionEvents, ["WRITER_GRANTED", "WRITER_REVOKED"], "permissionEvents");

  result.subgraph = {
    verified: true,
    endpoint,
    verifiedAt: new Date().toISOString(),
  };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + "\n");
  console.log("Subgraph state verified.");
}

async function pollGraph() {
  const deadline = Date.now() + 180_000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const data = await requestGraph();
      if (data.ownerRecord && data.writerRecord && data.writerPermission) {
        return data;
      }
      lastError = new Error("Subgraph has not indexed all entities yet.");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  throw lastError || new Error("Timed out waiting for subgraph.");
}

async function requestGraph() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      variables: {
        ownerRecord: ownerPathHash,
        writerRecord: writerPathHash,
        permissionId,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  if (payload.errors) {
    throw new Error(JSON.stringify(payload.errors));
  }
  return payload.data;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertEventTypes(events, expected, label) {
  const actual = events.map((event) => event.type);
  for (const type of expected) {
    if (!actual.includes(type)) {
      throw new Error(`${label}: missing ${type}; got ${actual.join(",")}`);
    }
  }
}
