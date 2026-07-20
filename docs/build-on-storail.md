# Build On Storail

This page is for application developers using an existing Storail facility.

A facility provider should give you:

- chain id
- `AuthorizedEventHub` address
- ERC-2771 forwarder address
- relay worker URL
- public-domain subgraph query URL
- optional app-specific subgraph query URLs

You should not need operator relayer keys or storage-provider API keys.

## Configuration

Start from the SDK-local example:

```text
packages/developer/sdk/.env.example
```

If you are working with the payment demo, also check:

```text
packages/developer/payment-demo-subgraph/.env.example
```

## Packages

Developer-facing packages live under:

```text
packages/developer/
```

Current developer packages:

- `sdk`
- `payment-demo-subgraph`

## SDK Path

Most apps should start with the SDK:

```ts
import { createStorailMutationClient } from "@storail/sdk";
```

Use the SDK to write public-domain records, upload content through the provider's storage proxy, and track the lifecycle from signing to `confirmed` and `indexed`.

Continue with:

- [SDK Interface Guide](sdk.md)
- [Build A Serverless App Backend](serverless-app-backend.md)

## Dedicated App Path

If your app needs its own command format and derived state machine, use `AuthorizedEventHub` with an app hook contract and app-specific subgraph.

Continue with:

- [Build A Dedicated L2 App](dedicated-l2-app.md)
