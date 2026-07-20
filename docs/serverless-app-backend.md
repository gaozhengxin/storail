# Build A Serverless App Backend

This guide shows the shape of a Storail backend for general app data.

The goal is to replace the parts of a traditional backend that store low-frequency app objects, user-owned records, object metadata, write permissions, and audit history. The app can be deployed quickly because the stack is contracts, subgraph, relay, SDK, and frontend. There is no application server to operate, and writes are paid for only when they happen.

The current SDK is still evolving. Treat this as the project structure and operation flow, not as a final API reference.

Before using an official Storail facility, get a facility API key for relay and storage-proxy access. Request one through [Contact](contact.md), then configure it as `STORAIL_API_KEY` for the SDK.

## 1. Choose App Records

Start with records that are useful as public or auditable app state.

Examples:

- user profile
- avatar
- user asset
- project record
- public app setting
- attachment metadata

Avoid using this path for high-frequency counters, private data, or data that needs hidden server-side logic.

## 2. Choose Path Conventions

Use paths that make ownership and query patterns explicit.

Examples:

```text
/<user-address>/profile
/<user-address>/profile/avatar
/<user-address>/assets/<asset-id>
/<app-address>/objects/<object-id>
/<app-address>/projects/<project-id>
```

The first segment is the namespace owner. The owner can write under that namespace and can grant writers to a path prefix.

## 3. Store Object Bytes

Upload the object to Lighthouse or another content-addressed provider.

Lighthouse is the default storage provider supported by the SDK. It uses an API key and returns an IPFS CID for each uploaded object.

Use the Lighthouse dashboard or CLI to create an API key, then configure it in the worker environment. The frontend SDK calls the worker storage proxy and never receives the provider API key. Storacha is still tracked as a possible provider, but it is currently blocked by service-side upload capability in this project environment.

Configure the provider:

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

Expected result shape:

```ts
{
  providerId: "pinata",
  pointer: "bafy...",
  contentHash: "0x...",
}
```

The app should verify content hashes on download. The storage provider is not a source of correctness.

The relay and storage proxy require a facility API key. For the official Storail provider, request a key by emailing `defa.crypto@proton.me` with the project name and expected usage.

If the object should not be readable by the storage provider or by anyone who knows the CID, enable SDK-side encryption:

```ts
await client.write.replace({
  path: `/${userAddress}/profile/private-note`,
  content: JSON.stringify(note),
  contentType: "application/json",
  encryption: true,
});
```

The SDK derives the encryption key from the user's wallet signature, encrypts locally in 64 KiB blocks by default, and uploads only ciphertext.

## 4. Publish The Object Reference

Record the object reference in `AuthorizedEventHub`. For object-storage-like records, prefer `uploadAndUpdate` so the logical path stays stable and the public-domain subgraph exposes the latest pointer.

```ts
await client.uploadAndUpdate({
  path: `/${userAddress}/profile/avatar`,
  name: "avatar.png",
  content: file,
  contentType: "image/png",
  metadata: { purpose: "avatar" },
});
```

The relay path is the default. Use `{ mode: "direct" }` only when the user should pay gas directly.

## 5. Update Or Remove Objects

Use the same path for replacement:

```ts
await client.uploadAndUpdate({
  path,
  name,
  content,
  contentType,
  metadata,
});
```

Remove the active reference:

```ts
await client.remove({ path });
```

The event history remains on-chain. The subgraph derives the current visible record.

## 6. Delegate Writes

Grant a writer for a specific path prefix:

```ts
await client.grantWriter({
  domain: `/${userAddress}/assets`,
  writer,
});
```

The writer can mutate that domain and child paths. The namespace owner keeps authority.

## 7. Read Through The Subgraph

Use the public-domain subgraph to list records and current pointers.

Typical queries:

- profile object by path
- assets under a user prefix
- writer permissions for a domain
- recent mutations for audit views

Wait for `indexed` before assuming the subgraph read model has caught up to a mutation.

## 8. Frontend Operation Handling

Use SDK operation states:

```text
storage_uploading -> storage_uploaded -> registering -> submitted -> confirmed -> indexed
```

`confirmed` means the write is on-chain. `indexed` means the subgraph can serve the updated read model.

For app backend UX:

- show the local upload immediately
- preserve the returned CID if the operation reaches `storage_uploaded`
- show `confirmed` when the AEH mutation is mined
- refetch lists after `indexed`

Failure handling:

- `storage_failed`: retry the upload and registration together.
- `registration_failed`: do not re-upload blindly; keep the returned storage result and retry domain registration from that saved result.
- `indexing_delayed`: the chain write is already confirmed; wait and refetch through the subgraph.
