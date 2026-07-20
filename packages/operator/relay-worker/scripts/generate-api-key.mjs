#!/usr/bin/env node
// Copyright (C) 2026 Defa Wang

import { createHmac, randomBytes } from "node:crypto";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--") {
    continue;
  }
  if (arg?.startsWith("--")) {
    args.set(arg.slice(2), process.argv[index + 1] ?? "");
    index += 1;
  }
}

const keyId = args.get("key-id") || args.get("id");
const seed = args.get("seed") || process.env.API_KEY_SEED;
const keyNonce = args.get("nonce") || randomBytes(12).toString("base64url");

if (!keyId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(keyId)) {
  console.error("Usage: pnpm generate:api-key -- --key-id <id>");
  console.error("Set API_KEY_SEED in the environment or pass --seed <seed>.");
  process.exit(1);
}

if (!seed) {
  console.error("API_KEY_SEED is required.");
  process.exit(1);
}

if (!/^[A-Za-z0-9_-]{8,64}$/.test(keyNonce)) {
  console.error("API key nonce must be 8-64 base64url-style characters.");
  process.exit(1);
}

const secret = createHmac("sha256", seed)
  .update(`storail-api-key:${keyId}:${keyNonce}`)
  .digest("base64url");

console.log(`strl_${keyId}_${keyNonce}_${secret}`);
