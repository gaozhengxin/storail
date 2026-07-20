# SDK Interface Guide

The SDK provides a TypeScript interface for Storail mutations. It is not intended to hide the protocol model. It constructs AEH calls, signs ERC-2771 requests, submits them to the relay, tracks receipts, and waits for subgraph visibility when requested.

## Client Setup

```ts
import { createStorailMutationClient } from "@storail/sdk";

const client = createStorailMutationClient({
  chainId,
  aehAddress,
  forwarderAddress,
  relayUrl,
  apiKey,
  subgraphUrl,
  wallet,
  publicClient,
});
```

Required fields:

- `chainId`: expected EVM chain id.
- `aehAddress`: deployed `AuthorizedEventHub`.
- `forwarderAddress`: deployed `ERC2771Forwarder`.
- `relayUrl`: relay worker base URL.
- `apiKey`: facility API key used for relay and storage-proxy requests.
- `wallet`: adapter that exposes address and signing methods.
- `publicClient`: RPC client used for preflight and receipt tracking, or `rpcUrl` to let the SDK create one.

Optional fields:

- `subgraphUrl`: required only when waiting for `indexed`.
- `operationStore`: persistence for operation snapshots.
- `confirmationThreshold`: receipt confirmation count.
- `indexingTimeoutMs`: maximum time to wait for subgraph visibility.
- `indexingPollMs`: polling interval while waiting for the subgraph.
- `defaultGasLimit`: forward request gas limit.
- `fetch`: custom fetch implementation.
- `forwarderName`: EIP-712 domain name. Defaults to `Storail Forwarder`.
- `forwarderVersion`: EIP-712 domain version. Defaults to `1`.
- `paymentDemoAppId`: app id used by the payment demo helpers.
- `paymentDemoSubgraphUrl`: payment demo subgraph endpoint, required for payment balance queries.
- `storageProvider`: optional storage provider used by `uploadAndPublish` and `uploadAndUpdate`.
- `contentGatewayBaseUrl`: optional gateway base URL used by content retrieval helpers.

## Storage Proxy Provider

Storage uploads go through the project worker. Provider API keys stay in the worker environment and are not exposed to the frontend SDK.

The worker API itself is authenticated. The official Storail provider issues API keys by request; email `defa.crypto@proton.me` with the intended project and expected usage. Operators of their own facility can generate keys from their own worker seed.

```ts
import {
  createStorageProxyProvider,
  createStorailMutationClient,
} from "@storail/sdk";

const storageProvider = createStorageProxyProvider({
  workerUrl: relayUrl,
  apiKey,
});

const client = createStorailMutationClient({
  chainId,
  aehAddress,
  forwarderAddress,
  relayUrl,
  apiKey,
  subgraphUrl,
  wallet,
  publicClient,
  storageProvider,
});
```

Lighthouse is the default worker-side provider. Create the API key in the Lighthouse dashboard or with the Lighthouse CLI, then configure it as a worker secret:

```sh
PINATA_JWT=
```

The SDK sends content to `POST /v1/storage/upload`. The worker uploads to Lighthouse and returns the normalized `providerId`, CID pointer, content hash, and metadata used by `uploadAndUpdate` / `uploadAndPublish`.

Storacha remains available as an experimental direct provider, but it is currently blocked by a service-side upload capability error in this project environment.

```ts
import { createStorachaStorageProvider } from "@storail/sdk";

const storachaProvider = createStorachaStorageProvider({
  key: process.env.STORACHA_KEY,
  proof: process.env.STORACHA_PROOF,
});
```

Do not upload private or sensitive plaintext unless the app encrypts it first. Lighthouse and Storacha pointers are public CIDs.

```sh
STORACHA_KEY=
STORACHA_PROOF=
```

Do not upload private or sensitive plaintext to Storacha. Storacha data is retrievable by CID, and deletion from an account does not guarantee deletion from the wider IPFS network.

## Wallet Adapter

The wallet adapter must provide:

- `getAddress()`
- `signTypedData(...)`

Optional wallet methods:

- `getChainId()`: if present, the SDK checks it against `chainId` before starting an operation.
- `sendTransaction(...)`: required only for `{ mode: "direct" }`.

Relay mode does not require `sendTransaction`. Direct mode does not use `signTypedData`.

## Write Module

The primary write API is `client.write`. Every write is path-based, matching AEH/public-domain semantics.

```ts
await client.write.publish({
  path,
  providerId,
  pointer,
  contentHash,
  metadata,
});

await client.write.update({
  path,
  providerId,
  pointer,
  contentHash,
  metadata,
});

await client.write.remove({ path });

await client.write.grantWriter({ domain, writer });

await client.write.revokeWriter({ domain, writer });
```

The SDK validates paths, addresses, and `bytes32` content hashes before signing.

When `subgraphUrl` is configured, the SDK also checks writer permission before signing path writes:

- the namespace owner can always write under their namespace
- an authorized writer can write under an active granted path or slash-delimited domain prefix
- the contract remains the final authority

The write module cannot preflight subgraph application logic. AEH emits logs on-chain; that does not mean a public-domain or application subgraph has already indexed the log, accepted the instruction, or updated derived state successfully.

Disable this SDK-side check only when needed:

```ts
await client.write.update(record, {
  permissionPreflight: false,
});
```

The root methods `publish`, `update`, `remove`, `grantWriter`, and `revokeWriter` remain available as compatibility aliases.

## Storage-Backed Writes

Use these methods when the SDK should upload content first and then register the resulting pointer in the domain system.

```ts
await client.write.replace({
  path: `/${userAddress}/profile/avatar`,
  name: "avatar.png",
  content: file,
  contentType: "image/png",
  metadata: {
    purpose: "avatar",
  },
});

await client.write.create({
  path: `/${userAddress}/assets/${assetId}`,
  name: "asset.json",
  content: JSON.stringify(asset),
  contentType: "application/json",
});
```

`client.write.replace` maps to AEH `update`. It is the default shape for app backend objects because the path stays stable and the latest pointer is visible through the public-domain subgraph.

`client.write.create` maps to AEH `publish`. It is useful when every stored object should be a separate logical record.

`client.write.delete` maps to AEH `remove`. It is a logical public-domain deletion. It does not claim physical deletion from content-addressed storage networks.

### Client-Side Encryption

Storage-backed writes can encrypt content before it reaches the storage proxy or storage network:

```ts
await client.write.replace({
  path,
  name: "profile.json",
  content: JSON.stringify(profile),
  contentType: "application/json",
  encryption: true,
});
```

The SDK derives an encryption key by asking the user's wallet to sign a stable EIP-712 `StorageEncryptionKey` message. The user does not manage a separate encryption key, and the private key is never exported.

Encryption uses AES-GCM in aligned blocks. The default block size is 64 KiB, and custom block sizes must be at least 8 KiB:

```ts
await client.write.replace({
  path,
  content: file,
  encryption: {
    blockSize: 64 * 1024,
  },
});
```

AEH records the hash of the encrypted uploaded bytes. The plaintext hash, block size, nonce, and encryption algorithm are stored in record metadata under `storailEncryption`.

To retrieve and decrypt content:

```ts
const content = await client.read.getContent({
  path,
  decryption: true,
});
```

If decryption is not requested, `getContent` returns the encrypted bytes and still verifies the encrypted content hash.

If upload succeeds but chain registration fails, retry registration with the returned storage result instead of uploading the same content again:

```ts
await client.write.registerUploaded({
  path,
  registrationKind: "update",
  storage: operation.storage,
});
```

The provider result is registered as:

- `providerId`: storage provider id, currently `pinata`
- `pointer`: CID returned by Lighthouse
- `contentHash`: `bytes32` hash over the local content bytes
- `metadata`: JSON with provider, CID, name, content type, size, and caller metadata

The older root methods `uploadAndUpdate`, `uploadAndPublish`, and `registerUploadedStorage` remain available.

## Read Module

The primary read API is `client.read`. These methods query the public-domain subgraph and, when requested, retrieve content from the storage network.

```ts
const record = await client.read.getRecord(
  `/${userAddress}/profile/avatar`,
);

const records = await client.read.listRecords({
  path: `/${userAddress}/profile`,
  first: 50,
  includeDeleted: false,
});

const content = await client.read.getContent(
  `/${userAddress}/profile/avatar`,
);
```

`getRecord` returns the latest derived `StorageRecord` for an exact path.

`listRecords` returns records under a path prefix. Deleted records are excluded by default.

`getContent` resolves the record pointer through an explicit gateway URL, metadata gateway URL, or known provider gateway, then verifies the returned bytes against the registered `contentHash`. If verification fails, the SDK throws `STORAGE_FAILED`.

## Application Methods

Generic application action:

```ts
await client.submitToApp({
  appId,
  actionType,
  payload,
});
```

Payment demo helpers:

```ts
await client.paymentDemo.transfer({
  to,
  amount,
});

await client.paymentDemo.initializeSupply({
  amount,
});

const balance = await client.paymentDemo.getBalance({
  account,
});
```

These helpers only encode or query the payment demo. The balances are derived by the payment demo subgraph, so `paymentDemoSubgraphUrl` is required for `getBalance`.

The older root methods `paymentDemoTransfer` and `paymentDemoInitializeSupply` remain available as compatibility aliases.

## Operation States

SDK calls return a `StorailOperation`.

Important successful states:

- `confirmed`: the transaction is on-chain and has reached the configured confirmation threshold.
- `indexed`: the subgraph has processed the receipt block and the expected derived state is visible.

`indexed` is an observation of the configured subgraph after the transaction. It is not a transaction preflight, and it does not prove that every application-specific subgraph rule accepted the emitted AEH log. For app-specific state machines, use an `indexedVerifier` or app read API that checks the exact derived state the UI needs.

Other states include:

- `draft`
- `storage_uploading`
- `storage_uploaded`
- `registering`
- `signing`
- `signed`
- `submitting`
- `submitted`
- `rejected`
- `reverted`
- `rate_limited`
- `relay_unavailable`
- `indexing_delayed`
- `storage_failed`
- `registration_failed`
- `failed`

The SDK type also reserves `mined` and `expired`, but the current implementation does not emit them.

Use `onStatus` to update UI state:

```ts
const operation = await client.publish(record, {
  onStatus(next) {
    setOperation(next);
  },
});
```

## Relay Mode

Relay mode is the default.

The internal flow is:

1. Build AEH calldata.
2. Read the user's forwarder nonce.
3. Ask the wallet to sign the EIP-712 `ForwardRequest`.
4. Call `forwarder.verify(request)`.
5. Simulate `forwarder.execute(request)`.
6. Submit the signed request to `POST /v1/relay`.
7. Wait for the transaction receipt.
8. If `subgraphUrl` is configured, wait until `_meta.block.number >= receipt.blockNumber`.
9. Query the expected derived state.

By default, public-domain methods wait for indexing. If the application only needs the chain confirmation boundary, pass:

```ts
await client.publish(record, { waitForIndex: false });
```

This flow is why applications should not manually sign and submit relay requests unless they need lower-level control.

## Direct Mode

Use direct mode when the user should pay gas or when the relay is unavailable:

```ts
await client.update(record, { mode: "direct" });
```

Direct mode sends a transaction directly to `AuthorizedEventHub`. It can still wait for receipt confirmation and subgraph indexing.

Direct mode does not emit `signing` or `signed`. Its normal successful state sequence is:

```text
draft -> submitting -> submitted -> confirmed -> indexed
```

If `publicClient.call` is available and `preflight` is not disabled, the SDK performs an `eth_call` against `AuthorizedEventHub` before asking the wallet to send the transaction. If `publicClient.call` is not available, direct mode skips that preflight step.

## Indexed Verification

The SDK does not treat any query result as sufficient by itself. It first checks subgraph progress:

```graphql
{
  _meta {
    block {
      number
    }
  }
}
```

Only after the subgraph has reached the receipt block does the SDK check the expected derived state.

Built-in verifiers cover:

- record exists after `publish` / `update`
- record no longer exists after `remove`
- writer permission active after `grantWriter`
- writer permission inactive after `revokeWriter`

For application-specific calls, pass `indexedVerifier`.

## Operation Persistence

Provide `operationStore` when the frontend needs retry or recovery across reloads.

The SDK stores:

- `operationId`
- signed forward request
- `requestId`
- transaction hashes
- current status

If a request was signed but not submitted, `resumeOperation` can resubmit the same signed request. This avoids consuming a new forwarder nonce.

```ts
const recovered = await client.resumeOperation(operationId);
```

Current resume behavior:

- if there is a signed request but no `requestId`, the SDK can resubmit the same request
- if there is a `requestId`, the SDK can query relay status
- if there is a transaction hash, the SDK can recover receipt state
- it does not automatically re-run application-specific indexed verification during resume
- it does not yet automatically retry a saved `storage_uploaded` operation; callers should preserve the returned storage result and retry the registration path

## Error Handling

Errors are exposed as `StorailError` with stable codes.

Common codes:

- `VALIDATION_ERROR`
- `SIGNATURE_REJECTED`
- `FORWARDER_NONCE_CHANGED`
- `CONTRACT_REVERTED`
- `RATE_LIMITED`
- `RELAYER_POOL_EXHAUSTED`
- `RPC_UNAVAILABLE`
- `RELAY_UNAVAILABLE`
- `TRANSACTION_REVERTED`
- `INDEXING_DELAYED`
- `STORAGE_FAILED`
- `REGISTRATION_FAILED`
- `FAILED`

Applications should branch on `error.code`, not on RPC or relay text.

For storage-backed operations:

- `storage_failed` means no domain write was attempted.
- `registration_failed` means content was uploaded and has a CID, but the domain write did not complete.
- `confirmed` means the domain write is on-chain.
- `indexed` means the public-domain subgraph can serve the updated pointer.
