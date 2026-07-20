# Storail Documentation

This documentation is generated with AI assistance. If any description conflicts with the repository source code, deployed contract code, or generated artifacts, the code and artifacts are authoritative.

Storail is an EVM-based event log stack for low-frequency application state.

The stack has three separate responsibilities:

- `AuthorizedEventHub` records permissioned events on an EVM chain.
- A subgraph derives queryable state by replaying those events.
- An optional ERC-2771 relay lets users submit gasless writes.

The EVM chain is the source of correctness. The relay can submit transactions, but it cannot create authority. The subgraph provides a read model, but it does not replace the event log.

Storail records events and object references. It does not store large payloads. A public-domain record contains:

- `path`
- `providerId`
- `pointer`
- `contentHash`
- `metadata`

The `pointer` normally refers to content stored elsewhere. The `contentHash` is the value a client can use to verify that content.

## Paths And Namespaces

Every path starts with an owner address:

```text
/<owner-address>/...
```

The first path segment defines the namespace owner. The owner can write under that namespace and can grant a writer permission over a specific path prefix.

For example:

```text
/0xabc.../apps/example/inbox
```

A writer granted permission for that path can write that path and its children. The owner keeps authority over the same space.

## Public-Domain Mutations

The public-domain mutation set is:

- `publish`
- `update`
- `remove`
- `grantWriter`
- `revokeWriter`

The contract emits events for these mutations. The public-domain subgraph reconstructs current records and writer permissions from the event stream.

## Confirmed Versus Indexed

`confirmed` means the transaction is on-chain with the configured confirmation threshold.

`indexed` means the subgraph has processed at least the receipt block and the expected derived state is visible.

Applications should treat `confirmed` as the chain-success boundary and `indexed` as the UI-read-model boundary.

## Two User Roles

Storail has two user roles.

### Operate A Storail Facility

Use this path if you deploy and run the shared infrastructure:

- `AuthorizedEventHub`
- public-domain subgraph
- relay worker
- storage proxy
- relayer EOA pool
- provider-side storage credentials

This role is similar to operating an open-source cloud facility. The operator can be the Storail project, a third-party provider, or a developer self-hosting their own facility.

Start here:

- [Operate A Storail Facility](operate-a-storail-facility.md)

### Build On Storail

Use this path if you build an app on an existing Storail facility.

The developer uses provider endpoints, imports the SDK, writes domain records, and reads through subgraphs. The developer does not need relayer private keys or storage-provider API keys.

Start here:

- [Build On Storail](build-on-storail.md)

## Two Application Paths

Storail currently supports two main application paths.

### Serverless App Backend

Use Storail as a general serverless backend for app developers. The domain system records object references, permissions, and audit history. Storacha-style content storage keeps the bytes.

This path is designed for quick deployment and low operating cost. There is no application server to run, and writes are paid for only when an operation is submitted.

This path is for:

- user profiles
- user assets
- avatars and attachments
- public app settings
- low-frequency object metadata
- shared project records

Start here:

- [Build A Serverless App Backend](serverless-app-backend.md)

### Dedicated L2 App

Use `AuthorizedEventHub` to quickly deploy a dedicated L2-style app. The app gets its own command format, hook contract, event stream, and subgraph-derived state machine.

This path is for apps that need their own command format, hook contract, and subgraph replay logic. The payment demo is the current reference shape.

Registered applications receive actions through `AuthorizedEventHub.submitToApp`. The application contract handles the hook and emits ordinary AEH mutations under its own namespace. An application-specific subgraph then replays those records as a state machine.

Start here:

- [Build A Dedicated L2 App](dedicated-l2-app.md)

## Reference

- [SDK Interface Guide](sdk.md)
- [Current Deployments](deployments.md)
- [Contact](contact.md)

Codex task history, internal notes, and deployment records live under `codex/`.
