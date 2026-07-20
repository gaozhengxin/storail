// Copyright (C) 2026 Defa Wang

const fs = require("fs");

const [
  resultFile,
  status,
  moduleName,
  authorizedEventLog,
  owner,
  writer,
  runId,
  ownerPath,
  writerPath,
  ownerPathHash,
  writerPathHash,
  ownerContentHash,
  writerContentHash,
  eventCountBefore,
  eventCountAfter,
  eventHashBefore,
  eventHashAfter,
  checkpointCountAfter,
  txNamesCsv,
  txHashesCsv,
  txBlocksCsv,
] = process.argv.slice(2);

const txNames = txNamesCsv ? txNamesCsv.split(",") : [];
const txHashes = txHashesCsv ? txHashesCsv.split(",") : [];
const txBlocks = txBlocksCsv ? txBlocksCsv.split(",") : [];

const transactions = txNames.map((name, index) => ({
  name,
  hash: txHashes[index],
  blockNumber: Number(txBlocks[index]),
}));

const result = {
  status,
  network: "arbitrum-sepolia",
  chainId: 421614,
  moduleName,
  authorizedEventLog,
  owner,
  writer,
  runId,
  paths: {
    ownerRecord: ownerPath,
    writerRecord: writerPath,
  },
  pathHashes: {
    ownerRecord: ownerPathHash,
    writerRecord: writerPathHash,
  },
  finalContentHashes: {
    ownerRecord: ownerContentHash,
    writerRecord: writerContentHash,
  },
  eventHashChain: {
    eventCountBefore,
    eventCountAfter,
    eventHashBefore,
    eventHashAfter,
    checkpointCountAfter,
  },
  transactions,
  subgraph: {
    verified: false,
    reason: "SUBGRAPH_QUERY_URL not set",
  },
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + "\n");
