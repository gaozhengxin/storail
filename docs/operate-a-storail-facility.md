# Operate A Storail Facility

This page is for infrastructure operators who deploy and run Storail as a shared facility.

An operator provides:

- `AuthorizedEventHub`
- ERC-2771 forwarder
- public-domain subgraph
- relay worker
- storage proxy
- relayer EOA pool
- provider-side storage credentials
- API keys for application developers

Application developers consume these endpoints through the SDK. They should not receive relayer private keys or storage-provider API keys.

## Configuration

Start from the `.env.example` file next to the component you operate:

```text
scripts/operator/.env.example
packages/operator/public-domain-subgraph/.env.example
packages/operator/relay-worker/.env.example
```

Operator configuration includes:

- deployer private key
- chain RPC URL
- Graph deploy key and public-domain subgraph slug
- relay worker URL
- relayer private keys or worker secrets
- Lighthouse API key or other storage-provider credentials
- API key seed used to derive developer-facing facility API keys
- API usage limits for relay and storage-proxy requests
- optional explorer verification key

## API Keys

The relay worker protects relay and storage-proxy endpoints with API keys. Configure a random `API_KEY_SEED` as a Worker secret, then generate developer keys locally:

```sh
cd packages/operator/relay-worker
API_KEY_SEED=... pnpm generate:api-key -- --key-id developer-demo
```

Give the generated key to the developer. The SDK sends it as `Authorization: Bearer <key>`.

Keys are deterministic HMAC derivations from the seed and key id. The worker stores only the seed and can verify any derived key without storing a key list. Rotating the seed invalidates all issued keys.

Generated keys include a random key nonce, so the same key id can have multiple active keys:

```text
strl_<keyId>_<keyNonce>_<secret>
```

Pass `--nonce <value>` only when you need reproducible output for a specific key.

Usage is tracked per key id in Durable Objects. Relay requests and storage uploads share one abstract unit budget; storage is weighted higher because provider storage plans are usually the larger and longer-lived operator cost. Configure the default buckets with:

```text
API_USAGE_MAX_UNITS_PER_HOUR
API_USAGE_MAX_UNITS_PER_DAY
API_USAGE_RELAY_BASE_UNITS
API_USAGE_RELAY_GAS_UNIT_DIVISOR
API_USAGE_STORAGE_BASE_UNITS
API_USAGE_STORAGE_BYTES_PER_UNIT
API_USAGE_STORAGE_UNIT_MULTIPLIER
```

When a key exceeds a bucket, the worker returns HTTP 429 with `API_KEY_USAGE_EXCEEDED` and a retry-after value.

The default storage upload limit is 4 MiB:

```text
STORAGE_MAX_UPLOAD_BYTES=4194304
```

This limit applies to the bytes sent to the storage provider. If SDK-side encryption is enabled, the encrypted payload and authentication tags count toward the limit.

## Packages

Operator packages live under:

```text
packages/operator/
```

Current operator packages:

- `public-domain-subgraph`
- `relay-worker`

The contracts package remains at the repository root because it contains both facility contracts and developer app templates.

## Deployment Shape

The operator deployment flow is:

1. deploy `AuthorizedEventHub` and forwarder
2. update subgraph manifests from the deployment output
3. deploy the public-domain subgraph
4. deploy the relay worker and configure secrets
5. fund relayer accounts
6. run the project e2e flow

Useful scripts:

```sh
pnpm deploy:operator:aeh:arbitrum-sepolia
pnpm deploy:operator:subgraph:studio
pnpm deploy:operator:relay-worker
pnpm e2e:arbitrum-sepolia
```

The project e2e script reads local testnet configuration from component-local files, especially `scripts/e2e/.env` and the operator package `.env` files.

## E2E

The project-level e2e entry point is:

```sh
scripts/e2e/run-arbitrum-sepolia.sh
```

It checks the facility, public-domain mutations, SDK flow, storage upload and registration, and payment demo behavior. It is also available as the manual `Testnet E2E` GitHub workflow.
