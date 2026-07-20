// Copyright (C) 2026 Defa Wang

const fs = require("fs");
const path = require("path");

const broadcastFile = process.argv[2];

if (!broadcastFile) {
  console.error("Usage: node scripts/operator/sync-subgraph-from-broadcast.cjs <broadcast-json>");
  process.exit(1);
}

const rootDir = path.resolve(__dirname, "../..");
const fullBroadcastPath = path.resolve(rootDir, broadcastFile);
const broadcast = JSON.parse(fs.readFileSync(fullBroadcastPath, "utf8"));

const transactions = broadcast.transactions || [];
const hubTransaction = transactions.find((item) => item.contractName === "AuthorizedEventHub");
const paymentDemoTransaction = transactions.find((item) => item.contractName === "PaymentDemoApp");
const forwarderTransaction = transactions.find((item) => item.contractName === "ERC2771Forwarder");

if (!hubTransaction || !hubTransaction.contractAddress) {
  console.error("AuthorizedEventHub deployment transaction was not found in broadcast file.");
  process.exit(1);
}
if (!paymentDemoTransaction || !paymentDemoTransaction.contractAddress) {
  console.error("PaymentDemoApp deployment transaction was not found in broadcast file.");
  process.exit(1);
}
if (!forwarderTransaction || !forwarderTransaction.contractAddress) {
  console.error("ERC2771Forwarder deployment transaction was not found in broadcast file.");
  process.exit(1);
}

const receipt = (broadcast.receipts || []).find((item) => {
  const receiptAddress = String(item.contractAddress || "").toLowerCase();
  return receiptAddress === String(hubTransaction.contractAddress).toLowerCase();
});

if (!receipt || receipt.status !== "0x1") {
  console.error("AuthorizedEventHub deployment receipt is missing or unsuccessful.");
  process.exit(1);
}

const startBlock = parseBlockNumber(receipt.blockNumber);
const contractAddress = hubTransaction.contractAddress;
const paymentDemoAddress = paymentDemoTransaction.contractAddress;
const transactionHash = receipt.transactionHash || hubTransaction.hash;
const forwarderAddress = forwarderTransaction.contractAddress;

updateSubgraph("packages/operator/public-domain-subgraph/subgraph.yaml", contractAddress, startBlock);
updateSubgraph("packages/developer/payment-demo-subgraph/subgraph.yaml", contractAddress, startBlock);

const deploymentDir = path.resolve(rootDir, "codex/deployments");
fs.mkdirSync(deploymentDir, { recursive: true });
fs.writeFileSync(
  path.resolve(deploymentDir, "arbitrum-sepolia.json"),
  JSON.stringify(
    {
      network: "arbitrum-sepolia",
      chainId: 421614,
      erc2771Forwarder: forwarderAddress,
      authorizedEventHub: contractAddress,
      paymentDemoApp: paymentDemoAddress,
      startBlock,
      transactionHash,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);

console.log(`AuthorizedEventHub: ${contractAddress}`);
console.log(`PaymentDemoApp: ${paymentDemoAddress}`);
console.log(`ERC2771Forwarder: ${forwarderAddress}`);
console.log(`Start block: ${startBlock}`);
console.log("Updated packages/operator/public-domain-subgraph/subgraph.yaml");
console.log("Updated packages/developer/payment-demo-subgraph/subgraph.yaml");

function updateSubgraph(relativePath, address, blockNumber) {
  const subgraphPath = path.resolve(rootDir, relativePath);
  let subgraph = fs.readFileSync(subgraphPath, "utf8");

  subgraph = subgraph.replace(/network: .*/, "network: arbitrum-sepolia");
  subgraph = subgraph.replace(/address: "0x[a-fA-F0-9]{40}"/, `address: "${address}"`);
  subgraph = subgraph.replace(/startBlock: \d+/, `startBlock: ${blockNumber}`);

  fs.writeFileSync(subgraphPath, subgraph);
}

function parseBlockNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") {
    console.error("Receipt blockNumber is missing.");
    process.exit(1);
  }
  return value.startsWith("0x") ? Number.parseInt(value, 16) : Number.parseInt(value, 10);
}
