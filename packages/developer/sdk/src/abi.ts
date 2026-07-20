// Copyright (C) 2026 Defa Wang

import { parseAbi } from "viem";

export const AEH_ABI = parseAbi([
  "function publish(string path,string providerId,string pointer,bytes32 contentHash,string metadata)",
  "function update(string path,string providerId,string pointer,bytes32 contentHash,string metadata)",
  "function remove(string path)",
  "function grantWriter(string domain,address writer)",
  "function revokeWriter(string domain,address writer)",
  "function submitToApp(bytes32 appId,bytes32 actionType,bytes payload)",
]);

export const FORWARDER_ABI = parseAbi([
  "function nonces(address from) view returns (uint256)",
  "function verify((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) view returns (bool)",
  "function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) payable",
]);

export const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;
